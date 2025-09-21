import HeatOptimizerApp from '../../src/app';

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
  test('app can be instantiated without cron job properties', () => {
    const app = new (HeatOptimizerApp as any)() as any;
    app.homey = makeHomey();
    app.logger = { log: jest.fn(), error: jest.fn(), info: jest.fn(), marker: jest.fn() };
    
    // Test that the app initializes without the old cron job properties
    expect(app.hourlyJob).toBeUndefined();
    expect(app.weeklyJob).toBeUndefined();
    
    // Test that the app has the expected non-cron properties
    expect(app.copHelper).toBeUndefined(); // Should be undefined until initialized
    expect(app.timelineHelper).toBeUndefined(); // Should be undefined until initialized
  });
});
