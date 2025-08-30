import HeatOptimizerApp from '../../src/app';

// Minimal cron mock to satisfy app
jest.doMock('cron', () => ({
  CronJob: class {
    public running = false;
    public cronTime = { source: '* * * * *' };
    constructor() {}
    start() { this.running = true; }
    stop() { this.running = false; }
    nextDate() { return new Date(); }
  }
}));

const makeHomey = () => ({
  settings: {
    get: jest.fn().mockReturnValue(undefined),
    set: jest.fn(),
    on: jest.fn()
  },
  version: '1.0.0',
  platform: 'test'
} as any);

describe('HeatOptimizerApp additional branches', () => {
  test('updateCronStatusInSettings handles settings.set error', () => {
    const app = new (HeatOptimizerApp as any)() as any;
    app.homey = makeHomey();
    app.logger = { log: jest.fn(), error: jest.fn(), info: jest.fn(), marker: jest.fn() };
    // Spy on App.error (not logger.error) because implementation uses this.error()
    app.error = jest.fn();

    // Provide fake cron jobs
    const CronJob = (require('cron') as any).CronJob;
    app.hourlyJob = new CronJob('* * * * *', () => {}, null, false);
    app.weeklyJob = new CronJob('* * * * *', () => {}, null, false);

    // Force settings.set to throw
    app.homey.settings.set = jest.fn(() => { throw new Error('Settings set failed'); });

    // Call and assert error is logged but no throw
    app.updateCronStatusInSettings();
    expect(app.error).toHaveBeenCalled();
  });
});
