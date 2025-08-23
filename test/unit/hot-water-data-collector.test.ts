import os from 'os';
import fs from 'fs';
import { HotWaterDataCollector, HotWaterUsageDataPoint } from '../../src/services/hot-water/hot-water-data-collector';

describe('HotWaterDataCollector', () => {
  const makeHomey = () => ({
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    settings: {
      get: jest.fn().mockReturnValue(undefined),
      set: jest.fn(),
      unset: jest.fn()
    },
    env: { userDataPath: os.tmpdir() }
  });

  test('validateDataPoint rejects future timestamps', () => {
    const homey: any = makeHomey();
    const c = new HotWaterDataCollector(homey);

    const future: HotWaterUsageDataPoint = {
      timestamp: new Date(Date.now() + 1000000).toISOString(),
      tankTemperature: 40,
      targetTankTemperature: 45,
      hotWaterEnergyProduced: 1,
      hotWaterEnergyConsumed: 2,
      hotWaterCOP: 0.5,
      isHeating: true,
      hourOfDay: 12,
      dayOfWeek: 3
    };

    // validateDataPoint is private; call addDataPoint which uses validation
    return c.addDataPoint(future as any).then(() => {
      // addDataPoint will silently return; dataPoints should remain empty
      expect(c.getAllDataPoints().length).toBe(0);
    });
  });

  test('setDataPoints filters invalid points and saves', async () => {
    const homey: any = makeHomey();
    const c = new HotWaterDataCollector(homey);

    const now = new Date().toISOString();
    const valid: HotWaterUsageDataPoint = {
      timestamp: now,
      tankTemperature: 45,
      targetTankTemperature: 47,
      hotWaterEnergyProduced: 1,
      hotWaterEnergyConsumed: 2,
      hotWaterCOP: 0.5,
      isHeating: true,
      hourOfDay: 12,
      dayOfWeek: 2
    };

    const invalid: any = { ...valid, hourOfDay: 99 };

    await c.setDataPoints([valid, invalid]);
    expect(c.getAllDataPoints().length).toBe(1);
  });

  test('getDataStatistics returns zeros when no data', async () => {
    const homey: any = makeHomey();
    const c = new HotWaterDataCollector(homey);
    // Ensure any persisted data is cleared before asserting
    await c.clearData(true);
    const stats = c.getDataStatistics(7);
    expect(stats.dataPointCount).toBe(0);
    expect(Array.isArray(stats.usageByHourOfDay)).toBe(true);
  });
// Additional tests for HotWaterDataCollector are merged into the main describe block above.

});
