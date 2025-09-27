import Homey from 'homey';
import { CronJob } from 'cron';
import { MelCloudApi } from '../../src/services/melcloud-api';
import { HomeyLogger, LogLevel } from '../../src/util/logger';

module.exports = class BoilerDriver extends Homey.Driver {
  private melCloudApi?: MelCloudApi;
  private logger!: HomeyLogger;
  private hourlyJob?: CronJob;
  private weeklyJob?: CronJob;

  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.logger = new HomeyLogger(this.homey, {
      level: LogLevel.INFO,
      logToTimeline: false,
      prefix: 'BoilerDriver',
      includeTimestamps: true,
      includeSourceModule: true
    });

    this.logger.log('BoilerDriver has been initialized');

    // Initialize MELCloud API
    try {
      this.melCloudApi = new MelCloudApi(this.logger);
      this.logger.log('MELCloud API initialized for driver');
    } catch (error) {
      this.logger.error('Failed to initialize MELCloud API:', error);
    }

    // Initialize optimization cron jobs
    this.initializeCronJobs();

    // Listen for settings changes to restart cron jobs when fully configured
    this.homey.settings.on('set', (key: string) => {
      // Check if any critical setting was changed that might complete the configuration
      const criticalSettings = ['melcloud_user', 'melcloud_pass', 'device_id', 'building_id', 'tibber_token'];
      if (criticalSettings.includes(key)) {
        this.logger.log(`🔧 Critical setting '${key}' changed, checking if cron jobs should start`);
        setTimeout(() => {
          this.ensureCronRunningIfReady();
        }, 1000); // Small delay to ensure all related settings are saved
      }
    });
  }

  /**
   * Initialize cron jobs for optimization scheduling
   */
  private initializeCronJobs() {
    this.logger.log('🚀 Initializing optimization cron jobs in driver...');

    try {
      // Hourly optimization (every hour at minute 0)
      this.hourlyJob = new CronJob(
        '0 * * * *', // Every hour at minute 0
        async () => {
          this.logger.log('⏰ Hourly optimization triggered by cron job');
          await this.runHourlyOptimization();
        },
        null,
        false, // Don't start immediately
        'Europe/Oslo' // Use Norwegian timezone
      );

      // Weekly calibration (every Sunday at 2 AM)
      this.weeklyJob = new CronJob(
        '0 2 * * 0', // Every Sunday at 2 AM
        async () => {
          this.logger.log('⏰ Weekly calibration triggered by cron job');
          await this.runWeeklyCalibration();
        },
        null,
        false, // Don't start immediately
        'Europe/Oslo' // Use Norwegian timezone
      );

      // Start the cron jobs
      this.ensureCronRunningIfReady();

      this.logger.log('✅ Cron jobs initialized successfully');
    } catch (error) {
      this.logger.error('❌ Failed to initialize cron jobs:', error);
    }
  }

  /**
   * Ensure cron jobs are running if conditions are met
   */
  private ensureCronRunningIfReady() {
    try {
      // Check if we have the minimum required settings for the app to function
      if (!this.isAppFullyConfigured()) {
        this.logger.log('⚠️ Cron jobs not started - app not fully configured yet');
        return;
      }

      if (this.hourlyJob && !this.hourlyJob.running) {
        this.hourlyJob.start();
        this.logger.log('✅ Hourly optimization cron job started');
      }

      if (this.weeklyJob && !this.weeklyJob.running) {
        this.weeklyJob.start();
        this.logger.log('✅ Weekly calibration cron job started');
      }

      this.logger.log('🎯 All cron jobs are now running and ready for optimization');
    } catch (error) {
      this.logger.error('Failed to start cron jobs:', error);
    }
  }

  /**
   * Check if the app is fully configured and ready for optimization
   */
  private isAppFullyConfigured(): boolean {
    const melcloudUser = this.homey.settings.get('melcloud_user');
    const melcloudPass = this.homey.settings.get('melcloud_pass');
    const deviceId = this.homey.settings.get('device_id');
    const buildingId = this.homey.settings.get('building_id');

    // Check basic MELCloud configuration
    if (!melcloudUser || !melcloudPass || !deviceId || !buildingId) {
      this.logger.log('❌ Missing required MELCloud settings:', {
        hasUser: !!melcloudUser,
        hasPassword: !!melcloudPass,
        hasDeviceId: !!deviceId,
        hasBuildingId: !!buildingId
      });
      return false;
    }

    // Additional safety: Check if Tibber token is set if user wants price optimization
    const tibberToken = this.homey.settings.get('tibber_token');
    const enablePriceOptimization = this.homey.settings.get('enable_price_optimization');
    
    if (enablePriceOptimization && !tibberToken) {
      this.logger.log('❌ Price optimization enabled but Tibber token missing');
      return false;
    }

    this.logger.log('✅ App is fully configured and ready for optimization');
    return true;
  }

  /**
   * Run hourly optimization
   */
  private async runHourlyOptimization() {
    try {
      this.logger.log('🔄 Starting hourly optimization process...');
      
      // Check if app is fully configured before proceeding
      if (!this.isAppFullyConfigured()) {
        this.logger.log('⚠️ Skipping hourly optimization - app not fully configured');
        return;
      }
      
      // Call the API implementation
      const api = require('../../api.js');
      const result = await api.getRunHourlyOptimizer({ homey: this.homey });

      if (result.success) {
        this.logger.log('✅ Hourly optimization completed successfully');
        if (result.data) {
          this.logger.log(`Target temp: ${result.data.targetTemp}°C, Savings: ${result.data.savings || 'N/A'}`);
        }
      } else {
        this.logger.error('❌ Hourly optimization failed:', result.message);
        
        // If the failure indicates missing configuration, stop the cron jobs
        if (result.needsConfiguration) {
          this.logger.log('🛑 Stopping cron jobs due to configuration issues');
          if (this.hourlyJob) {
            this.hourlyJob.stop();
          }
          if (this.weeklyJob) {
            this.weeklyJob.stop();
          }
        }
      }
    } catch (error) {
      this.logger.error('❌ Error during hourly optimization:', error);
    }
  }

    /**
   * Run weekly calibration
   */
  private async runWeeklyCalibration() {
    try {
      this.logger.log('🔄 Starting weekly calibration process...');
      
      // Check if app is fully configured before proceeding
      if (!this.isAppFullyConfigured()) {
        this.logger.log('⚠️ Skipping weekly calibration - app not fully configured');
        return;
      }
      
      // Call the API implementation
      const api = require('../../api.js');
      const result = await api.getRunWeeklyCalibration({ homey: this.homey });

      if (result.success) {
        this.logger.log('✅ Weekly calibration completed successfully');
      } else {
        this.logger.error('❌ Weekly calibration failed:', result.message);
        
        // If the failure indicates missing configuration, stop the cron jobs
        if (result.needsConfiguration) {
          this.logger.log('🛑 Stopping cron jobs due to configuration issues');
          if (this.hourlyJob) {
            this.hourlyJob.stop();
          }
          if (this.weeklyJob) {
            this.weeklyJob.stop();
          }
        }
      }
    } catch (error) {
      this.logger.error('❌ Error during weekly calibration:', error);
    }
  }

  /**
   * Cleanup cron jobs when driver is destroyed
   */
  async onUninit() {
    this.logger.log('🛑 BoilerDriver shutting down, cleaning up cron jobs...');
    
    try {
      if (this.hourlyJob) {
        this.hourlyJob.stop();
        this.logger.log('✅ Hourly cron job stopped');
      }

      if (this.weeklyJob) {
        this.weeklyJob.stop();
        this.logger.log('✅ Weekly cron job stopped');
      }
    } catch (error) {
      this.logger.error('Error stopping cron jobs:', error);
    }
  }

  /**
   * onPairListDevices is called when a user is adding a device and the 'list_devices' view is called.
   * This should return an array with the data of devices that are available for pairing.
   */
  async onPairListDevices() {
    try {
      this.logger.log('Fetching MELCloud devices for pairing...');

      if (!this.melCloudApi) {
        throw new Error('MELCloud API not initialized');
      }

      // Check if we have credentials
      const email = this.homey.settings.get('melcloud_user');
      const password = this.homey.settings.get('melcloud_pass');

      if (!email || !password) {
        this.logger.error('MELCloud credentials not configured');
        throw new Error('MELCloud credentials not configured. Please configure them in the app settings first.');
      }

      // Set up global homeySettings for the API (temporary)
      if (!(global as any).homeySettings) {
        (global as any).homeySettings = this.homey.settings;
      }

      // Login and get devices
      await this.melCloudApi.login(email, password);
      const devices = await this.melCloudApi.getDevices();

      this.logger.log(`Found ${devices.length} MELCloud devices`);

      // Convert MELCloud devices to Homey device format
      const homeyDevices = devices.map(device => ({
        name: `${device.name} (Boiler)`,
        data: {
          id: `melcloud_boiler_${device.id}`,
          deviceId: String(device.id),
          buildingId: Number(device.buildingId)
        },
        store: {
          melcloud_device_id: String(device.id),
          melcloud_building_id: Number(device.buildingId),
          device_name: device.name
        },
        settings: {
          device_id: String(device.id),
          building_id: Number(device.buildingId)
        }
      }));

      return homeyDevices;
    } catch (error) {
      this.logger.error('Failed to fetch MELCloud devices:', error);
      throw error;
    }
  }

};
