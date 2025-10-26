import { DateTime } from 'luxon';
import { AggregatedDataPoint, ThermalDataCollector, ThermalDataPoint } from '../../src/services/thermal-model';

const createThermalPoint = (timestamp: DateTime): ThermalDataPoint => ({
  timestamp: timestamp.toISO()!,
  indoorTemperature: 21.5,
  outdoorTemperature: 5.0,
  targetTemperature: 22.0,
  heatingActive: true,
  weatherConditions: {
    windSpeed: 3.0,
    humidity: 70,
    cloudCover: 80,
    precipitation: 0
  },
  energyUsage: 0.5
});

describe('ThermalDataCollector retention policies', () => {
  let dataCollector: ThermalDataCollector;
  let mockHomey: any;
  let settingsStore: Record<string, any>;

  beforeEach(() => {
    jest.clearAllMocks();
    settingsStore = {};

    mockHomey = {
      log: jest.fn(),
      error: jest.fn(),
      env: { userDataPath: '/mock/path' },
      settings: {
        get: jest.fn((key: string) => settingsStore[key] ?? null),
        set: jest.fn((key: string, value: any) => {
          settingsStore[key] = value;
        })
      }
    };

    dataCollector = new ThermalDataCollector(mockHomey);
  });

  it('falls back to safe defaults when settings are missing', () => {
    const config = (dataCollector as any).getRetentionConfig();
    expect(config).toEqual({
      retentionDays: 60,
      fullResDays: 14,
      maxPoints: 10000,
      targetKB: 500
    });
  });

  it('clamps full resolution days so they never exceed retention days', () => {
    settingsStore.thermal_retention_days = 20;
    settingsStore.thermal_fullres_days = 40;

    const config = (dataCollector as any).getRetentionConfig();
    expect(config.retentionDays).toBe(20);
    expect(config.fullResDays).toBe(20);
  });

  it('keeps at least 100 full-resolution points after retention maintenance', () => {
    settingsStore.thermal_retention_days = 60;
    settingsStore.thermal_fullres_days = 3;
    settingsStore.thermal_max_points = 10000;
    settingsStore.thermal_target_kb = 900;

    const points: ThermalDataPoint[] = [];
    for (let i = 0; i < 150; i += 1) {
      points.push(createThermalPoint(DateTime.now().minus({ hours: 150 - i })));
    }

    (dataCollector as any).dataPoints = points;
    dataCollector.runRetentionMaintenance('unit-test');

    const remaining = dataCollector.getAllDataPoints();
    expect(remaining.length).toBeGreaterThanOrEqual(100);
  });

  it('increases hourly aggregation span when guard thresholds are exceeded', () => {
    settingsStore.thermal_retention_days = 60;
    settingsStore.thermal_fullres_days = 3;
    settingsStore.thermal_max_points = 10000;
    settingsStore.thermal_target_kb = 900;

    const base = DateTime.now().minus({ days: 5 });
    const hourlyBuckets: AggregatedDataPoint[] = [];
    for (let i = 0; i < 120; i += 1) {
      hourlyBuckets.push({
        date: base.minus({ hours: i }).toISO(),
        bucket: 'hour',
        bucketSpanHours: 1,
        avgIndoorTemp: 21,
        avgOutdoorTemp: 4,
        avgTargetTemp: 22,
        heatingHours: 0.5,
        avgWindSpeed: 3,
        avgHumidity: 65,
        totalEnergyUsage: 0.5,
        dataPointCount: 6
      });
    }

    (dataCollector as any).aggregatedData = hourlyBuckets;

    const config = {
      retentionDays: 60,
      fullResDays: 3,
      maxPoints: 50,
      targetKB: 1
    };

    (dataCollector as any).enforceCapsByAggregationAndTrim(config, 'unit-test', {
      promotedToFullRes: 0,
      aggregatedMid: hourlyBuckets.length,
      aggregatedLow: 0,
      droppedRaw: 0
    });

    const updatedMid = ((dataCollector as any).aggregatedData as AggregatedDataPoint[]).filter(point => point.bucket === 'hour');
    expect(updatedMid.length).toBeLessThan(hourlyBuckets.length);
    expect(updatedMid.every(point => (point.bucketSpanHours ?? 1) > 1)).toBe(true);
  });
});
