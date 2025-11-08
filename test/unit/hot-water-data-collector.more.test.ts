import os from 'os';
import { HotWaterDataCollector, HotWaterUsageDataPoint } from '../../src/services/hot-water/hot-water-data-collector';

describe('HotWaterDataCollector - additional coverage', () => {
  let homey: any;
  let collector: HotWaterDataCollector;

  beforeEach(async () => {
    homey = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      settings: {
        get: jest.fn().mockReturnValue(undefined),
        set: jest.fn(),
        unset: jest.fn()
      },
      env: { userDataPath: os.tmpdir() }
    };

    collector = new HotWaterDataCollector(homey);
    await collector.clearData(true);
  });

  test('reduceDataSize aggregates older data and trims to max (min cap applies)', async () => {
    // Set below minimum; implementation enforces minimum 100
    await collector.setMaxDataPoints(10);

    const now = Date.now();
    const mk = (ts: number, produced = 1, consumed = 1): HotWaterUsageDataPoint => {
      const iso = new Date(ts).toISOString();
      return {
        timestamp: iso,
        localDayKey: iso.split('T')[0],
      tankTemperature: 45,
      targetTankTemperature: 50,
      hotWaterEnergyProduced: produced,
      hotWaterEnergyConsumed: consumed,
      hotWaterCOP: consumed > 0 ? produced / consumed : 0,
      isHeating: produced > 0,
        hourOfDay: 12,
        dayOfWeek: 2,
      };
    };

    const points: HotWaterUsageDataPoint[] = [];
    // 80 recent points within last ~3 days
    for (let i = 0; i < 80; i++) {
      points.push(mk(now - i * 60 * 60 * 1000));
    }
    // 40 older points spread across 2 different days (8 and 9 days ago)
    for (let i = 0; i < 20; i++) {
      points.push(mk(now - (8 * 24 + i) * 60 * 60 * 1000));
      points.push(mk(now - (9 * 24 + i) * 60 * 60 * 1000));
    }

    await collector.setDataPoints(points);

    // After aggregation, recent data (80) remains since it's under min cap (100)
    expect(collector.getAllDataPoints().length).toBe(80);

    // Aggregated data should contain entries for at least 2 days
    expect(collector.getAggregatedData().length).toBeGreaterThanOrEqual(2);
  });

  test('clearData with clearAggregated=false preserves aggregated data', async () => {
    // Prepare by causing aggregation to populate aggregatedData
    await collector.setMaxDataPoints(10); // will be set to 100 internally

    const now = Date.now();
    const mk = (ts: number): HotWaterUsageDataPoint => {
      const iso = new Date(ts).toISOString();
      return {
        timestamp: iso,
        localDayKey: iso.split('T')[0],
      tankTemperature: 45,
      targetTankTemperature: 50,
      hotWaterEnergyProduced: 1,
      hotWaterEnergyConsumed: 1,
      hotWaterCOP: 1,
      isHeating: true,
        hourOfDay: 10,
        dayOfWeek: 1,
      };
    };

    const points: HotWaterUsageDataPoint[] = [];
    for (let i = 0; i < 80; i++) points.push(mk(now - i * 60 * 60 * 1000));
    for (let i = 0; i < 40; i++) points.push(mk(now - (8 * 24 + i) * 60 * 60 * 1000));

    await collector.setDataPoints(points);
    expect(collector.getAggregatedData().length).toBeGreaterThan(0);
    // Reset unset call tracking to verify behavior of clearData(false)
    (homey.settings.unset as jest.Mock).mockClear();
    const aggBefore = collector.getAggregatedData().length;
    await collector.clearData(false);

    expect(collector.getAllDataPoints().length).toBe(0);
    expect(collector.getAggregatedData().length).toBe(aggBefore);
    expect(homey.settings.unset).toHaveBeenCalledWith('hot_water_usage_data');
    // Should not have unset aggregated key when clearAggregated=false
    expect(homey.settings.unset).not.toHaveBeenCalledWith('hot_water_usage_aggregated_data');
  });

  test('saveData error is handled gracefully', async () => {
    const settingsSet = homey.settings.set as jest.Mock;
    settingsSet.mockImplementationOnce(() => { throw new Error('settings error'); });

    const pointIso = new Date().toISOString();
    const point: HotWaterUsageDataPoint = {
      timestamp: pointIso,
      localDayKey: pointIso.split('T')[0],
      tankTemperature: 40,
      targetTankTemperature: 45,
      hotWaterEnergyProduced: 1,
      hotWaterEnergyConsumed: 1,
      hotWaterCOP: 1,
      isHeating: true,
      hourOfDay: 12,
      dayOfWeek: 2,
    };

    await collector.setDataPoints([point]);

    // Error should be logged but not throw
    const calls = (homey.error as jest.Mock).mock.calls.map(c => c[0]);
    expect(calls.some((msg: string) => msg.includes('Error saving hot water usage data:'))).toBe(true);
  });
});
