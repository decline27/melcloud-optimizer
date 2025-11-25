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

  describe('Pattern Savings Calculation', () => {
    test('calculatePatternSavings: basic savings calculation', () => {
      const schedulePoints = [
        { hour: 2, priority: 0.8, reason: 'cheap', cop: 3.0, pricePercentile: 0.1 },
        { hour: 14, priority: 0.5, reason: 'moderate', cop: 3.0, pricePercentile: 0.5 }
      ];

      const priceData = [
        { hour: 0, time: '0:00', price: 0.50 },
        { hour: 1, time: '1:00', price: 0.40 },
        { hour: 2, time: '2:00', price: 0.30 }, // ← Scheduled here (cheap)
        { hour: 3, time: '3:00', price: 0.50 },
        { hour: 4, time: '4:00', price: 0.55 },
        { hour: 5, time: '5:00', price: 0.60 },
        { hour: 6, time: '6:00', price: 0.65 },
        { hour: 7, time: '7:00', price: 0.70 },
        { hour: 8, time: '8:00', price: 0.60 },
        { hour: 9, time: '9:00', price: 0.55 },
        { hour: 10, time: '10:00', price: 0.50 },
        { hour: 11, time: '11:00', price: 0.55 },
        { hour: 12, time: '12:00', price: 0.60 },
        { hour: 13, time: '13:00', price: 0.65 },
        { hour: 14, time: '14:00', price: 0.60 }, // ← Scheduled here (mid)
        { hour: 15, time: '15:00', price: 0.70 },
        { hour: 16, time: '16:00', price: 0.75 },
        { hour: 17, time: '17:00', price: 0.80 },
        { hour: 18, time: '18:00', price: 0.75 },
        { hour: 19, time: '19:00', price: 0.70 },
        { hour: 20, time: '20:00', price: 0.65 },
        { hour: 21, time: '21:00', price: 0.60 },
        { hour: 22, time: '22:00', price: 0.55 },
        { hour: 23, time: '23:00', price: 0.50 }
      ];

      const savings = hotWaterOptimizer['calculatePatternSavings'](
        schedulePoints,
        0, // current hour
        priceData,
        { gridFeePerKwh: 0, estimatedDailyHotWaterKwh: 3 }
      );

      // Expected:
      // Total priority = 1.3, estimatedDailyHotWaterKwh = 3
      // Hour 2 allocation: (0.8 / 1.3) * 3 = 1.846 kWh @ 0.30 = 0.554
      // Hour 14 allocation: (0.5 / 1.3) * 3 = 1.154 kWh @ 0.60 = 0.692
      // Scheduled cost = 1.246
      // Avg price ≈ 0.583, total demand 3 kWh => on-demand = 1.749
      // Savings ≈ 0.503

      expect(savings).toBeGreaterThan(0);
      expect(savings).toBeLessThan(1.0); // Reasonable range
      expect(savings).toBeCloseTo(0.535, 2);
    });

    test('calculatePatternSavings: returns 0 for no schedule points', () => {
      const priceData = [
        { hour: 0, time: '0:00', price: 0.50 },
        { hour: 1, time: '1:00', price: 0.60 }
      ];
      const savings = hotWaterOptimizer['calculatePatternSavings']([], 0, priceData, { estimatedDailyHotWaterKwh: 3 });
      expect(savings).toBe(0);
    });

    test('calculatePatternSavings: returns 0 for empty price data', () => {
      const schedulePoints = [
        { hour: 2, priority: 0.8, reason: 'cheap', cop: 3.0, pricePercentile: 0.1 }
      ];
      const savings = hotWaterOptimizer['calculatePatternSavings'](schedulePoints, 0, []);
      expect(savings).toBe(0);
    });

    test('optimizeHotWaterSchedulingByPattern: includes savings in result', () => {
      const priceData = Array.from({ length: 24 }, (_, i) => ({
        hour: i,
        time: `${i}:00`,
        price: i === 2 || i === 3 ? 0.30 : 0.60 // Hours 2-3 are cheap
      }));

      const usagePattern = {
        peakHours: [7, 18], // Morning and evening peaks
        hourlyDemand: Array(24).fill(0.1).map((v, i) =>
          i === 7 || i === 18 ? 0.8 : v
        )
      };

      // Use currentHour = 5, so peak at 7 is 2 hours ahead
      // Valid heating window for peak 7: hours 3,4,5,6 (4 hours before)
      // Valid heating window for peak 18: hours 14,15,16,17 (4 hours before)
      const result = hotWaterOptimizer.optimizeHotWaterSchedulingByPattern(
        5, // current hour is 5
        priceData,
        3.0, // hot water COP
        usagePattern,
        undefined,
        { currencyCode: 'NOK', estimatedDailyHotWaterKwh: usagePattern.hourlyDemand.reduce((s, v) => s + v, 0) }
      );

      expect(result.estimatedSavings).toBeGreaterThan(0);
      expect(result.reasoning).toContain('saves');
      expect(result.reasoning).toContain('NOK');
    });
  });
});
