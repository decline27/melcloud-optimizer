import { Optimizer } from '../../src/services/optimizer';
import { createMockLogger } from '../mocks';

const mockMel: any = {
  getEnhancedCOPData: jest.fn(),
  getDailyEnergyTotals: jest.fn(),
  getDeviceState: jest.fn(),
  setDeviceTemperature: jest.fn(),
  setZoneTemperature: jest.fn(),
  setTankTemperature: jest.fn()
};

const mockTibber: any = {
  getPrices: jest.fn()
};

describe('Optimizer hotwater & enhanced edge cases', () => {
  let optimizer: Optimizer;
  let logger = createMockLogger();

  beforeEach(() => {
    jest.clearAllMocks();
    logger = createMockLogger();
    mockMel.getEnhancedCOPData.mockResolvedValue({
      current: { heating: 1.2, hotWater: 0.8, outdoor: 5 },
      daily: { TotalHeatingConsumed: 0, TotalHotWaterConsumed: 0, CoP: [], AverageHeatingCOP: 0, AverageHotWaterCOP: 0 },
      trends: { heatingTrend: 'stable', hotWaterTrend: 'stable' },
      historical: { heating: 0, hotWater: 0 }
    });

    mockMel.getDeviceState.mockResolvedValue({
      RoomTemperature: 20,
      SetTemperature: 20,
      OutdoorTemperature: 5
    });
    mockMel.setZoneTemperature.mockResolvedValue(true);
    mockMel.setTankTemperature.mockResolvedValue(true);

    const nowIso = new Date().toISOString();
    mockTibber.getPrices.mockResolvedValue({
      current: { price: 0.5, time: nowIso },
      prices: new Array(24).fill(0).map((_, i) => ({ price: 0.5, time: new Date(Date.now() + i * 3600000).toISOString() })),
      priceLevel: 'CHEAP'
    });

    optimizer = new Optimizer(mockMel, mockTibber, 'device-1', 1, logger as any);
  });

  test('optimizeHotWaterScheduling handles missing metrics and returns maintain', async () => {
    // Access through the hotWaterOptimizer service
    const res = await (optimizer as any).hotWaterOptimizer.optimizeHotWaterScheduling(
      0.5,
      { current: { price: 0.5, time: new Date().toISOString() }, prices: new Array(24).fill({ price: 0.5, time: new Date().toISOString() }) },
      null, // No metrics
      null  // No last energy data
    );
    expect(res).toBeDefined();
    expect(['maintain', 'heat_now', 'delay']).toContain(res.action);
    expect(res.action).toBe('maintain'); // Should return maintain when no metrics
  });

  test('runOptimization returns no_change when difference below deadband', async () => {
    // Last energy data will be zeros -> metrics indicate summer -> small diff
    const result = await optimizer.runOptimization();
    expect(result).toBeDefined();
    expect(result.action).toMatch(/no_change|temperature_adjusted/);
  });

  test('runOptimization includes zone2 data when zone2 enabled', async () => {
    optimizer.setZone2TemperatureConstraints(true, 18, 22, 0.5);
    mockMel.getDeviceState.mockResolvedValue({
      RoomTemperature: 20,
      RoomTemperatureZone1: 20,
      SetTemperature: 20,
      SetTemperatureZone1: 20,
      OutdoorTemperature: 5,
      RoomTemperatureZone2: 19,
      SetTemperatureZone2: 21
    });

    const result = await optimizer.runOptimization();
    expect(result.zone2Data).toBeDefined();
  });

  test('Zone2 honors its own temperature step when rounding', async () => {
    optimizer.setZone2TemperatureConstraints(true, 18, 25, 0.5); // Zone2 step = 0.5
    // Set Zone 1 deadband to a value that won't block our step-limited changes
    (optimizer as any).constraintManager.setZone1Deadband(0.3);

    const inputs: any = {
      deviceState: {
        SetTemperatureZone2: 20,
        RoomTemperatureZone2: 20,
        RoomTemperature: 20,
        SetTemperature: 20,
        OutdoorTemperature: 5
      },
      currentTemp: 20,
      currentTarget: 20,
      outdoorTemp: 5,
      priceData: { current: { price: 0.5, time: new Date().toISOString() }, prices: [] },
      priceStats: { priceLevel: 'CHEAP' },
      priceClassification: { thresholds: {} },
      priceForecast: null,
      planningReferenceTime: new Date(),
      planningReferenceTimeMs: Date.now(),
      thermalResponse: 1,
      previousIndoorTemp: null,
      previousIndoorTempTs: null,
      constraintsBand: { minTemp: 18, maxTemp: 22 },
      safeCurrentTarget: 20
    };

    const zone1Result: any = {
      targetTemp: 21.44, // Zone2 will ramp-limit to +0.5°C per change, rounded to step
      weatherInfo: null,
      thermalStrategy: null,
      metrics: null
    };

    const result = await (optimizer as any).optimizeZone2(inputs, zone1Result, jest.fn());

    // With maxDeltaPerChangeC = 0.5 (step size), change is limited from 20 -> 20.5
    const [, , issuedTarget] = mockMel.setZoneTemperature.mock.calls[0];
    expect(issuedTarget).toBeCloseTo(20.5, 2);
    expect(result.toTemp).toBeCloseTo(20.5, 2);
  });

  test('runOptimization includes tank data when tank control enabled', async () => {
    optimizer.setTankTemperatureConstraints(true, 40, 50, 1);
    mockMel.getDeviceState.mockResolvedValue({
      RoomTemperature: 20,
      RoomTemperatureZone1: 20,
      SetTemperature: 20,
      SetTemperatureZone1: 20,
      OutdoorTemperature: 5,
      SetTankWaterTemperature: 48
    });

    const result = await optimizer.runOptimization();
    expect(result.tankData).toBeDefined();
  });

  test('calculateDailySavings falls back to non-price-aware calculation on Tibber error', async () => {
    mockTibber.getPrices.mockRejectedValueOnce(new Error('boom'));
    const projection = await optimizer.getSavingsService().calculateDailySavings(1);
    // On error, it falls back to the enhanced savings calculator which calculates based on
    // remaining hours in the day and applies clamping. The result should still be a positive number.
    expect(projection).toBeGreaterThan(0);
    expect(projection).toBeLessThanOrEqual(24); // Max possible with hourly savings of 1
  });

  test('thermal model cleanup helper returns safe defaults when service unavailable', () => {
    expect(optimizer.forceThermalDataCleanup()).toEqual({ success: false, message: 'Thermal model service not initialized' });
  });
});
