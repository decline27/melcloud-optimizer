import fetch from 'node-fetch';
import { Logger } from '../util/logger';

/**
 * MELCloud API Service
 * Handles communication with the MELCloud API
 */
export class MelCloudApi {
  private baseUrl = 'https://app.melcloud.com/Mitsubishi.Wifi.Client/';
  private contextKey: string | null = null;
  private devices: any[] = [];
  private logger: Logger;

  /**
   * Constructor
   * @param logger Logger instance
   */
  constructor(logger?: Logger) {
    // Create a default console logger if none provided (for tests)
    this.logger = logger || {
      log: (message: string, ...args: any[]) => console.log(message, ...args),
      info: (message: string, ...args: any[]) => console.log(`INFO: ${message}`, ...args),
      error: (message: string, error?: Error | unknown, ...args: any[]) => console.error(message, error, ...args),
      debug: (message: string, ...args: any[]) => console.debug(message, ...args),
      warn: (message: string, ...args: any[]) => console.warn(message, ...args),
      notify: async (message: string) => Promise.resolve(),
      marker: (message: string) => console.log(`===== ${message} =====`),
      sendToTimeline: async (message: string) => Promise.resolve(),
      setLogLevel: () => {},
      setTimelineLogging: () => {}
    };
  }

  /**
   * Log API call details
   * @param method HTTP method
   * @param endpoint API endpoint
   * @param params Optional parameters
   */
  private logApiCall(method: string, endpoint: string, params?: any): void {
    this.logger.log(`API Call: ${method} ${endpoint}${params ? ' with params: ' + JSON.stringify(params) : ''}`);
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
       error.message.includes('connection'));
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
       error.message.includes('login'));
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
      const response = await fetch(`${this.baseUrl}Login/ClientLogin`, {
        method: 'POST',
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
      });

      const data = await response.json() as any;

      if (data.ErrorId !== null) {
        throw new Error(`MELCloud login failed: ${data.ErrorMessage}`);
      }

      this.contextKey = data.LoginData.ContextKey;
      this.logger.log('MELCloud login successful');
      return true;
    } catch (error) {
      if (this.isAuthError(error)) {
        this.logger.error('Authentication error in MELCloud login:', error);
        throw new Error(`Authentication error: ${error instanceof Error ? error.message : String(error)}`);
      } else if (this.isNetworkError(error)) {
        this.logger.error('Network error in MELCloud login:', error);
        throw new Error(`Network error: ${error instanceof Error ? error.message : String(error)}`);
      } else {
        this.logger.error('MELCloud login error:', error);
        const enhancedError = error instanceof Error
          ? new Error(`MELCloud login failed: ${error.message}`)
          : new Error(`MELCloud login failed: ${String(error)}`);
        throw enhancedError;
      }
    }
  }

  /**
   * Get devices from MELCloud
   * @returns Promise resolving to devices array
   */
  async getDevices(): Promise<any[]> {
    if (!this.contextKey) {
      this.logger.error('Not logged in to MELCloud');
      throw new Error('Not logged in to MELCloud');
    }

    this.logApiCall('GET', 'User/ListDevices');

    try {
      const response = await fetch(`${this.baseUrl}User/ListDevices`, {
        method: 'GET',
        headers: {
          'X-MitsContextKey': this.contextKey,
        },
      });

      const data = await response.json() as any[];
      this.devices = this.extractDevices(data);
      this.logger.log(`MELCloud devices retrieved: ${this.devices.length} devices found`);
      return this.devices;
    } catch (error) {
      if (this.isAuthError(error)) {
        this.logger.error('Authentication error in MELCloud getDevices:', error);
        throw new Error(`Authentication error: ${error instanceof Error ? error.message : String(error)}`);
      } else if (this.isNetworkError(error)) {
        this.logger.error('Network error in MELCloud getDevices:', error);
        throw new Error(`Network error: ${error instanceof Error ? error.message : String(error)}`);
      } else {
        this.logger.error('MELCloud get devices error:', error);
        const enhancedError = error instanceof Error
          ? new Error(`MELCloud get devices failed: ${error.message}`)
          : new Error(`MELCloud get devices failed: ${String(error)}`);
        throw enhancedError;
      }
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
   * Get device state
   * @param deviceId Device ID
   * @param buildingId Building ID
   * @returns Promise resolving to device state
   */
  async getDeviceState(deviceId: string, buildingId: number): Promise<any> {
    if (!this.contextKey) {
      this.logger.error('Not logged in to MELCloud');
      throw new Error('Not logged in to MELCloud');
    }

    this.logApiCall('GET', `Device/Get?id=${deviceId}&buildingID=${buildingId}`);

    try {
      const response = await fetch(`${this.baseUrl}Device/Get?id=${deviceId}&buildingID=${buildingId}`, {
        method: 'GET',
        headers: {
          'X-MitsContextKey': this.contextKey,
        },
      });

      const data = await response.json();
      this.logger.log(`MELCloud device state retrieved for device ${deviceId}`);
      return data;
    } catch (error) {
      if (this.isAuthError(error)) {
        this.logger.error(`Authentication error in MELCloud getDeviceState for device ${deviceId}:`, error);
        throw new Error(`Authentication error: ${error instanceof Error ? error.message : String(error)}`);
      } else if (this.isNetworkError(error)) {
        this.logger.error(`Network error in MELCloud getDeviceState for device ${deviceId}:`, error);
        throw new Error(`Network error: ${error instanceof Error ? error.message : String(error)}`);
      } else {
        this.logger.error(`MELCloud get device state error for device ${deviceId}:`, error);
        const enhancedError = error instanceof Error
          ? new Error(`MELCloud get device state failed: ${error.message}`)
          : new Error(`MELCloud get device state failed: ${String(error)}`);
        throw enhancedError;
      }
    }
  }

  /**
   * Set device temperature
   * @param deviceId Device ID
   * @param buildingId Building ID
   * @param temperature Target temperature
   * @returns Promise resolving to success
   */
  async setDeviceTemperature(deviceId: string, buildingId: number, temperature: number): Promise<boolean> {
    if (!this.contextKey) {
      this.logger.error('Not logged in to MELCloud');
      throw new Error('Not logged in to MELCloud');
    }

    this.logger.log(`Setting temperature for device ${deviceId} to ${temperature}°C`);

    try {
      // First get current state
      const currentState = await this.getDeviceState(deviceId, buildingId);

      // Update temperature
      currentState.SetTemperature = temperature;

      this.logApiCall('POST', 'Device/SetAta', { deviceId, temperature });

      // Send update
      const response = await fetch(`${this.baseUrl}Device/SetAta`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-MitsContextKey': this.contextKey,
        },
        body: JSON.stringify(currentState),
      });

      const data = await response.json();
      const success = data !== null;

      if (success) {
        this.logger.log(`Successfully set temperature for device ${deviceId} to ${temperature}°C`);
      } else {
        this.logger.error(`Failed to set temperature for device ${deviceId}`);
      }

      return success;
    } catch (error) {
      if (this.isAuthError(error)) {
        this.logger.error(`Authentication error in MELCloud setDeviceTemperature for device ${deviceId}:`, error);
        throw new Error(`Authentication error: ${error instanceof Error ? error.message : String(error)}`);
      } else if (this.isNetworkError(error)) {
        this.logger.error(`Network error in MELCloud setDeviceTemperature for device ${deviceId}:`, error);
        throw new Error(`Network error: ${error instanceof Error ? error.message : String(error)}`);
      } else {
        this.logger.error(`MELCloud set temperature error for device ${deviceId}:`, error);
        const enhancedError = error instanceof Error
          ? new Error(`MELCloud set temperature failed: ${error.message}`)
          : new Error(`MELCloud set temperature failed: ${String(error)}`);
        throw enhancedError;
      }
    }
  }
}
