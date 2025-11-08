import { HotWaterAnalyzer } from '../../src/services/hot-water/hot-water-analyzer';
import { DateTime } from 'luxon';

const mockHomey = () => ({
  settings: { get: jest.fn(), set: jest.fn(), unset: jest.fn() },
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  env: { userDataPath: '/tmp' }
} as any);

describe('HotWaterAnalyzer', () => {
  test('updatePatterns returns false when not enough data', async () => {
    const homey = mockHomey();

    const dataCollector = {
      getCombinedDataForAnalysis: () => ({ detailed: new Array(10).fill(0).map((_, i) => ({
        timestamp: DateTime.now().minus({ minutes: i * 20 }).toISO(),
        tankTemperature: 40,
        targetTankTemperature: 45,
        hotWaterEnergyProduced: 0.1,
        hotWaterEnergyConsumed: 0.2,
        hotWaterCOP: 2,
        isHeating: false,
        hourOfDay: 12,
        dayOfWeek: 1
      })), aggregated: [] })
    } as any;

    const analyzer = new HotWaterAnalyzer(homey, dataCollector);
    const res = await analyzer.updatePatterns();
    expect(res).toBe(false);
    expect(homey.log).toHaveBeenCalled();
  });

  test('updatePatterns processes enough data and updates patterns, predict functions work', async () => {
    const homey = mockHomey();

    // Create 100 data points spanning different hours and days
    const detailed = [] as any[];
    for (let i = 0; i < 100; i++) {
      const dt = DateTime.now().minus({ minutes: i * 20 });
      detailed.push({
        timestamp: dt.toISO(),
        tankTemperature: 40 + (i % 5),
        targetTankTemperature: 45,
        hotWaterEnergyProduced: (i % 24) === 6 || (i % 24) === 19 ? 1 : 0.2,
        hotWaterEnergyConsumed: 0.5,
        hotWaterCOP: 2,
        isHeating: (i % 10) === 0,
        hourOfDay: dt.hour,
        dayOfWeek: (dt.weekday + 6) % 7
      });
    }

    const dataCollector = { getCombinedDataForAnalysis: () => ({ detailed, aggregated: [] }) } as any;

    const analyzer = new HotWaterAnalyzer(homey, dataCollector);

    const updated = await analyzer.updatePatterns();
    expect(updated).toBe(true);

    const patterns = analyzer.getPatterns();
    expect(patterns).toBeDefined();
    expect(patterns.hourlyUsagePattern.length).toBe(24);

    // With low confidence (initial patterns are 0), predictUsage should use hourly pattern
    patterns.confidence = 5;
    const usage = analyzer.predictUsage(6, 1);
    expect(typeof usage).toBe('number');

    // Force high confidence and test predictNext24Hours + getOptimalTankTemperature
    patterns.confidence = 90;
    analyzer['patterns'] = patterns;

    const next24 = analyzer.predictNext24Hours();
    expect(next24.length).toBe(24);

    const optimalCheap = analyzer.getOptimalTankTemperature(40, 60, 0.05, 'CHEAP');
    expect(typeof optimalCheap).toBe('number');

    const optimalExpensive = analyzer.getOptimalTankTemperature(40, 60, 0.2, 'EXPENSIVE');
    expect(typeof optimalExpensive).toBe('number');
  }, 10000);

  test('predictUsage honors Monday=0 mapping', () => {
    const homey = mockHomey();
    const dataCollector = {
      getCombinedDataForAnalysis: () => ({ detailed: new Array(12).fill(0), aggregated: [] })
    } as any;

    const analyzer = new HotWaterAnalyzer(homey, dataCollector);
    const customPatterns = {
      hourlyUsagePattern: new Array(24).fill(1),
      dailyUsagePattern: [3, 1, 1, 1, 1, 1, 1],
      hourlyByDayUsagePattern: new Array(7).fill(null).map(() => new Array(24).fill(1)),
      confidence: 80,
      lastUpdated: new Date().toISOString()
    };
    customPatterns.hourlyByDayUsagePattern[0][8] = 5; // Monday morning spike
    customPatterns.hourlyByDayUsagePattern[1][8] = 1;
    analyzer['patterns'] = customPatterns;

    const mondayUsage = analyzer.predictUsage(8, 0);
    const tuesdayUsage = analyzer.predictUsage(8, 1);
    expect(mondayUsage).toBeGreaterThan(tuesdayUsage);
  });
});
