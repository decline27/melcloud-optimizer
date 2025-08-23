import { HotWaterDataCollector, HotWaterUsageDataPoint } from '../../src/services/hot-water/hot-water-data-collector';
import { DateTime } from 'luxon';

const mockHomey = () => ({
  settings: { get: jest.fn(), set: jest.fn(), unset: jest.fn() },
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  env: { userDataPath: '/tmp' }
} as any);

describe('HotWaterDataCollector basic behaviors', () => {
  test('validateDataPoint rejects future timestamps and bad ranges', () => {
    const homey = mockHomey();
    const collector = new HotWaterDataCollector(homey);

    const future: HotWaterUsageDataPoint = {
      timestamp: DateTime.now().plus({ days: 1 }).toISO(),
      tankTemperature: 40,
      targetTankTemperature: 45,
      hotWaterEnergyProduced: 0.1,
      hotWaterEnergyConsumed: 0.2,
      hotWaterCOP: 2,
      isHeating: false,
      hourOfDay: 12,
      dayOfWeek: 1
    };

    // Use internal validation via setDataPoints which filters invalid ones
    return collector.setDataPoints([future]).then(() => {
      // After setting, no data points should be present because it was invalid
      const all = collector.getAllDataPoints();
      expect(all.length).toBe(0);
    });
  });

  test('getDataStatistics returns zeros for empty and calculates for data', async () => {
    const homey = mockHomey();
    const collector = new HotWaterDataCollector(homey);

    // Empty stats
    const emptyStats = collector.getDataStatistics(1);
    expect(emptyStats.dataPointCount).toBe(0);

    // Add a valid point
    const dp: HotWaterUsageDataPoint = {
      timestamp: DateTime.now().toISO(),
      tankTemperature: 40,
      targetTankTemperature: 45,
      hotWaterEnergyProduced: 1,
      hotWaterEnergyConsumed: 0.5,
      hotWaterCOP: 2,
      isHeating: true,
      hourOfDay: DateTime.now().hour,
      dayOfWeek: DateTime.now().weekday % 7
    };

    await collector.addDataPoint(dp);

    const stats = collector.getDataStatistics(1);
    expect(stats.dataPointCount).toBeGreaterThanOrEqual(1);
    expect(stats.totalHotWaterEnergyProduced).toBeGreaterThanOrEqual(1);

    // Clearing data
    await collector.clearData(true);
    const afterClear = collector.getAllDataPoints();
    expect(afterClear.length).toBe(0);
  }, 10000);
});
