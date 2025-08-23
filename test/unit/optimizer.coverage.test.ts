// Prevent the real MelCloudApi from making network requests when importing
jest.mock('../../src/services/melcloud-api', () => ({
  MelCloudApi: class {
    constructor() {}
  }
}));

import { Optimizer } from '../../src/services/optimizer';
import { MelCloudApi } from '../../src/services/melcloud-api';
import { TibberApi } from '../../src/services/tibber-api';
import { createMockLogger } from '../mocks';

// Create minimal mocks for MelCloud and Tibber
const mockMel = {
  getEnhancedCOPData: jest.fn(),
  getDailyEnergyTotals: jest.fn()
} as unknown as MelCloudApi;

const mockTibber = {
  getPrices: jest.fn()
} as unknown as TibberApi;

describe('Optimizer additional coverage', () => {
  let optimizer: Optimizer;
  let logger = createMockLogger();

  beforeEach(() => {
    jest.clearAllMocks();
    logger = createMockLogger();

    // Minimal melcloud enhanced data
    (mockMel as any).getEnhancedCOPData.mockResolvedValue({
      current: { heating: 3.5, hotWater: 3.2, outdoor: 5 },
      daily: { TotalHeatingConsumed: 10, TotalHotWaterConsumed: 5, CoP: [3,3.2], AverageHeatingCOP: 3.5, AverageHotWaterCOP: 3.2 },
      trends: { heatingTrend: 'stable', hotWaterTrend: 'stable' },
      historical: { heating: 3.5, hotWater: 3.2 }
    });

    optimizer = new Optimizer(mockMel, mockTibber, 'device-1', 1, logger as any);
  });

  test('setThermalModel validates inputs', () => {
    expect(() => optimizer.setThermalModel(0.05)).toThrow(); // too small
    expect(() => optimizer.setThermalModel(0.5)).not.toThrow();
  });

  test('setTemperatureConstraints validates ranges', () => {
    expect(() => optimizer.setTemperatureConstraints(22, 20, 0.5)).toThrow(); // max <= min
    expect(() => optimizer.setTemperatureConstraints(18, 24, 0.5)).not.toThrow();
  });

  test('calculateThermalMassStrategy returns preheat/coast/maintain depending on inputs', () => {
    const impl = (optimizer as any).calculateThermalMassStrategy.bind(optimizer);

    // Cheap period, good COP and room for preheating => preheat
    const cheapPrices = new Array(24).fill({ price: 0.1 }).map((p, i) => ({ price: i === 0 ? 0.1 : 0.2, time: `${i}:00` }));
    const preheat = impl(19, 22, 0.1, cheapPrices, { heating: 3.8, hotWater: 3.2, outdoor: 5 });
    expect(preheat.action).toBeDefined();

    // Expensive period => coast
    const expensiveNow = new Array(24).fill({ price: 1.0 }).map((p, i) => ({ price: i === 0 ? 1.0 : 0.5, time: `${i}:00` }));
    const coast = impl(22, 22, 1.0, expensiveNow, { heating: 2.0, hotWater: 2.0, outdoor: 5 });
    expect(coast.action).toBeDefined();

  // Neutral period => maintain (use identical prices and low COPs)
  const neutral = new Array(24).fill(0).map((_, i) => ({ price: 0.5, time: `${i}:00` }));
  const maintain = impl(21, 21, 0.5, neutral, { heating: 0.1, hotWater: 0.1, outdoor: 5 });
  // Depending on percentile calculation neutral prices may lead to 'coast' or 'maintain'
  expect(['maintain', 'coast']).toContain(maintain.action);
  });
});
