import { Optimizer } from '../../src/services/optimizer';

const logger = {
  log: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
};

const mel: any = {
  getDeviceState: jest.fn(),
  setDeviceTemperature: jest.fn(),
};

const tibber: any = { getPrices: jest.fn() };

/*
 * These tests have been disabled because calculateThermalMassStrategy is no longer
 * a method on the Optimizer class. It has been refactored into the ThermalController service.
 * 
 * The functionality is still tested through:
 * 1. Integration tests that call runEnhancedOptimization (which uses ThermalController internally)
 * 2. Direct tests of ThermalController in thermal-controller.test.ts (if needed)
 * 
 * The refactoring improved separation of concerns by moving thermal strategy calculation
 * to a dedicated service.
 */

describe.skip('Optimizer.calculateThermalMassStrategy branches (DISABLED - method moved to ThermalController)', () => {
  let opt: Optimizer;

  beforeEach(() => {
    jest.clearAllMocks();
    opt = new Optimizer(mel, tibber, 'dev1', 1, logger as any);
  });

  function pricesWithCheapest(countCheap: number, cheapPrice = 0.1, expensivePrice = 1.0) {
    const arr = new Array(24).fill(0).map((_, i) => ({ price: expensivePrice, time: `${i}:00` }));
    for (let i = 0; i < Math.min(countCheap, 24); i++) arr[i].price = cheapPrice;
    return arr;
  }

  test('preheat branch when very cheap and high COP with room for preheating', () => {
    const future = pricesWithCheapest(4); // 4/24 = 0.166 <= 0.2
    const res = (opt as any).calculateThermalMassStrategy(
      20, // currentTemp
      21, // targetTemp
      0.1, // currentPrice
      future,
      { heating: 4.5, hotWater: 3.5, outdoor: 5 }
    );
    expect(res.action).toBe('preheat');
    expect(res.targetTemp).toBeGreaterThanOrEqual(21);
  });

  test('coast branch when very expensive and above target', () => {
    const future = pricesWithCheapest(4); // majority expensive
    const res = (opt as any).calculateThermalMassStrategy(
      22, // currentTemp
      21, // targetTemp
      1.5, // current price high
      future,
      { heating: 3.0, hotWater: 2.5, outdoor: 5 }
    );
    expect(res.action).toBe('coast');
    expect(res.targetTemp).toBeLessThanOrEqual(21);
  });

  test('boost branch when cheap, excellent COP, and below target', () => {
    const future = pricesWithCheapest(6); // 6/24 = 0.25 <= user's cheap threshold (0.25)
    const res = (opt as any).calculateThermalMassStrategy(
      19, // currentTemp below target by >1
      21.5, // targetTemp
      0.1,
      future,
      { heating: 4.6, hotWater: 3.5, outdoor: 5 }
    );
    expect(res.action).toBe('boost');
    expect(res.targetTemp).toBeGreaterThan(21);
  });

  test('maintain branch for normal conditions', () => {
    const future = pricesWithCheapest(4);
    const res = (opt as any).calculateThermalMassStrategy(
      21, // currentTemp
      21, // targetTemp
      0.5,
      future,
      { heating: 3.0, hotWater: 2.0, outdoor: 5 }
    );
    expect(res.action).toBe('maintain');
  });

  test('error path returns maintain with safe defaults', () => {
    const res = (opt as any).calculateThermalMassStrategy(
      21,
      21,
      0.5,
      null as any, // cause internal error on slice
      { heating: 3.0, hotWater: 2.0, outdoor: 5 }
    );
    expect(res.action).toBe('maintain');
  });
});

