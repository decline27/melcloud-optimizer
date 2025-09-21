// Enhanced app tests for improved coverage
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
  }),
  updateOptimizerSettings: jest.fn().mockResolvedValue(undefined)
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

describe('HeatOptimizerApp Enhanced Coverage Tests', () => {
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

  // NEW TESTS FOR IMPROVED COVERAGE

  test('runHourlyOptimizer handles successful optimization with timeline entries', async () => {
    const mockApi = require('../../api.js');
    mockApi.getRunHourlyOptimizer.mockResolvedValue({
      success: true,
      data: {
        targetTemp: 19,
        targetOriginal: 20,
        savings: 0.5,
        reason: 'Low price optimization',
        cop: 3.2
      }
    });

    // Mock timeline helper
    (app as any).timelineHelper = {
      addTimelineEntry: jest.fn().mockResolvedValue(undefined)
    };

    const result = await app.runHourlyOptimizer();

    expect(result.success).toBe(true);
    expect(result.data.targetTemp).toBe(19);
    expect((app as any).timelineHelper.addTimelineEntry).toHaveBeenCalledWith(
      expect.anything(), // TimelineEventType
      {}, // details (empty)
      false, // createNotification
      expect.objectContaining({
        targetTemp: 19,
        targetOriginal: 20,
        savings: 0.5,
        reason: 'Low price optimization',
        cop: 3.2
      })
    );
  });

  test('runHourlyOptimizer handles errors with fallback and notifications', async () => {
    const mockApi = require('../../api.js');
    const testError = new Error('API Error');
    mockApi.getRunHourlyOptimizer.mockRejectedValue(testError);

    // Mock fallback data
    homey.settings.get.mockImplementation((key: string) => {
      if (key === 'last_optimization_result') return {
        targetTemp: 20,
        timestamp: new Date().toISOString()
      };
      return undefined;
    });

    // Mock timeline helper
    (app as any).timelineHelper = {
      addTimelineEntry: jest.fn().mockResolvedValue(undefined)
    };

    const result = await app.runHourlyOptimizer();

    expect(result.fallback).toBe(true);
    expect((app as any).timelineHelper.addTimelineEntry).toHaveBeenCalledWith(
      expect.anything(), // TimelineEventType.HOURLY_OPTIMIZATION_ERROR
      expect.objectContaining({
        error: 'API Error. Using cached settings as fallback.',
        warning: true
      }),
      true
    );
  });

  test('runHourlyOptimizer handles errors without timeline helper', async () => {
    const mockApi = require('../../api.js');
    const testError = new Error('API Error');
    mockApi.getRunHourlyOptimizer.mockRejectedValue(testError);

    // Mock fallback data
    homey.settings.get.mockImplementation((key: string) => {
      if (key === 'last_optimization_result') return {
        targetTemp: 20,
        timestamp: new Date().toISOString()
      };
      return undefined;
    });

    // Ensure timeline helper is not available
    (app as any).timelineHelper = undefined;

    // Mock homey.notifications
    homey.notifications = {
      createNotification: jest.fn().mockResolvedValue(undefined)
    };

    const result = await app.runHourlyOptimizer();

    expect(result.fallback).toBe(true);
    // Should use fallback notification
    expect(homey.notifications.createNotification).toHaveBeenCalledWith({
      excerpt: 'HourlyOptimizer error: API Error. Using cached settings as fallback.'
    });
  });

  test('runWeeklyCalibration handles successful calibration', async () => {
    const mockApi = require('../../api.js');
    mockApi.getRunWeeklyCalibration.mockResolvedValue({
      success: true,
      data: {
        oldK: 0.8,
        newK: 0.9,
        method: 'linear_regression',
        newS: 0.1,
        thermalCharacteristics: { k: 0.9, s: 0.1 }
      }
    });

    // Mock timeline helper
    (app as any).timelineHelper = {
      addTimelineEntry: jest.fn().mockResolvedValue(undefined)
    };

    const result = await app.runWeeklyCalibration();

    expect(result.success).toBe(true);
    expect(result.data.newK).toBe(0.9);
    expect((app as any).timelineHelper.addTimelineEntry).toHaveBeenCalledWith(
      expect.anything(), // TimelineEventType.WEEKLY_CALIBRATION_RESULT
      {},
      false,
      expect.objectContaining({
        oldK: 0.8,
        newK: 0.9,
        method: 'linear_regression',
        newS: 0.1,
        thermalCharacteristics: { k: 0.9, s: 0.1 }
      })
    );
  });

  test('runWeeklyCalibration handles calibration errors', async () => {
    const mockApi = require('../../api.js');
    const testError = new Error('Calibration failed');
    mockApi.getRunWeeklyCalibration.mockRejectedValue(testError);

    // Mock timeline helper
    (app as any).timelineHelper = {
      addTimelineEntry: jest.fn().mockResolvedValue(undefined)
    };

    await expect(app.runWeeklyCalibration()).rejects.toThrow('Calibration failed');

    expect((app as any).timelineHelper.addTimelineEntry).toHaveBeenCalledWith(
      expect.anything(), // TimelineEventType.WEEKLY_CALIBRATION_ERROR
      expect.objectContaining({
        error: 'Calibration failed'
      }),
      true
    );
  });

  test('runWeeklyCalibration handles calibration errors without timeline helper', async () => {
    const mockApi = require('../../api.js');
    const testError = new Error('Calibration failed');
    mockApi.getRunWeeklyCalibration.mockRejectedValue(testError);

    // Ensure timeline helper is not available
    (app as any).timelineHelper = undefined;

    // Mock homey.notifications
    homey.notifications = {
      createNotification: jest.fn().mockResolvedValue(undefined)
    };

    await expect(app.runWeeklyCalibration()).rejects.toThrow('Calibration failed');

    // Should use fallback notification
    expect(homey.notifications.createNotification).toHaveBeenCalledWith({
      excerpt: 'WeeklyCalibration error: Calibration failed'
    });
  });

  test('monitorMemoryUsage tracks memory usage and warns on high usage', () => {
    // Set development mode to enable memory monitoring
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    
    // Initialize logger first
    (app as any).initializeLogger();
    
    // Re-mock logger after initialization
    (app as any).logger = {
      setLogLevel: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      marker: jest.fn(),
      optimization: jest.fn()
    } as any;
    
    // Mock setInterval to execute callback immediately
    const originalSetInterval = global.setInterval;
    (global as any).setInterval = jest.fn((callback: Function) => {
      callback(); // Execute immediately
      return 1; // Return a fake interval ID
    });
    
    // Mock process.memoryUsage to return high memory usage
    const originalMemoryUsage = process.memoryUsage;
    (process as any).memoryUsage = jest.fn().mockReturnValue({
      rss: 150 * 1024 * 1024, // 150MB
      heapTotal: 120 * 1024 * 1024, // 120MB
      heapUsed: 110 * 1024 * 1024, // 110MB
      external: 10 * 1024 * 1024 // 10MB
    });

    (app as any).monitorMemoryUsage();

    // Verify memory usage was logged
    expect((app as any).logger.debug).toHaveBeenCalledWith(
      'Memory Usage:',
      expect.objectContaining({
        rss: '150 MB',
        heapTotal: '120 MB',
        heapUsed: '110 MB',
        external: '10 MB'
      })
    );

    // Verify high memory warning was logged
    expect((app as any).logger.warn).toHaveBeenCalledWith(
      'High memory usage detected',
      expect.objectContaining({
        heapUsed: '110 MB'
      })
    );

    // Restore original functions and environment
    (process as any).memoryUsage = originalMemoryUsage;
    (global as any).setInterval = originalSetInterval;
    process.env.NODE_ENV = originalNodeEnv;
  });

  test('initializeLogger sets up logger with correct configuration', () => {
    // Mock settings for logger configuration
    homey.settings.get.mockImplementation((key: string) => {
      if (key === 'log_level') return 2; // WARN level
      if (key === 'log_to_timeline') return true;
      return undefined;
    });

    (app as any).initializeLogger();

    expect((app as any).logger).toBeDefined();
    // Check that the logger was created with the correct level by checking its internal state
    expect((app as any).logger.logLevel).toBe(2);
  });

  test('checkSystemHealth identifies multiple system issues', async () => {
    // Mock API status methods to return disconnected
    const mockApi = require('../../api.js');
    mockApi.getMelCloudStatus.mockRejectedValue(new Error('Connection failed'));
    mockApi.getTibberStatus.mockRejectedValue(new Error('API error'));

    // Note: Cron jobs are now managed by the driver, not the main app

    const healthStatus = await (app as any).checkSystemHealth();

    expect(healthStatus.healthy).toBe(false);
    expect(healthStatus.issues).toContain('MELCloud connection check failed: Connection failed');
    expect(healthStatus.issues).toContain('Tibber API connection check failed: API error');
    // Note: No longer expecting cron job issues since they're driver-managed
  });

  test('onSettingsChanged handles manual optimization triggers', async () => {
    // Mock settings for manual trigger
    homey.settings.get.mockImplementation((key: string) => {
      if (key === 'trigger_hourly_optimization') return true;
      return undefined;
    });

    // Mock the optimization method
    const runHourlySpy = jest.spyOn(app, 'runHourlyOptimizer').mockResolvedValue({ success: true });

    await (app as any).onSettingsChanged('trigger_hourly_optimization');

    expect(runHourlySpy).toHaveBeenCalled();
    expect(homey.settings.unset).toHaveBeenCalledWith('trigger_hourly_optimization');
  });

  test('onSettingsChanged handles manual calibration triggers', async () => {
    // Mock settings for manual trigger
    homey.settings.get.mockImplementation((key: string) => {
      if (key === 'trigger_weekly_calibration') return true;
      return undefined;
    });

    // Mock the calibration method
    const runWeeklySpy = jest.spyOn(app, 'runWeeklyCalibration').mockResolvedValue({ success: true });

    await (app as any).onSettingsChanged('trigger_weekly_calibration');

    expect(runWeeklySpy).toHaveBeenCalled();
    expect(homey.settings.unset).toHaveBeenCalledWith('trigger_weekly_calibration');
  });

  test('onSettingsChanged handles COP setting changes', async () => {
    // Mock settings for COP change
    homey.settings.get.mockImplementation((key: string) => {
      if (key === 'cop_weight') return 0.8;
      return undefined;
    });

    // Mock the API update method
    const mockApi = require('../../api.js');
    mockApi.updateOptimizerSettings = jest.fn().mockResolvedValue(undefined);

    await (app as any).onSettingsChanged('cop_weight');

    expect(mockApi.updateOptimizerSettings).toHaveBeenCalledWith(homey);
  });

  test('runSystemHealthCheck no longer handles cron recovery since jobs moved to driver', async () => {
    // Note: Cron jobs are now managed by the driver, not the main app
    // This test now verifies that recovery doesn't attempt to manage cron jobs

    const result = await app.runSystemHealthCheck();

    // Should not attempt cron job recovery since they're driver-managed
    expect(result.healthy).toBe(true);
    expect(result.recovered).toBe(true);
  });

  test('runHourlyOptimizer handles missing timeline helper gracefully', async () => {
    const mockApi = require('../../api.js');
    mockApi.getRunHourlyOptimizer.mockResolvedValue({
      success: true,
      data: {
        targetTemp: 19,
        targetOriginal: 20,
        savings: 0.5,
        reason: 'Low price optimization',
        cop: 3.2
      }
    });

    // Ensure timeline helper is not available
    (app as any).timelineHelper = undefined;

    const result = await app.runHourlyOptimizer();

    expect(result.success).toBe(true);
    // Should not throw when timeline helper is missing
  });

  test('runWeeklyCalibration handles missing timeline helper gracefully', async () => {
    const mockApi = require('../../api.js');
    mockApi.getRunWeeklyCalibration.mockResolvedValue({
      success: true,
      data: {
        oldK: 0.8,
        newK: 0.9,
        method: 'linear_regression'
      }
    });

    // Ensure timeline helper is not available
    (app as any).timelineHelper = undefined;

    const result = await app.runWeeklyCalibration();

    expect(result.success).toBe(true);
    // Should not throw when timeline helper is missing
  });

  test('monitorMemoryUsage handles normal memory usage without warnings', () => {
    // Set development mode to enable memory monitoring
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    
    // Initialize logger first
    (app as any).initializeLogger();
    
    // Re-mock logger after initialization
    (app as any).logger = {
      setLogLevel: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      marker: jest.fn(),
      optimization: jest.fn()
    } as any;
    
    // Mock setInterval to execute callback immediately
    const originalSetInterval = global.setInterval;
    (global as any).setInterval = jest.fn((callback: Function) => {
      callback(); // Execute immediately
      return 1; // Return a fake interval ID
    });
    
    // Mock process.memoryUsage to return normal memory usage
    const originalMemoryUsage = process.memoryUsage;
    (process as any).memoryUsage = jest.fn().mockReturnValue({
      rss: 50 * 1024 * 1024, // 50MB
      heapTotal: 40 * 1024 * 1024, // 40MB
      heapUsed: 30 * 1024 * 1024, // 30MB
      external: 5 * 1024 * 1024 // 5MB
    });

    (app as any).monitorMemoryUsage();

    // Verify memory usage was logged
    expect((app as any).logger.debug).toHaveBeenCalledWith(
      'Memory Usage:',
      expect.objectContaining({
        rss: '50 MB',
        heapTotal: '40 MB',
        heapUsed: '30 MB',
        external: '5 MB'
      })
    );

    // Should not log warnings for normal usage
    expect((app as any).logger.warn).not.toHaveBeenCalled();

    // Restore original functions and environment
    (process as any).memoryUsage = originalMemoryUsage;
    (global as any).setInterval = originalSetInterval;
    process.env.NODE_ENV = originalNodeEnv;
  });

  test('initializeLogger handles missing settings gracefully', () => {
    // Mock settings to return undefined for all keys
    homey.settings.get.mockReturnValue(undefined);

    (app as any).initializeLogger();

    expect((app as any).logger).toBeDefined();
    // Should use default log level (INFO = 1)
    expect((app as any).logger.logLevel).toBe(1);
  });

  test('checkSystemHealth handles API connection errors', async () => {
    // Mock API status methods to throw errors
    const mockApi = require('../../api.js');
    mockApi.getMelCloudStatus.mockRejectedValue(new Error('Network timeout'));
    mockApi.getTibberStatus.mockRejectedValue(new Error('Authentication failed'));

    // Note: Cron jobs are now managed by the driver

    const healthStatus = await (app as any).checkSystemHealth();

    expect(healthStatus.healthy).toBe(false);
    expect(healthStatus.issues).toContain('MELCloud connection check failed: Network timeout');
    expect(healthStatus.issues).toContain('Tibber API connection check failed: Authentication failed');
    // Note: No longer checking cron job issues since they're driver-managed
  });
});
