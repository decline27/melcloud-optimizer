/**
 * Stale-range COP protection tests for TemperatureOptimizer.
 *
 * Uses REAL CopNormalizer instances (not mocked) to verify that the optimizer
 * handles the case where the learned COP range does not cover the current COP
 * (e.g. summer range still loaded during winter). In that case normalize()
 * returns 0 for a physically valid COP, and the fix must fall back to
 * CopNormalizer.roughNormalize() so the optimizer doesn't misclassify a good
 * COP as "very poor" and suppress heating.
 *
 * Covers:
 *   P1-1a  basic path  (calculateOptimalTemperature)
 *   P1-1b  winter path (calculateOptimalTemperatureWithRealData, seasonalMode='winter')
 *   P1-1c  transition path (seasonalMode='transition')
 *   P2-2   transition path must use heatingEfficiency only for zone1 decisions,
 *           not an average with hotWaterEfficiency
 */

import {
  TemperatureOptimizer,
  TemperatureOptimizerDeps,
} from '../../src/services/temperature-optimizer';
import { CopNormalizer } from '../../src/services/cop-normalizer';
import { OptimizationMetrics } from '../../src/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a CopNormalizer whose learned range sits above the COP under test. */
function buildStaleNormalizer(rangeMin: number, rangeMax: number): CopNormalizer {
  const n = new CopNormalizer();
  (n as any).state.minObserved = rangeMin;
  (n as any).state.maxObserved = rangeMax;
  return n;
}

/** Build a CopNormalizer with a specific learned range. */
function buildNormalizer(rangeMin: number, rangeMax: number): CopNormalizer {
  const n = new CopNormalizer();
  (n as any).state.minObserved = rangeMin;
  (n as any).state.maxObserved = rangeMax;
  return n;
}

function buildOptimizer(opts: {
  copNormalizerHeating: CopNormalizer;
  copNormalizerHotWater?: CopNormalizer;
  /** COP returned by the mock copHelper (basic path only) */
  copToReturn?: number;
  copWeight?: number;
}): TemperatureOptimizer {
  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const copHelper = {
    isSummerSeason: () => false,
    getSeasonalCOP: async () => opts.copToReturn ?? 2.75,
  } as any;

  const deps: TemperatureOptimizerDeps = {
    copNormalizer: opts.copNormalizerHeating,
    copNormalizerHotWater: opts.copNormalizerHotWater,
    copHelper,
    adaptiveParametersLearner: null, // use all library defaults
    logger,
    copWeight: opts.copWeight ?? 0.5,
    autoSeasonalMode: false,
    summerMode: false,
  };
  return new TemperatureOptimizer(deps);
}

/**
 * Symmetric price stats: normalizedPrice = 0.5 → priceAdjustment = 0.
 * This isolates the COP-driven efficiency adjustment as the only variable.
 */
const SYMMETRIC_PRICE = {
  currentPrice: 1.0,
  avgPrice: 1.0,
  minPrice: 0.0,
  maxPrice: 2.0,
};

const COMFORT_BAND = { minTemp: 20, maxTemp: 23 };
// midTemp = (20 + 23) / 2 = 21.5

function makeMetrics(
  overrides: Partial<OptimizationMetrics> = {}
): OptimizationMetrics {
  return {
    realHeatingCOP: 2.75,
    realHotWaterCOP: 2.5,
    seasonalMode: 'winter',
    optimizationFocus: 'heating',
    dailyEnergyConsumption: 20,
    heatingEfficiency: 0,
    hotWaterEfficiency: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// P1-1a  Basic path: calculateOptimalTemperature
// ---------------------------------------------------------------------------

describe('P1-1a basic path: stale COP range must not trigger very-poor-COP penalty', () => {
  it('does not apply the very-poor-COP penalty when normalize() returns 0 for a valid COP', async () => {
    // Stale range: learnt at [3.5, 5.0] (summer) → winter COP 2.75 normalises to 0.
    const staleNorm = buildStaleNormalizer(3.5, 5.0);
    expect(staleNorm.normalize(2.75)).toBe(0); // precondition

    const optimizer = buildOptimizer({ copNormalizerHeating: staleNorm, copToReturn: 2.75 });

    // With symmetric price, priceAdjustment = 0 → base target = midTemp = 21.5.
    // Buggy: normalise(2.75) = 0 → very-poor branch → adjustment = −1.2 × 0.5 = −0.6
    //        → result = 21.5 − 0.6 = 20.9
    // Fixed: roughNormalize(2.75) = 0.55 > GOOD(0.5) → good branch → adjustment ≈ 0
    //        → result ≈ 21.5
    const result = await optimizer.calculateOptimalTemperature(
      SYMMETRIC_PRICE,
      21.5,
      COMFORT_BAND
    );

    // The very-poor penalty (−0.6) would push result to 20.9.
    // After the fix the result should be clearly above that.
    expect(result).toBeGreaterThan(21.1);
  });
});

// ---------------------------------------------------------------------------
// P1-1b  Winter path: calculateOptimalTemperatureWithRealData
// ---------------------------------------------------------------------------

describe('P1-1b winter path: stale COP range must not trigger very-poor-COP penalty', () => {
  it('does not apply DEFAULT_COP_ADJUSTMENT_VERY_POOR (−0.8) when normalize() returns 0 for realHeatingCOP 2.75', async () => {
    const staleNorm = buildStaleNormalizer(3.5, 5.0);
    expect(staleNorm.normalize(2.75)).toBe(0); // precondition

    const optimizer = buildOptimizer({ copNormalizerHeating: staleNorm });

    // outdoor = 10°C → between COLD_OUTDOOR_THRESHOLD(5) and MILD_OUTDOOR_THRESHOLD(15)
    //                  → outdoorAdjustment = 0
    // Symmetric price → priceAdjustment = 0 → base = midTemp = 21.5
    // Buggy:  very-poor → efficiencyAdjustment = DEFAULT_COP_ADJUSTMENT_VERY_POOR = −0.8
    //         → result = 21.5 − 0.8 = 20.7
    // Fixed:  roughNormalize(2.75) = 0.55 → good branch → DEFAULT_COP_ADJUSTMENT_GOOD = −0.1
    //         → result = 21.5 − 0.1 = 21.4
    const result = await optimizer.calculateOptimalTemperatureWithRealData(
      SYMMETRIC_PRICE,
      21.5,
      10.0,
      COMFORT_BAND,
      makeMetrics({ seasonalMode: 'winter', realHeatingCOP: 2.75 })
    );

    // Very-poor penalty would land at 20.7 — clearly below 21.0.
    expect(result.targetTemp).toBeGreaterThan(21.0);
  });
});

// ---------------------------------------------------------------------------
// P1-1c  Transition path: stale COP range for both normalizers
// ---------------------------------------------------------------------------

describe('P1-1c transition path: stale COP range must not trigger efficiency reduction', () => {
  it('does not apply TRANSITION_EFFICIENCY_REDUCTION (−0.4) when both normalizers return 0 for valid COPs', async () => {
    // Both heating and hot-water use the same stale normalizer (copNormalizerHotWater not
    // separately provided → falls back to copNormalizer in the constructor).
    const staleNorm = buildStaleNormalizer(3.5, 5.0);
    expect(staleNorm.normalize(2.75)).toBe(0); // precondition (heating)
    expect(staleNorm.normalize(2.5)).toBe(0);  // precondition (hot water)

    const optimizer = buildOptimizer({ copNormalizerHeating: staleNorm });

    // Symmetric price → priceAdjustment = 0 → base = midTemp = 21.5
    // Buggy:  combined = (0 + 0) / 2 = 0 < TRANSITION_EFFICIENCY_LOW(0.4)
    //         → TRANSITION_EFFICIENCY_REDUCTION = −0.4 → result = 21.1
    // Fixed:  stale-range fallback → combined > 0.4 → no reduction → result = 21.5
    const result = await optimizer.calculateOptimalTemperatureWithRealData(
      SYMMETRIC_PRICE,
      21.5,
      10.0,
      COMFORT_BAND,
      makeMetrics({ seasonalMode: 'transition', realHeatingCOP: 2.75, realHotWaterCOP: 2.5 })
    );

    // Efficiency reduction would land at 21.1 — below 21.2.
    expect(result.targetTemp).toBeGreaterThan(21.2);
  });
});

// ---------------------------------------------------------------------------
// P2-2  Transition path must use heatingEfficiency alone for zone1 decisions
// ---------------------------------------------------------------------------

describe('P2-2 transition path: zone1 target must depend on heatingEfficiency only, not a hot-water average', () => {
  it('applies efficiency bonus when heating COP is excellent even if hot-water COP is poor', async () => {
    // Heating normaliser: range [1.0, 4.0] → normalize(3.7) = (3.7−1)/(4−1) = 0.9 > HIGH(0.7)
    const heatingNorm = buildNormalizer(1.0, 4.0);
    expect(heatingNorm.normalize(3.7)).toBeCloseTo(0.9, 2);

    // Hot-water normaliser: same range → normalize(1.4) = (1.4−1)/(4−1) ≈ 0.133
    const hwNorm = buildNormalizer(1.0, 4.0);
    expect(hwNorm.normalize(1.4)).toBeCloseTo(0.133, 2);

    const optimizer = buildOptimizer({
      copNormalizerHeating: heatingNorm,
      copNormalizerHotWater: hwNorm,
    });

    // Symmetric price → priceAdjustment = 0 → base = midTemp = 21.5
    // Buggy (combined average):
    //   combined = (0.9 + 0.133) / 2 = 0.517 → between LOW(0.4) and HIGH(0.7) → NO bonus
    //   → result = 21.5
    // Fixed (heating COP only):
    //   heatingEfficiency = 0.9 > HIGH(0.7) → bonus = DEFAULT_WEIGHTS.COP_EFFICIENCY_BONUS_MEDIUM = +0.2
    //   → result = 21.7
    const result = await optimizer.calculateOptimalTemperatureWithRealData(
      SYMMETRIC_PRICE,
      21.5,
      10.0,
      COMFORT_BAND,
      makeMetrics({
        seasonalMode: 'transition',
        realHeatingCOP: 3.7,
        realHotWaterCOP: 1.4,
      })
    );

    // Without the fix the result is exactly 21.5 (no bonus). With the fix it's 21.7.
    expect(result.targetTemp).toBeGreaterThan(21.55);
  });
});
