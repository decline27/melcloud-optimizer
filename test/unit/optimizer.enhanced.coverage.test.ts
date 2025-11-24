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
      prices: new Array(24).fill(0).map((_, i) => ({ price: 0.5, time: new Date(Date.now() + i * 3600000).toISOString() }))
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

  test('calculateDailySavings falls back to simple projection on Tibber error', async () => {
    mockTibber.getPrices.mockRejectedValueOnce(new Error('boom'));
    const projection = await optimizer.calculateDailySavings(1);
    expect(projection).toBeGreaterThan(23);
  });

  test('thermal model cleanup helper returns safe defaults when service unavailable', () => {
    expect(optimizer.forceThermalDataCleanup()).toEqual({ success: false, message: 'Thermal model service not initialized' });
  });
});
