// Ensure CronJob is mocked before importing the app implementation
jest.resetModules();
jest.doMock('cron', () => ({
  CronJob: class {
    public running: boolean;
    public cronTime: any;
    constructor(pattern: string, fn: Function, onComplete: any, start: boolean, tz?: string) {
      this.running = !!start;
      this.cronTime = { source: pattern };
      this.nextDate = () => new Date();
      // Do not start any timers to avoid leaking handles in tests
    }
    public start() { this.running = true; }
    public stop() { this.running = false; }
    public nextDate: () => Date;
  }
}));

import HeatOptimizerApp from '../../src/app';

describe('HeatOptimizerApp cron initialization (mocked)', () => {
  let app: HeatOptimizerApp;
  let mockSettings: any;

  beforeEach(() => {
    jest.clearAllMocks();
    app = new HeatOptimizerApp();

    mockSettings = {
      get: jest.fn().mockImplementation((k: string) => {
        if (k === 'time_zone_offset') return 2;
        if (k === 'use_dst') return true;
        return undefined;
      }),
      set: jest.fn().mockResolvedValue(undefined),
      on: jest.fn()
    };

    (app as any).homey = {
      settings: mockSettings,
      timeline: undefined,
      notifications: undefined,
      flow: undefined,
      version: '1.0.0',
      platform: 'test'
    };

    (app as any).log = jest.fn();
    (app as any).error = jest.fn();
  });

  it('initializeCronJobs creates hourly and weekly jobs and handles DST', () => {
    app.initializeCronJobs();

    expect((app as any).hourlyJob).toBeDefined();
    expect((app as any).weeklyJob).toBeDefined();

    expect((app as any).hourlyJob.cronTime.source).toContain('0 5');
    expect((app as any).weeklyJob.cronTime.source).toContain('0 5 2');
  });

  it('cleanupCronJobs stops and clears jobs', () => {
    app.initializeCronJobs();
    expect((app as any).hourlyJob).toBeDefined();

    app.cleanupCronJobs();

    expect((app as any).hourlyJob).toBeUndefined();
    expect((app as any).weeklyJob).toBeUndefined();
  });
});
