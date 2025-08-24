import HeatOptimizerApp from '../../src/app';
import { Api, initializeServices, updateOptimizerSettings } from '../../src/api';

// Use existing mocks helper pattern
import { createMockLogger } from '../mocks';

describe('Ported API - new endpoints and compatibility helpers', () => {
  test('Api.runSystemHealthCheck proxies to app.runSystemHealthCheck', async () => {
    // Create a minimal fake app with runSystemHealthCheck
    const fakeApp: any = {
      runSystemHealthCheck: jest.fn().mockResolvedValue({ healthy: true, issues: [], recovered: false }),
      log: jest.fn(),
      error: jest.fn()
    };

    // Construct Api instance with fake app
    const api = new Api(fakeApp);

    const res = await api.runSystemHealthCheck({ homey: { app: fakeApp } });
    expect(res).toEqual({ healthy: true, issues: [], recovered: false });
    expect(fakeApp.runSystemHealthCheck).toHaveBeenCalled();
  });

  test('top-level updateOptimizerSettings calls Api.updateOptimizerSettings', async () => {
    // Create a fake app and fake optimizer
    const fakeApply = jest.fn().mockResolvedValue(undefined);
    const fakeOptimizer = { applySettings: fakeApply };

    const fakeHomey: any = {
      app: { optimizer: fakeOptimizer, log: jest.fn(), error: jest.fn() },
      settings: { get: jest.fn().mockReturnValue(undefined), set: jest.fn() }
    };

    // Call top-level helper
    const res = await updateOptimizerSettings(fakeHomey);

    // Should return success true (Api.updateOptimizerSettings returns { success: true } when no errors)
    expect(res && res.success).toBe(true);
  });

  test('__test.setServices and setHistoricalData populate globals and resetAll clears them', () => {
    // Access CommonJS exported __test if available
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod: any = require('../../src/api');
    if (!mod.__test) {
      // If not attached (should be), fail the test
      throw new Error('__test helpers not found on module.exports');
    }

    // Create sample services
    const services = {
      melCloud: { name: 'mel' },
      tibber: { name: 'tib' },
      optimizer: { name: 'opt' },
      historicalData: { optimizations: [1,2,3], lastCalibration: null }
    };

    mod.__test.setServices(services);
    expect((global as any).melCloud).toBe(services.melCloud);
    expect((global as any).tibber).toBe(services.tibber);
    expect((global as any).optimizer).toBe(services.optimizer);

    mod.__test.setHistoricalData({ optimizations: [] });
    expect((global as any).historicalData).toBeDefined();

    mod.__test.resetAll();
    expect((global as any).melCloud).toBeUndefined();
    expect((global as any).tibber).toBeUndefined();
    expect((global as any).optimizer).toBeUndefined();
    expect((global as any).historicalData).toBeDefined();
  });
});
