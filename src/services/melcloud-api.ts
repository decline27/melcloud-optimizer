import * as https from 'https';
import { URL } from 'url';
import { Logger } from '../util/logger';
import { DeviceInfo, MelCloudDevice, HomeySettings } from '../types';
import { ErrorHandler, AppError, ErrorCategory } from '../util/error-handler';

// Add global declaration for homeySettings and logger
declare global {
  var homeySettings: HomeySettings;
  var logger: Logger;
}

/**
 * MELCloud API Service
 * Handles communication with the MELCloud API
 * Uses Node.js built-in https module for better compatibility with Homey
 */
export class MelCloudApi {
  private baseUrl = 'https://app.melcloud.com/Mitsubishi.Wifi.Client/';
  private contextKey: string | null = null;
  private devices: any[] = [];
  private logger: Logger;
  private lastApiCallTime: number = 0;
  private minApiCallInterval: number = 2000; // 2 seconds minimum between calls
  private cache: Map<string, { data: any; timestamp: number }> = new Map();
  private cacheTTL: number = 5 * 60 * 1000; // 5 minutes default TTL
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 5000; // 5 seconds initial delay
  private reconnectTimers: NodeJS.Timeout[] = [];
  private errorHandler: ErrorHandler;

  /**
   * Constructor
   * @param logger Logger instance
   */
  constructor(logger?: Logger) {
    // Use the provided logger or try to get the global logger
    if (logger) {
      this.logger = logger;
    } else if (global.logger) {
      this.logger = global.logger;
    } else {
      // Create a default console logger if none provided (for tests)
      this.logger = {
        log: (message: string, ...args: any[]) => console.log(message, ...args),
        info: (message: string, ...args: any[]) => console.log(`INFO: ${message}`, ...args),
        error: (message: string, error?: Error | unknown, context?: Record<string, any>) => console.error(message, error, context),
        debug: (message: string, ...args: any[]) => console.debug(message, ...args),
        warn: (message: string, context?: Record<string, any>) => console.warn(message, context),
        api: (message: string, context?: Record<string, any>) => console.log(`API: ${message}`, context),
        optimization: (message: string, context?: Record<string, any>) => console.log(`OPTIMIZATION: ${message}`, context),
        notify: async (message: string) => Promise.resolve(),
        marker: (message: string) => console.log(`===== ${message} =====`),
        sendToTimeline: async (message: string, type?: 'info' | 'warning' | 'error') => Promise.resolve(),
        setLogLevel: () => {},
        setTimelineLogging: () => {},
        getLogLevel: () => 1, // INFO level
        enableCategory: () => {},
        disableCategory: () => {},
        isCategoryEnabled: () => true,
        formatValue: (value: any) => typeof value === 'object' ? JSON.stringify(value) : String(value)
      };
    }

    // Initialize error handler
    this.errorHandler = new ErrorHandler(this.logger);
  }

  /**
   * Log API call details
   * @param method HTTP method
   * @param endpoint API endpoint
   * @param params Optional parameters
   */
  private logApiCall(method: string, endpoint: string, params?: any): void {
    this.logger.api(`${method} ${endpoint}`, {
      method,
      endpoint,
      params: params || null,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Check if an error is a network error
   * @param error Error to check
   * @returns True if it's a network error
   */
  private isNetworkError(error: unknown): boolean {
    return error instanceof Error &&
      (error.message.includes('network') ||
       error.message.includes('timeout') ||
       error.message.includes('connection') ||
       error.message.includes('ENOTFOUND') ||
       error.message.includes('ETIMEDOUT'));
  }

  /**
   * Check if an error is an authentication error
   * @param error Error to check
   * @returns True if it's an authentication error
   */
  private isAuthError(error: unknown): boolean {
    return error instanceof Error &&
      (error.message.includes('auth') ||
       error.message.includes('credentials') ||
       error.message.includes('login') ||
       error.message.includes('Authentication') ||
       error.message.includes('X-MitsContextKey'));
  }

  /**
   * Create a standardized API error
   * @param error Original error
   * @param context Additional context
   * @param message Optional custom message
   * @returns AppError instance
   */
  private createApiError(error: unknown, context?: Record<string, any>, message?: string): AppError {
    return this.errorHandler.createAppError(error, {
      api: 'MELCloud',
      ...context
    }, message);
  }

  /**
   * Retryable request with exponential backoff
   * @param requestFn Function that returns a promise with the request
   * @param maxRetries Maximum number of retry attempts
   * @param retryDelay Initial delay between retries in ms
   * @returns Promise resolving to the request result
   */
  private async retryableRequest<T>(
    requestFn: () => Promise<T>,
    maxRetries: number = 3,
    retryDelay: number = 2000
  ): Promise<T> {
    let lastError: Error | unknown;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await requestFn();
      } catch (error) {
        lastError = error;

        // Check if it's a network error that we should retry
        if (this.isNetworkError(error)) {
          // Create a standardized error with context
          const appError = this.createApiError(error, {
            attempt,
            maxRetries,
            retryDelay,
            retryable: true
          });

          this.logger.warn(
            `Network error on attempt ${attempt}/${maxRetries}, retrying in ${retryDelay}ms: ${appError.message}`,
            { attempt, maxRetries, retryDelay }
          );

          // Wait before retrying
          await new Promise(resolve => setTimeout(resolve, retryDelay));

          // Increase delay for next attempt (exponential backoff)
          retryDelay *= 2;
        } else {
          // Not a retryable error
          throw this.createApiError(error, {
            attempt,
            maxRetries,
            retryable: false
          });
        }
      }
    }

    // If we get here, all retries failed
    throw this.createApiError(lastError, {
      allRetriesFailed: true,
      maxRetries
    }, `All ${maxRetries} retry attempts failed`);
  }

  /**
   * Ensure we have a valid connection to MELCloud
   * Attempts to reconnect if not connected
   */
  private async ensureConnected(): Promise<boolean> {
    if (this.contextKey) {
      return true; // Already connected
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logger.error(`Maximum reconnect attempts (${this.maxReconnectAttempts}) reached`);
      throw new Error('Failed to reconnect to MELCloud after multiple attempts');
    }

    this.reconnectAttempts++;

    try {
      // Get credentials from global settings
      const email = global.homeySettings?.get('melcloud_user');
      const password = global.homeySettings?.get('melcloud_pass');

      if (!email || !password) {
        throw new Error('MELCloud credentials not available');
      }

      this.logger.log(`Attempting to reconnect to MELCloud (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

      // Try to login
      const success = await this.login(email, password);

      if (success) {
        this.reconnectAttempts = 0; // Reset counter on success
        this.logger.log('Successfully reconnected to MELCloud');
        return true;
      } else {
        throw new Error('Login returned false');
      }
    } catch (error) {
      this.logger.error(`Failed to reconnect to MELCloud (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}):`, error);

      // Exponential backoff for next attempt
      const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
      this.logger.log(`Will retry in ${delay / 1000} seconds`);

      // Schedule retry
      const timer = setTimeout(() => {
        this.ensureConnected().catch(err => {
          this.logger.error('Scheduled reconnect failed:', err);
        });
      }, delay);

      // Store timer reference for cleanup
      this.reconnectTimers.push(timer);

      return false;
    }
  }

  /**
   * Get cached data if available and not expired
   * @param key Cache key
   * @returns Cached data or null if not found or expired
   */
  private getCachedData<T>(key: string): T | null {
    const cached = this.cache.get(key);

    if (!cached) {
      return null;
    }

    // Check if cache is still valid
    const now = Date.now();
    if (now - cached.timestamp > this.cacheTTL) {
      this.cache.delete(key);
      return null;
    }

    return cached.data as T;
  }

  /**
   * Set data in cache
   * @param key Cache key
   * @param data Data to cache
   */
  private setCachedData<T>(key: string, data: T): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  /**
   * Throttled API call to prevent rate limiting
   * @param method HTTP method
   * @param endpoint API endpoint
   * @param options Request options
   * @returns Promise resolving to API response
   */
  private async throttledApiCall<T>(
    method: string,
    endpoint: string,
    options: {
      headers?: Record<string, string> | Headers;
      body?: string;
    } = {}
  ): Promise<T> {
    // Ensure minimum time between API calls
    const now = Date.now();
    const timeSinceLastCall = now - this.lastApiCallTime;

    if (timeSinceLastCall < this.minApiCallInterval) {
      const waitTime = this.minApiCallInterval - timeSinceLastCall;
      this.logger.debug(`Throttling API call to ${endpoint}, waiting ${waitTime}ms`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    this.lastApiCallTime = Date.now();

    // Make the API call
    const fullUrl = `${this.baseUrl}${endpoint}`;
    this.logger.debug(`API Call: ${method} ${fullUrl}`);

    // Parse the URL
    const urlObj = new URL(fullUrl);

    // Create headers object as a plain object
    const headersObj: Record<string, string> = {
      'Accept': 'application/json'
    };

    // Add existing headers if any
    if (options.headers) {
      if (options.headers instanceof Headers) {
        options.headers.forEach((value, key) => {
          headersObj[key] = value;
        });
      } else if (typeof options.headers === 'object') {
        Object.assign(headersObj, options.headers);
      }
    }

    // Add context key if available
    if (this.contextKey) {
      headersObj['X-MitsContextKey'] = this.contextKey;
    }

    // Create request options
    const requestOptions = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: method,
      headers: headersObj
    };

    // Return a promise that resolves with the API response
    return new Promise<T>((resolve, reject) => {
      const req = https.request(requestOptions, (res) => {
        let data = '';

        // Collect data chunks
        res.on('data', (chunk) => {
          data += chunk;
        });

        // Process the complete response
        res.on('end', () => {
          // Check if the response is successful (2xx status code)
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              // Parse the JSON response
              const parsedData = JSON.parse(data);
              resolve(parsedData as T);
            } catch (error) {
              reject(new Error(`Failed to parse API response: ${error instanceof Error ? error.message : String(error)}`));
            }
          } else {
            reject(new Error(`API error: ${res.statusCode} ${res.statusMessage}`));
          }
        });
      });

      // Handle request errors
      req.on('error', (error) => {
        reject(new Error(`API request error: ${error.message}`));
      });

      // Send the request body if provided
      if (options.body) {
        req.write(options.body);
      }

      // End the request
      req.end();
    });
  }

  /**
   * Login to MELCloud
   * @param email MELCloud email
   * @param password MELCloud password
   * @returns Promise resolving to login success
   */
  async login(email: string, password: string): Promise<boolean> {
    this.logApiCall('POST', 'Login/ClientLogin', { Email: email });

    try {
      const data = await this.retryableRequest(
        () => this.throttledApiCall<any>('POST', 'Login/ClientLogin', {
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            Email: email,
            Password: password,
            Language: 0,
            AppVersion: '1.23.4.0',
            Persist: true,
            CaptchaResponse: null,
          }),
        })
      );

      if (data.ErrorId !== null) {
        throw new Error(`MELCloud login failed: ${data.ErrorMessage}`);
      }

      this.contextKey = data.LoginData.ContextKey;
      this.logger.log('MELCloud login successful');

      // Reset reconnect attempts on successful login
      this.reconnectAttempts = 0;

      return true;
    } catch (error) {
      // Create a standardized error with context
      const appError = this.createApiError(error, {
        operation: 'login',
        email: email ? `${email.substring(0, 3)}...` : 'not provided', // Only include first 3 chars for privacy
      });

      // Log the error with appropriate level based on category
      this.errorHandler.logError(appError);

      // Throw the standardized error
      throw appError;
    }
  }

  /**
   * Get devices from MELCloud
   * @returns Promise resolving to devices array
   */
  async getDevices(): Promise<DeviceInfo[]> {
    try {
      if (!this.contextKey) {
        const connected = await this.ensureConnected();
        if (!connected) {
          throw new Error('Not logged in to MELCloud');
        }
      }

      this.logApiCall('GET', 'User/ListDevices');

      try {
        const data = await this.retryableRequest(
          () => this.throttledApiCall<any[]>('GET', 'User/ListDevices')
        );

        this.devices = this.extractDevices(data);
        this.logger.log(`MELCloud devices retrieved: ${this.devices.length} devices found`);
        return this.devices;
      } catch (error) {
        // Create a standardized error with context
        const appError = this.createApiError(error, {
          operation: 'getDevices'
        });

        // For authentication errors, try to reconnect
        if (appError.category === ErrorCategory.AUTHENTICATION) {
          this.logger.warn('Authentication error in MELCloud getDevices, attempting to reconnect');

          // Try to reconnect on auth error
          await this.ensureConnected();
        }

        // Log the error with appropriate level based on category
        this.errorHandler.logError(appError);

        // Throw the standardized error
        throw appError;
      }
    } catch (error) {
      // If this is already an AppError, just rethrow it
      if (error instanceof AppError) {
        throw error;
      }

      // Otherwise, create and log a standardized error
      const appError = this.createApiError(error, {
        operation: 'getDevices',
        outerCatch: true
      });

      this.errorHandler.logError(appError);
      throw appError;
    }
  }

  /**
   * Extract devices from MELCloud response
   * @param data MELCloud response data
   * @returns Array of devices
   */
  private extractDevices(data: any[]): any[] {
    const devices: any[] = [];

    // Process each building
    data.forEach(building => {
      if (building.Structure && building.Structure.Devices) {
        building.Structure.Devices.forEach((device: any) => {
          devices.push({
            id: device.DeviceID,
            name: device.DeviceName,
            buildingId: building.ID,
            type: 'heat_pump',
            data: device,
          });
        });
      }
    });

    return devices;
  }

  /**
   * Get device by ID
   * @param deviceId Device ID
   * @returns Device object or null if not found
   */
  getDeviceById(deviceId: string): any {
    return this.devices.find(device => device.id === deviceId) || null;
  }

  /**
   * Get weekly average COP (Coefficient of Performance) for a device
   * @param deviceId Device ID
   * @param buildingId Building ID
   * @returns Promise resolving to COP values for heating and hot water
   */
  async getWeeklyAverageCOP(deviceId: string, buildingId: number): Promise<{ heating: number; hotWater: number }> {
    try {
      // Get device state to access energy data
      const deviceState = await this.getDeviceState(deviceId, buildingId);

      // Calculate COP for heating
      let heatingCOP = 0;
      if (deviceState.DailyHeatingEnergyProduced && deviceState.DailyHeatingEnergyConsumed) {
        if (deviceState.DailyHeatingEnergyConsumed > 0) {
          heatingCOP = deviceState.DailyHeatingEnergyProduced / deviceState.DailyHeatingEnergyConsumed;
        }
      }

      // Calculate COP for hot water
      let hotWaterCOP = 0;
      if (deviceState.DailyHotWaterEnergyProduced && deviceState.DailyHotWaterEnergyConsumed) {
        if (deviceState.DailyHotWaterEnergyConsumed > 0) {
          hotWaterCOP = deviceState.DailyHotWaterEnergyProduced / deviceState.DailyHotWaterEnergyConsumed;
        }
      }

      this.logger.log(`Weekly average COP for device ${deviceId}: Heating=${heatingCOP.toFixed(2)}, Hot Water=${hotWaterCOP.toFixed(2)}`);

      return {
        heating: heatingCOP,
        hotWater: hotWaterCOP
      };
    } catch (error) {
      this.logger.warn(`Failed to get weekly average COP for device ${deviceId}:`, {
        deviceId,
        buildingId,
        error: error instanceof Error ? error.message : String(error)
      });
      return {
        heating: 0,
        hotWater: 0
      };
    }
  }

  /**
   * Get device state
   * @param deviceId Device ID
   * @param buildingId Building ID
   * @returns Promise resolving to device state
   */
  async getDeviceState(deviceId: string, buildingId: number): Promise<MelCloudDevice> {
    try {
      if (!this.contextKey) {
        const connected = await this.ensureConnected();
        if (!connected) {
          throw new Error('Not logged in to MELCloud');
        }
      }

      const cacheKey = `device_state_${deviceId}_${buildingId}`;
      const cachedData = this.getCachedData<any>(cacheKey);

      if (cachedData) {
        this.logger.debug(`Using cached device state for device ${deviceId}`);
        return cachedData;
      }

      this.logApiCall('GET', `Device/Get?id=${deviceId}&buildingID=${buildingId}`);

      try {
        const data = await this.retryableRequest(
          () => this.throttledApiCall<any>('GET', `Device/Get?id=${deviceId}&buildingID=${buildingId}`)
        );

        this.logger.log(`MELCloud device state retrieved for device ${deviceId}`);

        // Cache the result
        this.setCachedData(cacheKey, data);

        return data;
      } catch (error) {
        // Create a standardized error with context
        const appError = this.createApiError(error, {
          operation: 'getDeviceState',
          deviceId,
          buildingId
        });

        // For authentication errors, try to reconnect
        if (appError.category === ErrorCategory.AUTHENTICATION) {
          this.logger.warn(`Authentication error in MELCloud getDeviceState for device ${deviceId}, attempting to reconnect`);

          // Try to reconnect on auth error
          await this.ensureConnected();
        }

        // Log the error with appropriate level based on category
        this.errorHandler.logError(appError);

        // Throw the standardized error
        throw appError;
      }
    } catch (error) {
      // If this is already an AppError, just rethrow it
      if (error instanceof AppError) {
        throw error;
      }

      // Otherwise, create and log a standardized error
      const appError = this.createApiError(error, {
        operation: 'getDeviceState',
        deviceId,
        buildingId,
        outerCatch: true
      });

      this.errorHandler.logError(appError);
      throw appError;
    }
  }

  /**
   * Clean up any pending timers and resources
   * This is important for tests to prevent memory leaks and lingering timers
   */
  cleanup(): void {
    // Clear all reconnect timers
    for (const timer of this.reconnectTimers) {
      clearTimeout(timer);
    }
    this.reconnectTimers = [];

    // Reset state
    this.reconnectAttempts = 0;
    this.contextKey = null;
  }

  /**
   * Set device temperature
   * @param deviceId Device ID
   * @param buildingId Building ID
   * @param temperature Target temperature
   * @returns Promise resolving to success
   */
  async setDeviceTemperature(deviceId: string, buildingId: number, temperature: number): Promise<boolean> {
    try {
      if (!this.contextKey) {
        const connected = await this.ensureConnected();
        if (!connected) {
          throw new Error('Not logged in to MELCloud');
        }
      }

      this.logger.log(`Setting temperature for device ${deviceId} to ${temperature}°C`);

      try {
        // First get current state
        const currentState = await this.getDeviceState(deviceId, buildingId);

        // Update temperature
        currentState.SetTemperature = temperature;

        this.logApiCall('POST', 'Device/SetAta', { deviceId, temperature });

        // Send update with retry
        const data = await this.retryableRequest(
          () => this.throttledApiCall<any>('POST', 'Device/SetAta', {
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(currentState),
          })
        );

        const success = data !== null;

        if (success) {
          this.logger.log(`Successfully set temperature for device ${deviceId} to ${temperature}°C`);
        } else {
          this.logger.error(`Failed to set temperature for device ${deviceId}`);
        }

        return success;
      } catch (error) {
        // Create a standardized error with context
        const appError = this.createApiError(error, {
          operation: 'setDeviceTemperature',
          deviceId,
          buildingId,
          temperature
        });

        // For authentication errors, try to reconnect
        if (appError.category === ErrorCategory.AUTHENTICATION) {
          this.logger.warn(`Authentication error in MELCloud setDeviceTemperature for device ${deviceId}, attempting to reconnect`);

          // Try to reconnect on auth error
          await this.ensureConnected();
        }

        // Log the error with appropriate level based on category
        this.errorHandler.logError(appError);

        // Throw the standardized error
        throw appError;
      }
    } catch (error) {
      // If this is already an AppError, just rethrow it
      if (error instanceof AppError) {
        throw error;
      }

      // Otherwise, create and log a standardized error
      const appError = this.createApiError(error, {
        operation: 'setDeviceTemperature',
        deviceId,
        buildingId,
        temperature,
        outerCatch: true
      });

      this.errorHandler.logError(appError);
      throw appError;
    }
  }
}
