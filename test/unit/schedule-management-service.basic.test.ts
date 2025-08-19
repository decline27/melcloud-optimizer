import { ScheduleManagementService, ScheduleConfig, ManualTriggerOptions } from '../../src/services/schedule-management-service';
import { ConfigurationService } from '../../src/services/configuration-service';
import { HomeyLogger } from '../../src/util/logger';

// Mock all dependencies
jest.mock('cron', () => ({
  CronJob: jest.fn().mockImplementation(() => ({
    start: jest.fn(),
    stop: jest.fn(),
    running: true,
    nextDate: jest.fn().mockReturnValue(new Date('2025-08-19T15:05:00Z'))
  }))
}));

jest.mock('../../src/services/configuration-service');
jest.mock('../../src/util/logger');
jest.mock('../../src/util/circuit-breaker', () => ({
  CircuitBreaker: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockImplementation((fn) => fn())
  }))
}));

describe('ScheduleManagementService - Basic Functionality', () => {
  let service: ScheduleManagementService;
  let mockHomey: any;
  let mockConfigService: jest.Mocked<ConfigurationService>;
  let mockLogger: jest.Mocked<HomeyLogger>;
  let mockHourlyCallback: jest.Mock;
  let mockWeeklyCallback: jest.Mock;

  beforeEach(() => {
    // Mock Homey
    mockHomey = {
      settings: {
        get: jest.fn().mockReturnValue(true),
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

    // Mock callbacks
    mockHourlyCallback = jest.fn().mockResolvedValue({ success: true });
    mockWeeklyCallback = jest.fn().mockResolvedValue({ success: true });

    // Default settings
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

  describe('Service Creation', () => {
    it('should create service instance', () => {
      expect(service).toBeInstanceOf(ScheduleManagementService);
    });

    it('should load configuration from homey settings', () => {
      expect(mockHomey.settings.get).toHaveBeenCalledWith('schedule_enabled');
      expect(mockHomey.settings.get).toHaveBeenCalledWith('hourly_schedule_enabled');
    });
  });

  describe('Callback Management', () => {
    it('should register optimization callbacks', () => {
      service.setOptimizationCallbacks(mockHourlyCallback, mockWeeklyCallback);
      expect(mockLogger.info).toHaveBeenCalled();
    });
  });

  describe('Manual Triggers', () => {
    beforeEach(() => {
      service.setOptimizationCallbacks(mockHourlyCallback, mockWeeklyCallback);
    });

    it('should execute manual hourly optimization', async () => {
      const result = await service.triggerManualOptimization({ jobType: 'hourly' });
      
      expect(result.jobType).toBe('manual');
      expect(result.success).toBe(true);
      expect(mockHourlyCallback).toHaveBeenCalled();
    });

    it('should execute manual weekly calibration', async () => {
      const result = await service.triggerManualOptimization({ jobType: 'weekly' });
      
      expect(result.jobType).toBe('manual');
      expect(result.success).toBe(true);
      expect(mockWeeklyCallback).toHaveBeenCalled();
    });

    it('should handle callback failures', async () => {
      mockHourlyCallback.mockRejectedValueOnce(new Error('Test failure'));
      
      const result = await service.triggerManualOptimization({ jobType: 'hourly' });
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('Test failure');
    });
  });

  describe('Schedule Status', () => {
    it('should return schedule status', async () => {
      const status = await service.getScheduleStatus();
      
      expect(status).toHaveProperty('hourlyJob');
      expect(status).toHaveProperty('weeklyJob');
      expect(status).toHaveProperty('manualJobs');
      expect(status).toHaveProperty('lastUpdated');
    });
  });

  describe('Configuration Updates', () => {
    it('should update schedule configuration', async () => {
      const newConfig: Partial<ScheduleConfig> = {
        enabled: false
      };

      await service.updateScheduleConfiguration(newConfig);
      
      expect(mockHomey.settings.set).toHaveBeenCalledWith('schedule_enabled', false);
    });
  });

  describe('Service Health', () => {
    it('should report service health', async () => {
      const health = await service.getServiceHealth();
      
      expect(health).toHaveProperty('status');
      expect(health).toHaveProperty('details');
      expect(['healthy', 'degraded', 'error']).toContain(health.status);
    });
  });

  describe('Execution History', () => {
    beforeEach(() => {
      service.setOptimizationCallbacks(mockHourlyCallback, mockWeeklyCallback);
    });

    it('should maintain execution history', async () => {
      await service.triggerManualOptimization({ jobType: 'hourly' });
      
      const history = service.getExecutionHistory();
      
      expect(history).toHaveLength(1);
      expect(history[0].jobType).toBe('manual');
    });
  });

  describe('Job Management', () => {
    beforeEach(() => {
      service.setOptimizationCallbacks(mockHourlyCallback, mockWeeklyCallback);
    });

    it('should start scheduled jobs', async () => {
      await service.startScheduledJobs();
      // Should not throw an error
    });

    it('should stop scheduled jobs', async () => {
      await service.stopScheduledJobs();
      // Should not throw an error
    });

    it('should restart scheduled jobs', async () => {
      await service.restartScheduledJobs();
      // Should not throw an error
    });
  });

  describe('Graceful Shutdown', () => {
    it('should shutdown gracefully', async () => {
      await service.shutdown();
      expect(mockLogger.info).toHaveBeenCalled();
    });
  });
});
