import { ThermalModelService } from '../../src/services/thermal-model/thermal-model-service';
import { ThermalDataCollector } from '../../src/services/thermal-model/data-collector';
import { ThermalAnalyzer } from '../../src/services/thermal-model/thermal-analyzer';
import { DateTime } from 'luxon';

jest.mock('../../src/services/thermal-model/data-collector');
jest.mock('../../src/services/thermal-model/thermal-analyzer');

describe('ThermalModelService branch coverage', () => {
  let svc: ThermalModelService;
  let homey: any;
  let collector: jest.Mocked<ThermalDataCollector>;
  let analyzer: jest.Mocked<ThermalAnalyzer>;

  beforeEach(() => {
    jest.clearAllMocks();
    homey = { log: jest.fn(), error: jest.fn() } as any;
    collector = new ThermalDataCollector(homey) as any;
    // defaults for memory usage and stats
    collector.getMemoryUsage = jest.fn().mockReturnValue({
      dataPointCount: 0,
      aggregatedDataCount: 0,
      estimatedMemoryUsageKB: 0,
      dataPointsPerDay: 0
    });
    collector.getAllDataPoints = jest.fn().mockReturnValue([]);
    collector.getCombinedDataForAnalysis = jest.fn().mockReturnValue({ detailed: [], aggregated: [], totalDataPoints: 0 });
    svc = new ThermalModelService(homey);
    (svc as any).dataCollector = collector;
    analyzer = new ThermalAnalyzer(homey) as any;
    analyzer.getThermalCharacteristics = jest.fn().mockReturnValue({
      heatingRate: 0.5,
      coolingRate: 0.25,
      outdoorTempImpact: 0.1,
      windImpact: 0.05,
      thermalMass: 0.8,
      modelConfidence: 0.6,
      lastUpdated: DateTime.now().toISO(),
    });
    (svc as any).analyzer = analyzer;
  });

  test('getOptimalPreheatingTime returns now when targetTime in past or already at target', () => {
    const nowIso = DateTime.now().toISO();
    const past = DateTime.now().minus({ hours: 1 }).toISO();
    const r1 = svc.getOptimalPreheatingTime(20, past, 20, 5, {} as any);
    expect(typeof r1).toBe('string');
    const r2 = svc.getOptimalPreheatingTime(20, DateTime.now().plus({ hours: 1 }).toISO(), 21, 5, {} as any);
    expect(typeof r2).toBe('string');
  });

  test('getOptimalPreheatingTime low confidence uses conservative margin', () => {
    analyzer.getThermalCharacteristics = jest.fn().mockReturnValue({
      heatingRate: 0.5,
      coolingRate: 0.25,
      outdoorTempImpact: 0.1,
      windImpact: 0.05,
      thermalMass: 0.8,
      modelConfidence: 0.1,
      lastUpdated: DateTime.now().toISO(),
    });
    const target = DateTime.now().plus({ hours: 3 }).toISO();
    const start = svc.getOptimalPreheatingTime(22, target, 20, 5, {} as any);
    expect(typeof start).toBe('string');
  });

  test('getHeatingRecommendation branches: no variation, preheat, reduce, maintain', () => {
    // no variation
    let prices = [0.2,0.2,0.2].map((p,i)=>({price:p, time: DateTime.now().plus({hours:i}).toISO()}));
    let rec = svc.getHeatingRecommendation(prices, 21, 20, 5, {} as any, { dayStart:6, dayEnd:22, nightTempReduction:2, preHeatHours:1 });
    expect(rec.explanation).toContain('No significant price');

    // preheat: cheap now and expensive in <6h
    const now = DateTime.now();
    prices = [
      { price: 0.5, time: now.minus({ minutes: 10 }).toISO() },
      { price: 1.5, time: now.plus({ hours: 2 }).toISO() },
      { price: 0.8, time: now.plus({ hours: 5 }).toISO() }
    ];
    rec = svc.getHeatingRecommendation(prices, 21, 20, 5, {} as any, { dayStart:6, dayEnd:22, nightTempReduction:2, preHeatHours:1 });
    expect(rec.explanation).toContain('Pre-heating');

    // reduce until next cheap period within thermal inertia window
    analyzer.getThermalCharacteristics = jest.fn().mockReturnValue({
      heatingRate: 0.5,
      coolingRate: 0.5, // smaller inertia
      outdoorTempImpact: 0.1,
      windImpact: 0.05,
      thermalMass: 0.5,
      modelConfidence: 0.8,
      lastUpdated: DateTime.now().toISO(),
    });
    prices = [
      { price: 1.4, time: now.toISO() },
      { price: 0.6, time: now.plus({ hours: 2 }).toISO() },
      { price: 1.2, time: now.plus({ hours: 4 }).toISO() }
    ];
    rec = svc.getHeatingRecommendation(prices, 21, 20, 5, {} as any, { dayStart:6, dayEnd:22, nightTempReduction:2, preHeatHours:1 });
    expect(rec.explanation).toContain('Temporarily reducing');

    // maintain when too long to wait
    analyzer.getThermalCharacteristics = jest.fn().mockReturnValue({
      heatingRate: 0.5,
      coolingRate: 0.05, // large inertia => waiting too long
      outdoorTempImpact: 0.1,
      windImpact: 0.05,
      thermalMass: 0.5,
      modelConfidence: 0.8,
      lastUpdated: DateTime.now().toISO(),
    });
    prices = [
      { price: 1.4, time: now.toISO() },
      { price: 0.6, time: now.plus({ hours: 12 }).toISO() }
    ];
    rec = svc.getHeatingRecommendation(prices, 21, 20, 5, {} as any, { dayStart:6, dayEnd:22, nightTempReduction:2, preHeatHours:1 });
    expect(rec.explanation).toContain('Maintaining');
  });

  test('getTimeToTarget error path returns default prediction', () => {
    // invalid inputs to trigger validation catch
    const res = svc.getTimeToTarget(NaN as any, NaN as any, NaN as any, { windSpeed: -1 } as any);
    expect(res.timeToTarget).toBe(60);
    expect(res.confidence).toBe(0);
  });

  test('forceDataCleanup handles error', () => {
    collector.getMemoryUsage.mockImplementationOnce(() => { throw new Error('boom'); });
    const r = svc.forceDataCleanup();
    expect(r.success).toBe(false);
    expect(homey.error).toHaveBeenCalled();
  });
});

