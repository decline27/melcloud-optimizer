import { Optimizer } from '../../src/services/optimizer';

function makeLogger() {
  return { log: jest.fn(), error: jest.fn() } as any;
}

describe('Optimizer hot water & thermal helpers', () => {
  let optimizer: any;

  beforeEach(() => {
    const logger = makeLogger();
    optimizer = new Optimizer({} as any, {} as any, 'dev', 1, logger);
    // Ensure defaults
    optimizer.setTemperatureConstraints(18, 24, 0.5);
  });

  test('optimizeHotWaterScheduling: excellent COP -> heat_now when cheap', async () => {
    // Setup last energy data and metrics
    optimizer.lastEnergyData = { TotalHotWaterConsumed: 70 };

    optimizer.getRealEnergyMetrics = async () => ({
      realHotWaterCOP: 4.0,
      realHeatingCOP: 2.0,
      dailyEnergyConsumption: 10,
      heatingEfficiency: 0.5,
      hotWaterEfficiency: 0.9,
      seasonalMode: 'summer',
      optimizationFocus: 'hotwater'
    });

    // create priceData with cheapest current price
    const prices = Array.from({ length: 24 }, (_, i) => ({ time: `${i}:00`, price: i === 0 ? 1 : 100 }));

    const res = await optimizer.optimizeHotWaterScheduling(1, { prices });

    expect(res).toBeDefined();
    expect(['heat_now', 'delay', 'maintain']).toContain(res.action);
    expect(res.action).toBe('heat_now');
  });

  test('optimizeHotWaterScheduling: poor COP -> delay', async () => {
    optimizer.lastEnergyData = { TotalHotWaterConsumed: 70 };

    optimizer.getRealEnergyMetrics = async () => ({
      realHotWaterCOP: 0.5,
      realHeatingCOP: 1.0,
      dailyEnergyConsumption: 8,
      heatingEfficiency: 0.3,
      hotWaterEfficiency: 0.1,
      seasonalMode: 'winter',
      optimizationFocus: 'both'
    });

    const prices = Array.from({ length: 24 }, (_, i) => ({ time: `${i}:00`, price: i }));

    const res = await optimizer.optimizeHotWaterScheduling(5, { prices });

    expect(res).toBeDefined();
    expect(['heat_now', 'delay', 'maintain']).toContain(res.action);
    // poor COP should not choose heat_now for mid price
    expect(res.action).not.toBe('heat_now');
  });

  test('calculatePreheatingValue, calculateCoastingSavings, calculateBoostValue return numbers', () => {
    const cheapest = [{ price: 1 }, { price: 2 }, { price: 3 }, { price: 4 }];

    const pre = optimizer.calculatePreheatingValue(22, cheapest, { heating: 3, hotWater: 2, outdoor: 5 }, 5);
    const coast = optimizer.calculateCoastingSavings(2, 3, { heating: 2, hotWater: 1, outdoor: 0 });
    const boost = optimizer.calculateBoostValue(24, 3, { heating: 2, hotWater: 1, outdoor: 0 });

    expect(typeof pre).toBe('number');
    expect(typeof coast).toBe('number');
    expect(typeof boost).toBe('number');
  });
});
