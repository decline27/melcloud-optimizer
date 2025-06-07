import { App } from 'homey';
import { CronJob } from 'cron'; // Import CronJob
import { COPHelper } from './services/cop-helper';
import { TimelineHelper, TimelineEventType } from './util/timeline-helper';
import { HomeyLogger, LogLevel, LogCategory } from './util/logger';
import {
  OptimizationResult, // Kept as it's used in function signatures for return
  HomeyApp
} from './types';

// New Service Imports
import { Optimizer } from './services/optimizer';
import { MelCloudApi } from './services/melcloud-api';
import { TibberApi } from './services/tibber-api';
import { ThermalModelService } from './services/thermal-model';
import { WeatherApi } from './services/weather-api';

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
  public timelineHelper?: TimelineHelper;
  public logger!: HomeyLogger; // Definite assignment, initialized in constructor/onInit
  private memoryUsageInterval?: NodeJS.Timeout;

  // Service instances
  private melcloudApi!: MelCloudApi;
  private tibberApi!: TibberApi;
  private weatherApi!: WeatherApi;
  private thermalModelService!: ThermalModelService;
  private appOptimizer!: Optimizer;

  constructor(props: any) {
    super(props);
    // Basic logger initialization for very early logs, will be refined in onInit's initializeLogger
    this.logger = new HomeyLogger(this, {
      level: LogLevel.INFO,
      logToTimeline: false,
      prefix: 'App',
      includeTimestamps: true,
      includeSourceModule: true
    });
    (global as any).logger = this.logger; // Make it globally available early
  }

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
   * Clean up cron jobs
   * This method is public so it can be called from tests
   */
  public cleanupCronJobs() {
    this.log('Cleaning up cron jobs...');

    // Stop hourly job if it exists
    if (this.hourlyJob) {
      this.log('Stopping hourly cron job...');
      this.hourlyJob.stop();
      this.hourlyJob = undefined;
      this.log('Hourly cron job stopped');
    }

    // Stop weekly job if it exists
    if (this.weeklyJob) {
      this.log('Stopping weekly cron job...');
      this.weeklyJob.stop();
      this.weeklyJob = undefined;
      this.log('Weekly cron job stopped');
    }

    this.log('Cron jobs cleaned up successfully');
  }

  /**
   * onInit is called when the app is initialized
   */
  async onInit() {
    // Initialize the centralized logger (this will refine the one from constructor)
    this.initializeLogger();

    // Log app initialization
    this.logger.marker('MELCloud Optimizer App Starting');
    this.logger.info('Heat Pump Optimizer initializing...'); // Changed message slightly

    // Register settings change listener early
    this.homey.settings.on('set', this.onSettingsChanged.bind(this));
    this.logger.info('Settings change listener registered');

    // Validate essential settings for service initialization
    this.validateSettings(); // Ensure basic settings are present

    // Instantiate services (Moved here as per overall plan)
    try {
      this.melcloudApi = new MelCloudApi(this.logger, this.homey.settings);
      const melcloudUser = this.homey.settings.get('melcloud_user');
      const melcloudPass = this.homey.settings.get('melcloud_pass');
      if (melcloudUser && melcloudPass) {
        // Intentionally not awaiting login here to prevent blocking onInit for too long.
        // Login will be attempted by MelCloudApi internally when needed.
        this.logger.info('MelCloudApi instantiated. Login will be attempted on first use.');
      } else {
        this.logger.error('MELCloud credentials not found. MelCloudApi may not function.');
      }

      this.tibberApi = new TibberApi(this.homey.settings.get('tibber_token') || '', this.logger);
      this.logger.info('TibberApi initialized.');

      this.weatherApi = new WeatherApi(this.logger, this.homey.settings.get('weather_api_key'));
      this.logger.info('WeatherApi initialized.');

      this.thermalModelService = new ThermalModelService(this.homey as any);
      this.logger.info('ThermalModelService initialized.');

      // Instantiate Optimizer
      const deviceId = this.homey.settings.get('melcloud_device_id');
      const buildingIdSetting = this.homey.settings.get('melcloud_building_id');
      // Ensure buildingId is treated as a number if it exists, or undefined
      const buildingId = buildingIdSetting !== undefined && buildingIdSetting !== null ? Number(buildingIdSetting) : undefined;


      if (deviceId && buildingId !== undefined) {
        this.appOptimizer = new Optimizer(
          this.melcloudApi,
          this.tibberApi,
          deviceId,
          buildingId, // Already a number or undefined
          this.logger,
          this.weatherApi,
          this.homey as any // Pass homey for settings and other app context
        );
        this.logger.info('Optimizer service initialized.');

        // Load initial settings into Optimizer
        this.appOptimizer.setTemperatureConstraints(
          this.homey.settings.get('min_temp') ?? 18,
          this.homey.settings.get('max_temp') ?? 22,
          this.homey.settings.get('temp_step') ?? 0.5
        );
        this.appOptimizer.setCOPSettings(
          this.homey.settings.get('cop_weight') ?? 0.3,
          this.homey.settings.get('auto_seasonal_mode') !== false,
          this.homey.settings.get('summer_mode') === true
        );
        this.appOptimizer.setComfortProfileSettings(
          this.homey.settings.get('comfort_profile_enabled') ?? true,
          this.homey.settings.get('comfort_day_start_hour') ?? 7,
          this.homey.settings.get('comfort_day_end_hour') ?? 22,
          this.homey.settings.get('comfort_night_temp_reduction') ?? 2,
          this.homey.settings.get('comfort_preheat_hours') ?? 1
        );
        this.logger.info('Initial settings loaded into Optimizer.');

      } else {
        this.logger.error('CRITICAL: Optimizer cannot be initialized. MELCloud Device ID or Building ID is missing from settings.');
        // Consider how to handle this - app might be non-functional
      }

    } catch (error) {
      this.logger.error('Error during service initialization:', error as Error);
    }

    // Initialize COP Helper
    try {
      this.copHelper = new COPHelper(this.homey, this);
      this.logger.info('COP Helper initialized');

      // Make it available globally
      (global as any).copHelper = this.copHelper;
    } catch (error) {
      this.logger.error('Failed to initialize COP Helper', error as Error);
    }

    // Initialize Timeline Helper
    try {
      this.timelineHelper = new TimelineHelper(this.homey, this.logger);
      this.logger.info('Timeline Helper initialized');

      // Make it available globally
      (global as any).timelineHelper = this.timelineHelper;
    } catch (error) {
      this.logger.error('Failed to initialize Timeline Helper', error as Error);
    }

    // Initialize cron jobs
    this.initializeCronJobs();

    // Always run test logging on startup for debugging
    this.logger.info('Running test logging on startup...');
    this.testLogging();

    // Monitor memory usage in development mode
    if (process.env.NODE_ENV === 'development') {
      this.monitorMemoryUsage();
      this.logger.info('Memory usage monitoring started (development mode only)');
    }

    // Run initial data cleanup to optimize memory usage on startup
    this.runInitialDataCleanup();

    // Log app initialization complete
    this.logger.info('MELCloud Optimizer App initialized successfully');
  }

  /**
   * Initialize the centralized logger
   */
  private initializeLogger() {
    // Get log level from settings or use INFO as default
    const logLevelSetting = this.homey.settings.get('log_level');
    const logLevel = logLevelSetting !== undefined ? Number(logLevelSetting) : LogLevel.INFO;

    // Get timeline logging setting or use false as default
    const logToTimeline = this.homey.settings.get('log_to_timeline') === true;

    // Initialize the logger
    this.logger = new HomeyLogger(this, {
      level: logLevel,
      logToTimeline: logToTimeline,
      prefix: 'App',
      includeTimestamps: true,
      includeSourceModule: true
    });

    // Make the logger available globally for other modules
    (global as any).logger = this.logger; // Ensure global logger is the refined one

    // Log initialization
    this.logger.log(`Centralized logger initialized with level: ${LogLevel[logLevel]}`);
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
        this.log('Creating timeline entry for hourly job');

        if (this.timelineHelper) {
          await this.timelineHelper.addTimelineEntry(
            TimelineEventType.HOURLY_OPTIMIZATION,
            {},
            false
          );
          this.log('Timeline entry created using timeline helper');
        } else {
          // Fallback to direct API calls if timeline helper is not available
          this.log('Timeline helper not available, using direct API calls');
          // First try the direct timeline API if available
          if (typeof this.homey.timeline === 'object' && typeof this.homey.timeline.createEntry === 'function') {
            await this.homey.timeline.createEntry({
              title: 'MELCloud Optimizer',
              body: '🕒 Automatic hourly optimization | Adjusting temperatures based on price and COP',
              icon: 'flow:device_changed'
            });
            this.log('Timeline entry created using timeline API');
          }
          // Then try the notifications API as the main fallback
          else if (typeof this.homey.notifications === 'object' && typeof this.homey.notifications.createNotification === 'function') {
            await this.homey.notifications.createNotification({
              excerpt: 'MELCloud Optimizer: 🕒 Automatic hourly optimization | Adjusting temperatures based on price and COP',
            });
            this.log('Timeline entry created using notifications API');
          }
          // Finally try homey.flow if available
          else if (typeof this.homey.flow === 'object' && typeof this.homey.flow.runFlowCardAction === 'function') {
            await this.homey.flow.runFlowCardAction({
              uri: 'homey:flowcardaction:homey:manager:timeline:log',
              args: { text: '🕒 Automatic hourly optimization | Adjusting temperatures based on price and COP' }
            });
            this.log('Timeline entry created using flow API');
          }
          else {
            this.log('No timeline API available, using log only');
          }
        }
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
        this.log('Creating timeline entry for weekly job');

        if (this.timelineHelper) {
          await this.timelineHelper.addTimelineEntry(
            TimelineEventType.WEEKLY_CALIBRATION,
            {},
            false
          );
          this.log('Timeline entry created using timeline helper');
        } else {
          // Fallback to direct API calls if timeline helper is not available
          this.log('Timeline helper not available, using direct API calls');
          // First try the direct timeline API if available
          if (typeof this.homey.timeline === 'object' && typeof this.homey.timeline.createEntry === 'function') {
            await this.homey.timeline.createEntry({
              title: 'MELCloud Optimizer',
              body: '📈 Automatic weekly calibration | Updating thermal model with latest data',
              icon: 'flow:device_changed'
            });
            this.log('Timeline entry created using timeline API');
          }
          // Then try the notifications API as the main fallback
          else if (typeof this.homey.notifications === 'object' && typeof this.homey.notifications.createNotification === 'function') {
            await this.homey.notifications.createNotification({
              excerpt: 'MELCloud Optimizer: 📈 Automatic weekly calibration | Updating thermal model with latest data',
            });
            this.log('Timeline entry created using notifications API');
          }
          // Finally try homey.flow if available
          else if (typeof this.homey.flow === 'object' && typeof this.homey.flow.runFlowCardAction === 'function') {
            await this.homey.flow.runFlowCardAction({
              uri: 'homey:flowcardaction:homey:manager:timeline:log',
              args: { text: '📈 Automatic weekly calibration | Updating thermal model with latest data' }
            });
            this.log('Timeline entry created using flow API');
          }
          else {
            this.log('No timeline API available, using log only');
          }
        }
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
        this.logger.setLogLevel(logLevel);
        this.logger.info(`Log level changed to ${LogLevel[logLevel]}`);
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
    // Temperature constraints
    else if (['min_temp', 'max_temp', 'temp_step'].includes(key)) {
      if (this.appOptimizer) {
        this.logger.info(`Temperature constraint '${key}' changed. Updating optimizer.`);
        this.appOptimizer.setTemperatureConstraints(
          this.homey.settings.get('min_temp') ?? 18,
          this.homey.settings.get('max_temp') ?? 22,
          this.homey.settings.get('temp_step') ?? 0.5
        );
      }
    }
    // COP settings
    else if (['cop_weight', 'auto_seasonal_mode', 'summer_mode'].includes(key)) {
      if (this.appOptimizer) {
        this.logger.info(`COP setting '${key}' changed. Updating optimizer.`);
        this.appOptimizer.setCOPSettings(
          this.homey.settings.get('cop_weight') ?? 0.3,
          this.homey.settings.get('auto_seasonal_mode') !== false,
          this.homey.settings.get('summer_mode') === true
        );
      }
    }
    // Comfort profile settings
    else if ([
      'comfort_profile_enabled',
      'comfort_day_start_hour',
      'comfort_day_end_hour',
      'comfort_night_temp_reduction',
      'comfort_preheat_hours',
    ].includes(key)) {
      if (this.appOptimizer) {
        this.logger.info(`Comfort profile setting '${key}' changed. Updating optimizer.`);
        this.appOptimizer.setComfortProfileSettings(
          this.homey.settings.get('comfort_profile_enabled') ?? true,
          this.homey.settings.get('comfort_day_start_hour') ?? 7,
          this.homey.settings.get('comfort_day_end_hour') ?? 22,
          this.homey.settings.get('comfort_night_temp_reduction') ?? 2,
          this.homey.settings.get('comfort_preheat_hours') ?? 1
        );
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
          this.log('Creating timeline entry for manual hourly optimization');

          if (this.timelineHelper) {
            await this.timelineHelper.addTimelineEntry(
              TimelineEventType.HOURLY_OPTIMIZATION_MANUAL,
              {},
              true // Create notification for manual triggers
            );
            this.log('Timeline entry created using timeline helper');
          } else {
            // Fallback to direct API calls if timeline helper is not available
            this.log('Timeline helper not available, using direct API calls');
            // First try the direct timeline API if available
            if (typeof this.homey.timeline === 'object' && typeof this.homey.timeline.createEntry === 'function') {
              await this.homey.timeline.createEntry({
                title: 'MELCloud Optimizer',
                body: '🔄 Manual hourly optimization | Optimizing based on current prices and COP',
                icon: 'flow:device_changed'
              });
              this.log('Timeline entry created using timeline API');
            }
            // Then try the notifications API as the main fallback
            else if (typeof this.homey.notifications === 'object' && typeof this.homey.notifications.createNotification === 'function') {
              await this.homey.notifications.createNotification({
                excerpt: 'MELCloud Optimizer: 🔄 Manual hourly optimization | Optimizing based on current prices and COP',
              });
              this.log('Timeline entry created using notifications API');
            }
            // Finally try homey.flow if available
            else if (typeof this.homey.flow === 'object' && typeof this.homey.flow.runFlowCardAction === 'function') {
              await this.homey.flow.runFlowCardAction({
                uri: 'homey:flowcardaction:homey:manager:timeline:log',
                args: { text: '🔄 Manual hourly optimization | Optimizing based on current prices and COP' }
              });
              this.log('Timeline entry created using flow API');
            }
            else {
              this.log('No timeline API available, using log only');
            }
          }

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
          this.log('Creating timeline entry for manual weekly calibration');

          if (this.timelineHelper) {
            await this.timelineHelper.addTimelineEntry(
              TimelineEventType.WEEKLY_CALIBRATION_MANUAL,
              {},
              true // Create notification for manual triggers
            );
            this.log('Timeline entry created using timeline helper');
          } else {
            // Fallback to direct API calls if timeline helper is not available
            this.log('Timeline helper not available, using direct API calls');
            // First try the direct timeline API if available
            if (typeof this.homey.timeline === 'object' && typeof this.homey.timeline.createEntry === 'function') {
              await this.homey.timeline.createEntry({
                title: 'MELCloud Optimizer',
                body: '📊 Manual weekly calibration | Analyzing thermal model based on collected data',
                icon: 'flow:device_changed'
              });
              this.log('Timeline entry created using timeline API');
            }
            // Then try the notifications API as the main fallback
            else if (typeof this.homey.notifications === 'object' && typeof this.homey.notifications.createNotification === 'function') {
              await this.homey.notifications.createNotification({
                excerpt: 'MELCloud Optimizer: 📊 Manual weekly calibration | Analyzing thermal model based on collected data',
              });
              this.log('Timeline entry created using notifications API');
            }
            // Finally try homey.flow if available
            else if (typeof this.homey.flow === 'object' && typeof this.homey.flow.runFlowCardAction === 'function') {
              await this.homey.flow.runFlowCardAction({
                uri: 'homey:flowcardaction:homey:manager:timeline:log',
                args: { text: '📊 Manual weekly calibration | Analyzing thermal model based on collected data' }
              });
              this.log('Timeline entry created using flow API');
            }
            else {
              this.log('No timeline API available, using log only');
            }
          }

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
   * Monitor memory usage
   */
  private monitorMemoryUsage(): void {
    const memoryUsageInterval = setInterval(() => {
      const memoryUsage = process.memoryUsage();
      const formattedMemory = {
        rss: `${Math.round(memoryUsage.rss / 1024 / 1024)} MB`,
        heapTotal: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)} MB`,
        heapUsed: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)} MB`,
        external: `${Math.round(memoryUsage.external / 1024 / 1024)} MB`
      };

      this.logger.debug('Memory Usage:', formattedMemory);

      // Log a warning if memory usage is high
      const heapUsedMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);
      if (heapUsedMB > 100) { // Warn if heap usage exceeds 100MB
        this.logger.warn('High memory usage detected', {
          heapUsed: formattedMemory.heapUsed,
          timestamp: new Date().toISOString()
        });
      }
    }, 60 * 60 * 1000); // Log memory usage every hour

    // Store the interval for cleanup
    this.memoryUsageInterval = memoryUsageInterval;
  }

  /**
   * Test logging functionality
   */
  public testLogging() {
    // Test all log levels and categories
    this.logger.marker('TEST LOGGING STARTED');

    // Test different log levels
    this.logger.debug('This is a test debug message');
    this.logger.info('This is a test info message');
    this.logger.warn('This is a test warning message', { source: 'testLogging' });
    this.logger.error('This is a test error message', new Error('Test error'), { source: 'testLogging' });

    // Test specialized log categories
    this.logger.api('This is a test API log message', { endpoint: '/test', method: 'GET' });
    this.logger.optimization('This is a test optimization log message', { factor: 0.75, reason: 'testing' });

    // Log system information
    this.logger.info('System Information:');
    const systemInfo = {
      appId: this.id,
      appVersion: this.manifest.version,
      homeyVersion: this.homey.version,
      homeyPlatform: this.homey.platform,
      nodeVersion: process.version,
      memoryUsage: process.memoryUsage()
    };

    // Test object formatting
    this.logger.info('System Info Object:', systemInfo);

    // Log current date and time
    this.logger.info('Current Date/Time:', new Date().toISOString());

    // Test timeline entry
    if (this.timelineHelper) {
      this.timelineHelper.createInfoEntry('MELCloud Optimizer', 'Test logging entry', false)
        .then(() => this.logger.info('Timeline test entry created'))
        .catch(err => this.logger.error('Failed to create timeline test entry', err));
    } else {
      this.logger.warn('Timeline helper not available, skipping timeline test');
    }

    // Test array formatting
    const testArray = Array.from({ length: 20 }, (_, i) => `item-${i}`);
    this.logger.debug('Test array formatting:', testArray);

    // Test error formatting
    try {
      throw new Error('Test error with stack trace');
    } catch (error) {
      this.logger.error('Caught test error', error);
    }

    this.logger.marker('TEST LOGGING COMPLETED');
  }

  /**
   * Run the hourly optimization process
   */
  public async runHourlyOptimizer() {
    this.logger.marker('HOURLY OPTIMIZATION STARTED (using appOptimizer service)');
    this.logger.optimization('Starting hourly optimization process via Optimizer service');

    if (!this.appOptimizer) {
      this.logger.error('Optimizer service not initialized. Cannot run hourly optimization.');
      this.logger.marker('HOURLY OPTIMIZATION FAILED (Optimizer not initialized)');
      // Create error timeline entry
      if (this.timelineHelper) {
        await this.timelineHelper.addTimelineEntry(
          TimelineEventType.HOURLY_OPTIMIZATION_ERROR,
          { error: 'Optimizer service not initialized.' }, true
        ).catch(err => this.logger.error('Failed to create error timeline entry', err));
      }
      throw new Error('Optimizer service not initialized.');
    }

    try {
      const resultData = await this.appOptimizer.runHourlyOptimization();

      // Store the successful result for potential fallback use
      this.homey.settings.set('last_optimization_result', resultData);

      // Log optimization details
      this.logger.optimization('Optimization successful (via Optimizer service)', {
        targetTemp: resultData.targetTemp,
        originalTemp: resultData.targetOriginal,
        savings: resultData.savings,
        reason: resultData.reason,
        cop: resultData.cop,
        thermalModelUsed: !!resultData.thermalModel,
      });

      // Create success timeline entry
      if (this.timelineHelper) {
        const additionalData: Record<string, any> = {
          targetTemp: resultData.targetTemp,
          targetOriginal: resultData.targetOriginal,
          savings: resultData.savings,
          reason: resultData.reason,
          cop: resultData.cop,
        };
        await this.timelineHelper.addTimelineEntry(
          TimelineEventType.HOURLY_OPTIMIZATION_RESULT, {}, false, additionalData
        ).catch(err => this.logger.error('Failed to create success timeline entry', err));
      }

      this.logger.marker('HOURLY OPTIMIZATION COMPLETED SUCCESSFULLY (via appOptimizer service)');
      return { success: true, data: resultData }; // For API compatibility if anything relies on this structure
    } catch (err) {
      const error = err as Error;
      this.logger.error('Hourly optimization error (via Optimizer service)', error, {
        timestamp: new Date().toISOString(),
        component: 'appOptimizer.runHourlyOptimization'
      });

      // Fallback logic (simplified, as Optimizer might handle some internal fallbacks or not)
      const lastResult = this.homey.settings.get('last_optimization_result') as OptimizationResult | undefined;
      if (lastResult) {
        this.logger.warn('Using cached optimization result as fallback due to Optimizer service error', {
          lastResultTimestamp: lastResult.timestamp || 'unknown',
          error: error.message
        });
        if (this.timelineHelper) {
          await this.timelineHelper.addTimelineEntry(
            TimelineEventType.HOURLY_OPTIMIZATION_ERROR,
            { error: `${error.message}. Using cached settings as fallback.`, warning: true }, true
          ).catch(timelineErr => this.logger.error('Failed to send fallback notification', timelineErr));
        }
        this.logger.marker('HOURLY OPTIMIZATION COMPLETED WITH FALLBACK (after Optimizer service error)');
        return { success: true, data: lastResult, fallback: true };
      }

      // Send failure notification
      if (this.timelineHelper) {
        await this.timelineHelper.addTimelineEntry(
          TimelineEventType.HOURLY_OPTIMIZATION_ERROR, { error: error.message }, true
        ).catch(timelineErr => this.logger.error('Failed to send failure notification', timelineErr));
      }
      this.logger.marker('HOURLY OPTIMIZATION FAILED (via appOptimizer service)');
      throw error; // Re-throw for the API handler to catch if necessary
    }
  }

  /**
   * Check system health
   * @returns Object with health status and issues
   */
  private async checkSystemHealth(): Promise<{ healthy: boolean; issues: string[] }> {
    const issues: string[] = [];

    // Check MELCloud connection
    try {
      const api = require('../api.js');
      const melcloudStatus = await api.getMelCloudStatus({ homey: this.homey });

      if (!melcloudStatus.connected) {
        issues.push('MELCloud connection: Not connected');
      }
    } catch (error) {
      issues.push(`MELCloud connection check failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Check Tibber API
    try {
      const api = require('../api.js');
      const tibberStatus = await api.getTibberStatus({ homey: this.homey });

      if (!tibberStatus.connected) {
        issues.push('Tibber API connection: Not connected');
      }
    } catch (error) {
      issues.push(`Tibber API connection check failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Check cron jobs
    if (!this.hourlyJob || !this.hourlyJob.running) {
      issues.push('Hourly optimization job: Not running');
    }

    if (!this.weeklyJob || !this.weeklyJob.running) {
      issues.push('Weekly calibration job: Not running');
    }

    return {
      healthy: issues.length === 0,
      issues
    };
  }

  /**
   * Run system health check and recover if needed
   * @returns Health status and recovery information
   */
  public async runSystemHealthCheck(): Promise<{ healthy: boolean; issues: string[]; recovered: boolean }> {
    this.log('Running system health check');

    const healthStatus = await this.checkSystemHealth();

    if (!healthStatus.healthy) {
      this.log(`System health check found ${healthStatus.issues.length} issues:`, healthStatus.issues);

      // Create timeline entry for health check issues
      try {
        if (this.timelineHelper) {
          const issuesMessage = healthStatus.issues.join(', ');
          await this.timelineHelper.addTimelineEntry(
            TimelineEventType.SYSTEM_HEALTH_ERROR,
            {
              count: healthStatus.issues.length,
              issues: issuesMessage
            },
            true // Create notification for health issues
          );
        }
      } catch (timelineErr) {
        this.error('Failed to create health check timeline entry', timelineErr as Error);
      }

      // Try to recover
      let recovered = false;

      try {
        // Restart cron jobs if needed
        if (!this.hourlyJob?.running || !this.weeklyJob?.running) {
          this.log('Restarting cron jobs');
          this.initializeCronJobs();
          recovered = true;
        }

        // Other recovery actions as needed

        this.log('System recovery actions completed');

        // Create timeline entry for recovery
        if (recovered && this.timelineHelper) {
          await this.timelineHelper.addTimelineEntry(
            TimelineEventType.SYSTEM_RECOVERY,
            {},
            false // Don't create notification for recovery
          );
        }
      } catch (error) {
        this.error('Failed to recover system:', error as Error);

        // Create timeline entry for recovery failure
        if (this.timelineHelper) {
          try {
            await this.timelineHelper.addTimelineEntry(
              TimelineEventType.SYSTEM_HEALTH_ERROR,
              {
                error: `Failed to recover from system health issues: ${error instanceof Error ? error.message : String(error)}`,
                count: 1,
                issues: 'Recovery failure'
              },
              true // Create notification for recovery failure
            );
          } catch (timelineErr) {
            this.error('Failed to create recovery failure timeline entry', timelineErr as Error);
          }
        }
      }

      return {
        ...healthStatus,
        recovered
      };
    } else {
      // Create timeline entry for successful health check
      try {
        if (this.timelineHelper) {
          await this.timelineHelper.addTimelineEntry(
            TimelineEventType.SYSTEM_HEALTH_CHECK,
            {},
            false // Don't create notification for successful health check
          );
        }
      } catch (timelineErr) {
        this.error('Failed to create health check success timeline entry', timelineErr as Error);
      }
    }

    this.log('System health check passed');
    return {
      ...healthStatus,
      recovered: false
    };
  }

  /**
   * Run the weekly calibration process
   */
  public async runWeeklyCalibration() {
    this.logger.log('Starting weekly calibration (via Optimizer service)');
    this.logger.marker('===== WEEKLY CALIBRATION STARTED (via Optimizer service) =====');

    if (!this.appOptimizer) {
      this.logger.error('Optimizer service not initialized. Cannot run weekly calibration.');
      this.logger.marker('WEEKLY CALIBRATION FAILED (Optimizer not initialized)');
      if (this.timelineHelper) {
        await this.timelineHelper.addTimelineEntry(
          TimelineEventType.WEEKLY_CALIBRATION_ERROR,
          { error: 'Optimizer service not initialized.' }, true
        ).catch(err => this.logger.error('Failed to create error timeline entry', err));
      }
      throw new Error('Optimizer service not initialized.');
    }

    try {
      const calibrationData = await this.appOptimizer.runWeeklyCalibration();

      // Create success timeline entry
      if (this.timelineHelper) {
        const additionalData: Record<string, any> = { ...calibrationData };
        await this.timelineHelper.addTimelineEntry(
          TimelineEventType.WEEKLY_CALIBRATION_RESULT, {}, false, additionalData
        ).catch(err => this.logger.error('Failed to create success timeline entry', err));
      }

      this.logger.log('===== WEEKLY CALIBRATION COMPLETED SUCCESSFULLY (via Optimizer service) =====');
      return { success: true, data: calibrationData }; // For API compatibility
    } catch (err) {
      const error = err as Error;
      this.logger.error('Weekly calibration error (via Optimizer service)', error);

      // Send notification
      if (this.timelineHelper) {
        await this.timelineHelper.addTimelineEntry(
          TimelineEventType.WEEKLY_CALIBRATION_ERROR, { error: error.message }, true
        ).catch(timelineErr => this.logger.error('Failed to send notification', timelineErr));
      }
      this.logger.marker('===== WEEKLY CALIBRATION FAILED (via Optimizer service) =====');
      throw error; // Re-throw for the API handler
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
    this.log('===== MELCloud Optimizer App Stopping =====');

    try {
      // Stop and clean up cron jobs
      this.cleanupCronJobs();

      // Stop thermal model service
      if (this.thermalModelService && typeof this.thermalModelService.stop === 'function') {
        this.logger.log('Stopping thermal model service...');
        this.thermalModelService.stop();
        this.logger.log('Thermal model service stopped');
      } else {
        this.logger.warn('Thermal model service not available or stop method missing during uninit.');
      }

      if (this.melcloudApi && typeof this.melcloudApi.cleanup === 'function') {
        this.logger.log('Cleaning up MelCloud API resources...');
        this.melcloudApi.cleanup();
      }


      // Clean up any other resources
      if (this.copHelper) {
        this.log('Cleaning up COP helper resources');
        // No specific cleanup needed for COP helper currently
      }

      // Clean up memory usage monitoring
      if (this.memoryUsageInterval) {
        this.log('Cleaning up memory usage monitoring');
        clearInterval(this.memoryUsageInterval);
        this.memoryUsageInterval = undefined;
      }

      // Final cleanup
      this.log('All resources cleaned up');
    } catch (error) {
      this.error('Error during app shutdown:', error as Error);
    } finally {
      this.log('MELCloud Optimizer App shutdown complete');
    }
  }

  /**
   * Run initial data cleanup on app startup
   * This ensures we start with optimized memory usage
   */
  private runInitialDataCleanup(): void {
    try {
      // Wait a bit to ensure all services are initialized
      setTimeout(async () => {
        this.logger.log('Running initial data cleanup to optimize memory usage...');
        if (this.thermalModelService && typeof this.thermalModelService.forceDataCleanup === 'function') {
          try {
            const result = this.thermalModelService.forceDataCleanup();
            if (result.success) {
              this.logger.log(`Initial data cleanup successful. Memory usage reduced from ${result.memoryUsageBefore}KB to ${result.memoryUsageAfter}KB`);
              const memoryStats = this.thermalModelService.getMemoryUsage();
              this.logger.log(`Current thermal model data: ${memoryStats.dataPointCount} data points, ${memoryStats.aggregatedDataCount} aggregated points`);
            } else {
              this.logger.error(`Initial data cleanup failed: ${result.message}`);
            }
          } catch (error) {
            this.logger.error('Error during initial data cleanup:', error as Error);
          }
        } else {
          this.logger.warn('Thermal model service not available for initial cleanup or forceDataCleanup method missing.');
        }
      }, 2 * 60 * 1000); // Run 2 minutes after startup
    } catch (error) {
      this.logger.error('Error scheduling initial data cleanup:', error as Error);
    }
  }
}
