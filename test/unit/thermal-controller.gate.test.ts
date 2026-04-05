import { ThermalController } from '../../src/services/thermal-controller';
import { CopNormalizer } from '../../src/services/cop-normalizer';
import { ThermalModelService } from '../../src/services/thermal-model';
import { PricePoint } from '../../src/types';

const HOUR_MS = 60 * 60 * 1000;

const makeLogger = () => ({
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}) as any;

const makeThermalModelService = (coolingRate: number, confidence: number) => ({
  getThermalCharacteristics: jest.fn().mockReturnValue({
    heatingRate: 0.5,
    coolingRate,
    outdoorTempImpact: 0,
    windImpact: 0,
    thermalMass: 0.8,
    modelConfidence: confidence,
    lastUpdated: new Date().toISOString()
  })
}) as unknown as ThermalModelService;

const buildPriceSeries = (referenceTimeMs: number, currentPrice: number, futurePrice: number): PricePoint[] => {
  return Array.from({ length: 8 }).map((_, idx) => ({
    time: new Date(referenceTimeMs + idx * HOUR_MS).toISOString(),
    price: idx === 0 ? currentPrice : futurePrice
  }));
};

describe('ThermalController preheat cost/benefit gate', () => {
  it('allows preheat when net benefit is positive with confident thermal model', () => {
    const logger = makeLogger();
    const copNormalizer = new CopNormalizer();
    const thermalModelService = makeThermalModelService(0.2, 0.9);
    const controller = new ThermalController(logger, thermalModelService, undefined, copNormalizer);
    const reference = Date.now();

    const strategy = controller.calculateThermalMassStrategy(
      20,
      21,
      0.1,
      buildPriceSeries(reference, 0.1, 0.3),
      { heating: 4, hotWater: 0, outdoor: 5 },
      {} as any,
      0.25,
      { minTemp: 19, maxTemp: 23 },
      reference,
      {
        currentTargetC: 21,
        minC: 19,
        maxC: 23,
        stepC: 0.5,
        deadbandC: 0.2,
        minChangeMinutes: 0,
        lastChangeMs: reference - 10 * 60 * 1000,
        maxDeltaPerChangeC: 0.5
      }
    );

    expect(strategy.action).toBe('preheat');
    expect(strategy.targetTemp).toBeGreaterThan(21);
    expect(logger.log).toHaveBeenCalledWith(
      'Preheat cost-benefit gate',
      expect.objectContaining({ decision: 'allow' })
    );
  });

  it('blocks preheat when net benefit is non-positive even if price conditions trigger preheat', () => {
    const logger = makeLogger();
    const copNormalizer = new CopNormalizer();
    const thermalModelService = makeThermalModelService(0.001, 0.9);
    const controller = new ThermalController(logger, thermalModelService, undefined, copNormalizer);
    const reference = Date.now();

    const strategy = controller.calculateThermalMassStrategy(
      20,
      21,
      0.1,
      buildPriceSeries(reference, 0.1, 0.12),
      { heating: 4, hotWater: 0, outdoor: 5 },
      {} as any,
      0.25,
      { minTemp: 19, maxTemp: 23 },
      reference,
      {
        currentTargetC: 21,
        minC: 19,
        maxC: 23,
        stepC: 0.5,
        deadbandC: 0.2,
        minChangeMinutes: 0,
        lastChangeMs: reference - 10 * 60 * 1000,
        maxDeltaPerChangeC: 0.5
      }
    );

    expect(strategy.action).toBe('maintain');
    expect(logger.log).toHaveBeenCalledWith(
      'Preheat cost-benefit gate',
      expect.objectContaining({ decision: 'block' })
    );
  });

  it('falls back to heuristic when thermal model confidence is low', () => {
    const logger = makeLogger();
    const copNormalizer = new CopNormalizer();
    const thermalModelService = makeThermalModelService(0.2, 0.1);
    const controller = new ThermalController(logger, thermalModelService, undefined, copNormalizer);
    const reference = Date.now();

    const strategy = controller.calculateThermalMassStrategy(
      20,
      21,
      0.1,
      buildPriceSeries(reference, 0.1, 0.3),
      { heating: 4, hotWater: 0, outdoor: 5 },
      {} as any,
      0.25,
      { minTemp: 19, maxTemp: 23 },
      reference,
      {
        currentTargetC: 21,
        minC: 19,
        maxC: 23,
        stepC: 0.5,
        deadbandC: 0.2,
        minChangeMinutes: 0,
        lastChangeMs: reference - 10 * 60 * 1000,
        maxDeltaPerChangeC: 0.5
      }
    );

    expect(strategy.action).toBe('preheat');
    expect(logger.log).toHaveBeenCalledWith(
      'Preheat cost-benefit gate',
      expect.objectContaining({ decision: 'skip', reason: 'low-thermal-confidence' })
    );
  });
});

describe('normalizeHeatingEfficiency stale range fix', () => {
  it('returns roughNormalize fallback when copNormalizer returns 0 for valid COP', () => {
    // Simulate a stale CopNormalizer range (summer range: min=3.5, max=5.0)
    // When winter COP = 2.97, normalize() returns 0 (below learned min)
    const staleCopNormalizer = new CopNormalizer();
    // Force a stale range by directly updating with high summer values
    for (let i = 0; i < 10; i++) staleCopNormalizer.updateRange(3.5 + (i * 0.15));
    // Now normalized COP of 2.97 should be 0 from the stale normalizer
    expect(staleCopNormalizer.normalize(2.97)).toBe(0);

    const makeThermalController = () => {
      const logger = makeLogger();
      const thermalModelService = makeThermalModelService(0.2, 0.9);
      return new ThermalController(logger, thermalModelService, undefined, new CopNormalizer());
    };
    const controller = makeThermalController();
    (controller as any).copNormalizer = staleCopNormalizer;

    // normalizeHeatingEfficiency must NOT return 0 for cop=2.97 (a physically valid COP)
    const result = (controller as any).normalizeHeatingEfficiency(2.97);
    expect(result).toBeGreaterThan(0.2);  // roughNormalize(2.97) ≈ 0.494
  });
});
