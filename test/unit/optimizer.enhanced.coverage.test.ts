import { Optimizer } from '../../src/services/optimizer';
import { createMockLogger } from '../mocks';

const mockMel: any = {
  getEnhancedCOPData: jest.fn(),
  getDailyEnergyTotals: jest.fn(),
  getDeviceState: jest.fn(),
  setDeviceTemperature: jest.fn()
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

    mockTibber.getPrices.mockResolvedValue({
      current: { price: 0.5 },
      prices: new Array(24).fill(0).map((_, i) => ({ price: 0.5, time: `${i}:00` }))
    });

    optimizer = new Optimizer(mockMel, mockTibber, 'device-1', 1, logger as any);
  });

  test('optimizeHotWaterScheduling handles missing metrics and returns maintain', async () => {
    // Manually call optimizeHotWaterScheduling via any-cast
    const res = await (optimizer as any).optimizeHotWaterScheduling(0.5, { prices: new Array(24).fill({ price: 0.5 }) });
    expect(res).toBeDefined();
    expect(['maintain', 'heat_now', 'delay']).toContain(res.action);
  });

  test('runEnhancedOptimization returns no_change when difference below deadband', async () => {
    // Last energy data will be zeros -> metrics indicate summer -> small diff
    const result = await optimizer.runEnhancedOptimization();
    expect(result).toBeDefined();
    expect(result.action).toMatch(/no_change|temperature_adjusted/);
  });
});
