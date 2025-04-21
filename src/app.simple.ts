import { App } from 'homey';
import { CronJob } from 'cron'; // Import CronJob

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
}

/**
 * MELCloud Heat Pump Optimizer App
 * 
 * This app optimizes heat pump operation based on electricity prices and thermal models
 */
export default class HeatOptimizerApp extends App {
  private hourlyJob?: CronJob;
  private weeklyJob?: CronJob;

  /**
   * onInit is called when the app is initialized
   */
  async onInit() {
    // Log app initialization
    this.log('===== MELCloud Optimizer App Starting =====');
    this.log('Heat Pump Optimizer initialized');

    // Register settings change listener
    this.homey.settings.on('set', this.onSettingsChanged.bind(this));
    this.log('Settings change listener registered');

    // Initialize cron jobs
    this.initializeCronJobs();

    // Test logging
    this.testLogging();

    // Log app initialization complete
    this.log('MELCloud Optimizer App initialized successfully');
  }

  /**
   * Initialize cron jobs for hourly optimization and weekly calibration
   */
  private initializeCronJobs() {
    this.log('Initializing cron jobs');

    // Hourly job - runs at minute 5 of every hour
    this.hourlyJob = new CronJob('0 5 * * * *', async () => {
      this.log('Hourly cron job triggered');
      try {
        await this.runHourlyOptimizer();
      } catch (err) {
        this.error('Error in hourly cron job', err as Error);
      }
    });

    // Weekly job - runs at 2:05 AM on Sundays
    this.weeklyJob = new CronJob('0 5 2 * * 0', async () => {
      this.log('Weekly cron job triggered');
      try {
        await this.runWeeklyCalibration();
      } catch (err) {
        this.error('Error in weekly cron job', err as Error);
      }
    });

    // Start the cron jobs
    this.hourlyJob.start();
    this.weeklyJob.start();
    this.log('Cron jobs started');
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
    else if (['melcloud_user', 'melcloud_pass', 'tibber_token', 'openai_api_key'].includes(key)) {
      this.log(`Credential setting '${key}' changed, re-validating settings`);
      // Re-run validation on credential change
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
  private testLogging() {
    // Direct log using Homey's built-in logging
    this.log('===== TEST LOGGING STARTED =====');
    this.log('This is a test debug message');
    this.log('This is a test info message');
    this.log('This is a test warning message');
    this.error('This is a test error message');
    this.log('===== TEST LOGGING COMPLETED =====');
  }

  /**
   * Run the hourly optimization process
   */
  private async runHourlyOptimizer() {
    this.log('Starting hourly optimization');
    this.log('===== HOURLY OPTIMIZATION STARTED =====');

    try {
      // Placeholder for actual optimization logic
      this.log('Hourly optimization logic would run here');
      
      // Simulate some work
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      this.log('===== HOURLY OPTIMIZATION COMPLETED SUCCESSFULLY =====');
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
    }
  }

  /**
   * Run the weekly calibration process
   */
  private async runWeeklyCalibration() {
    this.log('Starting weekly calibration');
    this.log('===== WEEKLY CALIBRATION STARTED =====');

    try {
      // Placeholder for actual calibration logic
      this.log('Weekly calibration logic would run here');
      
      // Simulate some work
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      this.log('===== WEEKLY CALIBRATION COMPLETED SUCCESSFULLY =====');
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
    }
  }

  /**
   * Validate settings
   */
  private validateSettings() {
    this.log('Validating settings');
    // Placeholder for actual validation logic
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
