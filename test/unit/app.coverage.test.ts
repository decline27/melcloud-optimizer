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

  test('getCronStatus returns status object with error when jobs not initialized', () => {
    // Ensure jobs are not initialized
    app.hourlyJob = undefined;
    app.weeklyJob = undefined;

    const status = app.getCronStatus();

    // getCronStatus should not initialize jobs, just return status
    expect(app.hourlyJob).toBeUndefined();
    expect(app.weeklyJob).toBeUndefined();

    expect(status).toHaveProperty('hourlyJob');
    expect(status).toHaveProperty('weeklyJob');
    expect(status).toHaveProperty('lastHourlyRun');
    expect(status.hourlyJob).toHaveProperty('error', 'Hourly job not initialized');
    expect(status.weeklyJob).toHaveProperty('error', 'Weekly job not initialized');
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

  test('runSystemHealthCheck detects issues and attempts recovery by reinitializing cron jobs', async () => {
    // Ensure cron jobs are not running
    app.hourlyJob = undefined;
    app.weeklyJob = undefined;

    const spyInit = jest.spyOn(app, 'initializeCronJobs');

    const res = await app.runSystemHealthCheck();

    expect(res.healthy).toBe(false);
    expect(Array.isArray(res.issues)).toBe(true);
    // Recovery should have run and initialized cron jobs
    expect(spyInit).toHaveBeenCalled();
  });
});
