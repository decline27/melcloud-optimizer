import Homey from 'homey';
import { BaseApiService } from '../../src/services/base-api-service';
import { MelCloudApi } from '../../src/services/melcloud-api';
import { ErrorHandler } from '../../src/util/error-handler';
import { HomeyLogger, LogLevel } from '../../src/util/logger';
import { MelCloudDevice } from '../../src/types';

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
    if (!(global as any).homeySettings) {
      (global as any).homeySettings = this.homey.settings;
    }

    // Set up global logger if not already set
    if (!(global as any).logger) {
      (global as any).logger = this.logger;
    }

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
      this.melCloudApi = new MelCloudApi(this.logger);
      this.logger.log('MELCloud API initialized for device');
    } catch (error) {
      this.logger.error('Failed to initialize MELCloud API:', error);
      this.setUnavailable('Failed to initialize MELCloud API');
      return;
    }

    // Ensure all required capabilities are available
    await this.ensureCapabilities();

    // Set up capability listeners
    this.setupCapabilityListeners();

    // Start data fetching
    await this.startDataFetching();
  }

  /**
   * Ensure all required capabilities are available on the device
   */
  private async ensureCapabilities() {
    const requiredCapabilities = [
      'measure_temperature',
      'measure_temperature.outdoor',
      'measure_temperature.zone2',
      'measure_temperature.tank',
      'target_temperature',
      'target_temperature.zone2',
      'target_temperature.tank',
      'onoff',
      'meter_power.heating',
      'meter_power.produced_heating',
      'meter_power.hotwater',
      'meter_power.produced_hotwater',
      'heating_cop',
      'hotwater_cop',
      'thermostat_mode',
      'alarm_generic.offline'
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
    
    this.logger.log('Capability check completed');
  }

  /**
   * Set up capability listeners for device control
   */
  private setupCapabilityListeners() {
    // Listen for target temperature changes (Zone 1)
    this.registerCapabilityListener('target_temperature', async (value: number) => {
      this.logger.log(`Target temperature (Zone 1) changed to ${value}°C`);
      
      try {
        // Ensure global settings are available
        if (!(global as any).homeySettings) {
          (global as any).homeySettings = this.homey.settings;
        }

        if (this.melCloudApi) {
          const success = await this.melCloudApi.setDeviceTemperature(
            this.deviceId,
            this.buildingId,
            value
          );

          if (success) {
            this.logger.log(`Successfully set target temperature (Zone 1) to ${value}°C`);
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

    // Listen for Zone 2 target temperature changes (if available)
    if (this.hasCapability('target_temperature.zone2')) {
      this.registerCapabilityListener('target_temperature.zone2', async (value: number) => {
        this.logger.log(`Target temperature (Zone 2) changed to ${value}°C`);
        
        try {
          if (this.melCloudApi) {
            // Note: This would need to be implemented in the MELCloud API service
            // For now, we'll just log and return the value
            this.logger.log(`Zone 2 temperature control not yet implemented: ${value}°C`);
            return value;
          } else {
            throw new Error('MELCloud API not available');
          }
        } catch (error) {
          this.logger.error('Error setting target temperature (Zone 2):', error);
          throw error;
        }
      });
    }

    // Listen for tank target temperature changes (if available)
    if (this.hasCapability('target_temperature.tank')) {
      this.registerCapabilityListener('target_temperature.tank', async (value: number) => {
        this.logger.log(`Target tank temperature changed to ${value}°C`);
        
        try {
          if (this.melCloudApi) {
            // Note: This would need to be implemented in the MELCloud API service
            // For now, we'll just log and return the value
            this.logger.log(`Tank temperature control not yet implemented: ${value}°C`);
            return value;
          } else {
            throw new Error('MELCloud API not available');
          }
        } catch (error) {
          this.logger.error('Error setting target tank temperature:', error);
          throw error;
        }
      });
    }

    // Listen for on/off changes (if applicable)
    this.registerCapabilityListener('onoff', async (value: boolean) => {
      this.logger.log(`Device power changed to ${value ? 'on' : 'off'}`);
      // Note: Actual implementation would depend on MELCloud API capabilities
      // For now, we'll just log and return the value
      return value;
    });

    // Listen for thermostat mode changes
    if (this.hasCapability('thermostat_mode')) {
      this.registerCapabilityListener('thermostat_mode', async (value: string) => {
        this.logger.log(`Operation mode changed to ${value}`);
        // Note: This would need to be implemented in the MELCloud API service
        return value;
      });
    }
  }

  /**
   * Start fetching data from MELCloud API every 2 minutes
   */
  private async startDataFetching() {
    // Initial fetch
    await this.fetchDeviceData();

    // Set up interval for every 2 minutes (120,000 ms)
    this.updateInterval = setInterval(async () => {
      try {
        await this.fetchDeviceData();
      } catch (error) {
        this.logger.error('Error during scheduled data fetch:', error);
      }
    }, 120000); // 2 minutes

    this.logger.log('Started data fetching every 2 minutes');
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
   * Update device capabilities based on MELCloud device state
   */
  private async updateCapabilities(deviceState: MelCloudDevice) {
    try {
      // Log the complete device state for debugging
      this.logger.log('MELCloud device state keys:', Object.keys(deviceState));
      this.logger.log('MELCloud device state:', JSON.stringify(deviceState, null, 2));
      
      // Set device as online
      if (this.hasCapability('alarm_generic.offline')) {
        await this.setCapabilityValue('alarm_generic.offline', deviceState.Offline || false);
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
   * Start energy reporting interval
   */
  private startEnergyReporting() {
    if (this.energyReportInterval) {
      clearInterval(this.energyReportInterval);
    }
    
    // Report energy data every 5 minutes (300,000 ms)
    this.energyReportInterval = setInterval(async () => {
      try {
        // Fetch and update energy data
        await this.fetchEnergyDataFromApi();
      } catch (error) {
        this.logger.error('Error during energy reporting:', error);
      }
    }, 300000); // 5 minutes

    this.logger.log('Energy reporting started (every 5 minutes)');
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
        // Use API-provided average COP if available, otherwise calculate from energy values
        let heatingCOP = energyTotals.AverageHeatingCOP || 0;
        if (heatingCOP === 0) {
          heatingCOP = this.calculateCOP(
            energyTotals.TotalHeatingProduced || 0,
            energyTotals.TotalHeatingConsumed || 0
          );
        }
        await this.setCapabilityValue('heating_cop', heatingCOP);
        this.logger.log(`Heating COP set: ${heatingCOP} ${energyTotals.AverageHeatingCOP ? '(from API)' : '(calculated)'}`);
      }

      if (this.hasCapability('hotwater_cop')) {
        // Use API-provided average COP if available, otherwise calculate from energy values
        let hotWaterCOP = energyTotals.AverageHotWaterCOP || 0;
        if (hotWaterCOP === 0) {
          hotWaterCOP = this.calculateCOP(
            energyTotals.TotalHotWaterProduced || 0,
            energyTotals.TotalHotWaterConsumed || 0
          );
        }
        await this.setCapabilityValue('hotwater_cop', hotWaterCOP);
        this.logger.log(`Hot Water COP set: ${hotWaterCOP} ${energyTotals.AverageHotWaterCOP ? '(from API)' : '(calculated)'}`);
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
      // Update operation mode
      if (deviceState.OperationMode !== undefined && this.hasCapability('thermostat_mode')) {
        const modeMap: { [key: number]: string } = {
          1: 'heat',
          2: 'cool', 
          3: 'auto',
          7: 'off',
          8: 'dry'
        };
        const mode = modeMap[deviceState.OperationMode] || 'auto';
        const currentMode = this.getCapabilityValue('thermostat_mode');
        if (currentMode !== mode) {
          await this.setCapabilityValue('thermostat_mode', mode);
          this.logger.debug(`Updated operation mode: ${mode} (${deviceState.OperationMode})`);
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
    
    // Clean up interval
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = undefined;
    }

    // Clean up MELCloud API
    if (this.melCloudApi) {
      this.melCloudApi.cleanup();
    }
  }

};
