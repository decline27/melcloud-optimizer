import { ServiceBase } from './base/service-base';
import { ConfigurationService, MelCloudConfig } from './configuration-service';
import { HomeyLogger } from '../util/logger';

export interface DeviceInfo {
  id: string;
  buildingId: string;
  name: string;
  type: 'ata' | 'atw' | 'unknown';
  isDummy: boolean;
  data?: {
    // Common properties
    Power: boolean;
    OperationMode: number;
    SetTemperatureZone1?: number;
    SetTemperatureZone2?: number;
    RoomTemperatureZone1?: number;
    RoomTemperatureZone2?: number;
    TankWaterTemperature?: number;
    SetTankWaterTemperature?: number;
    // Add other device-specific properties as needed
    [key: string]: any;
  };
  lastUpdated: string;
}

export interface DeviceCommand {
  deviceId: string;
  buildingId: string;
  commandType: 'SET_TEMPERATURE' | 'SET_TANK_TEMPERATURE' | 'SET_POWER' | 'SET_MODE';
  parameters: {
    temperature?: number;
    zone?: 1 | 2;
    power?: boolean;
    mode?: number;
    [key: string]: any;
  };
  retryCount?: number;
  timeout?: number;
}

export interface DeviceCommandResult {
  success: boolean;
  deviceId: string;
  commandType: string;
  executedAt: string;
  duration: number;
  result?: any;
  error?: string;
  retryCount: number;
}

export interface DeviceConnectionStatus {
  connected: boolean;
  lastConnected: string | null;
  loginExpiresAt: string | null;
  contextKey: string | null;
  devicesLastUpdated: string | null;
  devicesCount: number;
  connectionErrors: number;
  lastError: string | null;
}

export interface DeviceCacheEntry {
  device: DeviceInfo;
  lastUpdated: number;
  isValid: boolean;
}

export class DeviceCommunicationService extends ServiceBase {
  private config: MelCloudConfig | null = null;
  private contextKey: string | null = null;
  private devices: Map<string, DeviceCacheEntry> = new Map();
  private commandHistory: DeviceCommandResult[] = [];
  private connectionStatus: DeviceConnectionStatus = {
    connected: false,
    lastConnected: null,
    loginExpiresAt: null,
    contextKey: null,
    devicesLastUpdated: null,
    devicesCount: 0,
    connectionErrors: 0,
    lastError: null
  };
  
  private readonly baseUrl = 'https://app.melcloud.com/Mitsubishi.Wifi.Client/';
  private readonly deviceCacheTimeout = 5 * 60 * 1000; // 5 minutes
  private readonly maxCommandHistory = 100;
  private readonly maxRetries = 3;

  constructor(
    private configService: ConfigurationService,
    logger: HomeyLogger,
    private autoInitialize: boolean = true
  ) {
    super(logger);
    if (this.autoInitialize) {
      this.initializeService();
    }
  }

  private async initializeService(): Promise<void> {
    try {
      await this.loadConfiguration();
      this.logInfo('Device communication service initialized', {
        hasCredentials: !!(this.config?.username && this.config?.password),
        baseUrl: this.baseUrl
      });
    } catch (error) {
      this.logError(error as Error, { context: 'device communication initialization' });
      throw this.createServiceError(
        'Failed to initialize device communication service',
        'DEVICE_COMM_INIT_ERROR',
        true
      );
    }
  }

  private async loadConfiguration(): Promise<void> {
    try {
      this.config = await this.configService.getConfig('melcloud');
      
      if (!this.config.username || !this.config.password) {
        this.logInfo('MELCloud credentials not configured');
      }
    } catch (error) {
      this.logError(error as Error, { context: 'device communication configuration loading' });
      throw error;
    }
  }

  /**
   * Authenticate with MELCloud API
   */
  async authenticate(): Promise<boolean> {
    if (!this.config?.username || !this.config?.password) {
      throw this.createServiceError(
        'MELCloud credentials not configured',
        'CREDENTIALS_MISSING',
        false
      );
    }

    return this.executeWithRetry(async () => {
      this.logInfo('Authenticating with MELCloud');

      const requestData = {
        Email: this.config!.username,
        Password: this.config!.password,
        Language: this.config!.language || 0,
        AppVersion: this.config!.appVersion || '1.30.3.0',
        Persist: true,
        CaptchaResponse: null,
      };

      const response = await this.makeHttpRequest('POST', 'Login/ClientLogin', requestData);

      if (response.ErrorId !== null && response.ErrorId !== undefined) {
        this.connectionStatus.connectionErrors++;
        this.connectionStatus.lastError = response.ErrorMessage || 'Login failed';
        throw this.createServiceError(
          `MELCloud login failed: ${response.ErrorMessage}`,
          'LOGIN_FAILED',
          true
        );
      }

      this.contextKey = response.LoginData.ContextKey;
      this.connectionStatus.connected = true;
      this.connectionStatus.lastConnected = new Date().toISOString();
      this.connectionStatus.contextKey = this.contextKey;
      this.connectionStatus.connectionErrors = 0;
      this.connectionStatus.lastError = null;

      // Calculate expiry time
      const loginExpiry = response.LoginData.Expiry;
      if (loginExpiry) {
        this.connectionStatus.loginExpiresAt = new Date(loginExpiry).toISOString();
      }

      this.logInfo('Successfully authenticated with MELCloud', {
        expiry: this.connectionStatus.loginExpiresAt,
        userId: response.LoginData.Name
      });

      return true;
    });
  }

  /**
   * Get all devices from MELCloud
   */
  async getDevices(forceRefresh: boolean = false): Promise<DeviceInfo[]> {
    // Check cache first
    if (!forceRefresh && this.isDeviceCacheValid()) {
      return Array.from(this.devices.values()).map(entry => entry.device);
    }

    return this.executeWithRetry(async () => {
      await this.ensureAuthenticated();

      this.logInfo('Fetching devices from MELCloud');

      const response = await this.makeHttpRequest('GET', 'User/ListDevices');
      const extractedDevices = this.extractDevicesFromResponse(response);

      // Update cache
      this.devices.clear();
      const now = Date.now();
      
      extractedDevices.forEach(device => {
        this.devices.set(device.id, {
          device,
          lastUpdated: now,
          isValid: true
        });
      });

      this.connectionStatus.devicesLastUpdated = new Date().toISOString();
      this.connectionStatus.devicesCount = extractedDevices.length;

      this.logInfo('Devices fetched and cached', {
        deviceCount: extractedDevices.length,
        deviceIds: extractedDevices.map(d => d.id)
      });

      return extractedDevices;
    });
  }

  /**
   * Get a specific device by ID
   */
  async getDevice(deviceId: string, forceRefresh: boolean = false): Promise<DeviceInfo | null> {
    // Check cache first
    const cached = this.devices.get(deviceId);
    if (!forceRefresh && cached && this.isCacheEntryValid(cached)) {
      return cached.device;
    }

    // If not in cache or cache is invalid, fetch all devices
    const devices = await this.getDevices(forceRefresh);
    return devices.find(device => device.id === deviceId) || null;
  }

  /**
   * Execute a command on a device
   */
  async executeDeviceCommand(command: DeviceCommand): Promise<DeviceCommandResult> {
    const startTime = Date.now();
    const executionId = `${command.deviceId}_${command.commandType}_${startTime}`;

    this.logInfo(`Executing device command: ${command.commandType}`, {
      deviceId: command.deviceId,
      parameters: command.parameters,
      executionId
    });

    const result: DeviceCommandResult = {
      success: false,
      deviceId: command.deviceId,
      commandType: command.commandType,
      executedAt: new Date().toISOString(),
      duration: 0,
      retryCount: 0
    };

    try {
      await this.ensureAuthenticated();

      // Get device to determine type and current state
      const device = await this.getDevice(command.deviceId);
      if (!device) {
        throw this.createServiceError(
          `Device not found: ${command.deviceId}`,
          'DEVICE_NOT_FOUND',
          false
        );
      }

      // Execute command based on type
      let commandResult: any;
      switch (command.commandType) {
        case 'SET_TEMPERATURE':
          if (typeof command.parameters.temperature !== 'number') {
            throw this.createServiceError(
              'Temperature parameter is required for SET_TEMPERATURE command',
              'INVALID_PARAMETERS',
              false
            );
          }
          commandResult = await this.setDeviceTemperature(device, {
            temperature: command.parameters.temperature,
            zone: command.parameters.zone
          });
          break;
        case 'SET_TANK_TEMPERATURE':
          if (typeof command.parameters.temperature !== 'number') {
            throw this.createServiceError(
              'Temperature parameter is required for SET_TANK_TEMPERATURE command',
              'INVALID_PARAMETERS',
              false
            );
          }
          commandResult = await this.setDeviceTankTemperature(device, {
            temperature: command.parameters.temperature
          });
          break;
        case 'SET_POWER':
          if (typeof command.parameters.power !== 'boolean') {
            throw this.createServiceError(
              'Power parameter is required for SET_POWER command',
              'INVALID_PARAMETERS',
              false
            );
          }
          commandResult = await this.setDevicePower(device, {
            power: command.parameters.power
          });
          break;
        case 'SET_MODE':
          if (typeof command.parameters.mode !== 'number') {
            throw this.createServiceError(
              'Mode parameter is required for SET_MODE command',
              'INVALID_PARAMETERS',
              false
            );
          }
          commandResult = await this.setDeviceMode(device, {
            mode: command.parameters.mode
          });
          break;
        default:
          throw this.createServiceError(
            `Unsupported command type: ${command.commandType}`,
            'UNSUPPORTED_COMMAND',
            false
          );
      }

      result.success = true;
      result.result = commandResult;
      result.duration = Date.now() - startTime;

      // Invalidate device cache to force refresh on next request
      this.invalidateDeviceCache(command.deviceId);

      this.logInfo(`Device command executed successfully`, {
        deviceId: command.deviceId,
        commandType: command.commandType,
        duration: result.duration,
        executionId
      });

    } catch (error) {
      result.success = false;
      result.error = (error as Error).message;
      result.duration = Date.now() - startTime;
      
      this.logError(error as Error, {
        context: 'device command execution',
        deviceId: command.deviceId,
        commandType: command.commandType,
        executionId
      });
    }

    // Store in history
    this.addCommandToHistory(result);

    return result;
  }

  /**
   * Set device temperature
   */
  private async setDeviceTemperature(
    device: DeviceInfo, 
    params: { temperature: number; zone?: 1 | 2 }
  ): Promise<any> {
    const { temperature, zone = 1 } = params;

    if (device.type === 'atw') {
      return await this.setAtwTemperature(device, temperature, zone);
    } else if (device.type === 'ata') {
      return await this.setAtaTemperature(device, temperature);
    } else {
      throw this.createServiceError(
        `Temperature control not supported for device type: ${device.type}`,
        'UNSUPPORTED_DEVICE_TYPE',
        false
      );
    }
  }

  /**
   * Set ATW (Air to Water) device temperature
   */
  private async setAtwTemperature(
    device: DeviceInfo,
    temperature: number,
    zone: 1 | 2
  ): Promise<any> {
    // Create complete request body with current device state
    const requestBody = {
      ...device.data, // Start with current device state
      DeviceID: parseInt(device.id),
      BuildingID: parseInt(device.buildingId),
      EffectiveFlags: zone === 1 ? 1 : 2, // Zone 1 or Zone 2 temperature
      HasPendingCommand: true
    };

    // Set the temperature for the specified zone
    if (zone === 1) {
      requestBody.SetTemperatureZone1 = temperature;
    } else {
      requestBody.SetTemperatureZone2 = temperature;
    }

    return await this.makeHttpRequest('POST', 'Device/SetAtw', requestBody);
  }

  /**
   * Set ATA (Air to Air) device temperature
   */
  private async setAtaTemperature(device: DeviceInfo, temperature: number): Promise<any> {
    const requestBody = {
      DeviceID: parseInt(device.id),
      BuildingID: parseInt(device.buildingId),
      Power: true,
      SetTemperature: temperature,
      EffectiveFlags: 1,
      HasPendingCommand: true
    };

    return await this.makeHttpRequest('POST', 'Device/SetAta', requestBody);
  }

  /**
   * Set device tank temperature
   */
  private async setDeviceTankTemperature(
    device: DeviceInfo,
    params: { temperature: number }
  ): Promise<any> {
    if (device.type !== 'atw') {
      throw this.createServiceError(
        'Tank temperature control only supported for ATW devices',
        'UNSUPPORTED_OPERATION',
        false
      );
    }

    const requestBody = {
      ...device.data, // Start with current device state
      DeviceID: parseInt(device.id),
      BuildingID: parseInt(device.buildingId),
      SetTankWaterTemperature: params.temperature,
      EffectiveFlags: 32, // Tank temperature flag
      HasPendingCommand: true
    };

    return await this.makeHttpRequest('POST', 'Device/SetAtw', requestBody);
  }

  /**
   * Set device power state
   */
  private async setDevicePower(
    device: DeviceInfo,
    params: { power: boolean }
  ): Promise<any> {
    const endpoint = device.type === 'atw' ? 'Device/SetAtw' : 'Device/SetAta';
    
    const requestBody = {
      ...device.data, // Start with current device state
      DeviceID: parseInt(device.id),
      BuildingID: parseInt(device.buildingId),
      Power: params.power,
      EffectiveFlags: 1, // Power flag
      HasPendingCommand: true
    };

    return await this.makeHttpRequest('POST', endpoint, requestBody);
  }

  /**
   * Set device operation mode
   */
  private async setDeviceMode(
    device: DeviceInfo,
    params: { mode: number }
  ): Promise<any> {
    const endpoint = device.type === 'atw' ? 'Device/SetAtw' : 'Device/SetAta';
    
    const requestBody = {
      ...device.data, // Start with current device state
      DeviceID: parseInt(device.id),
      BuildingID: parseInt(device.buildingId),
      OperationMode: params.mode,
      EffectiveFlags: 2, // Operation mode flag
      HasPendingCommand: true
    };

    return await this.makeHttpRequest('POST', endpoint, requestBody);
  }

  /**
   * Make HTTP request to MELCloud API
   */
  private async makeHttpRequest(method: 'GET' | 'POST', path: string, data?: any): Promise<any> {
    const url = new URL(this.baseUrl);
    
    const options = {
      hostname: url.hostname,
      path: `/${path}`,
      method,
      headers: {
        'Accept': 'application/json',
        ...(this.contextKey && { 'X-MitsContextKey': this.contextKey }),
        ...(method === 'POST' && { 'Content-Type': 'application/json' })
      }
    };

    return new Promise((resolve, reject) => {
      const https = require('https');
      const req = https.request(options, (res: any) => {
        let responseData = '';

        res.on('data', (chunk: any) => {
          responseData += chunk;
        });

        res.on('end', () => {
          if (res.statusCode >= 400) {
            reject(new Error(`HTTP error ${res.statusCode}: ${res.statusMessage}`));
            return;
          }

          try {
            const parsedData = JSON.parse(responseData);
            resolve(parsedData);
          } catch (error) {
            reject(new Error(`Failed to parse response: ${(error as Error).message}`));
          }
        });
      });

      req.on('error', (error: Error) => {
        reject(error);
      });

      req.setTimeout(30000, () => {
        req.destroy();
        reject(new Error('Request timeout after 30 seconds'));
      });

      if (data && method === 'POST') {
        req.write(JSON.stringify(data));
      }

      req.end();
    });
  }

  /**
   * Extract devices from MELCloud API response
   */
  private extractDevicesFromResponse(response: any): DeviceInfo[] {
    const devices: DeviceInfo[] = [];
    const now = new Date().toISOString();

    if (!response || !Array.isArray(response)) {
      return devices;
    }

    response.forEach((building: any) => {
      if (!building.Structure) return;

      // Extract devices from all floors and areas
      building.Structure.Floors?.forEach((floor: any) => {
        floor.Areas?.forEach((area: any) => {
          area.Devices?.forEach((device: any) => {
            if (device.Device) {
              const deviceData = device.Device;
              const extractedDevice: DeviceInfo = {
                id: deviceData.DeviceID.toString(),
                buildingId: building.ID.toString(),
                name: deviceData.DeviceName || 'Unnamed Device',
                type: this.determineDeviceType(deviceData),
                isDummy: deviceData.Dummy || false,
                data: deviceData,
                lastUpdated: now
              };
              
              devices.push(extractedDevice);
            }
          });
        });
      });

      // Also check direct devices in building structure
      building.Structure.Devices?.forEach((device: any) => {
        if (device.Device) {
          const deviceData = device.Device;
          const extractedDevice: DeviceInfo = {
            id: deviceData.DeviceID.toString(),
            buildingId: building.ID.toString(),
            name: deviceData.DeviceName || 'Unnamed Device',
            type: this.determineDeviceType(deviceData),
            isDummy: deviceData.Dummy || false,
            data: deviceData,
            lastUpdated: now
          };
          
          devices.push(extractedDevice);
        }
      });
    });

    return devices;
  }

  /**
   * Determine device type from device data
   */
  private determineDeviceType(deviceData: any): 'ata' | 'atw' | 'unknown' {
    // ATW devices typically have tank water temperature properties
    if (deviceData.TankWaterTemperature !== undefined || 
        deviceData.SetTankWaterTemperature !== undefined ||
        deviceData.SetTemperatureZone1 !== undefined ||
        deviceData.SetTemperatureZone2 !== undefined) {
      return 'atw';
    }
    
    // ATA devices typically have SetTemperature property
    if (deviceData.SetTemperature !== undefined) {
      return 'ata';
    }

    return 'unknown';
  }

  /**
   * Ensure we have a valid authentication
   */
  private async ensureAuthenticated(): Promise<void> {
    if (!this.contextKey || this.isAuthenticationExpired()) {
      await this.authenticate();
    }
  }

  /**
   * Check if authentication is expired
   */
  private isAuthenticationExpired(): boolean {
    if (!this.connectionStatus.loginExpiresAt) return true;
    
    const expiryTime = new Date(this.connectionStatus.loginExpiresAt).getTime();
    const now = Date.now();
    const bufferTime = 5 * 60 * 1000; // 5 minutes buffer
    
    return (expiryTime - bufferTime) <= now;
  }

  /**
   * Check if device cache is valid
   */
  private isDeviceCacheValid(): boolean {
    if (this.devices.size === 0) return false;
    
    const now = Date.now();
    return Array.from(this.devices.values()).every(entry => 
      entry.isValid && (now - entry.lastUpdated) < this.deviceCacheTimeout
    );
  }

  /**
   * Check if a cache entry is valid
   */
  private isCacheEntryValid(entry: DeviceCacheEntry): boolean {
    const now = Date.now();
    return entry.isValid && (now - entry.lastUpdated) < this.deviceCacheTimeout;
  }

  /**
   * Invalidate device cache for a specific device
   */
  private invalidateDeviceCache(deviceId: string): void {
    const entry = this.devices.get(deviceId);
    if (entry) {
      entry.isValid = false;
    }
  }

  /**
   * Add command result to history
   */
  private addCommandToHistory(result: DeviceCommandResult): void {
    this.commandHistory.push(result);
    
    // Keep only the last N commands
    if (this.commandHistory.length > this.maxCommandHistory) {
      this.commandHistory.shift();
    }
  }

  /**
   * Get connection status
   */
  getConnectionStatus(): DeviceConnectionStatus {
    return { ...this.connectionStatus };
  }

  /**
   * Get command history
   */
  getCommandHistory(): DeviceCommandResult[] {
    return [...this.commandHistory];
  }

  /**
   * Get cached devices count
   */
  getCachedDevicesCount(): number {
    return this.devices.size;
  }

  /**
   * Clear device cache
   */
  clearDeviceCache(): void {
    this.devices.clear();
    this.connectionStatus.devicesLastUpdated = null;
    this.connectionStatus.devicesCount = 0;
    this.logInfo('Device cache cleared');
  }

  /**
   * Test connection to MELCloud
   */
  async testConnection(): Promise<{ success: boolean; message: string; details?: any }> {
    try {
      await this.authenticate();
      const devices = await this.getDevices(true);
      
      return {
        success: true,
        message: 'Connection test successful',
        details: {
          authenticated: true,
          devicesFound: devices.length,
          connectionStatus: this.getConnectionStatus()
        }
      };
    } catch (error) {
      return {
        success: false,
        message: `Connection test failed: ${(error as Error).message}`,
        details: {
          authenticated: false,
          connectionStatus: this.getConnectionStatus()
        }
      };
    }
  }

  /**
   * Reconfigure the service with new settings
   */
  async reconfigureDeviceCommunication(newConfig: Partial<MelCloudConfig>): Promise<void> {
    try {
      await this.configService.updateConfig('melcloud', newConfig);
      await this.loadConfiguration();
      
      // Clear authentication and cache to force re-authentication
      this.contextKey = null;
      this.clearDeviceCache();
      this.connectionStatus.connected = false;
      
      this.logInfo('Device communication service reconfigured', { newConfig });
    } catch (error) {
      this.logError(error as Error, { newConfig });
      throw this.createServiceError(
        'Failed to reconfigure device communication service',
        'DEVICE_COMM_RECONFIG_ERROR',
        true
      );
    }
  }

  /**
   * Shutdown the service
   */
  async shutdown(): Promise<void> {
    this.logInfo('Shutting down device communication service');
    
    // Clear sensitive data
    this.contextKey = null;
    this.clearDeviceCache();
    this.commandHistory.length = 0;
    
    this.connectionStatus = {
      connected: false,
      lastConnected: null,
      loginExpiresAt: null,
      contextKey: null,
      devicesLastUpdated: null,
      devicesCount: 0,
      connectionErrors: 0,
      lastError: null
    };
    
    this.logInfo('Device communication service shutdown completed');
  }
}
