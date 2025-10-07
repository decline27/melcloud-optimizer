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
  }

  /**
   * Get user timezone string for cron jobs
   * @returns Timezone string (e.g., "Europe/Berlin", "America/New_York")
   */
  private getUserTimezone(): string {
    try {
      // Get timezone offset from settings
      const timeZoneOffset = this.homey.settings.get('time_zone_offset') || 2;
      const useDST = this.homey.settings.get('use_dst') || false;
      
      // Map timezone offset to timezone string
      // This is a simplified mapping - could be enhanced with more timezones
      const timezoneMap: Record<number, string> = {
        '-12': 'Pacific/Auckland', // UTC-12 (example)
        '-11': 'Pacific/Midway',
        '-10': 'Pacific/Honolulu',
        '-9': 'America/Anchorage',
        '-8': 'America/Los_Angeles',
        '-7': 'America/Denver',
        '-6': 'America/Chicago',
        '-5': 'America/New_York',
        '-4': 'America/Halifax',
        '-3': 'America/Sao_Paulo',
        '-2': 'Atlantic/South_Georgia',
        '-1': 'Atlantic/Azores',
        '0': 'UTC',
        '1': 'Europe/London',
        '2': 'Europe/Berlin',
        '3': 'Europe/Moscow',
        '4': 'Asia/Dubai',
        '5': 'Asia/Karachi',
        '6': 'Asia/Dhaka',
        '7': 'Asia/Bangkok',
        '8': 'Asia/Shanghai',
        '9': 'Asia/Tokyo',
        '10': 'Australia/Sydney',
        '11': 'Pacific/Norfolk',
        '12': 'Pacific/Auckland',
        '13': 'Pacific/Tongatapu'
      };
      
      const timezone = timezoneMap[timeZoneOffset] || 'Europe/Oslo';
      this.logger.log(`Using timezone: ${timezone} (offset: ${timeZoneOffset}, DST: ${useDST})`);
      return timezone;
    } catch (error) {
      this.logger.error('Error getting user timezone, falling back to Europe/Oslo:', error);
      return 'Europe/Oslo';
    }
  }

  /**
   * Initialize cron jobs for optimization scheduling
   */
  private initializeCronJobs() {
    this.logger.log('🚀 Initializing optimization cron jobs in driver...');

    try {
      const userTimezone = this.getUserTimezone();
      
      // Hourly optimization (every hour at minute 0)
      this.hourlyJob = new CronJob(
        '0 * * * *', // Every hour at minute 0
        async () => {
          this.logger.log('⏰ Hourly optimization triggered by cron job');
          await this.runHourlyOptimization();
        },
        null,
        false, // Don't start immediately
        userTimezone // Use user's timezone from settings
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
        userTimezone // Use user's timezone from settings
      );

      // Start the cron jobs
      this.ensureCronRunningIfReady();

      this.logger.log('✅ Cron jobs initialized successfully');
    } catch (error) {
      this.logger.error('❌ Failed to initialize cron jobs:', error);
    }
  }

  /**
   * Update cron jobs with new timezone settings
   * Called when timezone settings change
   */
  public updateTimezone(): void {
    this.logger.log('🔄 Updating cron jobs with new timezone settings...');
    
    try {
      // Stop existing cron jobs if running
      if (this.hourlyJob) {
        this.hourlyJob.stop();
      }
      if (this.weeklyJob) {
        this.weeklyJob.stop();
      }
      
      // Reinitialize with new timezone
      this.initializeCronJobs();
      
      this.logger.log('✅ Cron jobs updated with new timezone');
    } catch (error) {
      this.logger.error('❌ Failed to update cron jobs timezone:', error);
    }
  }

  /**
   * Ensure cron jobs are running if conditions are met
   */
  private ensureCronRunningIfReady() {
    try {
      // Check if we have all required settings for optimization
      const melcloudUser = this.homey.settings.get('melcloud_user');
      const melcloudPass = this.homey.settings.get('melcloud_pass');
      const tibberToken = this.homey.settings.get('tibber_token');
      const deviceId = this.homey.settings.get('device_id');
      const priceDataSource = this.homey.settings.get('price_data_source') || 'tibber';

      // Check for missing required settings
      const missingSettings = [];
      if (!melcloudUser) missingSettings.push('MELCloud email');
      if (!melcloudPass) missingSettings.push('MELCloud password');
      
      // Only require Tibber token if Tibber is selected as price source
      if (priceDataSource === 'tibber' && !tibberToken) {
        missingSettings.push('Tibber API token');
      }
      
      if (!deviceId) missingSettings.push('Device ID');

      if (missingSettings.length === 0) {
        if (this.hourlyJob && !this.hourlyJob.running) {
          this.hourlyJob.start();
          this.logger.log('✅ Hourly optimization cron job started');
        }

        if (this.weeklyJob && !this.weeklyJob.running) {
          this.weeklyJob.start();
          this.logger.log('✅ Weekly calibration cron job started');
        }

        this.logger.log('🎯 All cron jobs are now running and ready for optimization');
      } else {
        this.logger.log(`⚠️ Cron jobs not started - missing required settings: ${missingSettings.join(', ')}`);
        
        // Stop any running cron jobs if settings are incomplete
        if (this.hourlyJob && this.hourlyJob.running) {
          this.hourlyJob.stop();
          this.logger.log('⏹️ Stopped hourly cron job due to incomplete settings');
        }
        
        if (this.weeklyJob && this.weeklyJob.running) {
          this.weeklyJob.stop();
          this.logger.log('⏹️ Stopped weekly cron job due to incomplete settings');
        }
      }
    } catch (error) {
      this.logger.error('Failed to manage cron jobs:', error);
    }
  }

  /**
   * Restart cron jobs (called from API after settings validation)
   */
  public async restartCronJobs() {
    try {
      this.logger.log('🔄 Restarting cron jobs...');
      
      // Stop existing jobs
      if (this.hourlyJob) {
        this.hourlyJob.stop();
      }
      if (this.weeklyJob) {
        this.weeklyJob.stop();
      }

      // Re-evaluate and start if ready
      this.ensureCronRunningIfReady();
      
      this.logger.log('✅ Cron jobs restart completed');
    } catch (error) {
      this.logger.error('Failed to restart cron jobs:', error);
      throw error;
    }
  }

  /**
   * Run hourly optimization
   */
  private async runHourlyOptimization() {
    try {
      this.logger.log('🔄 Starting hourly optimization process...');
      
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
      
      // Call the API implementation
      const api = require('../../api.js');
      const result = await api.getRunWeeklyCalibration({ homey: this.homey });

      if (result.success) {
        this.logger.log('✅ Weekly calibration completed successfully');
        if (result.data && result.data.method) {
          this.logger.log(`Calibration method: ${result.data.method}`);
        }
      } else {
        this.logger.error('❌ Weekly calibration failed:', result.message);
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
