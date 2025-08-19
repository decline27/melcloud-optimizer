import { ServiceBase } from './base/service-base';
import { ConfigurationService } from './configuration-service';
import { HomeyLogger } from '../util/logger';
import { CronJob } from 'cron';

export interface ScheduleConfig {
  enabled: boolean;
  hourlyOptimization: {
    enabled: boolean;
    cronPattern: string; // e.g., '0 5 * * * *' (every hour at minute 5)
    timeZone: string;
    useDST: boolean;
  };
  weeklyCalibration: {
    enabled: boolean;
    cronPattern: string; // e.g., '0 5 2 * * 0' (Sundays at 2:05 AM)
    timeZone: string;
    useDST: boolean;
  };
  manualTriggers: {
    enabled: boolean;
    maxConcurrentJobs: number;
  };
}

export interface ScheduleStatus {
  hourlyJob: {
    running: boolean;
    nextRun: string | null;
    lastRun: string | null;
    cronPattern: string;
    timeZone: string;
    executionCount: number;
  };
  weeklyJob: {
    running: boolean;
    nextRun: string | null;
    lastRun: string | null;
    cronPattern: string;
    timeZone: string;
    executionCount: number;
  };
  manualJobs: {
    active: number;
    completed: number;
    failed: number;
  };
  lastUpdated: string;
}

export interface ScheduleExecutionResult {
  jobType: 'hourly' | 'weekly' | 'manual';
  executionId: string;
  startTime: string;
  endTime?: string;
  success: boolean;
  result?: any;
  error?: string;
  duration?: number;
}

export interface ManualTriggerOptions {
  jobType: 'hourly' | 'weekly';
  force?: boolean; // Override cooldown periods
  reason?: string; // Reason for manual trigger
}

export class ScheduleManagementService extends ServiceBase {
  private config: ScheduleConfig | null = null;
  private hourlyJob: CronJob | null = null;
  private weeklyJob: CronJob | null = null;
  private executionHistory: ScheduleExecutionResult[] = [];
  private manualJobsActive = 0;
  private readonly maxHistoryLength = 50;
  
  // Callbacks for actual optimization execution
  private hourlyOptimizationCallback: (() => Promise<any>) | null = null;
  private weeklyCalibrationCallback: (() => Promise<any>) | null = null;
  private timelineCallback: ((eventType: string, data: any) => Promise<void>) | null = null;

  constructor(
    private homey: any,
    private configService: ConfigurationService,
    logger: HomeyLogger
  ) {
    super(logger);
    this.initializeService();
  }

  private async initializeService(): Promise<void> {
    try {
      await this.loadConfiguration();
      this.logInfo('Schedule management service initialized', {
        hourlyEnabled: this.config?.hourlyOptimization.enabled,
        weeklyEnabled: this.config?.weeklyCalibration.enabled,
        manualEnabled: this.config?.manualTriggers.enabled
      });
    } catch (error) {
      this.logError(error as Error, { context: 'schedule management initialization' });
      throw this.createServiceError(
        'Failed to initialize schedule management service',
        'SCHEDULE_INIT_ERROR',
        true
      );
    }
  }

  private async loadConfiguration(): Promise<void> {
    try {
      // Load configuration from homey settings directly
      this.config = {
        enabled: this.homey.settings.get('schedule_enabled') ?? true,
        hourlyOptimization: {
          enabled: this.homey.settings.get('hourly_schedule_enabled') ?? true,
          cronPattern: this.homey.settings.get('hourly_cron_pattern') || '0 5 * * * *',
          timeZone: this.homey.settings.get('schedule_timezone') || 'Europe/Oslo',
          useDST: this.homey.settings.get('schedule_use_dst') ?? true
        },
        weeklyCalibration: {
          enabled: this.homey.settings.get('weekly_schedule_enabled') ?? true,
          cronPattern: this.homey.settings.get('weekly_cron_pattern') || '0 5 2 * * 0',
          timeZone: this.homey.settings.get('schedule_timezone') || 'Europe/Oslo',
          useDST: this.homey.settings.get('schedule_use_dst') ?? true
        },
        manualTriggers: {
          enabled: this.homey.settings.get('manual_triggers_enabled') ?? true,
          maxConcurrentJobs: this.homey.settings.get('max_concurrent_manual_jobs') || 3
        }
      };

      // Save the configuration to ensure all defaults are stored
      await this.saveConfiguration();
    } catch (error) {
      this.logError(error as Error, { context: 'schedule configuration loading' });
      throw error;
    }
  }

  private async saveConfiguration(): Promise<void> {
    if (!this.config) return;

    try {
      this.homey.settings.set('schedule_enabled', this.config.enabled);
      this.homey.settings.set('hourly_schedule_enabled', this.config.hourlyOptimization.enabled);
      this.homey.settings.set('hourly_cron_pattern', this.config.hourlyOptimization.cronPattern);
      this.homey.settings.set('weekly_schedule_enabled', this.config.weeklyCalibration.enabled);
      this.homey.settings.set('weekly_cron_pattern', this.config.weeklyCalibration.cronPattern);
      this.homey.settings.set('schedule_timezone', this.config.hourlyOptimization.timeZone);
      this.homey.settings.set('schedule_use_dst', this.config.hourlyOptimization.useDST);
      this.homey.settings.set('manual_triggers_enabled', this.config.manualTriggers.enabled);
      this.homey.settings.set('max_concurrent_manual_jobs', this.config.manualTriggers.maxConcurrentJobs);
    } catch (error) {
      this.logError(error as Error, { context: 'schedule configuration saving' });
      throw error;
    }
  }

  /**
   * Set callback functions for optimization execution
   */
  setOptimizationCallbacks(
    hourlyCallback: () => Promise<any>,
    weeklyCallback: () => Promise<any>,
    timelineCallback?: (eventType: string, data: any) => Promise<void>
  ): void {
    this.hourlyOptimizationCallback = hourlyCallback;
    this.weeklyCalibrationCallback = weeklyCallback;
    this.timelineCallback = timelineCallback || null;
    this.logInfo('Optimization callbacks configured');
  }

  /**
   * Start all scheduled jobs
   */
  async startScheduledJobs(): Promise<void> {
    if (!this.config?.enabled) {
      this.logInfo('Schedule management disabled - skipping job start');
      return;
    }

    return this.executeWithRetry(async () => {
      await this.startHourlyJob();
      await this.startWeeklyJob();
      this.logInfo('All scheduled jobs started successfully');
    });
  }

  /**
   * Stop all scheduled jobs
   */
  async stopScheduledJobs(): Promise<void> {
    return this.executeWithRetry(async () => {
      if (this.hourlyJob) {
        this.hourlyJob.stop();
        this.logInfo('Hourly job stopped');
      }

      if (this.weeklyJob) {
        this.weeklyJob.stop();
        this.logInfo('Weekly job stopped');
      }

      this.logInfo('All scheduled jobs stopped');
    });
  }

  /**
   * Start the hourly optimization job
   */
  private async startHourlyJob(): Promise<void> {
    if (!this.config?.hourlyOptimization.enabled || !this.hourlyOptimizationCallback) {
      this.logInfo('Hourly optimization disabled or callback not set');
      return;
    }

    try {
      // Stop existing job if running
      if (this.hourlyJob) {
        this.hourlyJob.stop();
      }

      const timeZone = this.config.hourlyOptimization.timeZone;
      const cronPattern = this.config.hourlyOptimization.cronPattern;

      this.logInfo(`Creating hourly job with pattern: ${cronPattern} (${timeZone})`);

      this.hourlyJob = new CronJob(
        cronPattern,
        async () => {
          await this.executeScheduledJob('hourly', this.hourlyOptimizationCallback!);
        },
        null,
        true, // Start immediately
        timeZone
      );

      this.logInfo('Hourly optimization job started', {
        nextRun: this.hourlyJob.nextDate().toString(),
        pattern: cronPattern,
        timeZone
      });
    } catch (error) {
      this.logError(error as Error, { context: 'hourly job start' });
      throw this.createServiceError(
        'Failed to start hourly optimization job',
        'HOURLY_JOB_START_ERROR',
        true
      );
    }
  }

  /**
   * Start the weekly calibration job
   */
  private async startWeeklyJob(): Promise<void> {
    if (!this.config?.weeklyCalibration.enabled || !this.weeklyCalibrationCallback) {
      this.logInfo('Weekly calibration disabled or callback not set');
      return;
    }

    try {
      // Stop existing job if running
      if (this.weeklyJob) {
        this.weeklyJob.stop();
      }

      const timeZone = this.config.weeklyCalibration.timeZone;
      const cronPattern = this.config.weeklyCalibration.cronPattern;

      this.logInfo(`Creating weekly job with pattern: ${cronPattern} (${timeZone})`);

      this.weeklyJob = new CronJob(
        cronPattern,
        async () => {
          await this.executeScheduledJob('weekly', this.weeklyCalibrationCallback!);
        },
        null,
        true, // Start immediately
        timeZone
      );

      this.logInfo('Weekly calibration job started', {
        nextRun: this.weeklyJob.nextDate().toString(),
        pattern: cronPattern,
        timeZone
      });
    } catch (error) {
      this.logError(error as Error, { context: 'weekly job start' });
      throw this.createServiceError(
        'Failed to start weekly calibration job',
        'WEEKLY_JOB_START_ERROR',
        true
      );
    }
  }

  /**
   * Execute a scheduled job with error handling and logging
   */
  private async executeScheduledJob(
    jobType: 'hourly' | 'weekly',
    callback: () => Promise<any>
  ): Promise<void> {
    const executionId = `${jobType}_${Date.now()}`;
    const startTime = new Date().toISOString();

    this.logInfo(`Starting ${jobType} job execution`, { executionId });

    // Add timeline entry if callback is available
    if (this.timelineCallback) {
      try {
        await this.timelineCallback(
          jobType === 'hourly' ? 'HOURLY_OPTIMIZATION' : 'WEEKLY_CALIBRATION',
          { executionId, automatic: true }
        );
      } catch (error) {
        this.logError(error as Error, { context: 'timeline entry creation' });
      }
    }

    const executionResult: ScheduleExecutionResult = {
      jobType,
      executionId,
      startTime,
      success: false
    };

    try {
      const result = await callback();
      
      executionResult.success = true;
      executionResult.result = result;
      executionResult.endTime = new Date().toISOString();
      executionResult.duration = Date.now() - new Date(startTime).getTime();

      this.logInfo(`${jobType} job completed successfully`, {
        executionId,
        duration: executionResult.duration
      });

      // Update last run time in configuration
      await this.updateLastRunTime(jobType, startTime);

    } catch (error) {
      executionResult.success = false;
      executionResult.error = (error as Error).message;
      executionResult.endTime = new Date().toISOString();
      executionResult.duration = Date.now() - new Date(startTime).getTime();

      this.logError(error as Error, {
        context: `${jobType} job execution`,
        executionId
      });
    }

    // Store execution result
    this.addExecutionHistory(executionResult);
  }

  /**
   * Manually trigger an optimization job
   */
  async triggerManualOptimization(options: ManualTriggerOptions): Promise<ScheduleExecutionResult> {
    if (!this.config?.manualTriggers.enabled) {
      throw this.createServiceError(
        'Manual triggers are disabled',
        'MANUAL_TRIGGER_DISABLED',
        false
      );
    }

    if (this.manualJobsActive >= this.config.manualTriggers.maxConcurrentJobs) {
      throw this.createServiceError(
        'Maximum concurrent manual jobs reached',
        'MAX_MANUAL_JOBS_REACHED',
        true
      );
    }

    return this.executeWithRetry(async () => {
      const callback = options.jobType === 'hourly' 
        ? this.hourlyOptimizationCallback 
        : this.weeklyCalibrationCallback;

      if (!callback) {
        throw this.createServiceError(
          `No callback configured for ${options.jobType} optimization`,
          'CALLBACK_NOT_SET',
          false
        );
      }

      this.manualJobsActive++;

      const executionId = `manual_${options.jobType}_${Date.now()}`;
      const startTime = new Date().toISOString();

      this.logInfo(`Starting manual ${options.jobType} optimization`, {
        executionId,
        reason: options.reason,
        force: options.force
      });

      // Add timeline entry
      if (this.timelineCallback) {
        try {
          await this.timelineCallback(
            options.jobType === 'hourly' ? 'HOURLY_OPTIMIZATION' : 'WEEKLY_CALIBRATION',
            { 
              executionId, 
              automatic: false, 
              manual: true,
              reason: options.reason
            }
          );
        } catch (error) {
          this.logError(error as Error, { context: 'manual timeline entry creation' });
        }
      }

      const executionResult: ScheduleExecutionResult = {
        jobType: 'manual',
        executionId,
        startTime,
        success: false
      };

      try {
        const result = await callback();
        
        executionResult.success = true;
        executionResult.result = result;
        executionResult.endTime = new Date().toISOString();
        executionResult.duration = Date.now() - new Date(startTime).getTime();

        this.logInfo(`Manual ${options.jobType} optimization completed`, {
          executionId,
          duration: executionResult.duration
        });

      } catch (error) {
        executionResult.success = false;
        executionResult.error = (error as Error).message;
        executionResult.endTime = new Date().toISOString();
        executionResult.duration = Date.now() - new Date(startTime).getTime();

        this.logError(error as Error, {
          context: `manual ${options.jobType} optimization`,
          executionId
        });
      } finally {
        this.manualJobsActive = Math.max(0, this.manualJobsActive - 1);
      }

      this.addExecutionHistory(executionResult);
      return executionResult;
    });
  }

  /**
   * Get current schedule status
   */
  async getScheduleStatus(): Promise<ScheduleStatus> {
    const hourlyStats = this.getJobStatistics('hourly');
    const weeklyStats = this.getJobStatistics('weekly');
    const manualStats = this.getJobStatistics('manual');

    return {
      hourlyJob: {
        running: this.hourlyJob?.running || false,
        nextRun: this.hourlyJob?.nextDate()?.toString() || null,
        lastRun: this.getLastRunTime('hourly'),
        cronPattern: this.config?.hourlyOptimization.cronPattern || '',
        timeZone: this.config?.hourlyOptimization.timeZone || '',
        executionCount: hourlyStats.total
      },
      weeklyJob: {
        running: this.weeklyJob?.running || false,
        nextRun: this.weeklyJob?.nextDate()?.toString() || null,
        lastRun: this.getLastRunTime('weekly'),
        cronPattern: this.config?.weeklyCalibration.cronPattern || '',
        timeZone: this.config?.weeklyCalibration.timeZone || '',
        executionCount: weeklyStats.total
      },
      manualJobs: {
        active: this.manualJobsActive,
        completed: manualStats.successful,
        failed: manualStats.failed
      },
      lastUpdated: new Date().toISOString()
    };
  }

  /**
   * Update schedule configuration
   */
  async updateScheduleConfiguration(newConfig: Partial<ScheduleConfig>): Promise<void> {
    return this.executeWithRetry(async () => {
      if (!this.config) {
        await this.loadConfiguration();
      }

      // Merge new configuration
      this.config = {
        ...this.config!,
        ...newConfig
      };

      // Save to homey settings
      await this.saveConfiguration();

      // Restart jobs if configuration changed
      await this.stopScheduledJobs();
      if (this.config.enabled) {
        await this.startScheduledJobs();
      }

      this.logInfo('Schedule configuration updated', { newConfig });
    });
  }

  /**
   * Get execution history
   */
  getExecutionHistory(): ScheduleExecutionResult[] {
    return [...this.executionHistory];
  }

  /**
   * Get job statistics
   */
  private getJobStatistics(jobType: 'hourly' | 'weekly' | 'manual'): {
    total: number;
    successful: number;
    failed: number;
    avgDuration: number;
  } {
    const relevantExecutions = this.executionHistory.filter(
      exec => exec.jobType === jobType || (jobType === 'manual' && exec.jobType === 'manual')
    );

    const successful = relevantExecutions.filter(exec => exec.success).length;
    const failed = relevantExecutions.filter(exec => !exec.success).length;
    const totalDuration = relevantExecutions
      .filter(exec => exec.duration)
      .reduce((sum, exec) => sum + (exec.duration || 0), 0);
    const avgDuration = relevantExecutions.length > 0 ? totalDuration / relevantExecutions.length : 0;

    return {
      total: relevantExecutions.length,
      successful,
      failed,
      avgDuration: Math.round(avgDuration)
    };
  }

  /**
   * Add execution result to history
   */
  private addExecutionHistory(result: ScheduleExecutionResult): void {
    this.executionHistory.push(result);

    // Keep only the most recent executions
    if (this.executionHistory.length > this.maxHistoryLength) {
      this.executionHistory = this.executionHistory.slice(-this.maxHistoryLength);
    }
  }

  /**
   * Update last run time for a job type
   */
  private async updateLastRunTime(jobType: 'hourly' | 'weekly', timestamp: string): Promise<void> {
    try {
      const settingKey = jobType === 'hourly' ? 'last_hourly_run' : 'last_weekly_run';
      this.homey.settings.set(settingKey, timestamp);
    } catch (error) {
      this.logError(error as Error, { context: 'last run time update', jobType });
    }
  }

  /**
   * Get last run time for a job type
   */
  private getLastRunTime(jobType: 'hourly' | 'weekly'): string | null {
    const lastExecution = this.executionHistory
      .filter(exec => exec.jobType === jobType && exec.success)
      .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())[0];

    return lastExecution?.startTime || null;
  }

  /**
   * Force restart all scheduled jobs
   */
  async restartScheduledJobs(): Promise<void> {
    return this.executeWithRetry(async () => {
      this.logInfo('Force restarting all scheduled jobs');
      
      await this.stopScheduledJobs();
      
      // Wait a moment for cleanup
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      await this.startScheduledJobs();
      
      this.logInfo('All scheduled jobs restarted successfully');
    });
  }

  /**
   * Get service health status
   */
  async getServiceHealth(): Promise<{
    status: 'healthy' | 'degraded' | 'error';
    details: {
      configLoaded: boolean;
      hourlyJobRunning: boolean;
      weeklyJobRunning: boolean;
      recentFailures: number;
      lastError?: string;
    };
  }> {
    const recentFailures = this.executionHistory
      .filter(exec => !exec.success && new Date(exec.startTime).getTime() > Date.now() - 24 * 60 * 60 * 1000)
      .length;

    const lastError = this.executionHistory
      .filter(exec => !exec.success)
      .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())[0]?.error;

    const details = {
      configLoaded: this.config !== null,
      hourlyJobRunning: this.hourlyJob?.running || false,
      weeklyJobRunning: this.weeklyJob?.running || false,
      recentFailures,
      lastError
    };

    let status: 'healthy' | 'degraded' | 'error' = 'healthy';

    if (!details.configLoaded || recentFailures > 5) {
      status = 'error';
    } else if (recentFailures > 2 || (!details.hourlyJobRunning && this.config?.hourlyOptimization.enabled)) {
      status = 'degraded';
    }

    return { status, details };
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    this.logInfo('Shutting down schedule management service');
    
    await this.stopScheduledJobs();
    
    // Clear callbacks
    this.hourlyOptimizationCallback = null;
    this.weeklyCalibrationCallback = null;
    this.timelineCallback = null;
    
    this.logInfo('Schedule management service shutdown complete');
  }
}
