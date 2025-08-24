import Homey from 'homey';
import { BaseApiService } from '../../src/services/base-api-service';
import { MelCloudApi } from '../../src/services/melcloud-api';
import { ErrorHandler } from '../../src/util/error-handler';
import { HomeyLogger, LogLevel } from '../../src/util/logger';
import { MelCloudDevice } from '../../src/types';
import { CircuitBreaker, CircuitState } from '../../src/util/circuit-breaker'; // Task 2.2

/**
 * Energy data interface for ATW devices
 */
interface EnergyData {
  TotalHeatingConsumed?: number;
  TotalHeatingProduced?: number;
  TotalHotWaterConsumed?: number;
  TotalHotWaterProduced?: number;
  TotalCoolingConsumed?: number;
  TotalCoolingProduced?: number;
  CoP?: number[];
  AverageHeatingCOP?: number;
  AverageHotWaterCOP?: number;
  [key: string]: any;
}

module.exports = class BoilerDevice extends Homey.Device {
  private melCloudApi?: MelCloudApi;
  private logger!: HomeyLogger;
  private updateInterval?: NodeJS.Timeout;
  private deviceId!: string;
  private buildingId!: number;
  private energyReportInterval?: NodeJS.Timeout;
  private hasZone2: boolean = false;
  private zone2Checked: boolean = false;
  private energyBasedZone2Check: boolean = false;
  
  // Power command debouncing properties (Task 1.1)
  private powerCommandDebounce?: NodeJS.Timeout;
  private lastPowerCommand?: { value: boolean; timestamp: number };
  private readonly POWER_COMMAND_DELAY = 3000; // 3 seconds minimum

  // Task 2.1: Configurable polling intervals with smart adaptive polling
  private pollingConfig = {
    dataInterval: 300000,     // 5 minutes (optimized from 120000 / 2 minutes)
    energyInterval: 900000,   // 15 minutes (optimized from 300000 / 5 minutes)
    fastPollDuration: 600000, // 10 minutes of fast polling after commands
    fastPollInterval: 60000   // 1 minute during fast poll mode
  };
  
  private fastPollUntil?: number;
  private currentDataInterval: number = this.pollingConfig.dataInterval;
  private currentEnergyInterval: number = this.pollingConfig.energyInterval;

  // Task 2.2: Circuit breaker pattern for API protection
  private apiCircuitBreaker?: CircuitBreaker;
  private energyCircuitBreaker?: CircuitBreaker;
  private lastSuccessfulUpdate?: Date;
  private circuitBreakerMetrics = {
    dataCallFailures: 0,
    energyCallFailures: 0,
    lastFailureTime: null as Date | null,
    degradedModeActive: false
  };

  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    this.logger = new HomeyLogger(this.homey, {
      level: LogLevel.INFO,
      logToTimeline: false,
      prefix: `BoilerDevice[${this.getName()}]`,
      includeTimestamps: true,
      includeSourceModule: true
    });

    this.logger.log('BoilerDevice has been initialized');

    // Set up global homeySettings for the API if not already set
  // Note: Do NOT write to Node globals here. Services should be injected explicitly
  // by the app (see migration plan). Legacy code that relies on globals should use
  // the compatibility shim (`api.__test.setServices`) during tests.

    // Get device configuration from store or settings
    const storeDeviceId = this.getStoreValue('melcloud_device_id');
    const storeBuildingId = this.getStoreValue('melcloud_building_id');
    const settingsDeviceId = this.getSetting('device_id');
    const settingsBuildingId = this.getSetting('building_id');

    this.deviceId = storeDeviceId || settingsDeviceId;
    this.buildingId = storeBuildingId || settingsBuildingId;

    if (!this.deviceId || !this.buildingId) {
      this.logger.error('Device ID or Building ID not found in store or settings');
      this.setUnavailable('Device configuration missing');
      return;
    }

    this.logger.log(`Initialized for MELCloud device ${this.deviceId} in building ${this.buildingId}`);

    // Initialize MELCloud API
    try {
  this.melCloudApi = new MelCloudApi(this.logger, this.homey.settings);
      this.logger.log('MELCloud API initialized for device');
    } catch (error) {
      this.logger.error('Failed to initialize MELCloud API:', error);
      this.setUnavailable('Failed to initialize MELCloud API');
      return;
    }

    // Task 2.1: Initialize configurable polling intervals
    this.initializePollingConfiguration();

    // Task 2.2: Initialize circuit breakers for API protection
    this.initializeCircuitBreakers();

    // Ensure all required capabilities are available
    await this.ensureCapabilities();

    // Set up initial capability listeners (Zone 1 and common capabilities)
    this.setupInitialCapabilityListeners();

    // Start data fetching (Zone 2 check and setup will happen here)
    await this.startDataFetching();
  }

  /**
   * Ensure all required capabilities are available on the device
   */
  private async ensureCapabilities() {
    const requiredCapabilities = [
      'onoff',
      'hot_water_mode',
      'measure_temperature',
      'measure_temperature.outdoor',
      'measure_temperature.tank',
      'target_temperature',
      'target_temperature.tank',
      'thermostat_mode',
      'operational_state',
      'operational_state.hot_water',
      'operational_state.zone1',
      'meter_power.heating',
      'meter_power.produced_heating',
      'meter_power.hotwater',
      'meter_power.produced_hotwater',
      'heating_cop',
      'hotwater_cop',
      'alarm_generic.offline'
    ];

    // Zone 2 capabilities - added conditionally
    const zone2Capabilities = [
      'measure_temperature.zone2',
      'target_temperature.zone2',
      'thermostat_mode.zone2',
      'operational_state.zone2'
    ];

    this.logger.log('Checking required capabilities...');
    
    for (const capability of requiredCapabilities) {
      if (!this.hasCapability(capability)) {
        try {
          await this.addCapability(capability);
          this.logger.log(`Added missing capability: ${capability}`);
          
          // Set initial values for custom capabilities
          if (capability === 'heating_cop') {
            await this.setCapabilityValue(capability, 0);
          } else if (capability === 'hotwater_cop') {
            await this.setCapabilityValue(capability, 0);
          }
        } catch (error) {
          this.logger.error(`Failed to add capability ${capability}:`, error);
        }
      } else {
        this.logger.debug(`Capability ${capability} already exists`);
      }
    }

    // Initially add Zone 2 capabilities (will be removed if not needed)
    for (const capability of zone2Capabilities) {
      if (!this.hasCapability(capability)) {
        try {
          await this.addCapability(capability);
          this.logger.log(`Added Zone 2 capability: ${capability}`);
        } catch (error) {
          this.logger.error(`Failed to add Zone 2 capability ${capability}:`, error);
        }
      }
    }
    
    this.logger.log('Capability check completed');
  }

  /**
   * Remove Zone 2 capabilities if not supported by the device
   */
  private async removeZone2Capabilities() {
    const zone2Capabilities = [
      'measure_temperature.zone2',
      'target_temperature.zone2', 
      'thermostat_mode.zone2',
      'operational_state.zone2'
    ];

    this.logger.log('Removing Zone 2 capabilities as device does not support Zone 2');
    
    for (const capability of zone2Capabilities) {
      if (this.hasCapability(capability)) {
        try {
          await this.removeCapability(capability);
          this.logger.log(`Removed Zone 2 capability: ${capability}`);
        } catch (error) {
          this.logger.error(`Failed to remove Zone 2 capability ${capability}:`, error);
        }
      }
    }
  }

  /**
   * Add Zone 2 capabilities if supported by the device
   */
  private async ensureZone2Capabilities() {
    const zone2Capabilities = [
      'measure_temperature.zone2',
      'target_temperature.zone2', 
      'thermostat_mode.zone2',
      'operational_state.zone2'
    ];

    this.logger.log('Adding Zone 2 capabilities as device supports Zone 2');
    
    for (const capability of zone2Capabilities) {
      if (!this.hasCapability(capability)) {
        try {
          await this.addCapability(capability);
          this.logger.log(`Added Zone 2 capability: ${capability}`);
        } catch (error) {
          this.logger.error(`Failed to add Zone 2 capability ${capability}:`, error);
        }
      }
    }
  }

  /**
   * Check if device supports Zone 2 based on device data
   */
  private checkZone2Support(deviceState: any): boolean {
    // Check if Zone 2 temperature data is valid (above -30°C)
    // Invalid readings like -39°C indicate Zone 2 sensor is not connected
    const hasValidZone2Temperature = deviceState.RoomTemperatureZone2 !== undefined && 
                                   deviceState.RoomTemperatureZone2 !== null &&
                                   deviceState.RoomTemperatureZone2 > -30;
    
    // Check if Zone 2 has a custom name (indicates user configuration)
    const hasZone2Name = deviceState.Zone2Name !== undefined && 
                        deviceState.Zone2Name !== null && 
                        deviceState.Zone2Name.trim() !== '';

    // Check if Zone 2 is idle (if both zones are idle, might indicate single zone)
    const zone1Idle = deviceState.IdleZone1 === true;
    const zone2Idle = deviceState.IdleZone2 === true;
    const bothZonesIdle = zone1Idle && zone2Idle;

    // Zone 2 is considered available if:
    // 1. Temperature reading is valid (above -30°C), OR
    // 2. Zone 2 has a custom name
    // Additional consideration: If both zones are idle and temp is invalid, likely single zone
    const hasZone2 = (hasValidZone2Temperature || hasZone2Name) && 
                     !(bothZonesIdle && !hasValidZone2Temperature && !hasZone2Name);
    
    this.logger.log(`Zone 2 support check:`);
    this.logger.log(`  - Temperature: ${deviceState.RoomTemperatureZone2}°C (valid: ${hasValidZone2Temperature})`);
    this.logger.log(`  - Zone name: "${deviceState.Zone2Name}" (has name: ${hasZone2Name})`);
    this.logger.log(`  - Zone 1 idle: ${zone1Idle}, Zone 2 idle: ${zone2Idle}`);
    this.logger.log(`  - Final result: ${hasZone2}`);
    
    return hasZone2;
  }

  /**
   * Set up initial capability listeners for device control (Zone 1 and common capabilities)
   */
  private setupInitialCapabilityListeners() {
    // Listen for target temperature changes (Zone 1)
    this.registerCapabilityListener('target_temperature', async (value: number) => {
      this.logger.log(`Target temperature (Zone 1) changed to ${value}°C`);
      
      try {
        // Ensure global settings are available
        if (!(global as any).homeySettings) {
          (global as any).homeySettings = this.homey.settings;
        }

        if (this.melCloudApi) {
          const success = await this.melCloudApi.setZoneTemperature(
            this.deviceId,
            this.buildingId,
            value,
            1
          );

          if (success) {
            this.logger.log(`Successfully set target temperature (Zone 1) to ${value}°C`);
            
            // Task 2.1: Enable fast polling after temperature change for better responsiveness
            this.enableFastPolling('temperature command (Zone 1)');
            
            return value;
          } else {
            this.logger.error('Failed to set target temperature (Zone 1)');
            throw new Error('Failed to set target temperature (Zone 1)');
          }
        } else {
          throw new Error('MELCloud API not available');
        }
      } catch (error) {
        this.logger.error('Error setting target temperature (Zone 1):', error);
        throw error;
      }
    });

    // Listen for tank target temperature changes (if available)
    if (this.hasCapability('target_temperature.tank')) {
      this.registerCapabilityListener('target_temperature.tank', async (value: number) => {
        this.logger.log(`Target tank temperature changed to ${value}°C`);
        
        try {
          if (this.melCloudApi) {
            const success = await this.melCloudApi.setTankTemperature(
              this.deviceId,
              this.buildingId,
              value
            );

            if (success) {
              this.logger.log(`Successfully set target tank temperature to ${value}°C`);
              
              // Task 2.1: Enable fast polling after temperature change for better responsiveness
              this.enableFastPolling('tank temperature command');
              
              return value;
            } else {
              this.logger.error('Failed to set target tank temperature');
              throw new Error('Failed to set target tank temperature');
            }
          } else {
            throw new Error('MELCloud API not available');
          }
        } catch (error) {
          this.logger.error('Error setting target tank temperature:', error);
          throw error;
        }
      });
    }

    // Listen for hot water mode changes
    this.registerCapabilityListener('hot_water_mode', async (value: string) => {
      this.logger.log(`Hot water mode changed to ${value}`);
      
      try {
        if (this.melCloudApi) {
          const forced = value === 'forced';
          this.logger.log(`Setting hot water mode to: ${value} (forced: ${forced})`);
          
          const success = await this.melCloudApi.setHotWaterMode(this.deviceId, this.buildingId, forced);
          
          if (success) {
            this.logger.log(`Successfully set hot water mode to ${value}`);
            return value;
          } else {
            this.logger.error(`Failed to set hot water mode to ${value}`);
            throw new Error(`Failed to set hot water mode to ${value}`);
          }
        } else {
          throw new Error('MELCloud API not available');
        }
      } catch (error) {
        this.logger.error('Error setting hot water mode:', error);
        throw error;
      }
    });

    // Listen for on/off changes (with debouncing - Task 1.1)
    this.registerCapabilityListener('onoff', async (value: boolean) => {
      this.logger.log(`Device power changed to ${value ? 'on' : 'off'}`);
      
      // Check if we need to debounce this command
      const now = Date.now();
      if (this.lastPowerCommand) {
        const timeSinceLastCommand = now - this.lastPowerCommand.timestamp;
        
        if (timeSinceLastCommand < this.POWER_COMMAND_DELAY) {
          const remainingDelay = this.POWER_COMMAND_DELAY - timeSinceLastCommand;
          this.logger.log(`Power command debounced. Waiting ${remainingDelay}ms before executing.`);
          
          // Clear any existing debounce timer
          if (this.powerCommandDebounce) {
            clearTimeout(this.powerCommandDebounce);
          }
          
          // Set up a new debounced command
          return new Promise<boolean>((resolve, reject) => {
            this.powerCommandDebounce = setTimeout(async () => {
              try {
                const result = await this.executePowerCommand(value);
                resolve(result);
              } catch (error) {
                reject(error);
              }
            }, remainingDelay);
          });
        }
      }
      
      // Execute command immediately if no recent command
      return await this.executePowerCommand(value);
    });

    // Listen for thermostat mode changes (Zone 1)
    this.registerCapabilityListener('thermostat_mode', async (value: string) => {
      this.logger.log(`Thermostat mode (Zone 1) changed to ${value}`);
      
      try {
        if (this.melCloudApi) {
          const modeMap: { [key: string]: number } = {
            'room': 0,
            'flow': 1,
            'curve': 2
          };
          
          const mode = modeMap[value];
          if (mode === undefined) {
            throw new Error(`Invalid thermostat mode: ${value}`);
          }
          
          const success = await this.melCloudApi.setOperationMode(this.deviceId, this.buildingId, mode, 1);
          
          if (success) {
            this.logger.log(`Successfully set thermostat mode (Zone 1) to ${value}`);
            return value;
          } else {
            this.logger.error(`Failed to set thermostat mode (Zone 1) to ${value}`);
            throw new Error(`Failed to set thermostat mode (Zone 1) to ${value}`);
          }
        } else {
          throw new Error('MELCloud API not available');
        }
      } catch (error) {
        this.logger.error('Error setting thermostat mode:', error);
        throw error;
      }
    });
  }

  /**
   * Set up Zone 2 capability listeners (only if Zone 2 is supported)
   */
  private async setupZone2CapabilityListeners() {
    // Only set up listeners after Zone 2 check is complete
    if (!this.zone2Checked) {
      this.logger.log('Zone 2 check not completed yet, skipping Zone 2 listeners setup');
      return;
    }

    if (!this.hasZone2) {
      this.logger.log('Device does not support Zone 2, skipping Zone 2 listeners setup');
      return;
    }

    this.logger.log('Setting up Zone 2 capability listeners');

    // Listen for Zone 2 target temperature changes (if available)
    if (this.hasCapability('target_temperature.zone2')) {
      this.registerCapabilityListener('target_temperature.zone2', async (value: number) => {
        this.logger.log(`Target temperature (Zone 2) changed to ${value}°C`);
        
        try {
          if (this.melCloudApi) {
            const success = await this.melCloudApi.setZoneTemperature(
              this.deviceId,
              this.buildingId,
              value,
              2
            );

            if (success) {
              this.logger.log(`Successfully set target temperature (Zone 2) to ${value}°C`);
              return value;
            } else {
              this.logger.error('Failed to set target temperature (Zone 2)');
              throw new Error('Failed to set target temperature (Zone 2)');
            }
          } else {
            throw new Error('MELCloud API not available');
          }
        } catch (error) {
          this.logger.error('Error setting target temperature (Zone 2):', error);
          throw error;
        }
      });
    }

    // Listen for Zone 2 thermostat mode changes (if available)
    if (this.hasCapability('thermostat_mode.zone2')) {
      this.registerCapabilityListener('thermostat_mode.zone2', async (value: string) => {
        this.logger.log(`Thermostat mode (Zone 2) changed to ${value}`);
        
        try {
          if (this.melCloudApi) {
            const modeMap: { [key: string]: number } = {
              'room': 0,
              'flow': 1,
              'curve': 2
            };
            
            const mode = modeMap[value];
            if (mode === undefined) {
              throw new Error(`Invalid thermostat mode: ${value}`);
            }
            
            const success = await this.melCloudApi.setOperationMode(this.deviceId, this.buildingId, mode, 2);
            
            if (success) {
              this.logger.log(`Successfully set thermostat mode (Zone 2) to ${value}`);
              return value;
            } else {
              this.logger.error(`Failed to set thermostat mode (Zone 2) to ${value}`);
              throw new Error(`Failed to set thermostat mode (Zone 2) to ${value}`);
            }
          } else {
            throw new Error('MELCloud API not available');
          }
        } catch (error) {
          this.logger.error('Error setting Zone 2 thermostat mode:', error);
          throw error;
        }
      });
    }
  }

  /**
   * Execute power command with tracking for debouncing (Task 1.1) and fast polling trigger (Task 2.1)
   */
  private async executePowerCommand(value: boolean): Promise<boolean> {
    try {
      if (!this.melCloudApi) {
        throw new Error('MELCloud API not available');
      }

      // Check if device is actually offline (Task 1.3)
      if (this.hasCapability('alarm_generic.offline')) {
        const isOffline = this.getCapabilityValue('alarm_generic.offline');
        if (isOffline) {
          this.logger.warn(`Attempting to send power command to offline device. Command may not be executed.`);
          // Still attempt the command as the device might come back online
        }
      }

      // Update tracking before making the call
      this.lastPowerCommand = { value, timestamp: Date.now() };
      
      const success = await this.melCloudApi.setDevicePower(this.deviceId, this.buildingId, value);
      
      if (success) {
        this.logger.log(`Successfully set power to ${value ? 'on' : 'off'}`);
        
        // Task 2.1: Enable fast polling after power command for better responsiveness
        this.enableFastPolling('power command');
        
        return value;
      } else {
        this.logger.error(`Failed to set power to ${value ? 'on' : 'off'}`);
        throw new Error(`Failed to set power to ${value ? 'on' : 'off'}`);
      }
    } catch (error) {
      this.logger.error('Error setting power state:', error);
      throw error;
    }
  }

  /**
   * Task 2.1: Start fetching data from MELCloud API with adaptive polling intervals
   * Task 2.2: Use circuit breaker protected data fetching
   */
  private async startDataFetching() {
    // Initial fetch with circuit breaker protection
    await this.fetchDeviceDataWithProtection();

    // Start adaptive polling instead of fixed interval
    this.scheduleNextDataFetch();

    this.logger.log(`Started adaptive data fetching with circuit breaker protection (normal: ${this.currentDataInterval}ms, fast: ${this.pollingConfig.fastPollInterval}ms)`);
  }

  /**
   * Fetch device data from MELCloud API
   */
  private async fetchDeviceData() {
    try {
      if (!this.melCloudApi) {
        this.logger.error('MELCloud API not available');
        return;
      }

      // Check if we have credentials and login if needed
      const email = this.homey.settings.get('melcloud_user');
      const password = this.homey.settings.get('melcloud_pass');

      if (!email || !password) {
        this.logger.error('MELCloud credentials not configured');
        this.setUnavailable('MELCloud credentials not configured');
        return;
      }

      // Set up global homeySettings for the API (temporary)
      if (!(global as any).homeySettings) {
        (global as any).homeySettings = this.homey.settings;
      }

      // Get device state from MELCloud
      const deviceState: MelCloudDevice = await this.melCloudApi.getDeviceState(
        this.deviceId,
        this.buildingId
      );

      // Update capabilities based on device state
      await this.updateCapabilities(deviceState);

      // Mark device as available if it was unavailable
      if (!this.getAvailable()) {
        await this.setAvailable();
        this.logger.log('Device marked as available');
      }

    } catch (error) {
      this.logger.error('Failed to fetch device data:', error);
      this.setWarning('Failed to fetch data from MELCloud');
    }
  }

  /**
   * Check if device is actually offline based on LastCommunication timestamp (Task 1.3)
   * @param deviceState Device state from MELCloud
   * @returns True if device is actually offline
   */
  private isActuallyOffline(deviceState: any): boolean {
    // If no LastCommunication field, fall back to deviceState.Offline
    if (!deviceState.LastCommunication) {
      this.logger.log('No LastCommunication field available, falling back to deviceState.Offline');
      return deviceState.Offline || false;
    }

    try {
      const lastComm = new Date(deviceState.LastCommunication);
      const staleness = Date.now() - lastComm.getTime();
      const isStale = staleness > 300000; // 5 minutes threshold
      
      this.logger.log(`Device communication check: lastComm=${lastComm.toISOString()}, staleness=${Math.round(staleness/1000)}s, isStale=${isStale}`);
      
      return isStale;
    } catch (error) {
      this.logger.error('Error parsing LastCommunication timestamp:', error);
      // Fall back to original offline status on parse error
      return deviceState.Offline || false;
    }
  }

  /**
   * Update device capabilities based on MELCloud device state
   */
  private async updateCapabilities(deviceState: MelCloudDevice) {
    try {
      // Check Zone 2 support on first data fetch
      if (!this.zone2Checked) {
        this.hasZone2 = this.checkZone2Support(deviceState);
        this.zone2Checked = true;
        
        if (!this.hasZone2) {
          this.logger.log('Device does not support Zone 2, removing Zone 2 capabilities');
          await this.removeZone2Capabilities();
        } else {
          this.logger.log('Device supports Zone 2, keeping Zone 2 capabilities');
          // Set up Zone 2 capability listeners now that we know Zone 2 is supported
          await this.setupZone2CapabilityListeners();
        }
      }

      // Log the complete device state for debugging
      this.logger.log('MELCloud device state keys:', Object.keys(deviceState));
      this.logger.log('MELCloud device state:', JSON.stringify(deviceState, null, 2));
      
      // Set device online/offline status using improved detection (Task 1.3)
      if (this.hasCapability('alarm_generic.offline')) {
        const actuallyOffline = this.isActuallyOffline(deviceState);
        await this.setCapabilityValue('alarm_generic.offline', actuallyOffline);
        
        if (actuallyOffline) {
          this.logger.warn('Device detected as actually offline based on LastCommunication timestamp');
        }
      }

      // Update power state
      if (deviceState.Power !== undefined && this.hasCapability('onoff')) {
        const currentPower = this.getCapabilityValue('onoff');
        if (currentPower !== deviceState.Power) {
          await this.setCapabilityValue('onoff', deviceState.Power);
          this.logger.log(`Updated power state: ${deviceState.Power ? 'on' : 'off'}`);
        }
      }

      // Update indoor temperature (Zone 1)
      if (deviceState.RoomTemperatureZone1 !== undefined && deviceState.RoomTemperatureZone1 > -30) {
        const currentIndoor = this.getCapabilityValue('measure_temperature');
        if (currentIndoor !== deviceState.RoomTemperatureZone1) {
          await this.setCapabilityValue('measure_temperature', deviceState.RoomTemperatureZone1);
          this.logger.log(`Updated indoor temperature (Zone 1): ${deviceState.RoomTemperatureZone1}°C`);
        }
      }

      // Update Zone 2 temperature (if available and valid)
      if (deviceState.RoomTemperatureZone2 !== undefined && deviceState.RoomTemperatureZone2 > -30 && this.hasCapability('measure_temperature.zone2')) {
        const currentZone2 = this.getCapabilityValue('measure_temperature.zone2');
        if (currentZone2 !== deviceState.RoomTemperatureZone2) {
          await this.setCapabilityValue('measure_temperature.zone2', deviceState.RoomTemperatureZone2);
          this.logger.log(`Updated indoor temperature (Zone 2): ${deviceState.RoomTemperatureZone2}°C`);
        }
      }

      // Update tank temperature (if available)
      if (deviceState.TankWaterTemperature !== undefined && this.hasCapability('measure_temperature.tank')) {
        const currentTank = this.getCapabilityValue('measure_temperature.tank');
        if (currentTank !== deviceState.TankWaterTemperature) {
          await this.setCapabilityValue('measure_temperature.tank', deviceState.TankWaterTemperature);
          this.logger.log(`Updated tank temperature: ${deviceState.TankWaterTemperature}°C`);
        }
      }

      // Update outdoor temperature
      if (deviceState.OutdoorTemperature !== undefined) {
        const currentOutdoor = this.getCapabilityValue('measure_temperature.outdoor');
        if (currentOutdoor !== deviceState.OutdoorTemperature) {
          await this.setCapabilityValue('measure_temperature.outdoor', deviceState.OutdoorTemperature);
          this.logger.log(`Updated outdoor temperature: ${deviceState.OutdoorTemperature}°C`);
        }
      }

      // Update target temperature (Zone 1)
      if (deviceState.SetTemperatureZone1 !== undefined) {
        const currentTarget = this.getCapabilityValue('target_temperature');
        if (currentTarget !== deviceState.SetTemperatureZone1) {
          await this.setCapabilityValue('target_temperature', deviceState.SetTemperatureZone1);
          this.logger.log(`Updated target temperature (Zone 1): ${deviceState.SetTemperatureZone1}°C`);
        }
      }

      // Update Zone 2 target temperature (if available)
      if (deviceState.SetTemperatureZone2 !== undefined && this.hasCapability('target_temperature.zone2')) {
        const currentTargetZone2 = this.getCapabilityValue('target_temperature.zone2');
        if (currentTargetZone2 !== deviceState.SetTemperatureZone2) {
          await this.setCapabilityValue('target_temperature.zone2', deviceState.SetTemperatureZone2);
          this.logger.log(`Updated target temperature (Zone 2): ${deviceState.SetTemperatureZone2}°C`);
        }
      }

      // Update tank target temperature (if available)
      if (deviceState.SetTankWaterTemperature !== undefined && this.hasCapability('target_temperature.tank')) {
        const currentTargetTank = this.getCapabilityValue('target_temperature.tank');
        if (currentTargetTank !== deviceState.SetTankWaterTemperature) {
          await this.setCapabilityValue('target_temperature.tank', deviceState.SetTankWaterTemperature);
          this.logger.log(`Updated target tank temperature: ${deviceState.SetTankWaterTemperature}°C`);
        }
      }

      // Update energy consumption and production data - Use API data if available
      await this.updateEnergyData(deviceState);

      // Update device state information
      await this.updateDeviceStateInfo(deviceState);

      // Update hot water mode
      await this.updateHotWaterMode(deviceState);

      // Update operational states
      await this.updateOperationalStates(deviceState);

      this.logger.debug('Device capabilities updated successfully');

    } catch (error) {
      this.logger.error('Error updating capabilities:', error);
      // Mark device as offline on error
      if (this.hasCapability('alarm_generic.offline')) {
        await this.setCapabilityValue('alarm_generic.offline', true);
      }
    }
  }

  /**
   * Update energy data from MELCloud device state
   */
  private async updateEnergyData(deviceState: MelCloudDevice) {
    try {
      // Check if device state has energy data
      if (deviceState.DailyHeatingEnergyConsumed !== undefined || 
          deviceState.DailyHeatingEnergyProduced !== undefined ||
          deviceState.DailyHotWaterEnergyConsumed !== undefined ||
          deviceState.DailyHotWaterEnergyProduced !== undefined) {
        
        this.logger.log('Using energy data from device state');
        
        // Update energy capabilities from device state
        if (this.hasCapability('heating_cop')) {
          const heatingCOP = this.calculateCOP(
            deviceState.DailyHeatingEnergyProduced || 0,
            deviceState.DailyHeatingEnergyConsumed || 0
          );
          await this.setCapabilityValue('heating_cop', heatingCOP);
        }

        if (this.hasCapability('hotwater_cop')) {
          const hotWaterCOP = this.calculateCOP(
            deviceState.DailyHotWaterEnergyProduced || 0,
            deviceState.DailyHotWaterEnergyConsumed || 0
          );
          await this.setCapabilityValue('hotwater_cop', hotWaterCOP);
        }

        // Update meter capabilities with actual values
        await this.updateEnergyCapability('meter_power.heating_consumed', (deviceState.DailyHeatingEnergyConsumed || 0) / 1000);
        await this.updateEnergyCapability('meter_power.heating_produced', (deviceState.DailyHeatingEnergyProduced || 0) / 1000);
        await this.updateEnergyCapability('meter_power.hotwater_consumed', (deviceState.DailyHotWaterEnergyConsumed || 0) / 1000);
        await this.updateEnergyCapability('meter_power.hotwater_produced', (deviceState.DailyHotWaterEnergyProduced || 0) / 1000);
        
        return; // Exit early since we have real data
      }

      // Fallback: try to get energy data from API
      this.logger.log('No energy data in device state, trying API');
      await this.fetchEnergyDataFromApi();
      
      // Start energy reporting if not already started
      if (!this.energyReportInterval) {
        this.startEnergyReporting();
      }

    } catch (error) {
      this.logger.error('Error updating energy data:', error);
      
      // Fallback to estimation if API fails
      this.logger.log('Falling back to energy estimation');
      await this.estimateEnergyData(deviceState);
    }
  }

  /**
   * Estimate energy data based on device state (fallback method)
   */
  private async estimateEnergyData(deviceState: MelCloudDevice) {
    try {
      // Use device demand and operation data to estimate energy consumption
      const demandPercentage = deviceState.DemandPercentage || 0;
      const powerOn = deviceState.Power || false;
      const isHeating = deviceState.OperationModeZone1 === 1; // Heat mode
      const isHotWater = deviceState.ForcedHotWaterMode || false;
      
      // Estimate energy consumption based on system state and typical COP values
      // This is a simplified estimation until proper energy API is available
      const baseConsumption = powerOn ? (demandPercentage / 100) * 3000 : 0; // 3kW typical max
      
      if (isHeating) {
        const estimatedHeatingConsumed = baseConsumption * 0.7; // 70% for heating
        const estimatedHeatingProduced = estimatedHeatingConsumed * 2.5; // COP of 2.5
        
        await this.updateEnergyCapability('meter_power.heating_consumed', estimatedHeatingConsumed);
        await this.updateEnergyCapability('meter_power.heating', estimatedHeatingConsumed);
        await this.updateEnergyCapability('meter_power.produced_heating', estimatedHeatingProduced);
        await this.updateEnergyCapability('heating_cop', estimatedHeatingProduced / (estimatedHeatingConsumed || 1));
      }
      
      if (isHotWater) {
        const estimatedHotWaterConsumed = baseConsumption * 0.3; // 30% for hot water
        const estimatedHotWaterProduced = estimatedHotWaterConsumed * 3.0; // COP of 3.0 for hot water
        
        await this.updateEnergyCapability('meter_power.hotwater_consumed', estimatedHotWaterConsumed);
        await this.updateEnergyCapability('meter_power.hotwater', estimatedHotWaterConsumed);
        await this.updateEnergyCapability('meter_power.produced_hotwater', estimatedHotWaterProduced);
        await this.updateEnergyCapability('hotwater_cop', estimatedHotWaterProduced / (estimatedHotWaterConsumed || 1));
      }

      this.logger.debug('Energy capabilities updated with estimates');

    } catch (error) {
      this.logger.error('Error estimating energy data:', error);
    }
  }

  /**
   * Update a single energy capability if it exists
   */
  private async updateEnergyCapability(capability: string, value: number) {
    if (this.hasCapability(capability)) {
      const currentValue = this.getCapabilityValue(capability);
      if (currentValue !== value) {
        await this.setCapabilityValue(capability, Math.round(value * 100) / 100); // Round to 2 decimal places
        this.logger.log(`Updated ${capability}: ${value.toFixed(2)}`);
      }
    }
  }

  /**
   * Task 2.1: Start energy reporting with configurable interval
   * Task 2.2: Use circuit breaker protected energy fetching
   */
  private startEnergyReporting() {
    if (this.energyReportInterval) {
      clearInterval(this.energyReportInterval);
    }
    
    // Report energy data using configured interval (default 15 minutes)
    this.energyReportInterval = setInterval(async () => {
      // Task 2.2: Use circuit breaker protected energy fetch
      await this.fetchEnergyDataWithProtection();
    }, this.currentEnergyInterval);

    this.logger.log(`Energy reporting started with circuit breaker protection (every ${this.currentEnergyInterval / 60000} minutes)`);
  }

  /**
   * Fetch and update energy data from MELCloud API
   */
  private async fetchEnergyDataFromApi() {
    if (!this.melCloudApi) {
      this.logger.error('MELCloud API not available for energy data');
      return;
    }

    try {
      // Get energy data for today
      const energyTotals = await this.melCloudApi.getDailyEnergyTotals(
        this.deviceId,
        this.buildingId
      );

      this.logger.log('Energy data retrieved:', energyTotals);

      // Check Zone 2 support from energy API if not already done
      if (!this.energyBasedZone2Check && energyTotals.HasZone2 !== undefined) {
        this.energyBasedZone2Check = true;
        const energyHasZone2 = energyTotals.HasZone2;
        
        this.logger.log(`Energy API reports Zone 2 support: ${energyHasZone2}`);
        
        // If energy API says no Zone 2 but we detected it from device state, remove Zone 2 capabilities
        if (!energyHasZone2 && this.hasZone2) {
          this.logger.log('Energy API indicates no Zone 2 support, overriding device state detection');
          this.hasZone2 = false;
          await this.removeZone2Capabilities();
        } else if (energyHasZone2 && !this.hasZone2) {
          this.logger.log('Energy API indicates Zone 2 support, adding Zone 2 capabilities');
          this.hasZone2 = true;
          // Re-add Zone 2 capabilities and set up listeners
          await this.ensureZone2Capabilities();
          await this.setupZone2CapabilityListeners();
        }
      }

      // Update energy capabilities directly (API already returns kWh values)
      if (this.hasCapability('meter_power.heating_consumed')) {
        await this.setCapabilityValue('meter_power.heating_consumed', energyTotals.TotalHeatingConsumed || 0);
      }
      if (this.hasCapability('meter_power.heating_produced')) {
        await this.setCapabilityValue('meter_power.heating_produced', energyTotals.TotalHeatingProduced || 0);
      }
      if (this.hasCapability('meter_power.hotwater_consumed')) {
        await this.setCapabilityValue('meter_power.hotwater_consumed', energyTotals.TotalHotWaterConsumed || 0);
      }
      if (this.hasCapability('meter_power.hotwater_produced')) {
        await this.setCapabilityValue('meter_power.hotwater_produced', energyTotals.TotalHotWaterProduced || 0);
      }

      // Update legacy meter capabilities for compatibility
      if (this.hasCapability('meter_power.heating')) {
        await this.setCapabilityValue('meter_power.heating', energyTotals.TotalHeatingConsumed || 0);
      }
      if (this.hasCapability('meter_power.produced_heating')) {
        await this.setCapabilityValue('meter_power.produced_heating', energyTotals.TotalHeatingProduced || 0);
      }
      if (this.hasCapability('meter_power.hotwater')) {
        await this.setCapabilityValue('meter_power.hotwater', energyTotals.TotalHotWaterConsumed || 0);
      }
      if (this.hasCapability('meter_power.produced_hotwater')) {
        await this.setCapabilityValue('meter_power.produced_hotwater', energyTotals.TotalHotWaterProduced || 0);
      }

      // Update COP capabilities with proper error handling
      if (this.hasCapability('heating_cop')) {
        // Prefer explicit field, then averageCOP, then legacy AverageHeatingCOP, then calculate
        let heatingCOP = (energyTotals as any).heatingCOP ?? (energyTotals as any).averageCOP ?? energyTotals.AverageHeatingCOP ?? 0;
        if (!heatingCOP || heatingCOP === 0) {
          heatingCOP = this.calculateCOP(
            energyTotals.TotalHeatingProduced || 0,
            energyTotals.TotalHeatingConsumed || 0
          );
        }
        await this.setCapabilityValue('heating_cop', heatingCOP);
        this.logger.log(`Heating COP set: ${heatingCOP} ${((energyTotals as any).heatingCOP || energyTotals.AverageHeatingCOP) ? '(from API)' : '(calculated)'}`);
      }

      if (this.hasCapability('hotwater_cop')) {
        // Prefer explicit field, then averageCOP, then legacy AverageHotWaterCOP, then calculate
        let hotWaterCOP = (energyTotals as any).hotWaterCOP ?? (energyTotals as any).averageCOP ?? energyTotals.AverageHotWaterCOP ?? 0;
        if (!hotWaterCOP || hotWaterCOP === 0) {
          hotWaterCOP = this.calculateCOP(
            energyTotals.TotalHotWaterProduced || 0,
            energyTotals.TotalHotWaterConsumed || 0
          );
        }
        await this.setCapabilityValue('hotwater_cop', hotWaterCOP);
        this.logger.log(`Hot Water COP set: ${hotWaterCOP} ${((energyTotals as any).hotWaterCOP || energyTotals.AverageHotWaterCOP) ? '(from API)' : '(calculated)'}`);
      }

    } catch (error) {
      this.logger.warn('Failed to update energy data:', {
        error: error instanceof Error ? error.message : String(error),
        deviceId: this.deviceId,
        buildingId: this.buildingId
      });
    }
  }

  /**
   * Calculate Coefficient of Performance (COP)
   * COP = Energy Produced / Energy Consumed
   */
  private calculateCOP(produced: number, consumed: number): number {
    // Return 0 if consumed is 0 or very small to avoid division by zero
    if (consumed <= 0.001) return 0;
    
    const cop = produced / consumed;
    
    // Sanity check: COP should be reasonable for heat pumps (typically 1.5-6.0)
    // If it's outside this range, something might be wrong with the data
    if (cop < 0 || cop > 10) {
      this.logger.warn(`Unusual COP calculated: ${cop} (Produced: ${produced}, Consumed: ${consumed})`);
      return 0;
    }
    
    // Round to 2 decimal places for cleaner display
    return Math.round(cop * 100) / 100;
  }

  /**
   * Update device state information
   */
  private async updateDeviceStateInfo(deviceState: MelCloudDevice) {
    try {
      // For ATW devices, use OperationModeZone1 for thermostat_mode instead of OperationMode
      if (deviceState.OperationModeZone1 !== undefined && this.hasCapability('thermostat_mode')) {
        const thermostatMode = this.convertOperationMode(deviceState.OperationModeZone1);
        const currentMode = this.getCapabilityValue('thermostat_mode');
        if (currentMode !== thermostatMode) {
          await this.setCapabilityValue('thermostat_mode', thermostatMode);
          this.logger.debug(`Updated thermostat mode (Zone 1): ${thermostatMode} (${deviceState.OperationModeZone1})`);
        }
      }

      // Update Zone 2 thermostat mode if available
      if (deviceState.OperationModeZone2 !== undefined && this.hasCapability('thermostat_mode.zone2')) {
        const thermostatModeZone2 = this.convertOperationMode(deviceState.OperationModeZone2);
        const currentModeZone2 = this.getCapabilityValue('thermostat_mode.zone2');
        if (currentModeZone2 !== thermostatModeZone2) {
          await this.setCapabilityValue('thermostat_mode.zone2', thermostatModeZone2);
          this.logger.debug(`Updated thermostat mode (Zone 2): ${thermostatModeZone2} (${deviceState.OperationModeZone2})`);
        }
      }

      // Update on/off state
      if (deviceState.Power !== undefined) {
        const currentOnOff = this.getCapabilityValue('onoff');
        if (currentOnOff !== deviceState.Power) {
          await this.setCapabilityValue('onoff', deviceState.Power);
          this.logger.debug(`Updated power state: ${deviceState.Power ? 'on' : 'off'}`);
        }
      } else if (deviceState.IdleZone1 !== undefined) {
        const currentOnOff = this.getCapabilityValue('onoff');
        const isOn = !deviceState.IdleZone1; // Idle means off, so invert
        if (currentOnOff !== isOn) {
          await this.setCapabilityValue('onoff', isOn);
          this.logger.debug(`Updated power state: ${isOn ? 'on' : 'off'}`);
        }
      }
    } catch (error) {
      this.logger.error('Error updating device state info:', error);
    }
  }

  /**
   * Update hot water mode capability based on device state
   */
  private async updateHotWaterMode(deviceState: MelCloudDevice) {
    try {
      if (deviceState.ForcedHotWaterMode !== undefined && this.hasCapability('hot_water_mode')) {
        const hotWaterMode = deviceState.ForcedHotWaterMode ? 'forced' : 'auto';
        const currentMode = this.getCapabilityValue('hot_water_mode');
        if (currentMode !== hotWaterMode) {
          await this.setCapabilityValue('hot_water_mode', hotWaterMode);
          this.logger.log(`Updated hot water mode: ${hotWaterMode}`);
        }
      }
    } catch (error) {
      this.logger.error('Error updating hot water mode:', error);
    }
  }

  /**
   * Update operational state capabilities
   */
  private async updateOperationalStates(deviceState: MelCloudDevice) {
    try {
      // Main operational state based on OperationMode
      if (deviceState.OperationMode !== undefined && this.hasCapability('operational_state')) {
        const operationState = this.getOperationModeState(deviceState.OperationMode);
        const currentState = this.getCapabilityValue('operational_state');
        if (currentState !== operationState) {
          await this.setCapabilityValue('operational_state', operationState);
          this.logger.log(`Updated operational state: ${operationState}`);
        }
      }

      // Hot water operational state
      if (this.hasCapability('operational_state.hot_water')) {
        const hotWaterState = this.getHotWaterOperationalState(deviceState);
        const currentHotWaterState = this.getCapabilityValue('operational_state.hot_water');
        if (currentHotWaterState !== hotWaterState) {
          await this.setCapabilityValue('operational_state.hot_water', hotWaterState);
          this.logger.log(`Updated hot water state: ${hotWaterState}`);
        }
      }

      // Zone 1 operational state
      if (this.hasCapability('operational_state.zone1')) {
        const zone1State = this.getZoneOperationalState(deviceState, 'Zone1');
        const currentZone1State = this.getCapabilityValue('operational_state.zone1');
        if (currentZone1State !== zone1State) {
          await this.setCapabilityValue('operational_state.zone1', zone1State);
          this.logger.log(`Updated Zone 1 state: ${zone1State}`);
        }
      }

      // Zone 2 operational state
      if (this.hasCapability('operational_state.zone2')) {
        const zone2State = this.getZoneOperationalState(deviceState, 'Zone2');
        const currentZone2State = this.getCapabilityValue('operational_state.zone2');
        if (currentZone2State !== zone2State) {
          await this.setCapabilityValue('operational_state.zone2', zone2State);
          this.logger.log(`Updated Zone 2 state: ${zone2State}`);
        }
      }

    } catch (error) {
      this.logger.error('Error updating operational states:', error);
    }
  }

  /**
   * Convert MELCloud operation mode to our thermostat mode values
   */
  private convertOperationMode(operationMode: number): string {
    // Map MELCloud operation modes to our thermostat mode values
    // These mappings should match the actual MELCloud API values
    switch (operationMode) {
      case 0: return 'room';    // Room temperature control
      case 1: return 'flow';    // Flow temperature control  
      case 2: return 'curve';   // Curve control
      default: return 'room';   // Default to room control
    }
  }

  /**
   * Get main operation mode state
   */
  private getOperationModeState(operationMode: number): string {
    switch (operationMode) {
      case 0: return 'idle';
      case 1: return 'heating';
      case 2: return 'cooling'; 
      case 3: return 'defrost';
      case 5: return 'dhw';       // Domestic hot water
      case 6: return 'legionella';
      default: return 'idle';
    }
  }

  /**
   * Get hot water operational state
   */
  private getHotWaterOperationalState(deviceState: MelCloudDevice): string {
    if (deviceState.ProhibitHotWater) {
      return 'prohibited';
    }
    
    // Check if hot water is actively being produced
    if (deviceState.OperationMode === 5) { // DHW mode
      return 'dhw';
    }
    
    // Check for legionella mode
    if (deviceState.OperationMode === 6) {
      return 'legionella';
    }
    
    return 'idle';
  }

  /**
   * Get zone operational state
   */
  private getZoneOperationalState(deviceState: MelCloudDevice, zone: 'Zone1' | 'Zone2'): string {
    const zoneInCoolMode = deviceState[`${zone}InCoolMode` as keyof MelCloudDevice];
    const zoneInHeatMode = deviceState[`${zone}InHeatMode` as keyof MelCloudDevice];
    const prohibitCooling = deviceState[`ProhibitCooling${zone}` as keyof MelCloudDevice];
    const prohibitHeating = deviceState[`ProhibitHeating${zone}` as keyof MelCloudDevice];
    const idle = deviceState[`Idle${zone}` as keyof MelCloudDevice];

    // Check for prohibited states
    if ((zoneInCoolMode && prohibitCooling) || (zoneInHeatMode && prohibitHeating)) {
      return 'prohibited';
    }

    // Check for defrost mode
    if (deviceState.DefrostMode) {
      return 'defrost';
    }

    // Check for cooling/heating
    if (zoneInCoolMode && !idle) {
      return 'cooling';
    }
    
    if (zoneInHeatMode && !idle) {
      return 'heating';
    }

    return 'idle';
  }

  /**
   * onAdded is called when the user adds the device, called just after pairing.
   */
  async onAdded() {
    this.logger.log('BoilerDevice has been added');
  }

  /**
   * onSettings is called when the user updates the device's settings.
   */
  async onSettings({
    oldSettings,
    newSettings,
    changedKeys,
  }: {
    oldSettings: { [key: string]: boolean | string | number | undefined | null };
    newSettings: { [key: string]: boolean | string | number | undefined | null };
    changedKeys: string[];
  }): Promise<string | void> {
    this.logger.log("BoilerDevice settings were changed");

    // Check if device ID or building ID changed
    if (changedKeys.includes('device_id') || changedKeys.includes('building_id')) {
      this.deviceId = newSettings.device_id as string;
      this.buildingId = newSettings.building_id as number;
      
      this.logger.log(`Device configuration updated: Device ID=${this.deviceId}, Building ID=${this.buildingId}`);
      
      // Restart data fetching with new configuration
      if (this.updateInterval) {
        clearInterval(this.updateInterval);
      }
      await this.startDataFetching();
    }
  }

  /**
   * Task 2.2: Initialize circuit breakers for API protection
   */
  private initializeCircuitBreakers() {
    try {
      // Main API calls circuit breaker
      this.apiCircuitBreaker = new CircuitBreaker(
        `API-${this.deviceId}`,
        this.logger,
        {
          failureThreshold: 3,        // Open after 3 consecutive failures
          resetTimeout: 60000,        // Try again after 1 minute
          halfOpenSuccessThreshold: 2, // Close after 2 successes
          timeout: 15000,             // 15 second request timeout
          monitorInterval: 300000     // Log status every 5 minutes
        }
      );

      // Energy reporting circuit breaker (more lenient)
      this.energyCircuitBreaker = new CircuitBreaker(
        `Energy-${this.deviceId}`,
        this.logger,
        {
          failureThreshold: 5,        // More tolerant for energy calls
          resetTimeout: 300000,       // 5 minute reset timeout
          halfOpenSuccessThreshold: 1,
          timeout: 20000,
          monitorInterval: 600000     // Log status every 10 minutes
        }
      );

      this.logger.log('Circuit breakers initialized for API protection');
      
    } catch (error) {
      this.logger.error('Error initializing circuit breakers:', error);
      // Continue without circuit breakers if initialization fails
    }
  }

  /**
   * Task 2.2: Protected API data fetching with circuit breaker
   */
  private async fetchDeviceDataWithProtection() {
    try {
      if (!this.apiCircuitBreaker) {
        // Fallback to direct call if circuit breaker not available
        return await this.fetchDeviceData();
      }

      const deviceData = await this.apiCircuitBreaker.execute(async () => {
        return await this.fetchDeviceData();
      });

      // Success - update metrics and clear degraded mode
      this.lastSuccessfulUpdate = new Date();
      this.circuitBreakerMetrics.degradedModeActive = false;
      await this.setAvailable();
      
      return deviceData;
      
    } catch (error) {
      this.circuitBreakerMetrics.dataCallFailures++;
      this.circuitBreakerMetrics.lastFailureTime = new Date();
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('circuit') && errorMessage.includes('open')) {
        // Circuit breaker is open - enter degraded mode
        await this.enterDegradedMode('API circuit breaker is open');
        this.logger.warn('Entering degraded mode due to API circuit breaker activation');
      } else {
        // Regular API error
        this.logger.error('API call failed:', error);
      }
      
      throw error;
    }
  }

  /**
   * Task 2.2: Protected energy data fetching with circuit breaker
   */
  private async fetchEnergyDataWithProtection() {
    try {
      if (!this.energyCircuitBreaker) {
        this.logger.warn('Energy circuit breaker not initialized, using direct call');
        return await this.fetchEnergyDataFromApi();
      }

      await this.energyCircuitBreaker.execute(async () => {
        await this.fetchEnergyDataFromApi();
      });
      
    } catch (error) {
      this.circuitBreakerMetrics.energyCallFailures++;
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('circuit') && errorMessage.includes('open')) {
        this.logger.warn('Energy circuit breaker is open, skipping energy updates');
        // Don't fail the device for energy circuit breaker - just log and continue
      } else {
        this.logger.error('Energy API call failed:', error);
      }
    }
  }

  /**
   * Task 2.2: Enter degraded mode during API failures
   */
  private async enterDegradedMode(reason: string) {
    this.circuitBreakerMetrics.degradedModeActive = true;
    
    // Set device as warning state but not unavailable
    await this.setWarning(`Degraded mode: ${reason}`);
    
    // Disable non-essential polling temporarily
    if (this.energyReportInterval) {
      clearInterval(this.energyReportInterval);
      this.logger.log('Energy reporting paused during degraded mode');
    }
    
    // Notify user
    try {
      await this.homey.notifications.createNotification({
        excerpt: `${this.getName()} is in degraded mode: ${reason}`
      });
    } catch (err) {
      this.logger.error('Failed to send notification:', err);
    }
  }

  /**
   * Task 2.2: Get circuit breaker status for monitoring
   */
  private getCircuitBreakerStatus() {
    return {
      apiState: this.apiCircuitBreaker?.getState() || 'unknown',
      energyState: this.energyCircuitBreaker?.getState() || 'unknown',
      degradedMode: this.circuitBreakerMetrics.degradedModeActive,
      lastSuccessfulUpdate: this.lastSuccessfulUpdate,
      failureCounts: {
        data: this.circuitBreakerMetrics.dataCallFailures,
        energy: this.circuitBreakerMetrics.energyCallFailures
      }
    };
  }

  /**
   * Task 2.1: Initialize configurable polling intervals
   */
  private initializePollingConfiguration() {
    try {
      // Get user-configured intervals from settings (in minutes, convert to ms)
      const dataIntervalMinutes = this.getSetting('polling_data_interval') || 5;
      const energyIntervalMinutes = this.getSetting('polling_energy_interval') || 15;
      const adaptiveMode = this.getSetting('polling_adaptive_mode') !== false; // default true
      
      // Validate and apply intervals
      this.currentDataInterval = Math.max(60000, dataIntervalMinutes * 60000); // Min 1 minute
      this.currentEnergyInterval = Math.max(300000, energyIntervalMinutes * 60000); // Min 5 minutes
      
      // Update config
      this.pollingConfig.dataInterval = this.currentDataInterval;
      this.pollingConfig.energyInterval = this.currentEnergyInterval;
      
      this.logger.log(`Polling configuration initialized:`);
      this.logger.log(`  - Data interval: ${dataIntervalMinutes} minutes (${this.currentDataInterval}ms)`);
      this.logger.log(`  - Energy interval: ${energyIntervalMinutes} minutes (${this.currentEnergyInterval}ms)`);
      this.logger.log(`  - Adaptive mode: ${adaptiveMode ? 'enabled' : 'disabled'}`);
      
      // Listen for settings changes
      this.homey.settings.on('set', (key: string) => {
        if (key.startsWith('polling_')) {
          this.logger.log(`Polling setting changed: ${key}, reinitializing...`);
          this.initializePollingConfiguration();
        }
      });
      
    } catch (error) {
      this.logger.error('Error initializing polling configuration, using defaults:', error);
      // Keep default values on error
    }
  }

  /**
   * Task 2.1: Check if fast polling should be used based on recent commands
   */
  private shouldUseFastPolling(): boolean {
    const adaptiveMode = this.getSetting('polling_adaptive_mode') !== false;
    const inFastPollWindow = this.fastPollUntil ? Date.now() < this.fastPollUntil : false;
    
    return adaptiveMode && inFastPollWindow;
  }

  /**
   * Task 2.1: Enable fast polling for a period after user commands
   */
  private enableFastPolling(reason: string = 'user command') {
    const adaptiveMode = this.getSetting('polling_adaptive_mode') !== false;
    
    if (adaptiveMode) {
      this.fastPollUntil = Date.now() + this.pollingConfig.fastPollDuration;
      this.logger.debug(`Fast polling enabled for 10 minutes after ${reason}`);
      
      // If currently using slow polling, restart with fast polling immediately
      if (this.updateInterval && !this.shouldUseFastPolling()) {
        clearTimeout(this.updateInterval);
        this.scheduleNextDataFetch();
      }
    }
  }

  /**
   * Task 2.1: Dynamically schedule next data fetch based on current polling mode
   * Task 2.2: Use circuit breaker protected data fetching
   */
  private scheduleNextDataFetch() {
    const interval = this.shouldUseFastPolling() 
      ? this.pollingConfig.fastPollInterval 
      : this.currentDataInterval;
      
    this.updateInterval = setTimeout(async () => {
      try {
        // Task 2.2: Use circuit breaker protected fetch
        await this.fetchDeviceDataWithProtection();
        this.scheduleNextDataFetch(); // Reschedule dynamically
      } catch (error) {
        this.logger.error('Error during scheduled data fetch:', error);
        this.scheduleNextDataFetch(); // Continue despite errors
      }
    }, interval);
    
    this.logger.debug(`Next data fetch scheduled in ${interval}ms (${this.shouldUseFastPolling() ? 'fast' : 'normal'} mode)`);
  }

  /**
   * onRenamed is called when the user updates the device's name.
   */
  async onRenamed(name: string) {
    this.logger.log(`BoilerDevice was renamed to ${name}`);
  }

  /**
   * onDeleted is called when the user deleted the device.
   */
  async onDeleted() {
    this.logger.log('BoilerDevice has been deleted');
    
    // Task 2.1: Clean up adaptive polling timeout (now using setTimeout instead of setInterval)
    if (this.updateInterval) {
      clearTimeout(this.updateInterval);
      this.updateInterval = undefined;
    }

    // Clean up energy report interval
    if (this.energyReportInterval) {
      clearInterval(this.energyReportInterval);
      this.energyReportInterval = undefined;
    }

    // Clean up power command debounce timer (Task 1.1)
    if (this.powerCommandDebounce) {
      clearTimeout(this.powerCommandDebounce);
      this.powerCommandDebounce = undefined;
    }

    // Task 2.1: Clear fast polling state
    this.fastPollUntil = undefined;

    // Task 2.2: Clean up circuit breakers
    if (this.apiCircuitBreaker) {
      this.apiCircuitBreaker.cleanup();
    }
    if (this.energyCircuitBreaker) {
      this.energyCircuitBreaker.cleanup();
    }

    // Clean up MELCloud API
    if (this.melCloudApi) {
      this.melCloudApi.cleanup();
    }
  }

};
