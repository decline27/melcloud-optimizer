import { Optimizer } from '../../src/services/optimizer';
import { MelCloudApi } from '../../src/services/melcloud-api';
import { TibberApi } from '../../src/services/tibber-api';

// Mock deps
jest.mock('../../src/services/melcloud-api');
jest.mock('../../src/services/tibber-api');

describe('Optimizer + Engine integration and safety', () => {
  let optimizer: Optimizer;
  let mel: jest.Mocked<MelCloudApi>;
  let tib: jest.Mocked<TibberApi>;
  const logger: any = { log: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() };

  const nowIso = new Date().toISOString();

  // Helper to build a Homey-like settings object
  const makeHomey = (overrides: Record<string, any> = {}) => ({
    settings: {
      get: jest.fn((key: string) => {
        const base: Record<string, any> = {
          melcloud_user: 'u', melcloud_pass: 'p', tibber_token: 't',
          device_id: '123', building_id: 456,
          min_temp: 18, max_temp: 22,
          use_engine: true,
          deadband_c: 0.3,
          min_setpoint_change_minutes: 15,
          extreme_weather_min_temp: 20,
          occupied: true,
          comfort_lower_occupied: 20.0,
          comfort_upper_occupied: 21.0,
          comfort_lower_away: 19.0,
          comfort_upper_away: 20.5,
          preheat_enable: true,
          preheat_horizon_hours: 12,
          preheat_cheap_percentile: 0.25,
          ...overrides
        };
        return base[key];
      }),
      set: jest.fn(),
      unset: jest.fn()
    }
  }) as any;

  beforeEach(() => {
    jest.clearAllMocks();
    mel = new MelCloudApi() as any;
    tib = new TibberApi('t') as any;

    // default device state
    mel.getDeviceState = jest.fn().mockResolvedValue({
      DeviceID: '123', BuildingID: 456,
      RoomTemperatureZone1: 20.2,
      SetTemperatureZone1: 20.0,
      OutdoorTemperature: 5,
      Power: true
    });
    mel.setDeviceTemperature = jest.fn().mockResolvedValue(true);

    // minimal enhanced COP data to avoid fallback paths
    (mel as any).getEnhancedCOPData = jest.fn().mockResolvedValue({
      current: { heating: 3, hotWater: 2.5, outdoor: 5, timestamp: new Date() },
      daily: { TotalHeatingConsumed: 5, TotalHotWaterConsumed: 2 },
      historical: { heating: 3, hotWater: 2.5 },
      trends: { heatingTrend: 'stable', hotWaterTrend: 'stable', averageHeating: 3, averageHotWater: 2.5 },
      predictions: { nextHourHeating: 3, nextHourHotWater: 2.5, confidenceLevel: 0.8 }
    });

    tib.getPrices = jest.fn().mockResolvedValue({
      current: { price: 0.10, time: nowIso },
      prices: [
        { price: 0.10, time: nowIso },
        { price: 0.25, time: new Date(Date.now()+3600e3).toISOString() },
        { price: 0.30, time: new Date(Date.now()+7200e3).toISOString() }
      ]
    });
  });

  test('Engine ON adjusts temperature when price is cheap and no lockout', async () => {
    const homey = makeHomey({ use_engine: true });
    optimizer = new Optimizer(mel, tib, '123', 456, logger, undefined, homey);

    const res = await optimizer.runEnhancedOptimization();

    expect(res).toBeDefined();
    expect(res!.action).toBe('temperature_adjusted');
    expect(mel.setDeviceTemperature).toHaveBeenCalledTimes(1);
    // Should raise or at least change from 20.0 by >= deadband
    const argTemp = (mel.setDeviceTemperature as jest.Mock).mock.calls[0][2];
    expect(argTemp).toBeGreaterThanOrEqual(20.3); // 0.3 deadband above 20.0
  });

  test('Lockout prevents frequent setpoint changes (no change)', async () => {
    // Last change just 5 minutes ago, lockout 15 min
    const homey = makeHomey({ use_engine: true, last_setpoint_change_ms: Date.now() - 5*60000 });
    optimizer = new Optimizer(mel, tib, '123', 456, logger, undefined, homey);

    const res = await optimizer.runEnhancedOptimization();

    expect(res).toBeDefined();
    expect(res!.action).toBe('no_change');
    expect(String(res!.reason)).toMatch(/lockout/i);
    expect(mel.setDeviceTemperature).not.toHaveBeenCalled();
  });

  test('Stale Tibber price → safe hold (no change)', async () => {
    // Make current price timestamp stale (2 hours ago)
    tib.getPrices = jest.fn().mockResolvedValue({
      current: { price: 0.20, time: new Date(Date.now() - 2*3600e3).toISOString() },
      prices: [
        { price: 0.20, time: new Date(Date.now() - 2*3600e3).toISOString() },
        { price: 0.21, time: new Date(Date.now() - 3600e3).toISOString() }
      ]
    });

    const homey = makeHomey({ use_engine: true });
    optimizer = new Optimizer(mel, tib, '123', 456, logger, undefined, homey);

    const res = await optimizer.runEnhancedOptimization();
    expect(res).toBeDefined();
    expect(res!.action).toBe('no_change');
    expect(String(res!.reason)).toMatch(/stale price|safe hold/i);
    expect(mel.setDeviceTemperature).not.toHaveBeenCalled();
  });
});

