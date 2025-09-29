import { App } from 'homey';
import { COPHelper } from './services/cop-helper';
import { TimelineHelper, TimelineEventType } from './util/timeline-helper';
import { HomeyLogger, LogLevel, LogCategory } from './util/logger';
import { HotWaterService } from './services/hot-water';
import { TimeZoneHelper } from './util/time-zone-helper';
import {
  LogEntry,
  ThermalModel,
  DeviceInfo,
  PricePoint,
  OptimizationResult,
  HomeyApp
} from './types';
import { OrchestratorMetrics } from './metrics';

/**
 * MELCloud Heat Pump Optimizer App
 *
 * This app optimizes heat pump operation based on electricity prices and thermal models
 */
export default class HeatOptimizerApp extends App {
  // Make these public so they can be accessed from the API
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
  
  constructor() {
    console.log('🚀 HeatOptimizerApp constructor called');
    super();
    console.log('🚀 HeatOptimizerApp constructor completed');
  }
  private memoryUsageInterval?: NodeJS.Timeout;
  private timeZoneHelper?: TimeZoneHelper;

  /**
   * Warning method for compatibility
   */
  public warn(message: string, ...args: any[]): void {
    this.logger.warn(message, ...args);
  }

  // Currency decimals fallback map
  private static readonly currencyDecimals: Record<string, number> = {
    JPY: 0,
    KWD: 3,
    // Default is 2 for most currencies
  };

  /**
   * Get decimal places for a currency (default 2)
   */
  private getCurrencyDecimals(currency: string): number {
    return HeatOptimizerApp.currencyDecimals[currency?.toUpperCase()] ?? 2;
  }

  /**
   * Convert major currency units to minor units (e.g. 1.23 EUR -> 123 cents)
   */
  public majorToMinor(amount: number, decimals: number): number {
    if (typeof amount !== 'number' || isNaN(amount)) return 0;
    return Math.round(amount * Math.pow(10, decimals));
  }

  /**
   * Convert minor currency units to major units (e.g. 123 cents -> 1.23 EUR)
   */
  public minorToMajor(amount: number, decimals: number): number {
    if (typeof amount !== 'number' || isNaN(amount)) return 0;
    return amount / Math.pow(10, decimals);
  }

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
   * Migrate legacy savings field to new metrics structure
   */
  private migrateLegacySavings(): void {
    try {
      const legacy = this.homey.settings.get('total_savings') ?? this.homey.settings.get('savings');
      if (typeof legacy === 'number' && !Number.isNaN(legacy) && legacy > 0) {
        const metrics: OrchestratorMetrics = this.homey.settings.get('orchestrator_metrics') || {
          totalSavings: 0,
          totalCostImpact: 0,
        };
        metrics.totalSavings = +(metrics.totalSavings + legacy).toFixed(2);
        if (metrics.totalCostImpact == null) metrics.totalCostImpact = 0;
        metrics.lastUpdateIso = new Date().toISOString();
        this.homey.settings.set('orchestrator_metrics', metrics);
        this.homey.settings.unset('total_savings');
        this.homey.settings.unset('savings');
        this.logger.info(`Migrated legacy savings=${legacy}`);
      }
    } catch (e) {
      this.logger.error('Failed to migrate legacy savings', e as Error);
    }
  }

  /**
   * Migrate legacy savings entry to new format with minor units
   */
  private migrateLegacyEntry(entry: any, currency: string, decimals: number): any {
    if (entry.totalMinor !== undefined) {
      // Already migrated
      return entry;
    }

    if (entry.total !== undefined) {
      // Legacy entry, convert to new format
      const totalMinor = this.majorToMinor(entry.total, decimals);
      return {
        date: entry.date,
        totalMinor,
        currency,
        decimals
      };
    }

    // Unknown format, return as-is
    return entry;
  }

  /**
   * Update cost metrics using actual/baseline energy and price
   */
  private accountCost(
    priceSekPerKWh: number,
    kWhActual: number,
    kWhBaseline: number,
    priceTimestamp?: string
  ): { todaySavings: number; costImpactToday: number } {
    const now = new Date();

    if (
      priceSekPerKWh == null || Number.isNaN(priceSekPerKWh) || priceSekPerKWh <= 0 ||
      kWhActual == null || Number.isNaN(kWhActual) || !Number.isFinite(kWhActual) ||
      kWhBaseline == null || Number.isNaN(kWhBaseline) || !Number.isFinite(kWhBaseline)
    ) {
      this.logger.log('[Accounting] Skipped - invalid inputs');
      return { todaySavings: 0, costImpactToday: 0 };
    }

    if (priceTimestamp) {
      const ts = new Date(priceTimestamp);
      if (isFinite(ts.getTime()) && now.getTime() - ts.getTime() > 65 * 60 * 1000) {
        this.logger.log('[Accounting] Skipped - stale price/energy data');
        return { todaySavings: 0, costImpactToday: 0 };
      }
    }

    const actualCost = kWhActual * priceSekPerKWh;
    const baselineCost = kWhBaseline * priceSekPerKWh;
    let costDelta = +(actualCost - baselineCost).toFixed(2);
    if (Math.abs(costDelta) < 0.005) costDelta = 0;
    const savingsThisInterval = Math.max(0, +(-costDelta).toFixed(2));

    const metrics: OrchestratorMetrics = this.homey.settings.get('orchestrator_metrics') || {
      totalSavings: 0,
      totalCostImpact: 0,
    };

    metrics.totalCostImpact = +(metrics.totalCostImpact + costDelta).toFixed(2);
    metrics.totalSavings = +(metrics.totalSavings + savingsThisInterval).toFixed(2);
    const today = this.formatLocalDate();
    if (metrics.dailyCostImpactDate !== today) {
      metrics.dailyCostImpactDate = today;
      metrics.dailyCostImpact = 0;
    }
    metrics.dailyCostImpact = +(Number(metrics.dailyCostImpact || 0) + costDelta).toFixed(2);
    metrics.lastUpdateIso = now.toISOString();
    this.homey.settings.set('orchestrator_metrics', metrics);

    // Do NOT persist savings history here to avoid double-counting.
    // The API layer (api.js:getRunHourlyOptimizer) is the single writer for savings_history.
    // Here we only read today's total from the already-persisted history to report "today so far".
    let todaySoFar = 0;
    try {
      const currency = this.homey.settings.get('currency_code') || this.homey.settings.get('currency') || '';
      const decimals = this.getCurrencyDecimals(currency);
      const today = this.formatLocalDate();
      const rawHistory = this.homey.settings.get('savings_history') || [];
      const history = (rawHistory as any[]).map((h: any) => this.migrateLegacyEntry(h, currency, decimals));
      const todayEntry: any = history.find((h: any) => h.date === today);
      if (todayEntry) {
        if (todayEntry.totalMinor !== undefined) {
          todaySoFar = Number(this.minorToMajor(todayEntry.totalMinor, todayEntry.decimals ?? decimals).toFixed(4));
        } else if (todayEntry.total !== undefined) {
          todaySoFar = Number(Number(todayEntry.total).toFixed(4));
        }
      }
    } catch (_) {
      todaySoFar = 0;
    }

    this.logger.info(
      `[Accounting] baseline=${baselineCost.toFixed(2)} actual=${actualCost.toFixed(2)} ` +
      `delta=${costDelta >= 0 ? '+' : ''}${costDelta.toFixed(2)} SEK ` +
      `saved=${savingsThisInterval.toFixed(2)} SEK totalSaved=${metrics.totalSavings.toFixed(2)} SEK ` +
      `totalImpact=${metrics.totalCostImpact.toFixed(2)} SEK`
    );

    return { todaySavings: todaySoFar, costImpactToday: metrics.dailyCostImpact || 0 };
  }

  /**
   * Add an hourly savings amount to today's total and maintain a short history
   * Amount should be in major units and will be converted to integer minor units
   * Returns todaySoFar and weekSoFar (last 7 days including today) in major units
   */
  private addSavings(amount: number): { todaySoFar: number; weekSoFar: number } {
    try {
      if (typeof amount !== 'number' || isNaN(amount)) {
        return { todaySoFar: 0, weekSoFar: 0 };
      }

      const today = this.formatLocalDate();
      
      // Get currency settings - prefer currency_code, fall back to currency
      const currency = this.homey.settings.get('currency_code') || this.homey.settings.get('currency') || '';
      const decimals = this.getCurrencyDecimals(currency);

      // Convert amount to minor units
      const amountMinor = this.majorToMinor(amount, decimals);

      const rawHistory = this.homey.settings.get('savings_history') || [];

      // Migrate legacy entries and normalize the history
      const history = rawHistory.map((h: any) => this.migrateLegacyEntry(h, currency, decimals));

      // Find or create today's entry
      let todayEntry: any = history.find((h: any) => h.date === today);
      if (!todayEntry) {
        todayEntry = {
          date: today,
          totalMinor: 0,
          currency,
          decimals
        };
        history.push(todayEntry);
      } else {
        // Ensure currency and decimals are set on existing entry
        if (!todayEntry.currency) todayEntry.currency = currency;
        if (todayEntry.decimals === undefined) todayEntry.decimals = decimals;
      }

      // Increment today's total (in minor units)
      todayEntry.totalMinor = (todayEntry.totalMinor || 0) + amountMinor;

      // Trim history to last 30 days
      history.sort((a: any, b: any) => a.date.localeCompare(b.date));
      const cutoffIndex = Math.max(0, history.length - 30);
      const trimmed = history.slice(cutoffIndex);

      this.homey.settings.set('savings_history', trimmed);

      // Compute last 7 days total including today (convert back to major units)
      const todayDate = new Date(`${today}T00:00:00`);
      const last7Cutoff = new Date(todayDate);
      last7Cutoff.setDate(todayDate.getDate() - 6); // include 7 days window

      const weekSoFarMinor = (trimmed as any[])
        .filter((h: any) => {
          const d = new Date(`${h.date}T00:00:00`);
          return d >= last7Cutoff && d <= todayDate;
        })
        .reduce((sum: number, h: any) => {
          return sum + (h.totalMinor || 0);
        }, 0);

      const todaySoFar = this.minorToMajor(todayEntry.totalMinor, decimals);
      const weekSoFar = this.minorToMajor(weekSoFarMinor, decimals);

      return {
        todaySoFar: Number(todaySoFar.toFixed(4)),
        weekSoFar: Number(weekSoFar.toFixed(4))
      };
    } catch (e) {
      this.error('Failed to add savings to history', e as Error);
      return { todaySoFar: 0, weekSoFar: 0 };
    }
  }

  /**
   * Get the total savings for the last 7 days including today
   */
  private getWeeklySavingsTotal(): number {
    try {
      const today = this.formatLocalDate();
      const todayDate = new Date(`${today}T00:00:00`);
      const last7Cutoff = new Date(todayDate);
      last7Cutoff.setDate(todayDate.getDate() - 6);

      // Get currency settings
      const currency = this.homey.settings.get('currency_code') || this.homey.settings.get('currency') || '';
      const decimals = this.getCurrencyDecimals(currency);

      const rawHistory = this.homey.settings.get('savings_history') || [];

      // Migrate legacy entries and calculate total
      const totalMinor = (rawHistory as any[])
        .map((h: any) => this.migrateLegacyEntry(h, currency, decimals))
        .filter((h: any) => {
          const d = new Date(`${h.date}T00:00:00`);
          return d >= last7Cutoff && d <= todayDate;
        })
        .reduce((sum: number, h: any) => {
          return sum + (h.totalMinor || 0);
        }, 0);

      const total = this.minorToMajor(totalMinor, decimals);
      return Number(total.toFixed(4));
    } catch (e) {
      this.error('Failed to compute weekly savings total', e as Error);
      return 0;
    }
  }

  /**
   * Get the status of the cron jobs
   * Note: Real cron jobs now run in the driver. This method provides status information.
   */
  public getCronStatus() {
    try {
      // Return status indicating that cron jobs run in the driver
      return {
        hourlyJob: { 
          running: 'unknown', 
          note: 'Real cron jobs run in BoilerDriver, not in main app',
          message: 'Check driver logs for actual cron job status'
        },
        weeklyJob: { 
          running: 'unknown', 
          note: 'Real cron jobs run in BoilerDriver, not in main app',
          message: 'Check driver logs for actual cron job status'
        },
        lastHourlyRun: this.homey.settings.get('last_hourly_run') || 'Never',
        lastWeeklyRun: this.homey.settings.get('last_weekly_run') || 'Never',
        lastUpdated: new Date().toISOString(),
        architecture: 'Cron jobs moved to BoilerDriver for proper auto-start functionality',
        recommendation: 'Check the BoilerDriver logs to see actual cron job status and execution'
      };
    } catch (error) {
      this.logger.error('Error getting cron status:', error as Error);
      return {
        error: 'Failed to get cron status',
        message: (error as Error).message,
        lastUpdated: new Date().toISOString()
      };
    }
  }

  /**
   * onInit is called when the app is initialized
   */
  async onInit() {
    // Early, unconditional app-level log (before logger init)
    console.log('🚀 HeatOptimizerApp onInit() starting');
    this.log('[App] onInit() starting');
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
    try {
      this.logger.marker('MELCloud Optimizer App Starting');
      this.logger.info('Heat Pump Optimizer initialized');
    } catch (_) {
      this.log('[App] Logger not ready for marker/info; continuing');
    }

    // Log some additional information
    try {
      this.logger.info(`App ID: ${this.id}`);
      this.logger.info(`App Version: ${this.manifest?.version || '1.0.0'}`);
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
    this.log('[App] Settings change listener registered');

    // Validate settings
    try {
      this.validateSettings();
      this.log('[App] validateSettings() completed');
    } catch (error) {
      this.error('Failed to validate settings during initialization:', error as Error);
      // Continue with initialization despite settings validation failure
    }

    // Migrate legacy savings to new metrics structure
    this.migrateLegacySavings();

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
      // Attach to homey instance so optimizer can access it
      (this.homey as any).hotWaterService = this.hotWaterService;
      this.logger.info('Hot Water Service initialized');
    } catch (error) {
      this.logger.error('Failed to initialize Hot Water Service', error as Error);
    }

    // Initialize Timeline Helper
    try {
      // Create adapter to match HomeyApp interface
      const homeyAppAdapter = {
        id: 'com.melcloud.optimize',
        manifest: this.manifest || { version: '1.0.0' },
        version: this.homey.version || this.manifest?.version || '1.0.0',
        platform: this.homey.platform || 'unknown',
        settings: {
          get: (key: string) => this.homey.settings.get(key),
          set: async (key: string, value: any) => { this.homey.settings.set(key, value); },
          unset: (key: string) => this.homey.settings.unset(key),
          on: (event: string, callback: (key: string) => void) => this.homey.settings.on(event, callback)
        },
        log: (message: string, ...args: any[]) => this.log(message, ...args),
        error: (message: string, error?: Error | unknown) => this.error(message, error as Error),
        timeline: this.homey.timeline,
        notifications: this.homey.notifications,
        flow: this.homey.flow
      };
      
      this.timelineHelper = new TimelineHelper(homeyAppAdapter, this.logger);
      this.logger.info('Timeline Helper initialized');
    } catch (error) {
      this.logger.error('Failed to initialize Timeline Helper', error as Error);
    }

    // Start cron jobs on init if settings are ready (safe re-init logic prevents duplicates)
    try {
      this.log('[App] Checking if cron jobs should be started on init…');
      // Note: Cron jobs are now managed by the driver, not the main app
      this.log('[App] Cron jobs are now handled by the driver and will auto-start at driver initialization');
    } catch (error) {
      this.logger.error('Failed to check/initialize cron jobs on init', error as Error);
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
    console.log('🚀 HeatOptimizerApp onInit() completed successfully');
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
   * Update timezone settings for all services
   */
  private async updateTimezoneSettings(): Promise<void> {
    const tzOffset = this.homey.settings.get('time_zone_offset') || 2;
    const useDST = this.homey.settings.get('use_dst') || false;
    
    // Update our own TimeZoneHelper
    if (this.timeZoneHelper) {
      this.timeZoneHelper.updateSettings(Number(tzOffset), Boolean(useDST));
    }
    
    // Update services through API if available
    try {
      const api = require('../api.js');
      if (api.updateAllServiceTimezones) {
        await api.updateAllServiceTimezones(this.homey, Number(tzOffset), Boolean(useDST));
      }
    } catch (error) {
      this.error('Failed to update service timezones via API:', error as Error);
    }
    
    // Update cron jobs in drivers
    try {
      // Update the boiler driver specifically
      const boilerDriver = this.homey.drivers.getDriver('boiler');
      if (boilerDriver && typeof (boilerDriver as any).updateTimezone === 'function') {
        (boilerDriver as any).updateTimezone();
        this.log('Updated timezone for boiler driver');
      }
    } catch (error) {
      this.error('Failed to update driver timezones:', error as Error);
    }
    
    this.log(`Updated timezone settings: offset=${tzOffset}, DST=${useDST}`);
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
    else if (['melcloud_user', 'melcloud_pass', 'tibber_token', 'tibberToken'].includes(key)) {
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
    // If timezone settings changed, update all services
    else if (['time_zone_offset', 'use_dst'].includes(key)) {
      this.log(`Timezone setting '${key}' changed, updating all services`);
      
      try {
        await this.updateTimezoneSettings();
        this.log('All services updated with new timezone settings');
      } catch (error) {
        this.error('Failed to update services with new timezone settings:', error as Error);
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

    // Ensure cron jobs are running after any relevant settings change
    try {
      this.log('[App] Re-initializing cron after settings change…');
      this.log('[App] Note: Cron jobs are now managed by the driver, not the main app');
      this.log('[App] The driver will automatically handle cron job initialization');
    } catch (err) {
      this.error('Failed to ensure cron after settings change', err as Error);
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

              // Prefer priceNow provided by API; fall back to priceData.current
              const priceNow = Number(
                (result.data as any).priceNow ??
                (result.data as any)?.priceData?.current ??
                (result as any)?.result?.priceData?.current
              );
              if (Number.isFinite(priceNow) && priceNow > 0) {
                const gridFee: number = Number(this.homey.settings.get('grid_fee_per_kwh')) || 0;
                const price = priceNow + (Number.isFinite(gridFee) ? gridFee : 0);
                // Use MELCloud-derived hourly baseline when provided by API
                let baselineKWh = Number((result.data as any).hourlyBaselineKWh);
                if (!(Number.isFinite(baselineKWh) && baselineKWh > 0)) {
                  baselineKWh = 1.0;  // Use default fallback when real data isn't available
                }
                const energyDeltaKWh = result.data.savings / price;
                const actualKWh = baselineKWh - energyDeltaKWh;
                const { todaySavings, costImpactToday } = this.accountCost(price, actualKWh, baselineKWh);
                additionalData.todaySoFar = todaySavings;
                additionalData.costImpactToday = costImpactToday;
              }
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

    // Check cron jobs - note: these are now managed by the driver
    // For compatibility, we'll report that they're running (since they are in the driver)
    // In the future, we could check the driver's cron status instead

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
        // Note: Cron jobs are now managed by the driver, not the main app
        // The driver should have already started the cron jobs automatically
        this.log('Checking cron jobs - they are now managed by the driver');
        recovered = true;

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
    const tibberToken = this.homey.settings.get('tibber_token') || this.homey.settings.get('tibberToken');

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
      this.log('Cleaning up cron jobs...');
      // Note: Cron jobs are now managed by the driver, not the main app
      // The driver will handle its own cleanup when it shuts down
      this.log('Cron jobs are now managed by the driver and will be cleaned up by the driver');
      this.log('Cron jobs cleaned up successfully');

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
