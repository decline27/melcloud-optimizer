import HeatOptimizerApp from '../../src/app';

// Mock dependencies
jest.mock('../../src/services/cop-helper', () => ({
  COPHelper: jest.fn().mockImplementation(() => ({
    initialize: jest.fn(),
    compute: jest.fn(),
    scheduleJobs: jest.fn(),
    stop: jest.fn()
  }))
}));

jest.mock('../../src/services/hot-water/hot-water-service', () => ({
  HotWaterService: jest.fn().mockImplementation(() => ({
    initialize: jest.fn()
  }))
}));

jest.mock('../../src/util/timeline-helper', () => ({
  TimelineHelper: jest.fn().mockImplementation(() => ({
    addTimelineEntry: jest.fn().mockResolvedValue(undefined)
  })),
  TimelineEventType: {
    SYSTEM_RECOVERY: 'system_recovery',
    HOURLY_OPTIMIZATION: 'hourly_optimization',
    WEEKLY_CALIBRATION: 'weekly_calibration'
  }
}));

jest.mock('../../src/util/logger', () => ({
  HomeyLogger: jest.fn().mockImplementation(() => ({
    marker: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    optimization: jest.fn(),
    setLogLevel: jest.fn()
  })),
  LogLevel: {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3
  },
  LogCategory: {
    THERMAL: 'thermal',
    COP: 'cop',
    OPTIMIZATION: 'optimization',
    API: 'api',
    TIMELINE: 'timeline'
  }
}));

jest.mock('cron', () => ({
  CronJob: jest.fn().mockImplementation(() => ({
    start: jest.fn(),
    stop: jest.fn(),
    running: true,
    nextDate: jest.fn().mockReturnValue(new Date()),
    cronTime: { source: '0 5 * * * *' }
  }))
}));

describe('HeatOptimizerApp Auto-Scheduling', () => {
  let app: any;
  let homey: any;

  function makeHomey() {
    return {
      settings: {
        get: jest.fn(),
        set: jest.fn(),
        on: jest.fn()
      },
      log: jest.fn(),
      error: jest.fn(),
      version: '1.0.0',
      platform: 'test'
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    homey = makeHomey();
    app = new HeatOptimizerApp();
    (app as any).homey = homey;
    (app as any).manifest = { version: '1.0.0' };
    (app as any).id = 'com.melcloud.optimize';
    (app as any).log = jest.fn();
    (app as any).error = jest.fn();
    (app as any).warn = jest.fn();
    
    // Mock other methods
    (app as any).initializeLogger = jest.fn();
    (app as any).validateSettings = jest.fn().mockReturnValue(true);
    (app as any).migrateLegacySavings = jest.fn();
    (app as any).runInitialDataCleanup = jest.fn();
    (app as any).monitorMemoryUsage = jest.fn();
    (app as any).initializeCronJobs = jest.fn();
    (app as any).cleanupCronJobs = jest.fn();
    (app as any).updateCronStatusInSettings = jest.fn();
  });

  test('areSettingsComplete returns true when all required settings are present', () => {
    homey.settings.get.mockImplementation((key: string) => {
      const settings: Record<string, any> = {
        'melcloud_user': 'test@example.com',
        'melcloud_pass': 'password',
        'tibber_token': 'token123',
        'device_id': '123',
        'building_id': '456'
      };
      return settings[key];
    });

    const result = (app as any).areSettingsComplete();
    expect(result).toBe(true);
  });

  test('areSettingsComplete returns false when MELCloud credentials are missing', () => {
    homey.settings.get.mockImplementation((key: string) => {
      const settings: Record<string, any> = {
        'tibber_token': 'token123',
        'device_id': '123',
        'building_id': '456'
        // Missing melcloud_user and melcloud_pass
      };
      return settings[key];
    });

    const result = (app as any).areSettingsComplete();
    expect(result).toBe(false);
  });

  test('areSettingsComplete returns false when Tibber token is missing', () => {
    homey.settings.get.mockImplementation((key: string) => {
      const settings: Record<string, any> = {
        'melcloud_user': 'test@example.com',
        'melcloud_pass': 'password',
        'device_id': '123',
        'building_id': '456'
        // Missing tibber_token
      };
      return settings[key];
    });

    const result = (app as any).areSettingsComplete();
    expect(result).toBe(false);
  });

  test('areSettingsComplete returns false when device selection is missing', () => {
    homey.settings.get.mockImplementation((key: string) => {
      const settings: Record<string, any> = {
        'melcloud_user': 'test@example.com',
        'melcloud_pass': 'password',
        'tibber_token': 'token123'
        // Missing device_id and building_id
      };
      return settings[key];
    });

    const result = (app as any).areSettingsComplete();
    expect(result).toBe(false);
  });

  test('ensureCronRunningIfReady starts jobs when settings are complete', () => {
    // Mock complete settings
    homey.settings.get.mockImplementation((key: string) => {
      const settings: Record<string, any> = {
        'melcloud_user': 'test@example.com',
        'melcloud_pass': 'password',
        'tibber_token': 'token123',
        'device_id': '123',
        'building_id': '456'
      };
      return settings[key];
    });

    // Mock no running jobs
    (app as any).hourlyJob = undefined;
    (app as any).weeklyJob = undefined;

    (app as any).ensureCronRunningIfReady();

    expect((app as any).initializeCronJobs).toHaveBeenCalled();
  });

  test('ensureCronRunningIfReady skips when settings are incomplete', () => {
    // Mock incomplete settings (missing tibber_token)
    homey.settings.get.mockImplementation((key: string) => {
      const settings: Record<string, any> = {
        'melcloud_user': 'test@example.com',
        'melcloud_pass': 'password',
        'device_id': '123',
        'building_id': '456'
        // Missing tibber_token
      };
      return settings[key];
    });

    // Mock no running jobs
    (app as any).hourlyJob = undefined;
    (app as any).weeklyJob = undefined;

    (app as any).ensureCronRunningIfReady();

    expect((app as any).initializeCronJobs).not.toHaveBeenCalled();
  });

  test('ensureCronRunningIfReady skips when jobs are already running', () => {
    // Mock complete settings
    homey.settings.get.mockImplementation((key: string) => {
      const settings: Record<string, any> = {
        'melcloud_user': 'test@example.com',
        'melcloud_pass': 'password',
        'tibber_token': 'token123',
        'device_id': '123',
        'building_id': '456'
      };
      return settings[key];
    });

    // Mock running jobs
    (app as any).hourlyJob = { running: true };
    (app as any).weeklyJob = { running: true };

    (app as any).ensureCronRunningIfReady();

    expect((app as any).initializeCronJobs).not.toHaveBeenCalled();
    expect((app as any).updateCronStatusInSettings).toHaveBeenCalled();
  });

  test('isRelevantKeyForScheduling identifies scheduling-related settings', () => {
    expect((app as any).isRelevantKeyForScheduling('melcloud_user')).toBe(true);
    expect((app as any).isRelevantKeyForScheduling('melcloud_pass')).toBe(true);
    expect((app as any).isRelevantKeyForScheduling('tibber_token')).toBe(true);
    expect((app as any).isRelevantKeyForScheduling('device_id')).toBe(true);
    expect((app as any).isRelevantKeyForScheduling('building_id')).toBe(true);
    expect((app as any).isRelevantKeyForScheduling('min_temp')).toBe(false);
    expect((app as any).isRelevantKeyForScheduling('log_level')).toBe(false);
  });

  test('unscheduleJobs calls cleanupCronJobs', () => {
    (app as any).unscheduleJobs();
    expect((app as any).cleanupCronJobs).toHaveBeenCalled();
  });

  test('onInit calls ensureCronRunningIfReady instead of initializeCronJobs directly', async () => {
    // Mock all required methods and properties
    (app as any).ensureCronRunningIfReady = jest.fn();
    
    // Set up basic homey mock
    homey.settings.get.mockImplementation((key: string) => {
      if (key === 'log_level') return 1;
      return undefined;
    });

    await (app as any).onInit();

    expect((app as any).ensureCronRunningIfReady).toHaveBeenCalled();
    expect((app as any).initializeCronJobs).not.toHaveBeenCalled();
  });
});