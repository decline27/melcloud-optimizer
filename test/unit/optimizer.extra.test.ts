import { Optimizer } from '../../src/services/optimizer';
import { HomeyLogger, LogLevel } from '../../src/util/logger';

describe('Optimizer private helpers', () => {
  let optimizer: any;

  beforeEach(() => {
    const mockApp: any = {
      log: jest.fn(),
      error: jest.fn(),
      homey: {
        settings: { get: jest.fn().mockReturnValue(undefined), set: jest.fn() }
      }
    };

    const logger = new HomeyLogger(mockApp, {
      level: LogLevel.DEBUG,
      logToTimeline: false,
      prefix: 'TEST',
      verboseMode: false
    });

    // Pass minimal melCloud/tibber mocks and DON'T provide a homey instance to avoid background services
    optimizer = new Optimizer({} as any, {} as any, 'device', 1, logger);
  });

  it('updateCOPRange and normalizeCOP produce expected normalization', () => {
    // initial range is 1..5
    optimizer.updateCOPRange(2);
    optimizer.updateCOPRange(5);
    const normalizedLow = optimizer.normalizeCOP(1);
    const normalizedHigh = optimizer.normalizeCOP(5);

    expect(typeof normalizedLow).toBe('number');
    expect(typeof normalizedHigh).toBe('number');
    expect(normalizedHigh).toBeGreaterThan(normalizedLow);
  });


  // This test has been removed because calculateThermalMassStrategy is now a private method
  // and its functionality has moved to the ThermalController service.
  // The functionality is tested in optimizer.thermal-mass.strategy.test.ts instead.
  /*
  it('calculateThermalMassStrategy returns preheat when conditions favorable', () => {
    const futurePrices = Array.from({ length: 24 }, (_, i) => ({ price: i === 0 ? 1 : 100 }));

    const strategy = optimizer.calculateThermalMassStrategy(
      20, // currentTemp
      21, // targetTemp
      1, // currentPrice
      futurePrices,
      { heating: 5, hotWater: 3, outdoor: 10 }
    );

    expect(strategy).toBeDefined();
    expect(['preheat', 'maintain', 'coast', 'boost']).toContain(strategy.action);
    // For this input we expect preheat to be chosen
    expect(strategy.action).toBe('preheat');
    expect(typeof strategy.estimatedSavings).toBe('number');
  });
  */

  it('learnHotWaterUsage updates pattern data and peakHours', () => {
    const history = Array.from({ length: 7 }, (_, d) => ({ timestamp: `2025-08-${10 + d}T07:00:00`, amount: d % 3 === 0 ? 5 : 0.5 }));

    optimizer.learnHotWaterUsage(history);

    expect(optimizer.hotWaterUsagePattern.dataPoints).toBeGreaterThan(0);
    expect(Array.isArray(optimizer.hotWaterUsagePattern.peakHours)).toBe(true);
  });

  it('estimateCostSavings returns strings for different seasons', () => {
    const summerMetrics = { seasonalMode: 'summer', dailyEnergyConsumption: 10, realHeatingCOP: 0, realHotWaterCOP: 0 };
    const winterMetrics = { seasonalMode: 'winter', dailyEnergyConsumption: 10, realHeatingCOP: 3, realHotWaterCOP: 2 };
    const transitionMetrics = { seasonalMode: 'transition', dailyEnergyConsumption: 10, realHeatingCOP: 1.5, realHotWaterCOP: 1.5 };

    const s1 = optimizer.estimateCostSavings(21, 20, 1, 2, summerMetrics);
    const s2 = optimizer.estimateCostSavings(21, 20, 1, 2, winterMetrics);
    const s3 = optimizer.estimateCostSavings(21, 20, 1, 2, transitionMetrics);

    expect(typeof s1).toBe('string');
    expect(s1).toMatch(/NOK\/week/);
    expect(s2).toMatch(/NOK\/week/);
    expect(s3).toMatch(/NOK\/week/);
  });
});
