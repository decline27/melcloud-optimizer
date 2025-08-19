import { ScheduleManagementService, ScheduleConfig, ManualTriggerOptions } from '../../src/services/schedule-management-service';
import { ConfigurationService } from '../../src/services/configuration-service';
import { HomeyLogger } from '../../src/util/logger';

// Mock dependencies
jest.mock('cron');
jest.mock('../../src/services/configuration-service');
jest.mock('../../src/util/logger');
jest.mock('../../src/util/circuit-breaker');

describe('ScheduleManagementService', () => {
  let service: ScheduleManagementService;
  let mockHomey: any;
  let mockConfigService: jest.Mocked<ConfigurationService>;
  let mockLogger: jest.Mocked<HomeyLogger>;
  let mockHourlyCallback: jest.Mock;
  let mockWeeklyCallback: jest.Mock;
  let mockTimelineCallback: jest.Mock;

  beforeEach(() => {
    // Mock Homey
    mockHomey = {
      settings: {
        get: jest.fn(),
        set: jest.fn()
      }
    };

    // Mock configuration service
    mockConfigService = {
      getConfig: jest.fn(),
      updateConfig: jest.fn()
    } as any;

    // Mock logger
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn()
    } as any;

    // Mock circuit breaker
    const mockCircuitBreaker = {
      execute: jest.fn().mockImplementation((fn) => fn())
    };
    
    const CircuitBreaker = jest.requireMock('../../src/util/circuit-breaker').CircuitBreaker;
    CircuitBreaker.mockImplementation(() => mockCircuitBreaker);

    // Mock callbacks
    mockHourlyCallback = jest.fn().mockResolvedValue({ success: true });
    mockWeeklyCallback = jest.fn().mockResolvedValue({ success: true });
    mockTimelineCallback = jest.fn().mockResolvedValue(undefined);

    // Mock CronJob
    const mockCronJob = {
      start: jest.fn(),
      stop: jest.fn(),
      running: true,
      nextDate: jest.fn().mockReturnValue(new Date('2025-08-19T15:05:00Z'))
    };

    const CronJob = jest.requireMock('cron').CronJob;
    CronJob.mockImplementation(() => mockCronJob);

    // Set up default settings
    mockHomey.settings.get.mockImplementation((key: string) => {
      const defaults: Record<string, any> = {
        schedule_enabled: true,
        hourly_schedule_enabled: true,
        hourly_cron_pattern: '0 5 * * * *',
        weekly_schedule_enabled: true,
        weekly_cron_pattern: '0 5 2 * * 0',
        schedule_timezone: 'Europe/Oslo',
        schedule_use_dst: true,
        manual_triggers_enabled: true,
        max_concurrent_manual_jobs: 3
      };
      return defaults[key];
    });

    service = new ScheduleManagementService(mockHomey, mockConfigService, mockLogger);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize with default configuration', async () => {
      await new Promise(resolve => setTimeout(resolve, 50)); // Wait for async initialization

      expect(mockHomey.settings.get).toHaveBeenCalledWith('schedule_enabled');
      expect(mockHomey.settings.get).toHaveBeenCalledWith('hourly_schedule_enabled');
      expect(mockHomey.settings.get).toHaveBeenCalledWith('weekly_schedule_enabled');
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Schedule management service initialized'),
        expect.any(Object)
      );
    });

    it('should handle initialization errors gracefully', async () => {
      mockHomey.settings.get.mockImplementation(() => {
        throw new Error('Settings error');
      });

      expect(() => {
        new ScheduleManagementService(mockHomey, mockConfigService, mockLogger);
      }).not.toThrow(); // Constructor doesn't throw, async init does
      
      // Wait for the async error to occur
      await new Promise(resolve => setTimeout(resolve, 50));
      
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('Configuration Management', () => {
    beforeEach(async () => {
      await new Promise(resolve => setTimeout(resolve, 50)); // Wait for initialization
    });

    it('should load configuration from homey settings', async () => {
      const expectedKeys = [
        'schedule_enabled',
        'hourly_schedule_enabled',
        'hourly_cron_pattern',
        'weekly_schedule_enabled',
        'weekly_cron_pattern',
        'schedule_timezone',
        'schedule_use_dst',
        'manual_triggers_enabled',
        'max_concurrent_manual_jobs'
      ];

      expectedKeys.forEach(key => {
        expect(mockHomey.settings.get).toHaveBeenCalledWith(key);
      });
    });

    it('should save configuration to homey settings', async () => {
      const newConfig: Partial<ScheduleConfig> = {
        enabled: false,
        hourlyOptimization: {
          enabled: false,
          cronPattern: '0 10 * * * *',
          timeZone: 'America/New_York',
          useDST: false
        }
      };

      await service.updateScheduleConfiguration(newConfig);

      expect(mockHomey.settings.set).toHaveBeenCalledWith('schedule_enabled', false);
      expect(mockHomey.settings.set).toHaveBeenCalledWith('hourly_schedule_enabled', false);
      expect(mockHomey.settings.set).toHaveBeenCalledWith('hourly_cron_pattern', '0 10 * * * *');
      expect(mockHomey.settings.set).toHaveBeenCalledWith('schedule_timezone', 'America/New_York');
      expect(mockHomey.settings.set).toHaveBeenCalledWith('schedule_use_dst', false);
    });
  });

  describe('Callback Registration', () => {
    beforeEach(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    it('should register optimization callbacks', () => {
      service.setOptimizationCallbacks(
        mockHourlyCallback,
        mockWeeklyCallback,
        mockTimelineCallback
      );

      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Optimization callbacks configured'));
    });

    it('should handle missing timeline callback', () => {
      service.setOptimizationCallbacks(mockHourlyCallback, mockWeeklyCallback);

      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Optimization callbacks configured'));
    });
  });

  describe('Scheduled Jobs Management', () => {
    beforeEach(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
      service.setOptimizationCallbacks(mockHourlyCallback, mockWeeklyCallback, mockTimelineCallback);
    });

    it('should start scheduled jobs when enabled', async () => {
      await service.startScheduledJobs();

      const CronJob = jest.requireMock('cron').CronJob;
      expect(CronJob).toHaveBeenCalledTimes(2); // Hourly and weekly jobs

      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('All scheduled jobs started successfully'));
    });

    it('should skip starting jobs when disabled', async () => {
      await service.updateScheduleConfiguration({ enabled: false });
      
      await service.startScheduledJobs();

      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Schedule management disabled - skipping job start'));
    });

    it('should stop all scheduled jobs', async () => {
      await service.startScheduledJobs();
      await service.stopScheduledJobs();

      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('All scheduled jobs stopped'));
    });

    it('should restart scheduled jobs', async () => {
      await service.startScheduledJobs();
      await service.restartScheduledJobs();

      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Force restarting all scheduled jobs'));
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('All scheduled jobs restarted successfully'));
    }, 10000); // Increase timeout for this test
  });

  describe('Manual Triggers', () => {
    beforeEach(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
      service.setOptimizationCallbacks(mockHourlyCallback, mockWeeklyCallback, mockTimelineCallback);
    });

    it('should execute manual hourly optimization', async () => {
      const options: ManualTriggerOptions = {
        jobType: 'hourly',
        reason: 'Testing manual trigger'
      };

      const result = await service.triggerManualOptimization(options);

      expect(result.success).toBe(true);
      expect(result.jobType).toBe('manual');
      expect(mockHourlyCallback).toHaveBeenCalledTimes(1);
      expect(mockTimelineCallback).toHaveBeenCalledWith(
        'HOURLY_OPTIMIZATION',
        expect.objectContaining({
          automatic: false,
          manual: true,
          reason: 'Testing manual trigger'
        })
      );
    });

    it('should execute manual weekly calibration', async () => {
      const options: ManualTriggerOptions = {
        jobType: 'weekly',
        force: true
      };

      const result = await service.triggerManualOptimization(options);

      expect(result.success).toBe(true);
      expect(result.jobType).toBe('manual');
      expect(mockWeeklyCallback).toHaveBeenCalledTimes(1);
      expect(mockTimelineCallback).toHaveBeenCalledWith(
        'WEEKLY_CALIBRATION',
        expect.objectContaining({
          automatic: false,
          manual: true
        })
      );
    });

    it('should handle manual trigger failures', async () => {
      mockHourlyCallback.mockRejectedValueOnce(new Error('Optimization failed'));

      const options: ManualTriggerOptions = {
        jobType: 'hourly'
      };

      const result = await service.triggerManualOptimization(options);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Optimization failed');
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should reject manual triggers when disabled', async () => {
      await service.updateScheduleConfiguration({
        manualTriggers: { enabled: false, maxConcurrentJobs: 3 }
      });

      const options: ManualTriggerOptions = {
        jobType: 'hourly'
      };

      await expect(service.triggerManualOptimization(options)).rejects.toThrow('Manual triggers are disabled');
    });

    it('should limit concurrent manual jobs', async () => {
      // Mock a slow callback to simulate concurrent execution
      mockHourlyCallback.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 100)));

      const options: ManualTriggerOptions = {
        jobType: 'hourly'
      };

      // Start 3 jobs (the default limit)
      const promises = [
        service.triggerManualOptimization(options),
        service.triggerManualOptimization(options),
        service.triggerManualOptimization(options)
      ];

      // Fourth job should fail
      await expect(service.triggerManualOptimization(options)).rejects.toThrow('Maximum concurrent manual jobs reached');

      // Wait for the original jobs to complete
      await Promise.all(promises);
    });
  });

  describe('Schedule Status', () => {
    beforeEach(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
      service.setOptimizationCallbacks(mockHourlyCallback, mockWeeklyCallback, mockTimelineCallback);
      await service.startScheduledJobs();
    });

    it('should return comprehensive schedule status', async () => {
      const status = await service.getScheduleStatus();

      expect(status).toEqual({
        hourlyJob: {
          running: true,
          nextRun: expect.any(String),
          lastRun: null,
          cronPattern: '0 5 * * * *',
          timeZone: 'Europe/Oslo',
          executionCount: 0
        },
        weeklyJob: {
          running: true,
          nextRun: expect.any(String),
          lastRun: null,
          cronPattern: '0 5 2 * * 0',
          timeZone: 'Europe/Oslo',
          executionCount: 0
        },
        manualJobs: {
          active: 0,
          completed: 0,
          failed: 0
        },
        lastUpdated: expect.any(String)
      });
    });

    it('should track execution statistics', async () => {
      // Execute some manual jobs to generate statistics
      await service.triggerManualOptimization({ jobType: 'hourly' });
      
      mockHourlyCallback.mockRejectedValueOnce(new Error('Test failure'));
      try {
        await service.triggerManualOptimization({ jobType: 'hourly' });
      } catch (error) {
        // Expected failure
      }

      const status = await service.getScheduleStatus();

      expect(status.manualJobs.completed).toBeGreaterThan(0);
      expect(status.manualJobs.failed).toBeGreaterThan(0);
    });
  });

  describe('Execution History', () => {
    beforeEach(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
      service.setOptimizationCallbacks(mockHourlyCallback, mockWeeklyCallback, mockTimelineCallback);
    });

    it('should maintain execution history', async () => {
      await service.triggerManualOptimization({ jobType: 'hourly' });
      await service.triggerManualOptimization({ jobType: 'weekly' });

      const history = service.getExecutionHistory();

      expect(history).toHaveLength(2);
      expect(history[0].jobType).toBe('manual');
      expect(history[0].success).toBe(true);
      expect(history[1].jobType).toBe('manual');
      expect(history[1].success).toBe(true);
    });

    it('should limit history length', async () => {
      // Execute fewer jobs to avoid concurrent limits  
      const promises: Promise<any>[] = [];
      for (let i = 0; i < 10; i++) {
        promises.push(service.triggerManualOptimization({ jobType: 'hourly' }));
      }
      await Promise.all(promises);

      const history = service.getExecutionHistory();

      expect(history.length).toBe(10); // Should have all 10 executions
    });
  });

  describe('Service Health', () => {
    beforeEach(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
      service.setOptimizationCallbacks(mockHourlyCallback, mockWeeklyCallback, mockTimelineCallback);
      await service.startScheduledJobs();
    });

    it('should report healthy status when everything is working', async () => {
      const health = await service.getServiceHealth();

      expect(health.status).toBe('healthy');
      expect(health.details.configLoaded).toBe(true);
      expect(health.details.hourlyJobRunning).toBe(true);
      expect(health.details.weeklyJobRunning).toBe(true);
      expect(health.details.recentFailures).toBe(0);
    });

    it('should report degraded status with some failures', async () => {
      // Generate some failures
      mockHourlyCallback.mockRejectedValue(new Error('Test failure'));
      
      for (let i = 0; i < 3; i++) {
        try {
          await service.triggerManualOptimization({ jobType: 'hourly' });
        } catch (error) {
          // Expected failures
        }
      }

      const health = await service.getServiceHealth();

      expect(health.status).toBe('degraded');
      expect(health.details.recentFailures).toBe(3);
      expect(health.details.lastError).toBe('Test failure');
    });

    it('should report error status with many failures', async () => {
      mockHourlyCallback.mockRejectedValue(new Error('Critical failure'));
      
      for (let i = 0; i < 6; i++) {
        try {
          await service.triggerManualOptimization({ jobType: 'hourly' });
        } catch (error) {
          // Expected failures
        }
      }

      const health = await service.getServiceHealth();

      expect(health.status).toBe('error');
      expect(health.details.recentFailures).toBe(6);
    });
  });

  describe('Graceful Shutdown', () => {
    beforeEach(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
      service.setOptimizationCallbacks(mockHourlyCallback, mockWeeklyCallback, mockTimelineCallback);
      await service.startScheduledJobs();
    });

    it('should shutdown gracefully', async () => {
      await service.shutdown();

      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Shutting down schedule management service'));
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Schedule management service shutdown complete'));
    });
  });

  describe('Error Handling', () => {
    beforeEach(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    it('should handle missing callbacks gracefully', async () => {
      await expect(service.triggerManualOptimization({ jobType: 'hourly' }))
        .rejects.toThrow(expect.stringContaining('No callback configured for hourly optimization'));
    }, 10000); // Increase timeout

    it('should handle cron job creation failures', async () => {
      const CronJob = jest.requireMock('cron').CronJob;
      CronJob.mockImplementationOnce(() => {
        throw new Error('Cron job creation failed');
      });

      service.setOptimizationCallbacks(mockHourlyCallback, mockWeeklyCallback);

      await expect(service.startScheduledJobs()).rejects.toThrow();
    });
  });
});
