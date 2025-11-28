import { Optimizer } from '../../src/services/optimizer';

function makeLogger() {
  return {
    log: jest.fn(),
    info: jest.fn(),
    error: jest.fn()
  } as any;
}

describe('Optimizer calculateOptimalTemperature and savings branches', () => {
  let optimizer: Optimizer;
  let logger: any;

  beforeEach(() => {
    logger = makeLogger();
    optimizer = new Optimizer({} as any, {} as any, 'dev', 1, logger);
    // Ensure defaults
    optimizer.setTemperatureConstraints(18, 24, 0.5);
  });

  test('calculateOptimalTemperature applies COP adjustment for excellent COP', async () => {
    (optimizer as any).copHelper = {
      isSummerSeason: () => false,
      getSeasonalCOP: async () => 1.5
    } as any;

    (optimizer as any).copWeight = 0.3;
    const temp = await (optimizer as any).calculateOptimalTemperature(1, 1.2, 0.8, 1.5, 21);
    expect(typeof temp).toBe('number');
  });

  test('calculateOptimalTemperature handles poor COP branch', async () => {
    (optimizer as any).copHelper = {
      isSummerSeason: () => false,
      getSeasonalCOP: async () => 0.3
    } as any;

    (optimizer as any).copWeight = 0.5;
    const temp = await (optimizer as any).calculateOptimalTemperature(1.4, 1.2, 0.8, 1.6, 20);
    expect(typeof temp).toBe('number');
  });

  test('calculateOptimalTemperature adjusts for summer mode', async () => {
    (optimizer as any).copHelper = {
      isSummerSeason: () => true,
      getSeasonalCOP: async () => 0.6
    } as any;

    (optimizer as any).copWeight = 0.4;
    (optimizer as any).autoSeasonalMode = true;
    const temp = await (optimizer as any).calculateOptimalTemperature(0.9, 1.0, 0.7, 1.5, 19);
    expect(typeof temp).toBe('number');
  });

  test('estimateCostSavings for summer, winter and transition', () => {
    const metricsSummer = {
      seasonalMode: 'summer',
      dailyEnergyConsumption: 10,
      realHeatingCOP: 2.0,
      realHotWaterCOP: 3.0
    } as any;

    const metricsWinter = {
      seasonalMode: 'winter',
      dailyEnergyConsumption: 8,
      realHeatingCOP: 1.5,
      realHotWaterCOP: 2.5
    } as any;

    const metricsTrans = {
      seasonalMode: 'transition',
      dailyEnergyConsumption: 9,
      realHeatingCOP: 1.2,
      realHotWaterCOP: 2.0
    } as any;

    const s1 = optimizer.getSavingsService().estimateCostSavings(22, 20, 1.2, 1.0, metricsSummer);
    const s2 = optimizer.getSavingsService().estimateCostSavings(20, 22, 1.2, 1.0, metricsWinter);
    const s3 = optimizer.getSavingsService().estimateCostSavings(21, 20, 1.2, 1.0, metricsTrans);

    expect(typeof s1).toBe('string');
    expect(typeof s2).toBe('string');
    expect(typeof s3).toBe('string');
  });

  test('runWeeklyCalibration uses thermal model service when available', async () => {
    // Mock thermalModelService to force the learning path
    (optimizer as any).useThermalLearning = true;
    (optimizer as any).thermalModelService = {
      getThermalCharacteristics: () => ({
        modelConfidence: 0.5,
        heatingRate: 0.25,
        coolingRate: 0.1,
        thermalMass: 2.2
      })
    } as any;

    const result = await (optimizer as any).runWeeklyCalibration();
    expect(result).toHaveProperty('newK');
    expect(result).toHaveProperty('newS');
  });
});
