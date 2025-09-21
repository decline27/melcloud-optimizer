// Ensure we can mock modules before importing the app
jest.resetModules();

// Mock the cron module to avoid real timers
jest.doMock('cron', () => ({
  CronJob: class {
    public running: boolean = false;
    public cronTime: any;
    constructor(pattern: string, fn: Function, onComplete: any, start: boolean, tz?: string) {
      this.running = !!start;
      this.cronTime = { source: pattern };
      // Do not schedule timers in tests
    }
    public start() { this.running = true; }
    public stop() { this.running = false; }
    public nextDate() { return new Date(); }
  }
}));

// Mock the API module used by the app to control external checks
jest.doMock('../../api.js', () => ({
  getMelCloudStatus: jest.fn().mockResolvedValue({ connected: false }),
  getTibberStatus: jest.fn().mockResolvedValue({ connected: false }),
  getRunHourlyOptimizer: jest.fn().mockResolvedValue({ success: true, data: {} }),
  getRunWeeklyCalibration: jest.fn().mockResolvedValue({ success: true, data: {} }),
  runThermalDataCleanup: jest.fn().mockResolvedValue({
    success: false,
    message: 'Thermal model service not available'
  })
}));

import HeatOptimizerApp from '../../src/app';

const makeHomey = () => ({
  settings: {
    get: jest.fn().mockReturnValue(undefined),
    set: jest.fn().mockResolvedValue(undefined),
    unset: jest.fn().mockResolvedValue(undefined),
    on: jest.fn()
  },
  timeline: undefined,
  notifications: undefined,
  flow: undefined,
  version: '1.0.0',
  platform: 'test'
} as any);

describe('HeatOptimizerApp focused coverage tests', () => {
  let app: HeatOptimizerApp;
  let homey: any;

  beforeEach(() => {
    jest.clearAllMocks();
    homey = makeHomey();
  app = new HeatOptimizerApp();
  (app as any).homey = homey;
    // Replace logger methods with spies to avoid noisy output
    (app as any).logger = {
      setLogLevel: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      marker: jest.fn(),
      optimization: jest.fn()
    } as any;
  });

  test('getCronStatus returns driver-based status', () => {
    // Note: Cron jobs are now managed by the driver, not the main app
    const status = app.getCronStatus();

    // The method should return status from the driver
    expect(status).toHaveProperty('architecture');
    expect(status.architecture).toContain('BoilerDriver');
    expect(status).toHaveProperty('hourlyJob');
    expect(status).toHaveProperty('weeklyJob');
    expect(status).toHaveProperty('lastHourlyRun');
  });

  test('onSettingsChanged handles log_level update', async () => {
    // Make settings.get return a log level when asked
    homey.settings.get.mockImplementation((k: string) => {
      if (k === 'log_level') return 2;
      return undefined;
    });

    // Call private method
    await (app as any).onSettingsChanged('log_level');

    expect((app as any).logger.setLogLevel).toHaveBeenCalled();
  });

  test('runSystemHealthCheck reports cron jobs as managed by driver', async () => {
    // Note: Cron jobs are now managed by the driver, not the main app
    const res = await app.runSystemHealthCheck();

    // Should not report cron job issues since they're driver-managed
    expect(res.healthy).toBe(true);
    expect(Array.isArray(res.issues)).toBe(true);
    expect(res.issues.length).toBe(0);
  });

  test('onUninit cleans up all resources properly', async () => {
    // Set up services
    (app as any).copHelper = {};
    (app as any).timelineHelper = {};
    (app as any).memoryUsageInterval = setInterval(() => {}, 1000);

    // Mock the API cleanup function to return success
    const mockApi = require('../../api.js');
    mockApi.cleanup = jest.fn().mockResolvedValue({ success: true });

    await (app as any).onUninit();

    // Verify that the logger was called with the stopping message
    expect((app as any).logger.marker).toHaveBeenCalledWith('MELCloud Optimizer App Stopping');
    expect((app as any).logger.info).toHaveBeenCalledWith('API resources cleanup completed successfully');
  });

  test('runInitialDataCleanup schedules cleanup after delay', async () => {
    jest.useFakeTimers();

    // Mock the api.js runThermalDataCleanup method
    const mockApi = require('../../api.js');
    mockApi.runThermalDataCleanup.mockResolvedValue({
      success: true,
      cleanedDataPoints: 10,
      freedMemory: 1024
    });

    (app as any).runInitialDataCleanup();

    // Fast-forward timers
    jest.advanceTimersByTime(2 * 60 * 1000);

    // Verify cleanup was called
    expect(mockApi.runThermalDataCleanup).toHaveBeenCalledWith({ homey: (app as any).homey });

    jest.useRealTimers();
  });

  test('validateSettings handles all validation scenarios', () => {
    // Test missing MELCloud credentials
    homey.settings.get.mockImplementation((key: string) => {
      if (key === 'melcloud_user') return undefined;
      if (key === 'melcloud_pass') return 'password';
      if (key === 'tibber_token') return 'token';
      return undefined;
    });

    let result = (app as any).validateSettings();
    expect(result).toBe(false);

    // Test missing Tibber token
    homey.settings.get.mockImplementation((key: string) => {
      if (key === 'melcloud_user') return 'user@example.com';
      if (key === 'melcloud_pass') return 'password';
      if (key === 'tibber_token') return undefined;
      return undefined;
    });

    result = (app as any).validateSettings();
    expect(result).toBe(false);

    // Test invalid temperature range
    homey.settings.get.mockImplementation((key: string) => {
      if (key === 'melcloud_user') return 'user@example.com';
      if (key === 'melcloud_pass') return 'password';
      if (key === 'tibber_token') return 'token';
      if (key === 'min_temp') return 25;
      if (key === 'max_temp') return 20;
      return undefined;
    });

    result = (app as any).validateSettings();
    expect(result).toBe(false);

    // Test valid settings
    homey.settings.get.mockImplementation((key: string) => {
      if (key === 'melcloud_user') return 'user@example.com';
      if (key === 'melcloud_pass') return 'password';
      if (key === 'tibber_token') return 'token';
      if (key === 'min_temp') return 18;
      if (key === 'max_temp') return 25;
      if (key === 'enable_zone2') return false;
      if (key === 'enable_tank_control') return false;
      if (key === 'use_weather_data') return false;
      return undefined;
    });

    result = (app as any).validateSettings();
    expect(result).toBe(true);
  });

  test('runSystemHealthCheck returns healthy status when all systems are working', async () => {
    // Note: Cron jobs are now managed by the driver

    // Mock API status methods to return connected
    const mockApi = require('../../api.js');
    mockApi.getMelCloudStatus.mockResolvedValue({ connected: true });
    mockApi.getTibberStatus.mockResolvedValue({ connected: true });

    const result = await app.runSystemHealthCheck();

    expect(result.healthy).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  test('app architecture has moved cron jobs to driver', () => {
    // Verify that cron job properties and methods no longer exist
    expect((app as any).hourlyJob).toBeUndefined();
    expect((app as any).weeklyJob).toBeUndefined();
    expect(typeof (app as any).updateCronStatusInSettings).toBe('undefined');
  });

  test('onInit handles various initialization scenarios', async () => {
    // Ensure homey and manifest are properly set
    (app as any).homey = homey;
    (app as any).manifest = { version: '1.0.0' };
    (app as any).id = 'com.melcloud.optimize';
    
    // Mock different settings scenarios
    let callCount = 0;
    homey.settings.get.mockImplementation((key: string) => {
      callCount++;
      if (key === 'log_level') return 1;
      if (key === 'melcloud_user') return 'test@example.com';
      if (key === 'melcloud_pass') return 'password';
      if (key === 'tibber_token') return 'token';
      if (key === 'device_id') return '123';
      if (key === 'time_zone_offset') return 2;
      if (key === 'use_dst') return true;
      return undefined;
    });

    // Mock the logger initialization
    (app as any).initializeLogger = jest.fn();
    (app as any).validateSettings = jest.fn().mockReturnValue(true);
    (app as any).initializeCronJobs = jest.fn();
    (app as any).runInitialDataCleanup = jest.fn();

    await (app as any).onInit();

    expect((app as any).initializeLogger).toHaveBeenCalled();
    expect((app as any).validateSettings).toHaveBeenCalled();
    expect((app as any).initializeCronJobs).toHaveBeenCalled();
    expect((app as any).runInitialDataCleanup).toHaveBeenCalled();
  });

  test('onInit handles initialization errors gracefully', async () => {
    // Ensure homey and manifest are properly set
    (app as any).homey = homey;
    (app as any).manifest = { version: '1.0.0' };
    (app as any).id = 'com.melcloud.optimize';
    
    // Mock settings to cause errors
    homey.settings.get.mockImplementation(() => {
      throw new Error('Settings error');
    });

    // Mock logger to avoid errors
    (app as any).logger = {
      marker: jest.fn(),
      info: jest.fn(),
      error: jest.fn()
    };

    // Should not throw despite errors
    await expect((app as any).onInit()).resolves.not.toThrow();
  });
});
