import { HotWaterOptimizer } from '../../src/services/hot-water-optimizer';
import { PriceAnalyzer } from '../../src/services/price-analyzer';
import { OptimizationMetrics } from '../../src/types';

// Mock dependencies
jest.mock('../../src/services/price-analyzer');

describe('HotWaterOptimizer', () => {
  let hotWaterOptimizer: HotWaterOptimizer;
  let mockLogger: any;
  let mockPriceAnalyzer: jest.Mocked<PriceAnalyzer>;

  beforeEach(() => {
    mockLogger = { log: jest.fn(), info: jest.fn(), error: jest.fn() };
    mockPriceAnalyzer = new PriceAnalyzer(mockLogger) as jest.Mocked<PriceAnalyzer>;
    // Mock getCheapPercentile
    mockPriceAnalyzer.getCheapPercentile = jest.fn().mockReturnValue(0.25);

    hotWaterOptimizer = new HotWaterOptimizer(mockLogger, mockPriceAnalyzer);
  });

  test('optimizeHotWaterScheduling: excellent COP -> heat_now when cheap', async () => {
    const metrics: OptimizationMetrics = {
      realHotWaterCOP: 4.0,
      realHeatingCOP: 2.0,
      dailyEnergyConsumption: 10,
      heatingEfficiency: 0.5,
      hotWaterEfficiency: 0.9,
      seasonalMode: 'summer',
      optimizationFocus: 'hotwater'
    };

    const lastEnergyData = { TotalHotWaterConsumed: 70 };

    // create priceData with cheapest current price
    const prices = Array.from({ length: 24 }, (_, i) => ({ time: `${i}:00`, price: i === 0 ? 1 : 100 }));
    const priceData = { current: { time: '0:00', price: 1 }, prices };

    const res = await hotWaterOptimizer.optimizeHotWaterScheduling(1, priceData, metrics, lastEnergyData);

    expect(res).toBeDefined();
    expect(['heat_now', 'delay', 'maintain']).toContain(res.action);
    expect(res.action).toBe('heat_now');
  });

  test('optimizeHotWaterScheduling: poor COP -> delay', async () => {
    const metrics: OptimizationMetrics = {
      realHotWaterCOP: 0.5,
      realHeatingCOP: 1.0,
      dailyEnergyConsumption: 8,
      heatingEfficiency: 0.3,
      hotWaterEfficiency: 0.1,
      seasonalMode: 'winter',
      optimizationFocus: 'both'
    };

    const lastEnergyData = { TotalHotWaterConsumed: 70 };

    const prices = Array.from({ length: 24 }, (_, i) => ({ time: `${i}:00`, price: i }));
    const priceData = { current: { time: '5:00', price: 5 }, prices };

    const res = await hotWaterOptimizer.optimizeHotWaterScheduling(5, priceData, metrics, lastEnergyData);

    expect(res).toBeDefined();
    expect(['heat_now', 'delay', 'maintain']).toContain(res.action);
    // poor COP should not choose heat_now for mid price
    expect(res.action).not.toBe('heat_now');
  });
});
