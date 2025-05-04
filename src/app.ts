import { App } from 'homey';
import { CronJob } from 'cron'; // Import CronJob
import { COPHelper } from './services/cop-helper';

// --- Type Definitions ---
interface LogEntry { ts: string; price: number; indoor: number; target: number }
interface ThermalModel { K: number; S?: number }
interface DeviceInfo { id: string; name: string; type: string }
interface PricePoint { time: string; price: number }
interface OptimizationResult {
  targetTemp: number;
  reason: string;
  priceNow: number;
  priceAvg: number;
  priceMin: number;
  priceMax: number;
  indoorTemp: number;
  outdoorTemp: number;
  targetOriginal: number;
  savings: number;
  comfort: number;
  timestamp: string;
  kFactor?: number;
  thermalModel?: {
    characteristics: any;
    timeToTarget: number;
    confidence: number;
    recommendation: any;
  };
}

/**
 * MELCloud Heat Pump Optimizer App
 *
 * This app optimizes heat pump operation based on electricity prices and thermal models
 */
export default class HeatOptimizerApp extends App {
  // Make these public so they can be accessed from the API
  public hourlyJob?: CronJob;
  public weeklyJob?: CronJob;
  public copHelper?: COPHelper;

  /**
   * Get the status of the cron jobs
   * This method is used by the API to get the cron job status
   */
  public getCronStatus() {
    const status = {
      hourlyJob: this.hourlyJob ? {
        running: this.hourlyJob.running,
        nextRun: this.hourlyJob.nextDate().toString(),
        cronTime: this.hourlyJob.cronTime.source
      } : { running: false, error: 'Hourly job not initialized' },

      weeklyJob: this.weeklyJob ? {
        running: this.weeklyJob.running,
        nextRun: this.weeklyJob.nextDate().toString(),
        cronTime: this.weeklyJob.cronTime.source
      } : { running: false, error: 'Weekly job not initialized' },

      lastHourlyRun: this.homey.settings.get('last_hourly_run') || 'Never',
      lastWeeklyRun: this.homey.settings.get('last_weekly_run') || 'Never',
      lastUpdated: new Date().toISOString()
    };

    // Update the status in settings
    this.updateCronStatusInSettings();

    return status;
  }

  /**
   * Update the cron status in settings
   * This method is called periodically to keep the status up to date
   */
  public updateCronStatusInSettings() {
    if (!this.hourlyJob || !this.weeklyJob) {
      this.log('Cannot update cron status in settings: jobs not initialized');
      this.log('Attempting to initialize cron jobs...');
      this.initializeCronJobs();
      return;
    }

    try {
      const status = {
        hourlyJob: {
          running: this.hourlyJob.running,
          nextRun: this.hourlyJob.nextDate().toString(),
          cronTime: this.hourlyJob.cronTime.source
        },
        weeklyJob: {
          running: this.weeklyJob.running,
          nextRun: this.weeklyJob.nextDate().toString(),
          cronTime: this.weeklyJob.cronTime.source
        },
        lastHourlyRun: this.homey.settings.get('last_hourly_run') || 'Never',
        lastWeeklyRun: this.homey.settings.get('last_weekly_run') || 'Never',
        lastUpdated: new Date().toISOString()
      };

      this.homey.settings.set('cron_status', status);
      this.log('Cron status updated in settings');
    } catch (err) {
      this.error('Failed to update cron status in settings', err as Error);
    }
  }

  /**
   * onInit is called when the app is initialized
   */
  async onInit() {
    // Log app initialization
    this.log('===== MELCloud Optimizer App Starting =====');
    this.log('Heat Pump Optimizer initialized');

    // Log some additional information
    this.log('App ID:', this.id);
    this.log('App Version:', this.manifest.version);
    this.log('Homey Version:', this.homey.version);
    this.log('Homey Platform:', this.homey.platform);

    // Register settings change listener
    this.homey.settings.on('set', this.onSettingsChanged.bind(this));
    this.log('Settings change listener registered');

    // Validate settings
    this.validateSettings();

    // API is automatically registered by Homey

    // Initialize COP Helper
    try {
      this.copHelper = new COPHelper(this.homey, this);
      this.log('COP Helper initialized');

      // Make it available globally
      (global as any).copHelper = this.copHelper;
    } catch (error) {
      this.error('Failed to initialize COP Helper:', error as Error);
    }

    // Initialize cron jobs
    this.initializeCronJobs();

    // Always run test logging on startup for debugging
    this.log('Running test logging on startup...');
    this.testLogging();

    // Log to console directly for maximum visibility
    console.log('===== DIRECT CONSOLE LOG =====');
    console.log('This is a direct console.log message');
    console.log('App ID:', this.id);
    console.log('App Version:', this.manifest.version);
    console.log('===== END DIRECT CONSOLE LOG =====');

    // Log app initialization complete
    this.log('MELCloud Optimizer App initialized successfully');
  }

  /**
   * Initialize cron jobs for hourly optimization and weekly calibration
   * This method is public so it can be called from the API
   */
  public initializeCronJobs() {
    this.log('===== INITIALIZING CRON JOBS =====');

    // Get the time zone offset from Homey settings - default to UTC+2 (Sweden/Denmark time zone)
    const timeZoneOffset = this.homey.settings.get('time_zone_offset') || 2;

    // Check if DST is enabled in settings
    const useDST = this.homey.settings.get('use_dst') || false;

    // Get the current time
    const now = new Date();

    // Create a local time object using the Homey time zone offset
    const localTime = new Date(now.getTime());
    localTime.setUTCHours(now.getUTCHours() + parseInt(timeZoneOffset));

    // If DST is enabled, check if we're in DST period (simplified approach for Europe)
    let effectiveOffset = parseInt(timeZoneOffset);
    if (useDST) {
      // Simple check for European DST (last Sunday in March to last Sunday in October)
      const month = now.getUTCMonth(); // 0-11
      if (month > 2 && month < 10) { // April (3) through October (9)
        localTime.setUTCHours(localTime.getUTCHours() + 1);
        effectiveOffset += 1;
        this.log('DST is active, adding 1 hour to the time zone offset');
      }
    }

    this.log('Current UTC time:', now.toISOString());
    this.log('Homey local time:', localTime.toUTCString());
    this.log(`Homey time zone offset: ${timeZoneOffset} hours${useDST ? ' (with DST enabled)' : ''}`);

    // Determine the time zone name from the effective offset
    const timeZoneString = `UTC${effectiveOffset >= 0 ? '+' : ''}${Math.abs(effectiveOffset)}`;

    this.log(`Using Homey time zone: ${timeZoneString}`);

    // Hourly job - runs at minute 5 of every hour
    // Format: second minute hour day-of-month month day-of-week
    this.log(`Creating hourly cron job with pattern: 0 5 * * * * (Time zone: ${timeZoneString})`);
    this.hourlyJob = new CronJob('0 5 * * * *', async () => {
      // Add a more visible log message
      const currentTime = new Date();

      // Create a local time object using the Homey time zone offset
      const localCurrentTime = new Date(currentTime.getTime());
      localCurrentTime.setUTCHours(currentTime.getUTCHours() + parseInt(timeZoneOffset));

      // Apply DST if enabled and in DST period
      if (useDST) {
        const month = currentTime.getUTCMonth(); // 0-11
        if (month > 2 && month < 10) { // April (3) through October (9)
          localCurrentTime.setUTCHours(localCurrentTime.getUTCHours() + 1);
        }
      }

      this.log('===== AUTOMATIC HOURLY CRON JOB TRIGGERED =====');
      this.log(`Current UTC time: ${currentTime.toISOString()}`);
      this.log(`Homey local time: ${localCurrentTime.toUTCString()}`);

      // Store the last run time in settings
      this.homey.settings.set('last_hourly_run', currentTime.toISOString());

      // Update cron status in settings
      const cronStatus = this.homey.settings.get('cron_status') || {};
      cronStatus.lastHourlyRun = currentTime.toISOString();
      cronStatus.lastUpdated = new Date().toISOString();
      this.homey.settings.set('cron_status', cronStatus);

      // Add a timeline entry for the automatic trigger
      try {
        await this.homey.flow.runFlowCardAction({
          uri: 'homey:flowcardaction:homey:manager:timeline:log',
          args: { text: '🕒 Automatic hourly optimization triggered' }
        });
      } catch (err) {
        this.error('Failed to create timeline entry for automatic trigger', err as Error);
      }
      this.log('Hourly cron job triggered');
      try {
        await this.runHourlyOptimizer();
      } catch (err) {
        this.error('Error in hourly cron job', err as Error);
      }
    }, null, true, timeZoneString); // Pass the time zone string to the CronJob constructor

    // Weekly job - runs at 2:05 AM on Sundays
    this.log(`Creating weekly cron job with pattern: 0 5 2 * * 0 (Time zone: ${timeZoneString})`);
    this.weeklyJob = new CronJob('0 5 2 * * 0', async () => {
      // Add a more visible log message
      const currentTime = new Date();

      // Create a local time object using the Homey time zone offset
      const localCurrentTime = new Date(currentTime.getTime());
      localCurrentTime.setUTCHours(currentTime.getUTCHours() + parseInt(timeZoneOffset));

      // Apply DST if enabled and in DST period
      if (useDST) {
        const month = currentTime.getUTCMonth(); // 0-11
        if (month > 2 && month < 10) { // April (3) through October (9)
          localCurrentTime.setUTCHours(localCurrentTime.getUTCHours() + 1);
        }
      }

      this.log('===== AUTOMATIC WEEKLY CRON JOB TRIGGERED =====');
      this.log(`Current UTC time: ${currentTime.toISOString()}`);
      this.log(`Homey local time: ${localCurrentTime.toUTCString()}`);

      // Store the last run time in settings
      this.homey.settings.set('last_weekly_run', currentTime.toISOString());

      // Update cron status in settings
      const cronStatus = this.homey.settings.get('cron_status') || {};
      cronStatus.lastWeeklyRun = currentTime.toISOString();
      cronStatus.lastUpdated = new Date().toISOString();
      this.homey.settings.set('cron_status', cronStatus);

      // Add a timeline entry for the automatic trigger
      try {
        await this.homey.flow.runFlowCardAction({
          uri: 'homey:flowcardaction:homey:manager:timeline:log',
          args: { text: '📈 Automatic weekly calibration triggered' }
        });
      } catch (err) {
        this.error('Failed to create timeline entry for automatic trigger', err as Error);
      }

      this.log('Weekly cron job triggered');
      try {
        await this.runWeeklyCalibration();
      } catch (err) {
        this.error('Error in weekly cron job', err as Error);
      }
    }, null, true, timeZoneString); // Pass the time zone string to the CronJob constructor

    // Start the cron jobs
    this.log('Starting hourly cron job...');
    this.hourlyJob.start();
    this.log('Hourly cron job started');

    this.log('Starting weekly cron job...');
    this.weeklyJob.start();
    this.log('Weekly cron job started');

    // Log the next run times
    const nextHourlyRun = this.hourlyJob.nextDate();
    const nextWeeklyRun = this.weeklyJob.nextDate();

    // Log the cron job status
    this.log('Hourly job running:', this.hourlyJob.running);
    this.log('Weekly job running:', this.weeklyJob.running);

    // Store cron job status in settings for API access
    this.homey.settings.set('cron_status', {
      hourlyJob: {
        running: this.hourlyJob.running,
        nextRun: this.hourlyJob.nextDate().toString(),
        cronTime: this.hourlyJob.cronTime.source,
        timeZone: timeZoneString
      },
      weeklyJob: {
        running: this.weeklyJob.running,
        nextRun: this.weeklyJob.nextDate().toString(),
        cronTime: this.weeklyJob.cronTime.source,
        timeZone: timeZoneString
      },
      lastUpdated: new Date().toISOString(),
      homeyTimeZone: timeZoneString,
      homeyTimeZoneOffset: timeZoneOffset,
      homeyDST: useDST,
      homeyEffectiveOffset: effectiveOffset
    });

    this.log(`Hourly cron job started - next run at: ${nextHourlyRun.toString()}`);
    this.log(`Weekly cron job started - next run at: ${nextWeeklyRun.toString()}`);
    this.log('Cron jobs started successfully');
  }

  /**
   * Handle settings changes
   */
  private async onSettingsChanged(key: string) {
    this.log(`Setting changed: ${key}`);

    // Log the value if possible
    try {
      const value = this.homey.settings.get(key);
      this.log(`Setting ${key} value: ${JSON.stringify(value)}`);
    } catch (err) {
      this.log(`Could not get value for ${key}`);
    }

    // Handle log level changes
    if (key === 'log_level') {
      const logLevel = this.homey.settings.get('log_level') as number;
      if (logLevel !== undefined) {
        this.log(`Log level changed to ${logLevel}`);
      }
    }
    // If credentials changed, re-validate
    else if (['melcloud_user', 'melcloud_pass', 'tibber_token'].includes(key)) {
      this.log(`Credential setting '${key}' changed, re-validating settings`);
      // Re-run validation on credential change
      this.validateSettings();
    }
    // If temperature settings changed, re-validate
    else if (['min_temp', 'max_temp', 'min_temp_zone2', 'max_temp_zone2', 'enable_zone2'].includes(key)) {
      this.log(`Temperature setting '${key}' changed, re-validating settings`);
      this.validateSettings();
    }
    // If COP settings changed, update the COP Helper
    else if (['cop_weight', 'auto_seasonal_mode', 'summer_mode'].includes(key)) {
      this.log(`COP setting '${key}' changed, updating optimizer settings`);

      // Call the API to update optimizer settings
      try {
        const api = require('../api.js');
        await api.updateOptimizerSettings(this.homey);
        this.log('Optimizer settings updated with new COP settings');
      } catch (error) {
        this.error('Failed to update optimizer settings with new COP settings:', error as Error);
      }
    }
    // Handle manual hourly optimization trigger
    else if (key === 'trigger_hourly_optimization') {
      this.log('Detected trigger_hourly_optimization setting change');

      const trigger = this.homey.settings.get('trigger_hourly_optimization') as boolean;
      this.log(`trigger_hourly_optimization value: ${trigger}`);

      if (trigger === true) {
        // Direct log using Homey's built-in logging
        this.log('===== MANUAL HOURLY OPTIMIZATION TRIGGERED =====');
        this.log('Manually triggering hourly optimizer via settings');

        try {
          // First add the timeline entry
          await this.homey.flow.runFlowCardAction({
            uri: 'homey:flowcardaction:homey:manager:timeline:log',
            args: { text: '\ud83d\udd04 Manual hourly optimization triggered' }
          });

          // Then run the optimization
          await this.runHourlyOptimizer();
          this.log('===== MANUAL HOURLY OPTIMIZATION COMPLETED =====');
        } catch (err) {
          this.error('Error in manual hourly trigger', err as Error);
          this.error('===== MANUAL HOURLY OPTIMIZATION FAILED =====');
        } finally {
          // Clear the trigger flag
          await this.homey.settings.unset('trigger_hourly_optimization');
        }
      }
    }
    // Handle test logging trigger
    else if (key === 'test_logging') {
      this.log('Detected test_logging setting change');

      const trigger = this.homey.settings.get('test_logging') as boolean;
      this.log(`test_logging value: ${trigger}`);

      if (trigger === true) {
        // Direct log using Homey's built-in logging
        this.log('===== TEST LOGGING TRIGGERED =====');
        this.log('Manually triggering test logging via settings');

        try {
          // Run the test logging
          this.testLogging();
          this.log('===== TEST LOGGING COMPLETED =====');
        } catch (err) {
          this.error('Error in test logging', err as Error);
          this.error('===== TEST LOGGING FAILED =====');
        } finally {
          // Clear the trigger flag
          await this.homey.settings.unset('test_logging');
        }
      }
    }
    // Handle manual weekly calibration trigger
    else if (key === 'trigger_weekly_calibration') {
      this.log('Detected trigger_weekly_calibration setting change');

      const trigger = this.homey.settings.get('trigger_weekly_calibration') as boolean;
      this.log(`trigger_weekly_calibration value: ${trigger}`);

      if (trigger === true) {
        // Direct log using Homey's built-in logging
        this.log('===== MANUAL WEEKLY CALIBRATION TRIGGERED =====');
        this.log('Manually triggering weekly calibration via settings');

        try {
          // First add the timeline entry
          await this.homey.flow.runFlowCardAction({
            uri: 'homey:flowcardaction:homey:manager:timeline:log',
            args: { text: '\ud83d\udcca Manual weekly calibration triggered' }
          });

          // Then run the calibration
          await this.runWeeklyCalibration();
          this.log('===== MANUAL WEEKLY CALIBRATION COMPLETED =====');
        } catch (err) {
          this.error('Error in manual weekly trigger', err as Error);
          this.error('===== MANUAL WEEKLY CALIBRATION FAILED =====');
        } finally {
          // Clear the trigger flag
          await this.homey.settings.unset('trigger_weekly_calibration');
        }
      }
    }
  }

  /**
   * Test logging functionality
   */
  public testLogging() {
    // Direct log using Homey's built-in logging
    this.log('===== TEST LOGGING STARTED =====');
    this.log('This is a test debug message');
    this.log('This is a test info message');
    this.log('This is a test warning message');
    this.error('This is a test error message');

    // Log some system information
    this.log('System Information:');
    this.log('- App ID:', this.id);
    this.log('- App Version:', this.manifest.version);
    this.log('- Homey Version:', this.homey.version);
    this.log('- Homey Platform:', this.homey.platform);
    this.log('- Node.js Version:', process.version);
    this.log('- Memory Usage:', JSON.stringify(process.memoryUsage()));

    // Log current date and time
    this.log('Current Date/Time:', new Date().toISOString());

    this.log('===== TEST LOGGING COMPLETED =====');
  }

  /**
   * Run the hourly optimization process
   */
  public async runHourlyOptimizer() {
    this.log('Starting hourly optimization');
    this.log('===== HOURLY OPTIMIZATION STARTED =====');

    try {
      // Call the API implementation
      const api = require('../api.js');
      const result = await api.getRunHourlyOptimizer({ homey: this.homey });

      if (result.success) {
        this.log('===== HOURLY OPTIMIZATION COMPLETED SUCCESSFULLY =====');
        return result;
      } else {
        throw new Error(result.error || 'Unknown error');
      }
    } catch (err) {
      const error = err as Error;
      this.error('Hourly optimization error', error);

      // Send notification
      try {
        await this.homey.notifications.createNotification({ excerpt: `HourlyOptimizer error: ${error.message}` });
      } catch (notifyErr) {
        this.error('Failed to send notification', notifyErr as Error);
      }

      this.error('===== HOURLY OPTIMIZATION FAILED =====');
      throw error; // Re-throw to propagate the error
    }
  }

  /**
   * Run the weekly calibration process
   */
  public async runWeeklyCalibration() {
    this.log('Starting weekly calibration');
    this.log('===== WEEKLY CALIBRATION STARTED =====');

    try {
      // Call the API implementation
      const api = require('../api.js');
      const result = await api.getRunWeeklyCalibration({ homey: this.homey });

      if (result.success) {
        this.log('===== WEEKLY CALIBRATION COMPLETED SUCCESSFULLY =====');
        return result;
      } else {
        throw new Error(result.error || 'Unknown error');
      }
    } catch (err) {
      const error = err as Error;
      this.error('Weekly calibration error', error);

      // Send notification
      try {
        await this.homey.notifications.createNotification({ excerpt: `WeeklyCalibration error: ${error.message}` });
      } catch (notifyErr) {
        this.error('Failed to send notification', notifyErr as Error);
      }

      this.error('===== WEEKLY CALIBRATION FAILED =====');
      throw error; // Re-throw to propagate the error
    }
  }



  /**
   * Validate settings
   * @returns {boolean} - True if settings are valid, false otherwise
   */
  private validateSettings(): boolean {
    this.log('Validating settings');

    // Check required settings
    const melcloudUser = this.homey.settings.get('melcloud_user');
    const melcloudPass = this.homey.settings.get('melcloud_pass');
    const tibberToken = this.homey.settings.get('tibber_token');

    if (!melcloudUser || !melcloudPass) {
      this.error('MELCloud credentials are missing');
      return false;
    }

    if (!tibberToken) {
      this.error('Tibber API token is missing');
      return false;
    }

    // Check temperature settings
    const minTemp = this.homey.settings.get('min_temp');
    const maxTemp = this.homey.settings.get('max_temp');

    if (minTemp !== undefined && maxTemp !== undefined) {
      if (minTemp >= maxTemp) {
        this.error('Min temperature must be less than max temperature');
        return false;
      }
    }

    // Check Zone2 settings if enabled
    const enableZone2 = this.homey.settings.get('enable_zone2');
    if (enableZone2) {
      const minTempZone2 = this.homey.settings.get('min_temp_zone2');
      const maxTempZone2 = this.homey.settings.get('max_temp_zone2');

      if (minTempZone2 !== undefined && maxTempZone2 !== undefined) {
        if (minTempZone2 >= maxTempZone2) {
          this.error('Min Zone2 temperature must be less than max Zone2 temperature');
          return false;
        }
      } else {
        this.error('Zone2 temperature limits are not set but Zone2 control is enabled');
        return false;
      }
    }

    // Check hot water tank settings if enabled
    const enableTankControl = this.homey.settings.get('enable_tank_control');
    if (enableTankControl) {
      const minTankTemp = this.homey.settings.get('min_tank_temp');
      const maxTankTemp = this.homey.settings.get('max_tank_temp');

      if (minTankTemp !== undefined && maxTankTemp !== undefined) {
        if (minTankTemp >= maxTankTemp) {
          this.error('Min tank temperature must be less than max tank temperature');
          return false;
        }
      } else {
        this.error('Tank temperature limits are not set but tank control is enabled');
        return false;
      }
    }

    // Check location settings if weather data is enabled
    const useWeatherData = this.homey.settings.get('use_weather_data');
    if (useWeatherData) {
      const latitude = this.homey.settings.get('latitude');
      const longitude = this.homey.settings.get('longitude');

      if (!latitude || !longitude) {
        this.log('Weather data is enabled but location is not set');
        // Not a critical error, just log it
      }
    }

    this.log('Settings validation successful');
    return true;
  }

  /**
   * onUninit is called when the app is destroyed
   */
  async onUninit() {
    this.log('MELCloud Optimizer App is shutting down');

    // Stop cron jobs
    if (this.hourlyJob) {
      this.hourlyJob.stop();
      this.log('Hourly cron job stopped');
    }

    if (this.weeklyJob) {
      this.weeklyJob.stop();
      this.log('Weekly cron job stopped');
    }

    this.log('MELCloud Optimizer App shutdown complete');
  }
}
