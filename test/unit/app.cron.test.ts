// Test to verify that cron job functionality has been moved to the driver
import HeatOptimizerApp from '../../src/app';

describe('HeatOptimizerApp cron architecture migration', () => {
  const makeHomey = () => ({
    settings: { get: jest.fn().mockReturnValue(undefined), set: jest.fn(), on: jest.fn() },
    version: '1.0',
    platform: 'test',
  });

  let app: HeatOptimizerApp;

  beforeEach(() => {
    jest.clearAllMocks();
    app = new HeatOptimizerApp();

    (app as any).homey = makeHomey();
    (app as any).log = jest.fn();
    (app as any).error = jest.fn();
  });

  test('app no longer has cron job properties', () => {
    // These properties should not exist since cron jobs moved to driver
    expect((app as any).hourlyJob).toBeUndefined();
    expect((app as any).weeklyJob).toBeUndefined();
  });

  test('app no longer has cron job methods', () => {
    // These methods should not exist since cron jobs moved to driver
    expect(typeof (app as any).initializeCronJobs).toBe('undefined');
    expect(typeof (app as any).cleanupCronJobs).toBe('undefined');
    expect(typeof (app as any).ensureCronRunningIfReady).toBe('undefined');
    expect(typeof (app as any).updateCronStatusInSettings).toBe('undefined');
  });

  test('app should still have core business logic methods', () => {
    // These methods should still exist as they are core app functionality
    expect(typeof app.onInit).toBe('function');
    expect(typeof app.onUninit).toBe('function');
    expect(typeof (app as any).runHourlyOptimizer).toBe('function');
    expect(typeof (app as any).runWeeklyCalibration).toBe('function');
    expect(typeof (app as any).getCronStatus).toBe('function');
  });
});
