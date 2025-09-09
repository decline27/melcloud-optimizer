import { App } from 'homey';
import { CronJob } from 'cron'; // Import CronJob
import { COPHelper } from './services/cop-helper';
import { TimelineHelper, TimelineEventType } from './util/timeline-helper';
import { HomeyLogger, LogLevel, LogCategory } from './util/logger';
import { HotWaterService } from './services/hot-water';
import { TimeZoneHelper } from './util/time-zone-helper';
import { majorToMinor, minorToMajor, getCurrencyDecimals, resolveCurrency } from './util/currency-utils';
import {
  LogEntry,
  ThermalModel,
  DeviceInfo,
  PricePoint,
  OptimizationResult,
  HomeyApp
} from './types';

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
  public hotWaterService?: HotWaterService;
  public logger: HomeyLogger = new HomeyLogger(this, {
    level: LogLevel.INFO,
    logToTimeline: false,
    prefix: 'App',
    includeTimestamps: true,
    includeSourceModule: true
  });
  private memoryUsageInterval?: NodeJS.Timeout;
  private timeZoneHelper?: TimeZoneHelper;

  /**
   * Format a Date to YYYY-MM-DD using local time (with timezone helper if available)
   */
  private formatLocalDate(date = new Date()): string {
    const d = this.timeZoneHelper ? this.timeZoneHelper.getLocalTime().date : date;
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Add an hourly savings amount to today's total and maintain a short history
   * Returns todaySoFar and weekSoFar (last 7 days including today)
   * Now stores amounts in integer minor units with currency and decimals
   */
  private addSavings(amount: number): { todaySoFar: number; weekSoFar: number } {
    try {
      if (typeof amount !== 'number' || isNaN(amount)) {
        return { todaySoFar: 0, weekSoFar: 0 };
      }

      // Resolve currency from settings or use empty string
      const currency = resolveCurrency(
        this.homey.settings.get('currency_code'),
        this.homey.settings.get('currency')
      );
      const decimals = getCurrencyDecimals(currency);

      // Convert major unit amount to minor units for storage
      const minorAmount = majorToMinor(amount, currency, decimals);

      const today = this.formatLocalDate();
      const history: Array<{ date: string; total?: number; totalMinor?: number; currency?: string; decimals?: number }> = 
        this.homey.settings.get('savings_history') || [];

      // Find or create today's entry, migrating legacy format if needed
      let todayEntry = history.find(h => h.date === today);
      if (!todayEntry) {
        // Create new entry in new format
        todayEntry = { 
          date: today, 
          totalMinor: 0,
          currency: currency || undefined,
          decimals: currency ? decimals : undefined
        };
        history.push(todayEntry);
      } else {
        // Migrate legacy entry if needed
        if (todayEntry.totalMinor === undefined && todayEntry.total !== undefined) {
          // Legacy entry - convert to new format
          const legacyAmount = todayEntry.total || 0;
          const resolvedDecimals = todayEntry.decimals ?? decimals;
          todayEntry.totalMinor = majorToMinor(legacyAmount, currency, resolvedDecimals);
          if (currency) {
            todayEntry.currency = currency;
            todayEntry.decimals = decimals;
          }
          // Remove legacy field
          delete todayEntry.total;
        }
      }

      // Increment today's total (in minor units)
      todayEntry.totalMinor = (todayEntry.totalMinor || 0) + minorAmount;

      // Update currency/decimals if we now have a currency but entry didn't have one
      if (currency && !todayEntry.currency) {
        todayEntry.currency = currency;
        todayEntry.decimals = decimals;
      }

      // Trim history to last 30 days
      history.sort((a, b) => a.date.localeCompare(b.date));
      const cutoffIndex = Math.max(0, history.length - 30);
      const trimmed = history.slice(cutoffIndex);

      // Migrate any remaining legacy entries in the trimmed history
      for (const entry of trimmed) {
        if (entry.totalMinor === undefined && entry.total !== undefined) {
          const legacyAmount = entry.total || 0;
          const entryDecimals = entry.decimals ?? decimals;
          const entryCurrency = entry.currency || currency;
          entry.totalMinor = majorToMinor(legacyAmount, entryCurrency, entryDecimals);
          if (currency && !entry.currency) {
            entry.currency = currency;
            entry.decimals = decimals;
          }
          delete entry.total;
        }
      }

      this.homey.settings.set('savings_history', trimmed);

      // Compute last 7 days total including today (convert back to major units for return)
      const todayDate = new Date(`${today}T00:00:00`);
      const last7Cutoff = new Date(todayDate);
      last7Cutoff.setDate(todayDate.getDate() - 6); // include 7 days window

      const weekSoFarMinor = trimmed
        .filter(h => {
          const d = new Date(`${h.date}T00:00:00`);
          return d >= last7Cutoff && d <= todayDate;
        })
        .reduce((sum, h) => sum + (h.totalMinor || 0), 0);

      // Convert back to major units for return values
      const todaySoFarMajor = minorToMajor(todayEntry.totalMinor || 0, currency, decimals);
      const weekSoFarMajor = minorToMajor(weekSoFarMinor, currency, decimals);

      return { 
        todaySoFar: Number(todaySoFarMajor.toFixed(4)), 
        weekSoFar: Number(weekSoFarMajor.toFixed(4)) 
      };
    } catch (e) {
      this.error('Failed to add savings to history', e as Error);
      return { todaySoFar: 0, weekSoFar: 0 };
    }
  }

  /**
   * Get the total savings for the last 7 days including today
   * Now handles both new format (totalMinor) and legacy format (total) with migration
   */
  private getWeeklySavingsTotal(): number {
    try {
      // Resolve currency from settings
      const currency = resolveCurrency(
        this.homey.settings.get('currency_code'),
        this.homey.settings.get('currency')
      );
      const decimals = getCurrencyDecimals(currency);

      const today = this.formatLocalDate();
      const todayDate = new Date(`${today}T00:00:00`);
      const last7Cutoff = new Date(todayDate);
      last7Cutoff.setDate(todayDate.getDate() - 6);

      const history: Array<{ date: string; total?: number; totalMinor?: number; currency?: string; decimals?: number }> = 
        this.homey.settings.get('savings_history') || [];
      
      let totalMinor = 0;
      let needsSave = false;

      for (const h of history) {
        const d = new Date(`${h.date}T00:00:00`);
        if (d >= last7Cutoff && d <= todayDate) {
          if (h.totalMinor !== undefined) {
            // New format - use directly
            totalMinor += h.totalMinor;
          } else if (h.total !== undefined) {
            // Legacy format - convert and migrate
            const entryDecimals = h.decimals ?? decimals;
            const convertedMinor = majorToMinor(h.total, h.currency || currency, entryDecimals);
            totalMinor += convertedMinor;
            
            // Migrate the entry
            h.totalMinor = convertedMinor;
            if (currency && !h.currency) {
              h.currency = currency;
              h.decimals = decimals;
            }
            delete h.total;
            needsSave = true;
          }
        }
      }

      // Save migrated history if any entries were converted
      if (needsSave) {
        this.homey.settings.set('savings_history', history);
      }

      // Convert back to major units for return
      const totalMajor = minorToMajor(totalMinor, currency, decimals);
      return Number(totalMajor.toFixed(4));
    } catch (e) {
      this.error('Failed to compute weekly savings total', e as Error);
      return 0;
    }
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
    // Initialize the centralized logger
    try {
      this.initializeLogger();
    } catch (error) {
      // If logger initialization fails, create a basic console logger
      this.logger = {
        marker: (msg: string) => console.log(`[MARKER] ${msg}`),
        info: (msg: string) => console.log(`[INFO] ${msg}`),
        warn: (msg: string) => console.log(`[WARN] ${msg}`),
        error: (msg: string) => console.error(`[ERROR] ${msg}`),
        debug: (msg: string) => console.log(`[DEBUG] ${msg}`),
        optimization: (msg: string) => console.log(`[OPTIMIZATION] ${msg}`)
      } as any;
      console.error('Failed to initialize centralized logger, using console fallback:', error);
    }

    // Log app initialization
    this.logger.marker('MELCloud Optimizer App Starting');
    this.logger.info('Heat Pump Optimizer initialized');

    // Log some additional information
    try {
      this.logger.info(`App ID: ${this.id}`);
      this.logger.info(`App Version: ${this.manifest.version}`);
      this.logger.info(`Homey Version: ${this.homey.version}`);
      this.logger.info(`Homey Platform: ${this.homey.platform}`);
    } catch (error) {
      this.logger.error('Failed to log app information:', error as Error);
    }

    // Register settings change listener
    try {
      this.homey.settings.on('set', this.onSettingsChanged.bind(this));
      this.logger.info('Settings change listener registered');
    } catch (error) {
      this.logger.error('Failed to register settings change listener:', error as Error);
    }

    // Validate settings
    try {
      this.validateSettings();
    } catch (error) {
      this.error('Failed to validate settings during initialization:', error as Error);
      // Continue with initialization despite settings validation failure
    }

    // API is automatically registered by Homey

    // Initialize COP Helper
    try {
      // Pass the logger instance to the helper
      this.copHelper = new COPHelper(this.homey, this.logger as any);
      this.logger.info('COP Helper initialized');
    } catch (error) {
      this.logger.error('Failed to initialize COP Helper', error as Error);
    }
    
    // Initialize Hot Water Service
    try {
      this.hotWaterService = new HotWaterService(this.homey);
      this.logger.info('Hot Water Service initialized');
    } catch (error) {
      this.logger.error('Failed to initialize Hot Water Service', error as Error);
    }

    // Initialize Timeline Helper
    try {
      this.timelineHelper = new TimelineHelper(this.homey, this.logger);
      this.logger.info('Timeline Helper initialized');
    } catch (error) {
      this.logger.error('Failed to initialize Timeline Helper', error as Error);
    }

    // Initialize cron jobs
    try {
      this.initializeCronJobs();
    } catch (error) {
      this.logger.error('Failed to initialize cron jobs', error as Error);
    }

    // Monitor memory usage in development mode
    if (process.env.NODE_ENV === 'development') {
      try {
        this.monitorMemoryUsage();
        this.logger.info('Memory usage monitoring started (development mode only)');
      } catch (error) {
        this.logger.error('Failed to start memory usage monitoring', error as Error);
      }
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

    // Initialize Time Zone Helper with current settings
    const tzOffset = this.homey.settings.get('time_zone_offset') || 2;
    const useDST = this.homey.settings.get('use_dst') || false;
    this.timeZoneHelper = new TimeZoneHelper(this.logger, Number(tzOffset), Boolean(useDST));

    // Log initialization
    this.log(`Centralized logger initialized with level: ${LogLevel[logLevel]}`);
  }

  /**
   * Initialize cron jobs for hourly optimization and weekly calibration
   * This method is public so it can be called from the API
   */
  public initializeCronJobs() {
    this.log('===== INITIALIZING CRON JOBS =====');
    // Resolve time zone via helper
    const tzHelper = this.timeZoneHelper;
    const timeZoneString = tzHelper ? tzHelper.getTimeZoneString() : 'UTC+0';
    const localInfo = tzHelper ? tzHelper.getLocalTime() : { timeZoneOffset: 0, effectiveOffset: 0, timeString: new Date().toUTCString() } as any;
    this.log('Homey local time:', localInfo.timeString);
    this.log(`Using Homey time zone: ${timeZoneString}`);

    // Hourly job - runs at minute 5 of every hour
    // Format: second minute hour day-of-month month day-of-week
    this.log(`Creating hourly cron job with pattern: 0 5 * * * * (Time zone: ${timeZoneString})`);
    this.hourlyJob = new CronJob('0 5 * * * *', async () => {
      // Add a more visible log message
      const currentTime = new Date();
      const localCurrentTime = this.timeZoneHelper ? this.timeZoneHelper.getLocalTime().date : new Date(currentTime.getTime());

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
          } else {
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
      const localCurrentTime = this.timeZoneHelper ? this.timeZoneHelper.getLocalTime().date : new Date(currentTime.getTime());

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
          const weeklySavings = this.getWeeklySavingsTotal();
          await this.timelineHelper.addTimelineEntry(
            TimelineEventType.WEEKLY_CALIBRATION,
            {},
            false,
            { weeklySavings }
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
          } else {
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
      homeyTimeZoneOffset: localInfo.timeZoneOffset,
      homeyDST: this.timeZoneHelper ? this.timeZoneHelper.isInDSTperiod() : false,
      homeyEffectiveOffset: localInfo.effectiveOffset
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
            const weeklySavings = this.getWeeklySavingsTotal();
            await this.timelineHelper.addTimelineEntry(
              TimelineEventType.WEEKLY_CALIBRATION_MANUAL,
              {},
              true, // Create notification for manual triggers
              { weeklySavings }
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
   * Run the hourly optimization process
   */
  public async runHourlyOptimizer() {
    this.logger.marker('HOURLY OPTIMIZATION STARTED');
    this.logger.optimization('Starting hourly optimization process');

    try {
      // Call the API implementation
      const api = require('../api.js');
      const result = await api.getRunHourlyOptimizer({ homey: this.homey });

      if (result.success) {
        // Store the successful result for potential fallback use
        this.homey.settings.set('last_optimization_result', result);

        // Log optimization details
        if (result.data) {
          this.logger.optimization('Optimization successful', {
            targetTemp: result.data.targetTemp,
            originalTemp: result.data.targetOriginal,
            savings: result.data.savings,
            reason: result.data.reason,
            cop: result.data.cop
          });
        }

        // Create success timeline entry
        try {
          if (this.timelineHelper) {
            // Prepare additional data for the timeline entry
            const additionalData: Record<string, any> = {};

            if (result.data && result.data.targetTemp && result.data.targetOriginal) {
              additionalData.targetTemp = result.data.targetTemp;
              additionalData.targetOriginal = result.data.targetOriginal;
            }

            if (result.data && typeof result.data.savings === 'number') {
              additionalData.savings = result.data.savings;

              // Update accumulated savings and include "today so far"
              const { todaySoFar } = this.addSavings(result.data.savings);
              additionalData.todaySoFar = todaySoFar;
            }

            // Add any other relevant data
            if (result.data && result.data.reason) {
              additionalData.reason = result.data.reason;
            }

            if (result.data && result.data.cop) {
              additionalData.cop = result.data.cop;
            }

            // Create the timeline entry using our standardized helper
            const notifyOnSuccess = this.homey.settings.get('notify_on_success') === true;
            await this.timelineHelper.addTimelineEntry(
              TimelineEventType.HOURLY_OPTIMIZATION_RESULT,
              {}, // No specific details needed
              notifyOnSuccess, // Respect user setting for success notifications
              additionalData
            );
          }
        } catch (timelineErr) {
          this.logger.error('Failed to create success timeline entry', timelineErr as Error);
        }

        this.logger.marker('HOURLY OPTIMIZATION COMPLETED SUCCESSFULLY');
        return result;
      } else {
        throw new Error(result.error || 'Unknown error');
      }
    } catch (err) {
      const error = err as Error;
      this.logger.error('Hourly optimization error', error, {
        timestamp: new Date().toISOString(),
        component: 'hourlyOptimizer'
      });

      // Check if we have cached data we can use as fallback
      try {
        const lastResult = this.homey.settings.get('last_optimization_result');
        if (lastResult) {
          this.logger.warn('Using cached optimization result as fallback', {
            lastResultTimestamp: lastResult.timestamp || 'unknown',
            error: error.message
          });

          // Send notification about the fallback
          try {
            if (this.timelineHelper) {
              await this.timelineHelper.addTimelineEntry(
                TimelineEventType.HOURLY_OPTIMIZATION_ERROR,
                {
                  error: `${error.message}. Using cached settings as fallback.`,
                  warning: true
                },
                true // Create notification for warnings
              );
            } else {
              // Fallback to direct notification
              await this.homey.notifications.createNotification({
                excerpt: `HourlyOptimizer error: ${error.message}. Using cached settings as fallback.`
              });
            }
          } catch (notifyErr) {
            this.logger.error('Failed to send notification', notifyErr as Error);
          }

          this.logger.marker('HOURLY OPTIMIZATION COMPLETED WITH FALLBACK');
          return { ...lastResult, fallback: true };
        }
      } catch (fallbackErr) {
        this.logger.error('Failed to use fallback optimization result', fallbackErr as Error);
      }

      // Send notification about the failure
      try {
        if (this.timelineHelper) {
          await this.timelineHelper.addTimelineEntry(
            TimelineEventType.HOURLY_OPTIMIZATION_ERROR,
            { error: error.message },
            true // Create notification for errors
          );
        } else {
          // Fallback to direct notification
          await this.homey.notifications.createNotification({
            excerpt: `HourlyOptimizer error: ${error.message}`
          });
        }
      } catch (notifyErr) {
        this.logger.error('Failed to send notification', notifyErr as Error);
      }

      this.logger.marker('HOURLY OPTIMIZATION FAILED');
      throw error; // Re-throw to propagate the error
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
    this.log('Starting weekly calibration');
    this.log('===== WEEKLY CALIBRATION STARTED =====');

    try {
      // Call the API implementation
      const api = require('../api.js');
      const result = await api.getRunWeeklyCalibration({ homey: this.homey });

      if (result.success) {
        // Create success timeline entry
        try {
          if (this.timelineHelper) {
            // Prepare additional data for the timeline entry
            const additionalData: Record<string, any> = {};

            if (result.data && result.data.oldK && result.data.newK) {
              additionalData.oldK = result.data.oldK;
              additionalData.newK = result.data.newK;
            }

            if (result.data && result.data.method) {
              additionalData.method = result.data.method;
            }

            // Add any other relevant data
            if (result.data && result.data.newS) {
              additionalData.newS = result.data.newS;
            }

            if (result.data && result.data.thermalCharacteristics) {
              additionalData.thermalCharacteristics = result.data.thermalCharacteristics;
            }

            // Attach weekly savings total if available
            additionalData.weeklySavings = this.getWeeklySavingsTotal();

            // Create the timeline entry using our standardized helper
            const notifyOnSuccess = this.homey.settings.get('notify_on_success') === true;
            await this.timelineHelper.addTimelineEntry(
              TimelineEventType.WEEKLY_CALIBRATION_RESULT,
              {}, // No specific details needed
              notifyOnSuccess, // Respect user setting for success notifications
              additionalData
            );
          }
        } catch (timelineErr) {
          this.error('Failed to create success timeline entry', timelineErr as Error);
        }

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
        if (this.timelineHelper) {
          await this.timelineHelper.addTimelineEntry(
            TimelineEventType.WEEKLY_CALIBRATION_ERROR,
            { error: error.message },
            true // Create notification for errors
          );
        } else {
          // Fallback to direct notification
          await this.homey.notifications.createNotification({
            excerpt: `WeeklyCalibration error: ${error.message}`
          });
        }
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
    this.logger.marker('MELCloud Optimizer App Stopping');

    try {
      // Stop and clean up cron jobs
      this.cleanupCronJobs();

      // Clean up API services - let the API handle its own cleanup
      try {
        const api = require('../api.js');

        // Prefer internalCleanup (non-HTTP, private); fall back to cleanup if present
        const cleanupFn = typeof api.internalCleanup === 'function'
          ? api.internalCleanup
          : (typeof api.cleanup === 'function' ? api.cleanup : null);

        // Call the cleanup method to properly stop all services
        if (cleanupFn) {
          const cleanupResult = await cleanupFn({ homey: this.homey });
          if (cleanupResult.success) {
            this.logger.info('API resources cleanup completed successfully');
          } else {
            this.logger.error('API cleanup reported failure:', cleanupResult.error);
          }
        } else {
          this.logger.warn('API cleanup method not available - resources may not be fully cleaned');
        }
      } catch (apiError) {
        this.logger.error('Error during API cleanup:', apiError as Error);
      }

      // Clean up any other resources
      if (this.copHelper) {
        this.logger.info('Cleaning up COP helper resources');
        // No specific cleanup needed for COP helper currently
      }

      // Clean up timeline helper
      if (this.timelineHelper) {
        this.logger.info('Cleaning up Timeline helper resources');
        // No specific cleanup needed for Timeline helper currently
      }

      // Clean up memory usage monitoring
      if (this.memoryUsageInterval) {
        this.logger.info('Cleaning up memory usage monitoring');
        clearInterval(this.memoryUsageInterval);
        this.memoryUsageInterval = undefined;
      }

      // Final cleanup
      this.logger.info('All resources cleaned up');
    } catch (error) {
      this.logger.error('Error during app shutdown:', error as Error);
    } finally {
      this.logger.marker('MELCloud Optimizer App shutdown complete');
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
        this.log('Running initial data cleanup to optimize memory usage...');

        try {
          // Call the API's thermal data cleanup method
          const api = require('../api.js');
          const result = await api.runThermalDataCleanup({ homey: this.homey });

          if (result.success) {
            this.log(`Initial data cleanup successful. Cleaned ${result.cleanedDataPoints || 0} data points, freed ${result.freedMemory || 0}KB of memory`);
          } else {
            this.log(`Initial data cleanup: ${result.message}`);
          }
        } catch (error) {
          this.error('Error during initial data cleanup:', error as Error);
        }
      }, 120000); // 2 minutes delay
    } catch (error) {
      this.error('Error scheduling initial data cleanup:', error as Error);
    }
  }
}
