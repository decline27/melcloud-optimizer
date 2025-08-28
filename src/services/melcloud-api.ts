import * as https from 'https';
import { URL } from 'url';
import { Logger } from '../util/logger';
import { DeviceInfo, MelCloudDevice, HomeySettings } from '../types';
import { ErrorHandler, AppError, ErrorCategory } from '../util/error-handler';
import { BaseApiService } from './base-api-service';
import { TimeZoneHelper } from '../util/time-zone-helper';

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
export class MelCloudApi extends BaseApiService {
  private baseUrl = 'https://app.melcloud.com/Mitsubishi.Wifi.Client/';
  private contextKey: string | null = null;
  private devices: any[] = [];
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 5000; // 5 seconds initial delay
  private reconnectTimers: NodeJS.Timeout[] = [];
  private timeZoneHelper: TimeZoneHelper;
  
  // Request deduplication and global rate limiting
  private pendingRequests = new Map<string, Promise<any>>();
  private static globalLastApiCall: number = 0;
  private static globalMinInterval: number = 15000; // 15 seconds between any MELCloud API calls globally

  /**
   * Constructor
   * @param logger Logger instance
   */
  constructor(logger?: Logger) {
    // Call the parent constructor with service name and logger
    super('MELCloud', logger || (global.logger as Logger), {
      failureThreshold: 5, // Allow more failures for temperature control operations
      resetTimeout: 180000, // 3 minutes reset timeout (was 10 minutes)
      halfOpenSuccessThreshold: 1, // Only need 1 success to close (was 2)
      timeout: 30000 // 30 seconds timeout
    });

    // Initialize time zone helper
    this.timeZoneHelper = new TimeZoneHelper(this.logger);

    // In test environments, disable global throttling to keep tests fast
    const isTestEnv = process.env.NODE_ENV === 'test' || typeof (global as any).jest !== 'undefined' || typeof (process as any).env?.JEST_WORKER_ID !== 'undefined';
    if (isTestEnv) {
      (MelCloudApi as any).globalMinInterval = 0;
    }
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
   * Ensure we have a valid connection to MELCloud
   * Attempts to reconnect if not connected
   */
  private async ensureConnected(): Promise<boolean> {
    if (this.contextKey) {
      return true; // Already connected
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logger.error(`Maximum reconnect attempts (${this.maxReconnectAttempts}) reached`);
      // Clear any pending timers before throwing
      this.clearReconnectTimers();
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
        // Clear any pending timers on successful reconnection
        this.clearReconnectTimers();
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

      // Clear any existing timers before creating a new one
      this.clearReconnectTimers();

      // Schedule retry
      const timer = setTimeout(() => {
        // Remove this timer from the array once it executes
        const index = this.reconnectTimers.indexOf(timer);
        if (index !== -1) {
          this.reconnectTimers.splice(index, 1);
        }

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
   * Clear all reconnect timers to prevent memory leaks
   */
  private clearReconnectTimers(): void {
    // Clear all existing timers
    for (const timer of this.reconnectTimers) {
      clearTimeout(timer);
    }
    // Reset the array
    this.reconnectTimers = [];
  }

  /**
   * Generate a unique key for request deduplication (Task 1.2)
   * @param method HTTP method
   * @param endpoint API endpoint
   * @param options Request options
   * @returns Unique request key
   */
  private getRequestKey(method: string, endpoint: string, options?: { body?: string }): string {
    return `${method}:${endpoint}:${JSON.stringify(options?.body || {})}`;
  }

  /**
   * Throttled API call to prevent rate limiting (enhanced with deduplication - Task 1.2)
   * @param method HTTP method
   * @param endpoint API endpoint
   * @param options Request options
   * @param isCritical Optional flag to bypass circuit breaker for critical operations
   * @returns Promise resolving to API response
   */
  private async throttledApiCall<T>(
    method: string,
    endpoint: string,
    options: {
      headers?: Record<string, string>;
      body?: string;
    } = {},
    isCritical: boolean = false
  ): Promise<T> {
    // Check for duplicate requests (Task 1.2)
    const requestKey = this.getRequestKey(method, endpoint, options);
    
    // If same request is already pending, return existing promise
    if (this.pendingRequests.has(requestKey)) {
      this.logger.log(`Duplicate API call detected for ${method} ${endpoint}, returning existing promise`);
      return this.pendingRequests.get(requestKey) as Promise<T>;
    }

    // Use circuit breaker to protect against cascading failures, but allow bypass for critical operations
    const executeRequest = async () => {
      // Global throttling across all MELCloud instances
      const now = Date.now();
      const timeSinceGlobalLastCall = now - MelCloudApi.globalLastApiCall;
      if (timeSinceGlobalLastCall < MelCloudApi.globalMinInterval) {
        const globalDelay = MelCloudApi.globalMinInterval - timeSinceGlobalLastCall;
        this.logger.debug(`Global throttling MELCloud API call, waiting ${globalDelay}ms`);
        await new Promise(resolve => setTimeout(resolve, globalDelay));
      }
      MelCloudApi.globalLastApiCall = Date.now();
      
      // Instance-specific throttle requests using the base class method
      await this.throttle();

      // Log the API call
      this.logApiCall(method, endpoint);

      // Make the API call
      const fullUrl = `${this.baseUrl}${endpoint}`;

      // Parse the URL
      const urlObj = new URL(fullUrl);

      // Create headers object as a plain object
      const headersObj: Record<string, string> = {
        'Accept': 'application/json'
      };

      // Add existing headers if any
      if (options.headers && typeof options.headers === 'object') {
        Object.assign(headersObj, options.headers);
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
          this.logger.error(`MELCloud API request error: ${error.message}`);
          reject(new Error(`API request error: ${error.message}`));
        });

        // Send the request body if provided
        if (options.body) {
          req.write(options.body);
        }

        // End the request
        req.end();
      });
    };

    // Execute with or without circuit breaker based on criticality
    if (isCritical) {
      this.logger.debug(`CRITICAL operation ${method} ${endpoint} - bypassing circuit breaker`);
    }
    const requestPromise = isCritical ? 
      executeRequest() : 
      this.circuitBreaker.execute(executeRequest);

    // Track the request promise (Task 1.2)
    this.pendingRequests.set(requestKey, requestPromise);

    // Clean up the tracking when request completes (success or failure)
    requestPromise
      .catch((error) => {
        // Log but don't rethrow here to avoid unhandled rejections in the tracking
        this.logger.debug(`Request ${requestKey} failed: ${error.message}`);
      })
      .finally(() => {
        this.pendingRequests.delete(requestKey);
      });

    return requestPromise;
  }

  /**
   * Login to MELCloud
   * @param email MELCloud email
   * @param password MELCloud password
   * @returns Promise resolving to login success
   */
  async login(email: string, password: string): Promise<boolean> {
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
   * Get devices from MELCloud with caching
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

      // Check cache for devices (1 hour TTL for device list)
      const cacheKey = 'device_list';
      const cachedDevices = this.getCachedData<DeviceInfo[]>(cacheKey);
      
      if (cachedDevices) {
        this.logger.debug('Using cached device list');
        return cachedDevices;
      }

      this.logApiCall('GET', 'User/ListDevices');

      try {
        const data = await this.retryableRequest(
          () => this.throttledApiCall<any[]>('GET', 'User/ListDevices')
        );

        this.devices = this.extractDevices(data);
        this.logger.log(`MELCloud devices retrieved: ${this.devices.length} devices found`);
        
        // Cache the device list with 1-hour TTL
        this.setCachedData(cacheKey, this.devices, 60 * 60 * 1000);
        
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

    // Debug logging to see the actual API response structure
    this.logger.debug('MELCloud API response structure:', JSON.stringify(data, null, 2));

    // Check if data is an array
    if (!Array.isArray(data)) {
      this.logger.log('MELCloud API response is not an array. Using as a single building.');
      data = [data];
    }

    this.logger.log(`Processing ${data.length} buildings from MELCloud`);

    // Process each building
    data.forEach((building, buildingIndex) => {
      this.logger.log(`Building: ${building.Name || 'Unknown'} (ID: ${building.ID || 'Unknown'})`);

      // Debug logging for building structure
      this.logger.debug(`Building structure keys: ${Object.keys(building).join(', ')}`);

      // Deep search for devices in the building object
      const foundDevices = this.findDevicesInObject(building, building.ID);

      if (foundDevices.length > 0) {
        this.logger.log(`Found ${foundDevices.length} devices in building ${building.Name || 'Unknown'}`);
        devices.push(...foundDevices);
      } else {
        this.logger.debug(`No devices found in building ${building.Name || 'Unknown'} - skipping.`);
      }
    });

    this.logger.log(`Total devices extracted: ${devices.length}`);
    return devices;
  }

  /**
   * Helper method to recursively find devices in an object
   */
  private findDevicesInObject(obj: any, buildingId: number, path: string = '', foundDeviceIds: Set<string> = new Set()): any[] {
    const devices: any[] = [];

    // If this is null or not an object, return empty array
    if (!obj || typeof obj !== 'object') {
      return devices;
    }

    // If this is an array, search each item
    if (Array.isArray(obj)) {
      obj.forEach((item, index) => {
        const foundDevices = this.findDevicesInObject(item, buildingId, `${path}[${index}]`, foundDeviceIds);
        devices.push(...foundDevices);
      });
      return devices;
    }

    // Check if this object looks like a device
    if (obj.DeviceID !== undefined && obj.DeviceName !== undefined) {
      // Only add the device if we haven't seen this ID before
      if (!foundDeviceIds.has(obj.DeviceID)) {
        this.logger.debug(`Found device at ${path}: ${obj.DeviceName} (ID: ${obj.DeviceID})`);
        foundDeviceIds.add(obj.DeviceID);
        devices.push({
          id: obj.DeviceID,
          name: obj.DeviceName || `Device ${obj.DeviceID}`,
          buildingId: buildingId,
          type: 'heat_pump',
          data: obj,
        });
      } else {
        this.logger.debug(`Skipping duplicate device at ${path}: ${obj.DeviceName} (ID: ${obj.DeviceID})`);
      }
    }

    // Check if this is a device list
    if (obj.Devices && Array.isArray(obj.Devices)) {
      this.logger.debug(`Found device list at ${path} with ${obj.Devices.length} devices`);
      obj.Devices.forEach((device: any) => {
        if (device.DeviceID !== undefined) {
          // Only add the device if we haven't seen this ID before
          if (!foundDeviceIds.has(device.DeviceID)) {
            this.logger.debug(`  Device: ${device.DeviceName || 'Unknown'} (ID: ${device.DeviceID})`);
            foundDeviceIds.add(device.DeviceID);
            devices.push({
              id: device.DeviceID,
              name: device.DeviceName || `Device ${device.DeviceID}`,
              buildingId: buildingId,
              type: 'heat_pump',
              data: device,
            });
          } else {
            this.logger.debug(`  Skipping duplicate device: ${device.DeviceName || 'Unknown'} (ID: ${device.DeviceID})`);
          }
        }
      });
    }

    // Recursively search all properties
    Object.keys(obj).forEach(key => {
      // Skip some common properties that are unlikely to contain devices
      if (['ID', 'Name', 'Address', 'City', 'Country', 'PostalCode', 'Icon', 'Latitude', 'Longitude'].includes(key)) {
        return;
      }

      const foundDevices = this.findDevicesInObject(obj[key], buildingId, `${path}.${key}`, foundDeviceIds);
      devices.push(...foundDevices);
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
   * Get enhanced COP data including real-time calculations and predictions
   * @param deviceId Device ID  
   * @param buildingId Building ID
   * @returns Enhanced COP data with current values, trends and predictions
   */
  public async getEnhancedCOPData(deviceId: string, buildingId: number): Promise<{
    current: {
      heating: number;
      hotWater: number;
      outdoor: number;
      timestamp: Date;
    };
    daily: any;
    historical: any;
    trends: {
      heatingTrend: 'improving' | 'stable' | 'declining';
      hotWaterTrend: 'improving' | 'stable' | 'declining';
      averageHeating: number;
      averageHotWater: number;
    };
    predictions: {
      nextHourHeating: number;
      nextHourHotWater: number;
      confidenceLevel: number;
    };
  }> {
    try {
      // Get all required data in parallel for efficiency
      const [deviceState, energyTotals] = await Promise.all([
        this.getDeviceState(deviceId, buildingId),
        this.getDailyEnergyTotals(deviceId, buildingId)
      ]);

      // Calculate current real-time COP
      const currentHeatingCOP = this.calculateCurrentCOP(deviceState, 'heating');
      const currentHotWaterCOP = this.calculateCurrentCOP(deviceState, 'hotwater');

      // Analyze trends from energy totals
      const trends = this.analyzeCOPTrends(energyTotals);

      // Generate predictions based on outdoor temperature and historical data
      const predictions = this.predictNextHourCOP(
        {
          heatingCOP: currentHeatingCOP,
          hotWaterCOP: currentHotWaterCOP,
          outdoorTemp: deviceState.OutdoorTemperature
        },
        deviceState.OutdoorTemperature
      );

      return {
        current: {
          heating: currentHeatingCOP,
          hotWater: currentHotWaterCOP,
          outdoor: deviceState.OutdoorTemperature || 0,
          timestamp: new Date()
        },
        daily: energyTotals,
        // Historical fields kept for backward compatibility, but prefer explicit fields when available
        historical: {
          heating: (energyTotals.heatingCOP ?? energyTotals.averageCOP ?? energyTotals.AverageHeatingCOP) || 0,
          hotWater: (energyTotals.hotWaterCOP ?? energyTotals.averageCOP ?? energyTotals.AverageHotWaterCOP) || 0
        },
        trends,
        predictions
      };
    } catch (error) {
      this.logger.error('Error getting enhanced COP data:', error);
      throw new AppError(
        'Failed to get enhanced COP data',
        ErrorCategory.API,
        'ENHANCED_COP_FAILED',
        { deviceId, buildingId, error: String(error) }
      );
    }
  }

  /**
   * Calculate current real-time COP from device state
   * @param deviceState Current device state
   * @param mode Heating or hot water mode
   * @returns Current COP value
   */
  private calculateCurrentCOP(deviceState: any, mode: 'heating' | 'hotwater'): number {
    try {
      if (mode === 'heating') {
        // Try to use real-time power readings if available
        const powerConsumed = deviceState.CurrentHeatingPowerConsumption || 0;
        const powerProduced = deviceState.CurrentHeatingPowerProduction || 0;
        
        if (powerConsumed > 0.1) { // Avoid division by very small numbers
          return powerProduced / powerConsumed;
        }
        
        // Fallback to daily energy readings
        const energyConsumed = deviceState.DailyHeatingEnergyConsumed || 0;
        const energyProduced = deviceState.DailyHeatingEnergyProduced || 0;
        
        if (energyConsumed > 0) {
          return energyProduced / energyConsumed;
        }
      } else {
        // Hot water COP calculation
        const powerConsumed = deviceState.CurrentHotWaterPowerConsumption || 0;
        const powerProduced = deviceState.CurrentHotWaterPowerProduction || 0;
        
        if (powerConsumed > 0.1) {
          return powerProduced / powerConsumed;
        }
        
        // Fallback to daily energy readings
        const energyConsumed = deviceState.DailyHotWaterEnergyConsumed || 0;
        const energyProduced = deviceState.DailyHotWaterEnergyProduced || 0;
        
        if (energyConsumed > 0) {
          return energyProduced / energyConsumed;
        }
      }
      
      return 0; // No data available
    } catch (error) {
      this.logger.warn(`Error calculating current COP for ${mode}:`, {
        mode,
        error: error instanceof Error ? error.message : String(error)
      });
      return 0;
    }
  }

  /**
   * Analyze COP trends from historical data
   * @param energyData Historical energy data
   * @returns COP trend analysis
   */
  private analyzeCOPTrends(energyData: any): {
    heatingTrend: 'improving' | 'stable' | 'declining';
    hotWaterTrend: 'improving' | 'stable' | 'declining'; 
    averageHeating: number;
    averageHotWater: number;
  } {
    try {
      // Calculate average COP values
      const averageHeating = energyData.AverageHeatingCOP || 0;
      const averageHotWater = energyData.AverageHotWaterCOP || 0;

      // For now, provide basic trend analysis
      // In a more sophisticated implementation, this would analyze historical COP data over time
      let heatingTrend: 'improving' | 'stable' | 'declining' = 'stable';
      let hotWaterTrend: 'improving' | 'stable' | 'declining' = 'stable';

      // Simple trend analysis based on COP values relative to typical ranges
      if (averageHeating > 3.5) {
        heatingTrend = 'improving';
      } else if (averageHeating < 2.0) {
        heatingTrend = 'declining';
      }

      if (averageHotWater > 3.0) {
        hotWaterTrend = 'improving';
      } else if (averageHotWater < 2.0) {
        hotWaterTrend = 'declining';
      }

      return {
        heatingTrend,
        hotWaterTrend,
        averageHeating,
        averageHotWater
      };
    } catch (error) {
      this.logger.warn('Error analyzing COP trends:', {
        error: error instanceof Error ? error.message : String(error)
      });
      return {
        heatingTrend: 'stable',
        hotWaterTrend: 'stable',
        averageHeating: 0,
        averageHotWater: 0
      };
    }
  }

  /**
   * Predict next hour COP based on outdoor temperature and patterns
   * @param currentData Current COP and temperature data
   * @param predictedOutdoorTemp Predicted outdoor temperature
   * @returns COP predictions
   */
  private predictNextHourCOP(
    currentData: { heatingCOP: number; hotWaterCOP: number; outdoorTemp: number },
    predictedOutdoorTemp: number
  ): {
    nextHourHeating: number;
    nextHourHotWater: number;
    confidenceLevel: number;
  } {
    try {
      // Simple prediction model - in reality this would use more sophisticated algorithms
      const tempDelta = predictedOutdoorTemp - currentData.outdoorTemp;
      
      // Heating COP typically decreases as outdoor temperature decreases
      let predictedHeatingCOP = currentData.heatingCOP;
      if (tempDelta < -2) {
        predictedHeatingCOP = currentData.heatingCOP * 0.9; // COP decreases in colder weather
      } else if (tempDelta > 2) {
        predictedHeatingCOP = currentData.heatingCOP * 1.05; // COP improves in warmer weather
      }

      // Hot water COP is less affected by outdoor temperature
      let predictedHotWaterCOP = currentData.hotWaterCOP;
      if (Math.abs(tempDelta) > 5) {
        predictedHotWaterCOP = currentData.hotWaterCOP * 0.95; // Slight decrease in extreme conditions
      }

      // Confidence level based on data availability and temperature stability
      let confidenceLevel = 0.7; // Base confidence
      if (currentData.heatingCOP > 0 && currentData.hotWaterCOP > 0) {
        confidenceLevel = 0.8; // Higher confidence with real data
      }
      if (Math.abs(tempDelta) < 1) {
        confidenceLevel = Math.min(confidenceLevel + 0.1, 0.9); // Higher confidence with stable temperature
      }

      return {
        nextHourHeating: Math.max(predictedHeatingCOP, 0.5), // Minimum realistic COP
        nextHourHotWater: Math.max(predictedHotWaterCOP, 0.5),
        confidenceLevel
      };
    } catch (error) {
      this.logger.warn('Error predicting COP:', {
        error: error instanceof Error ? error.message : String(error)
      });
      return {
        nextHourHeating: currentData.heatingCOP || 2.5,
        nextHourHotWater: currentData.hotWaterCOP || 3.0,
        confidenceLevel: 0.3
      };
    }
  }

  /**
   * Get device state
   * @param deviceId Device ID
   * @param buildingId Building ID
   * @param forceRefresh Optional flag to bypass cache (use when making changes)
   * @returns Promise resolving to device state
   */
  async getDeviceState(deviceId: string, buildingId: number, forceRefresh?: boolean): Promise<MelCloudDevice> {
    try {
      if (!this.contextKey) {
        const connected = await this.ensureConnected();
        if (!connected) {
          throw new Error('Not logged in to MELCloud');
        }
      }

      const cacheKey = `device_state_${deviceId}_${buildingId}`;
      
      // Only use cache if we're not forcing refresh (i.e., not making temperature changes)
      if (!forceRefresh) {
        const cachedData = this.getCachedData<any>(cacheKey);
        if (cachedData) {
          this.logger.debug(`Using cached device state for device ${deviceId}`);
          return cachedData;
        }
      } else {
        this.logger.debug(`Forcing fresh device state for device ${deviceId} (bypassing cache)`);
      }

      this.logApiCall('GET', `Device/Get?id=${deviceId}&buildingID=${buildingId}`);

      try {
        const data = await this.retryableRequest(
          () => this.throttledApiCall<any>('GET', `Device/Get?id=${deviceId}&buildingID=${buildingId}`)
        );

        this.logger.log(`MELCloud device state retrieved for device ${deviceId}`);

        // Only cache if not forced refresh (i.e., this was a read-only operation)
        // Use shorter TTL for device state since it contains current temperature readings
        if (!forceRefresh) {
          this.setCachedData(cacheKey, data, 2 * 60 * 1000); // 2 minutes TTL for device state
        }

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
   * Invalidate device state cache after making changes
   * @param deviceId Device ID
   * @param buildingId Building ID
   */
  private invalidateDeviceStateCache(deviceId: string, buildingId: number): void {
    const cacheKey = `device_state_${deviceId}_${buildingId}`;
    this.cache.delete(cacheKey);
    this.logger.debug(`Invalidated device state cache for device ${deviceId}`);
  }

  /**
   * Emergency circuit breaker reset for critical operations
   * Use with caution - only when temperature control is blocked
   */
  public emergencyCircuitBreakerReset(): void {
    this.logger.warn('EMERGENCY: Resetting circuit breaker for critical temperature control');
    // Reset the circuit breaker state manually
    (this.circuitBreaker as any).state = 'CLOSED';
    (this.circuitBreaker as any).failures = 0;
    (this.circuitBreaker as any).successes = 0;
  }

  /**
   * Clean up any pending timers and resources
   * This is important for tests to prevent memory leaks and lingering timers
   */
  cleanup(): void {
    // Clear all reconnect timers using our helper method
    this.clearReconnectTimers();

    // Clear pending requests tracking (Task 1.2)
    this.pendingRequests.clear();

    // Reset state
    this.reconnectAttempts = 0;
    this.contextKey = null;

    // Call parent class cleanup to handle cache and circuit breaker
    super.cleanup();
  }

  /**
   * Set device temperature - FIXED VERSION (using simple reliable approach)
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

        // Detect device type (ATW vs ATA)
        // ATW devices usually have SetTemperatureZone1 and SetTankWaterTemperature fields
        const isATW = (
          currentState.SetTemperatureZone1 !== undefined ||
          currentState.SetTankWaterTemperature !== undefined
        );

        if (isATW) {
          // For ATW: update zone 1 temp and use SetAtw endpoint
          currentState.SetTemperatureZone1 = temperature;
          // Optionally update SetTemperature for compatibility
          currentState.SetTemperature = temperature;
          this.logApiCall('POST', 'Device/SetAtw', { deviceId, temperature });
          const data = await this.retryableRequest(
            () => this.throttledApiCall<any>('POST', 'Device/SetAtw', {
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(currentState),
            })
          );
          const success = data !== null;
          if (success) {
            this.logger.log(`Successfully set ATW temperature for device ${deviceId} to ${temperature}°C`);
            this.invalidateDeviceStateCache(deviceId, buildingId);
          } else {
            this.logger.error(`Failed to set ATW temperature for device ${deviceId}`);
          }
          return success;
        } else {
          // For ATA: update SetTemperature and use SetAta endpoint
          currentState.SetTemperature = temperature;
          this.logApiCall('POST', 'Device/SetAta', { deviceId, temperature });
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
            this.logger.log(`Successfully set ATA temperature for device ${deviceId} to ${temperature}°C`);
            this.invalidateDeviceStateCache(deviceId, buildingId);
          } else {
            this.logger.error(`Failed to set ATA temperature for device ${deviceId}`);
          }
          return success;
        }
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

  /**
   * Get energy consumption data for a device with enhanced caching and deduplication
   * @param deviceId Device ID
   * @param buildingId Building ID  
   * @param from Start date (ISO date string, optional)
   * @param to End date (ISO date string, optional)
   * @returns Energy data
   */
  public async getEnergyData(
    deviceId: string, 
    buildingId: number, 
    from?: string, 
    to?: string
  ): Promise<any> {
    const url = 'EnergyCost/Report';
    
    // Build the request body according to MELCloud API specification
    const postData = {
      DeviceID: parseInt(deviceId),
      FromDate: from || '1970-01-01',
      ToDate: to || new Date().toISOString().split('T')[0]
    };
    
    // Create cache key for energy data requests to prevent duplicate calls
    const energyDataCacheKey = `energy_data_${deviceId}_${postData.FromDate}_${postData.ToDate}`;
    const cachedEnergyData = this.getCachedData<any>(energyDataCacheKey);
    
    if (cachedEnergyData) {
      this.logger.debug(`Using cached energy data for device ${deviceId} (${postData.FromDate} to ${postData.ToDate})`);
      return cachedEnergyData;
    }
    
    this.logApiCall('POST', url, postData);
    
    const data = await this.retryableRequest(
      () => this.throttledApiCall<any>('POST', url, {
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(postData),
      })
    );

    // Log the actual API response for debugging
    this.logger?.info('Raw energy API response:', JSON.stringify(data, null, 2));

    // Cache the energy data result with 30-minute TTL to prevent duplicate API calls
    this.setCachedData(energyDataCacheKey, data, 30 * 60 * 1000);

    return data;
  }

  /**
   * Get daily energy totals for a device
   * Returns total consumed and produced energy values
   * @param deviceId Device ID
   * @param buildingId Building ID
   * @returns Daily energy totals
   */
  public async getDailyEnergyTotals(deviceId: string, buildingId: number): Promise<{
    TotalHeatingConsumed?: number;
    TotalHeatingProduced?: number;
    TotalHotWaterConsumed?: number;
    TotalHotWaterProduced?: number;
    TotalCoolingConsumed?: number;
    TotalCoolingProduced?: number;
    CoP?: number[];  // Include CoP array from API
    AverageHeatingCOP?: number;  // Calculated average heating COP
    AverageHotWaterCOP?: number; // Calculated average hot water COP
  // New explicit COP fields (preferred)
  heatingCOP?: number | null;
  hotWaterCOP?: number | null;
  coolingCOP?: number | null;
  averageCOP?: number | null;
    HasZone2?: boolean; // Include Zone 2 support flag from API
  }> {
    try {
      // Smart caching based on time - energy data changes less frequently at night
      const now = new Date();
      const hour = now.getHours();
      let cacheDuration: number;
      
      if (hour >= 23 || hour <= 5) {
        // Night hours: cache for 2 hours (less activity)
        cacheDuration = 2 * 60 * 60 * 1000;
      } else if (hour >= 6 && hour <= 8) {
        // Morning peak: cache for 15 minutes (more frequent updates needed)
        cacheDuration = 15 * 60 * 1000;
      } else {
        // Regular hours: cache for 45 minutes
        cacheDuration = 45 * 60 * 1000;
      }
      
      const cacheKey = `energy_totals_${deviceId}_${buildingId}`;
      const cachedData = this.getCachedData<any>(cacheKey);
      
      if (cachedData) {
        this.logger.debug(`Using cached energy totals for device ${deviceId} (smart caching: ${cacheDuration/1000/60}min TTL)`);
        return cachedData;
      }
      
      // Try with a broader date range - last 7 days to increase chances of getting data
      const today = new Date();
      const oneWeekAgo = new Date(today);
      oneWeekAgo.setDate(today.getDate() - 7);
      
      const toDate = today.toISOString().split('T')[0];
      const fromDate = oneWeekAgo.toISOString().split('T')[0];
      
      this.logger.info(`Trying energy data from ${fromDate} to ${toDate}`);
      
      let energyData = await this.getEnergyData(deviceId, buildingId, fromDate, toDate);
      
      // If we don't get meaningful data, try yesterday
      if (!energyData || (energyData.TotalHeatingConsumed === 0 && energyData.TotalHotWaterConsumed === 0)) {
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);
        const yesterdayDate = yesterday.toISOString().split('T')[0];
        
        this.logger.info(`Trying yesterday's energy data: ${yesterdayDate}`);
        energyData = await this.getEnergyData(deviceId, buildingId, yesterdayDate, yesterdayDate);
      }
      
      // Extract energy totals from the response
      // The exact structure will depend on the API response format
      const result = {
        TotalHeatingConsumed: energyData?.TotalHeatingConsumed || 0,
        TotalHeatingProduced: energyData?.TotalHeatingProduced || 0,
        TotalHotWaterConsumed: energyData?.TotalHotWaterConsumed || 0,
        TotalHotWaterProduced: energyData?.TotalHotWaterProduced || 0,
        TotalCoolingConsumed: energyData?.TotalCoolingConsumed || 0,
        TotalCoolingProduced: energyData?.TotalCoolingProduced || 0,
        CoP: energyData?.CoP || [],
        AverageHeatingCOP: 0,
        AverageHotWaterCOP: 0,
        HasZone2: energyData?.HasZone2 || false,
      };

      // Preferred: calculate COP from totals (skip categories where consumption is 0)
      const safeRatio = (produced: number, consumed: number): number | null => {
        if (!consumed || consumed === 0) return null;
        if (!produced && produced !== 0) return null;
        return consumed > 0 ? produced / consumed : null;
      };

      const heatingCOP = safeRatio(result.TotalHeatingProduced || 0, result.TotalHeatingConsumed || 0);
      const hotWaterCOP = safeRatio(result.TotalHotWaterProduced || 0, result.TotalHotWaterConsumed || 0);
      const coolingCOP = safeRatio(result.TotalCoolingProduced || 0, result.TotalCoolingConsumed || 0);

      // Determine averageCOP: if at least one category available, average those; otherwise fallback to CoP[] array
      let averageCOP: number | null = null;
      const availableCOPs: number[] = [];
      if (heatingCOP !== null && !Number.isNaN(heatingCOP)) availableCOPs.push(heatingCOP);
      if (hotWaterCOP !== null && !Number.isNaN(hotWaterCOP)) availableCOPs.push(hotWaterCOP);
      if (coolingCOP !== null && !Number.isNaN(coolingCOP)) availableCOPs.push(coolingCOP);

      if (availableCOPs.length > 0) {
        averageCOP = availableCOPs.reduce((s, v) => s + v, 0) / availableCOPs.length;
      } else if (energyData?.CoP && Array.isArray(energyData.CoP)) {
        const validCopValues = energyData.CoP.filter((cop: number | null) => cop !== null && cop > 0) as number[];
        if (validCopValues.length > 0) {
          averageCOP = validCopValues.reduce((sum, cop) => sum + cop, 0) / validCopValues.length;
          this.logger.info(`Fallback average COP from CoP[]: ${averageCOP} from ${validCopValues.length} valid values`);
        }
      }

      // Round and store both the new fields and preserve legacy Average* fields for compatibility
      result.CoP = energyData?.CoP || [];
      result.AverageHeatingCOP = heatingCOP !== null && !Number.isNaN(heatingCOP) ? Math.round(heatingCOP * 100) / 100 : (averageCOP !== null ? Math.round(averageCOP * 100) / 100 : 0);
      result.AverageHotWaterCOP = hotWaterCOP !== null && !Number.isNaN(hotWaterCOP) ? Math.round(hotWaterCOP * 100) / 100 : (averageCOP !== null ? Math.round(averageCOP * 100) / 100 : 0);

      // Add the new explicit COP fields requested
      const rounded = (v: number | null) => (v === null || Number.isNaN(v) ? null : Math.round(v * 100) / 100);
      (result as any).heatingCOP = rounded(heatingCOP);
      (result as any).hotWaterCOP = rounded(hotWaterCOP);
      (result as any).coolingCOP = rounded(coolingCOP);
      (result as any).averageCOP = averageCOP !== null && !Number.isNaN(averageCOP) ? Math.round(averageCOP * 100) / 100 : null;

      // Preserve any lifetime/accumulated fields if present in the API response (for compatibility with tests)
      const passthroughFields = [
        'LifetimeHeatingConsumed',
        'LifetimeHeatingProduced',
        'AccumulatedHotWaterConsumed',
        'AccumulatedHotWaterProduced'
      ];
      for (const key of passthroughFields) {
        if (energyData && Object.prototype.hasOwnProperty.call(energyData, key)) {
          (result as any)[key] = (energyData as any)[key];
        }
      }

      // Cache the result with smart TTL based on time of day
      this.setCachedData(cacheKey, result, cacheDuration);

      return result;
    } catch (error) {
      this.logger.warn(`Failed to get daily energy totals for device ${deviceId}:`, {
        error: error instanceof Error ? error.message : String(error),
        deviceId,
        buildingId
      });
      
      // Return zeros as fallback (include new COP fields as null for consistency)
      return {
        TotalHeatingConsumed: 0,
        TotalHeatingProduced: 0,
        TotalHotWaterConsumed: 0,
        TotalHotWaterProduced: 0,
        TotalCoolingConsumed: 0,
        TotalCoolingProduced: 0,
        HasZone2: false,
        heatingCOP: null,
        hotWaterCOP: null,
        coolingCOP: null,
        averageCOP: null,
      };
    }
  }

  /**
   * Set hot water mode for ATW device
   * @param deviceId Device ID
   * @param buildingId Building ID
   * @param forced True for forced mode, false for auto mode
   * @returns Promise resolving to success
   */
  async setHotWaterMode(deviceId: string, buildingId: number, forced: boolean): Promise<boolean> {
    try {
      if (!this.contextKey) {
        const connected = await this.ensureConnected();
        if (!connected) {
          throw new Error('Not logged in to MELCloud');
        }
      }

      this.logger.log(`Setting hot water mode for device ${deviceId} to ${forced ? 'forced' : 'auto'}`);

      try {
        // First get current state with fresh data (bypass cache for changes)
        const currentState = await this.getDeviceState(deviceId, buildingId, true);

        // Update hot water mode
        currentState.ForcedHotWaterMode = forced;

        this.logApiCall('POST', 'Device/SetAtw', { deviceId, forcedHotWaterMode: forced });

        // Send update with retry - mark as critical to bypass circuit breaker
        const data = await this.retryableRequest(
          () => this.throttledApiCall<any>('POST', 'Device/SetAtw', {
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(currentState),
          }, true) // Critical operation - bypass circuit breaker
        );

        const success = data !== null;

        if (success) {
          this.logger.log(`Successfully set hot water mode for device ${deviceId} to ${forced ? 'forced' : 'auto'}`);
          // Invalidate device state cache since we made changes
          this.invalidateDeviceStateCache(deviceId, buildingId);
        } else {
          this.logger.error(`Failed to set hot water mode for device ${deviceId}`);
        }

        return success;
      } catch (error) {
        const appError = this.createApiError(error, {
          operation: 'setHotWaterMode',
          deviceId,
          buildingId,
          forced
        });

        if (appError.category === ErrorCategory.AUTHENTICATION) {
          this.logger.warn(`Authentication error in MELCloud setHotWaterMode for device ${deviceId}, attempting to reconnect`);
          await this.ensureConnected();
        }

        this.errorHandler.logError(appError);
        throw appError;
      }
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      const appError = this.createApiError(error, {
        operation: 'setHotWaterMode',
        deviceId,
        buildingId,
        forced
      });

      this.errorHandler.logError(appError);
      throw appError;
    }
  }

  /**
   * Set operation mode for ATW device
   * @param deviceId Device ID
   * @param buildingId Building ID
   * @param mode Operation mode (0=room, 1=flow, 2=curve)
   * @param zone Zone number (1 or 2)
   * @returns Promise resolving to success
   */
  async setOperationMode(deviceId: string, buildingId: number, mode: number, zone: number = 1): Promise<boolean> {
    try {
      if (!this.contextKey) {
        const connected = await this.ensureConnected();
        if (!connected) {
          throw new Error('Not logged in to MELCloud');
        }
      }

      const modeNames = ['room', 'flow', 'curve'];
      const modeName = modeNames[mode] || 'unknown';
      this.logger.log(`Setting operation mode for device ${deviceId} zone ${zone} to ${modeName} (${mode})`);

      try {
        // First get current state
        const currentState = await this.getDeviceState(deviceId, buildingId);

        // Update operation mode for the specified zone
        if (zone === 1) {
          currentState.OperationModeZone1 = mode;
        } else if (zone === 2) {
          currentState.OperationModeZone2 = mode;
        } else {
          throw new Error(`Invalid zone: ${zone}. Must be 1 or 2.`);
        }

        this.logApiCall('POST', 'Device/SetAtw', { deviceId, mode, zone });

        // Send update with retry
        const data = await this.retryableRequest(
          () => this.throttledApiCall<any>('POST', 'Device/SetAtw', {
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(currentState),
          })
        );

        const success = data !== null;

        if (success) {
          this.logger.log(`Successfully set operation mode for device ${deviceId} zone ${zone} to ${modeName}`);
        } else {
          this.logger.error(`Failed to set operation mode for device ${deviceId} zone ${zone}`);
        }

        return success;
      } catch (error) {
        const appError = this.createApiError(error, {
          operation: 'setOperationMode',
          deviceId,
          buildingId,
          mode,
          zone
        });

        if (appError.category === ErrorCategory.AUTHENTICATION) {
          this.logger.warn(`Authentication error in MELCloud setOperationMode for device ${deviceId}, attempting to reconnect`);
          await this.ensureConnected();
        }

        this.errorHandler.logError(appError);
        throw appError;
      }
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      const appError = this.createApiError(error, {
        operation: 'setOperationMode',
        deviceId,
        buildingId,
        mode,
        zone
      });

      this.errorHandler.logError(appError);
      throw appError;
    }
  }

  /**
   * Set device power state
   * @param deviceId Device ID
   * @param buildingId Building ID
   * @param power True for on, false for off
   * @returns Promise resolving to success
   */
  async setDevicePower(deviceId: string, buildingId: number, power: boolean): Promise<boolean> {
    try {
      if (!this.contextKey) {
        const connected = await this.ensureConnected();
        if (!connected) {
          throw new Error('Not logged in to MELCloud');
        }
      }

      this.logger.log(`Setting power for device ${deviceId} to ${power ? 'on' : 'off'}`);

      try {
        // First get current state
        const currentState = await this.getDeviceState(deviceId, buildingId);

        // Update power state
        currentState.Power = power;

        this.logApiCall('POST', 'Device/SetAtw', { deviceId, power });

        // Send update with retry
        const data = await this.retryableRequest(
          () => this.throttledApiCall<any>('POST', 'Device/SetAtw', {
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(currentState),
          })
        );

        const success = data !== null;

        if (success) {
          this.logger.log(`Successfully set power for device ${deviceId} to ${power ? 'on' : 'off'}`);
        } else {
          this.logger.error(`Failed to set power for device ${deviceId}`);
        }

        return success;
      } catch (error) {
        const appError = this.createApiError(error, {
          operation: 'setDevicePower',
          deviceId,
          buildingId,
          power
        });

        if (appError.category === ErrorCategory.AUTHENTICATION) {
          this.logger.warn(`Authentication error in MELCloud setDevicePower for device ${deviceId}, attempting to reconnect`);
          await this.ensureConnected();
        }

        this.errorHandler.logError(appError);
        throw appError;
      }
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      const appError = this.createApiError(error, {
        operation: 'setDevicePower',
        deviceId,
        buildingId,
        power
      });

      this.errorHandler.logError(appError);
      throw appError;
    }
  }

  /**
   * Set zone temperature for ATW device
   * @param deviceId Device ID
   * @param buildingId Building ID
   * @param temperature Target temperature
   * @param zone Zone number (1 or 2)
   * @returns Promise resolving to success
   */
  async setZoneTemperature(deviceId: string, buildingId: number, temperature: number, zone: number = 1): Promise<boolean> {
    try {
      if (!this.contextKey) {
        const connected = await this.ensureConnected();
        if (!connected) {
          throw new Error('Not logged in to MELCloud');
        }
      }

      this.logger.log(`Setting temperature for device ${deviceId} zone ${zone} to ${temperature}°C`);

      try {
        // First get current state
        const currentState = await this.getDeviceState(deviceId, buildingId);

        // Update temperature for the specified zone
        if (zone === 1) {
          currentState.SetTemperatureZone1 = temperature;
        } else if (zone === 2) {
          currentState.SetTemperatureZone2 = temperature;
        } else {
          throw new Error(`Invalid zone: ${zone}. Must be 1 or 2.`);
        }

        this.logApiCall('POST', 'Device/SetAtw', { deviceId, temperature, zone });

        // Send update with retry
        const data = await this.retryableRequest(
          () => this.throttledApiCall<any>('POST', 'Device/SetAtw', {
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(currentState),
          })
        );

        const success = data !== null;

        if (success) {
          this.logger.log(`Successfully set temperature for device ${deviceId} zone ${zone} to ${temperature}°C`);
        } else {
          this.logger.error(`Failed to set temperature for device ${deviceId} zone ${zone}`);
        }

        return success;
      } catch (error) {
        const appError = this.createApiError(error, {
          operation: 'setZoneTemperature',
          deviceId,
          buildingId,
          temperature,
          zone
        });

        if (appError.category === ErrorCategory.AUTHENTICATION) {
          this.logger.warn(`Authentication error in MELCloud setZoneTemperature for device ${deviceId}, attempting to reconnect`);
          await this.ensureConnected();
        }

        this.errorHandler.logError(appError);
        throw appError;
      }
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      const appError = this.createApiError(error, {
        operation: 'setZoneTemperature',
        deviceId,
        buildingId,
        temperature,
        zone
      });

      this.errorHandler.logError(appError);
      throw appError;
    }
  }

  /**
   * Set tank water temperature for ATW device
   * @param deviceId Device ID
   * @param buildingId Building ID
   * @param temperature Target tank temperature
   * @returns Promise resolving to success
   */
  async setTankTemperature(deviceId: string, buildingId: number, temperature: number): Promise<boolean> {
    try {
      if (!this.contextKey) {
        const connected = await this.ensureConnected();
        if (!connected) {
          throw new Error('Not logged in to MELCloud');
        }
      }

      this.logger.log(`Setting tank temperature for device ${deviceId} to ${temperature}°C`);

      try {
        // First get current state
        const currentState = await this.getDeviceState(deviceId, buildingId);

        // Update tank temperature
        currentState.SetTankWaterTemperature = temperature;

        this.logApiCall('POST', 'Device/SetAtw', { deviceId, tankTemperature: temperature });

        // Send update with retry
        const data = await this.retryableRequest(
          () => this.throttledApiCall<any>('POST', 'Device/SetAtw', {
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(currentState),
          })
        );

        const success = data !== null;

        if (success) {
          this.logger.log(`Successfully set tank temperature for device ${deviceId} to ${temperature}°C`);
        } else {
          this.logger.error(`Failed to set tank temperature for device ${deviceId}`);
        }

        return success;
      } catch (error) {
        const appError = this.createApiError(error, {
          operation: 'setTankTemperature',
          deviceId,
          buildingId,
          temperature
        });

        if (appError.category === ErrorCategory.AUTHENTICATION) {
          this.logger.warn(`Authentication error in MELCloud setTankTemperature for device ${deviceId}, attempting to reconnect`);
          await this.ensureConnected();
        }

        this.errorHandler.logError(appError);
        throw appError;
      }
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      const appError = this.createApiError(error, {
        operation: 'setTankTemperature',
        deviceId,
        buildingId,
        temperature
      });

      this.errorHandler.logError(appError);
      throw appError;
    }
  }
}
