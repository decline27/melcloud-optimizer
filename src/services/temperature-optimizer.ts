/**
 * Temperature Optimizer Service
 *
 * Extracts temperature calculation logic from the main Optimizer class.
 * Provides methods for calculating optimal temperatures based on:
 * - Price data and normalization
 * - COP (Coefficient of Performance) efficiency
 * - Seasonal mode (summer/winter/transition)
 * - Comfort band constraints
 * - Adaptive parameters learning
 *
 * Features:
 * - Pure calculation logic (no I/O)
 * - Dependency injection for testability
 * - Support for basic and enhanced (real data) optimization
 * - COP-based temperature adjustments
 * - Seasonal mode awareness
 *
 * @module services/temperature-optimizer
 */

import { CopNormalizer } from './cop-normalizer';
import { COPHelper } from './cop-helper';
import { AdaptiveParametersLearner, AdaptiveParameters } from './adaptive-parameters';
import { OptimizationMetrics } from '../types';
import { COP_THRESHOLDS, DEFAULT_WEIGHTS } from '../constants';

/**
 * Logger interface for dependency injection
 */
export interface TemperatureOptimizerLogger {
  log(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, error?: unknown): void;
}

/**
 * Comfort band configuration
 */
export interface ComfortBand {
  minTemp: number;
  maxTemp: number;
}

/**
 * Result of temperature optimization with reasoning
 */
export interface TemperatureOptimizationResult {
  targetTemp: number;
  reason: string;
  metrics?: OptimizationMetrics;
}

/**
 * Price statistics for temperature calculation
 */
export interface PriceStats {
  currentPrice: number;
  avgPrice: number;
  minPrice: number;
  maxPrice: number;
  /** Optional pre-calculated price level for accurate logging */
  priceLevel?: string;
}

/**
 * Dependencies for TemperatureOptimizer
 */
export interface TemperatureOptimizerDeps {
  copNormalizer: CopNormalizer;
  copHelper: COPHelper | null;
  adaptiveParametersLearner: AdaptiveParametersLearner | null;
  logger: TemperatureOptimizerLogger;
  /** COP weight setting (0-1) */
  copWeight: number;
  /** Auto seasonal mode enabled */
  autoSeasonalMode: boolean;
  /** Manual summer mode setting */
  summerMode: boolean;
}

/**
 * Temperature Optimizer Service
 *
 * Calculates optimal temperatures based on price, COP, and seasonal data.
 * Supports both basic price-based optimization and enhanced optimization
 * using real energy metrics from MELCloud.
 *
 * @example
 * ```typescript
 * const optimizer = new TemperatureOptimizer({
 *   copNormalizer,
 *   copHelper,
 *   adaptiveParametersLearner,
 *   logger,
 *   copWeight: 0.5,
 *   autoSeasonalMode: true,
 *   summerMode: false
 * });
 *
 * const result = await optimizer.calculateOptimalTemperature(
 *   { currentPrice: 1.2, avgPrice: 1.0, minPrice: 0.5, maxPrice: 2.0 },
 *   21.0,
 *   { minTemp: 19, maxTemp: 23 }
 * );
 * ```
 */
export class TemperatureOptimizer {
  private readonly copNormalizer: CopNormalizer;
  private readonly copHelper: COPHelper | null;
  private readonly adaptiveParametersLearner: AdaptiveParametersLearner | null;
  private readonly logger: TemperatureOptimizerLogger;
  
  // Settings that can be updated
  private copWeight: number;
  private autoSeasonalMode: boolean;
  private summerMode: boolean;

  constructor(deps: TemperatureOptimizerDeps) {
    this.copNormalizer = deps.copNormalizer;
    this.copHelper = deps.copHelper;
    this.adaptiveParametersLearner = deps.adaptiveParametersLearner;
    this.logger = deps.logger;
    this.copWeight = deps.copWeight;
    this.autoSeasonalMode = deps.autoSeasonalMode;
    this.summerMode = deps.summerMode;
  }

  /**
   * Update COP settings
   */
  updateCOPSettings(copWeight: number, autoSeasonalMode: boolean, summerMode: boolean): void {
    this.copWeight = copWeight;
    this.autoSeasonalMode = autoSeasonalMode;
    this.summerMode = summerMode;
  }

  /**
   * Get current COP weight
   */
  getCOPWeight(): number {
    return this.copWeight;
  }

  /**
   * Get price description based on pre-calculated price level
   * The priceLevel is already calculated using learned thresholds from AdaptiveParametersLearner
   * @param priceLevel Pre-calculated price level (VERY_CHEAP, CHEAP, NORMAL, EXPENSIVE, VERY_EXPENSIVE)
   * @returns Human-readable price description: 'low', 'moderate', or 'high'
   */
  private getPriceDescription(priceLevel: string | undefined): string {
    // priceLevel is calculated by price-classifier using learned veryChepMultiplier thresholds
    if (priceLevel === 'VERY_CHEAP' || priceLevel === 'CHEAP') {
      return 'low';
    } else if (priceLevel === 'VERY_EXPENSIVE' || priceLevel === 'EXPENSIVE') {
      return 'high';
    }
    return 'moderate';
  }

  /**
   * Calculate optimal temperature based on price
   * @param priceStats Price statistics (current, avg, min, max)
   * @param currentTemp Current room temperature
   * @param comfortBand Comfort band constraints (min/max)
   * @returns Optimal target temperature
   */
  async calculateOptimalTemperature(
    priceStats: PriceStats,
    currentTemp: number,
    comfortBand: ComfortBand
  ): Promise<number> {
    const { currentPrice, avgPrice, minPrice, maxPrice } = priceStats;
    const tempRange = comfortBand.maxTemp - comfortBand.minTemp;
    const midTemp = (comfortBand.maxTemp + comfortBand.minTemp) / 2;

    // Normalize price between 0 and 1 more efficiently
    const normalizedPrice = maxPrice === minPrice
      ? 0.5 // Handle edge case of equal prices
      : (currentPrice - minPrice) / (maxPrice - minPrice);

    // Invert (lower price = higher temperature)
    const invertedPrice = 1 - normalizedPrice;

    // Calculate base target based on price
    let targetTemp = midTemp + (invertedPrice - 0.5) * tempRange;

    // Apply COP adjustment if helper is available
    if (this.copHelper && this.copWeight > 0) {
      try {
        // Determine if we're in summer mode (cached calculation)
        const isSummerMode = this.autoSeasonalMode
          ? this.copHelper.isSummerSeason()
          : this.summerMode;

        // Get the appropriate COP value based on season
        const seasonalCOP = await this.copHelper.getSeasonalCOP();

        // Log the COP data (using log level to reduce log volume)
        this.logger.log(`Using COP data for optimization - Seasonal COP: ${seasonalCOP.toFixed(2)}, Summer Mode: ${isSummerMode}`);

        if (seasonalCOP > 0) {
          // FIXED: Correct COP optimization logic
          // Use high COP periods for efficient operation at comfort temperatures
          // Use low COP periods with reduced comfort expectations

          // Update COP range tracking for adaptive normalization
          this.copNormalizer.updateRange(seasonalCOP);

          // Use adaptive COP normalization based on observed range
          const normalizedCOP = this.copNormalizer.normalize(seasonalCOP);

          // Calculate COP efficiency factor (0 = poor, 1 = excellent)
          const copEfficiencyFactor = normalizedCOP;

          let copAdjustment = 0;

          // Get adaptive COP adjustment magnitudes (falls back to defaults if learner unavailable)
          const adaptiveThresholds = this.adaptiveParametersLearner?.getStrategyThresholds() || {
            copAdjustmentExcellent: 0.2,
            copAdjustmentPoor: 0.8,
            copAdjustmentVeryPoor: 1.2,
            summerModeReduction: 0.5
          };

          if (copEfficiencyFactor > COP_THRESHOLDS.EXCELLENT) {
            // Excellent COP (>80th percentile): Maintain comfort, allow normal price response
            copAdjustment = adaptiveThresholds.copAdjustmentExcellent;
            this.logger.log(`Excellent COP: Maintaining comfort with small bonus (+${adaptiveThresholds.copAdjustmentExcellent.toFixed(2)}°C)`);
          } else if (copEfficiencyFactor > COP_THRESHOLDS.GOOD) {
            // Good COP: Slight comfort reduction during expensive periods
            const priceAdjustmentReduction = 0.3; // Reduce price response by 30%
            copAdjustment = -priceAdjustmentReduction * Math.abs(targetTemp - midTemp);
            this.logger.log(`Good COP: Reducing temperature adjustment by 30%`);
          } else if (copEfficiencyFactor > COP_THRESHOLDS.POOR) {
            // Poor COP: Significant comfort reduction to save energy
            copAdjustment = -adaptiveThresholds.copAdjustmentPoor * this.copWeight;
            this.logger.log(`Poor COP: Reducing temperature for efficiency (-${adaptiveThresholds.copAdjustmentPoor.toFixed(2)}°C)`);
          } else {
            // Very poor COP: Maximum energy conservation
            copAdjustment = -adaptiveThresholds.copAdjustmentVeryPoor * this.copWeight;
            this.logger.log(`Very poor COP: Maximum energy conservation (-${adaptiveThresholds.copAdjustmentVeryPoor.toFixed(2)}°C)`);
          }

          // Apply the corrected adjustment
          targetTemp += copAdjustment;

          this.logger.log(`Applied COP adjustment: ${copAdjustment.toFixed(2)}°C (COP: ${seasonalCOP.toFixed(2)}, Efficiency: ${(copEfficiencyFactor * 100).toFixed(0)}%, Weight: ${this.copWeight})`);

          // In summer mode, further reduce heating temperature
          if (isSummerMode) {
            const summerModeReduction = adaptiveThresholds.summerModeReduction ?? 0.5;
            const summerAdjustment = -summerModeReduction * this.copWeight;
            targetTemp += summerAdjustment;
            this.logger.log(`Applied summer mode adjustment: ${summerAdjustment.toFixed(2)}°C (learned reduction: ${summerModeReduction.toFixed(2)})`);
          }
        }
      } catch (error) {
        this.logger.error('Error applying COP adjustment:', error);
      }
    }

    // Apply final comfort band constraints
    targetTemp = Math.max(comfortBand.minTemp, Math.min(comfortBand.maxTemp, targetTemp));

    return targetTemp;
  }

  /**
   * Calculate enhanced temperature optimization using real energy data
   * @param priceStats Price statistics (current, avg, min, max)
   * @param currentTemp Current room temperature
   * @param outdoorTemp Outdoor temperature
   * @param comfortBand Comfort band constraints
   * @param metrics Real energy metrics from MELCloud
   * @param basicCalculator Fallback function for basic calculation
   * @returns Optimal target temperature with reasoning
   */
  async calculateOptimalTemperatureWithRealData(
    priceStats: PriceStats,
    currentTemp: number,
    outdoorTemp: number,
    comfortBand: ComfortBand,
    metrics: OptimizationMetrics | null,
    basicCalculator?: () => Promise<number>
  ): Promise<TemperatureOptimizationResult> {
    const { currentPrice, avgPrice, minPrice, maxPrice } = priceStats;

    if (!metrics) {
      // Fall back to basic optimization if no real data available
      let basicTarget: number;
      if (basicCalculator) {
        basicTarget = await basicCalculator();
      } else {
        basicTarget = await this.calculateOptimalTemperature(priceStats, currentTemp, comfortBand);
      }
      return {
        targetTemp: basicTarget,
        reason: 'Using basic optimization (no real energy data available)'
      };
    }

    // Cache frequently used values - use user-configurable comfort bands
    const tempRange = comfortBand.maxTemp - comfortBand.minTemp;
    const midTemp = (comfortBand.maxTemp + comfortBand.minTemp) / 2;

    // Normalize price between 0 and 1
    const normalizedPrice = maxPrice === minPrice
      ? 0.5
      : (currentPrice - minPrice) / (maxPrice - minPrice);

    // Calculate base target based on seasonal mode and real performance
    let targetTemp: number;
    let reason: string;

    const adaptiveParams = this.adaptiveParametersLearner?.getParameters();

    if (metrics.seasonalMode === 'summer') {
      // Summer optimization: Focus on hot water efficiency and minimal heating
      const priceWeight = adaptiveParams?.priceWeightSummer || DEFAULT_WEIGHTS.PRICE_SUMMER;

      // Update COP range and normalize
      this.copNormalizer.updateRange(metrics.realHotWaterCOP);
      const hotWaterEfficiency = this.copNormalizer.normalize(metrics.realHotWaterCOP);

      // Price adjustment (inverted: low price = higher temp)
      const priceAdjustment = (0.5 - normalizedPrice) * tempRange * priceWeight;

      // Efficiency bonus for excellent hot water COP
      let efficiencyAdjustment = 0;
      if (hotWaterEfficiency > COP_THRESHOLDS.EXCELLENT) {
        efficiencyAdjustment = adaptiveParams?.copEfficiencyBonusHigh || DEFAULT_WEIGHTS.COP_EFFICIENCY_BONUS_HIGH;
      } else if (hotWaterEfficiency < 0.3) {
        efficiencyAdjustment = -0.5; // Penalty for poor COP
      }

      targetTemp = midTemp + priceAdjustment + efficiencyAdjustment;
      // Use pre-calculated price level (based on learned thresholds) for accurate description
      reason = `Summer mode: Hot water COP ${metrics.realHotWaterCOP.toFixed(2)} (${(hotWaterEfficiency * 100).toFixed(0)}% efficiency), price ${this.getPriceDescription(priceStats.priceLevel)} `;

    } else if (metrics.seasonalMode === 'winter') {
      // Winter optimization: Balance heating efficiency with comfort and prices
      const priceWeight = adaptiveParams?.priceWeightWinter || DEFAULT_WEIGHTS.PRICE_WINTER;

      // Update COP range and normalize  
      this.copNormalizer.updateRange(metrics.realHeatingCOP);
      const heatingEfficiency = this.copNormalizer.normalize(metrics.realHeatingCOP);

      // Price adjustment (inverted: low price = higher temp)
      const priceAdjustment = (0.5 - normalizedPrice) * tempRange * priceWeight;

      // Get adaptive COP thresholds
      const adaptiveThresholds = this.adaptiveParametersLearner?.getStrategyThresholds() || {
        excellentCOPThreshold: COP_THRESHOLDS.EXCELLENT,
        goodCOPThreshold: COP_THRESHOLDS.GOOD,
        minimumCOPThreshold: COP_THRESHOLDS.POOR
      };

      // Efficiency-based comfort adjustment using adaptive thresholds
      let efficiencyAdjustment = 0;
      if (heatingEfficiency > adaptiveThresholds.excellentCOPThreshold) {
        // Excellent heating COP: maintain comfort
        efficiencyAdjustment = adaptiveParams?.copEfficiencyBonusMedium || DEFAULT_WEIGHTS.COP_EFFICIENCY_BONUS_MEDIUM;
      } else if (heatingEfficiency > adaptiveThresholds.goodCOPThreshold) {
        // Good heating COP: slight reduction
        efficiencyAdjustment = -0.1;
      } else if (heatingEfficiency > adaptiveThresholds.minimumCOPThreshold) {
        // Poor heating COP: significant reduction
        efficiencyAdjustment = -0.5;
      } else {
        // Very poor heating COP: maximum conservation
        efficiencyAdjustment = -0.8;
      }

      // Outdoor temperature adjustment: colder outside = need higher inside for comfort
      const outdoorAdjustment = outdoorTemp < 5 ? 0.5 : outdoorTemp > 15 ? -0.3 : 0;

      targetTemp = midTemp + priceAdjustment + efficiencyAdjustment + outdoorAdjustment;
      // Use pre-calculated price level (based on learned thresholds) for accurate description
      reason = `Winter mode: Heating COP ${metrics.realHeatingCOP.toFixed(2)} (${(heatingEfficiency * 100).toFixed(0)}% efficiency), outdoor ${outdoorTemp}°C, price ${this.getPriceDescription(priceStats.priceLevel)} `;

    } else {
      // Transition mode: Balanced approach using both COPs
      const priceWeight = adaptiveParams?.priceWeightTransition || DEFAULT_WEIGHTS.PRICE_TRANSITION;

      // Update COP ranges for both systems
      this.copNormalizer.updateRange(metrics.realHeatingCOP);
      this.copNormalizer.updateRange(metrics.realHotWaterCOP);

      const heatingEfficiency = this.copNormalizer.normalize(metrics.realHeatingCOP);
      const hotWaterEfficiency = this.copNormalizer.normalize(metrics.realHotWaterCOP);
      const combinedEfficiency = (heatingEfficiency + hotWaterEfficiency) / 2;

      const priceAdjustment = (0.5 - normalizedPrice) * tempRange * priceWeight;

      // Combined efficiency adjustment
      let efficiencyAdjustment = 0;
      if (combinedEfficiency > 0.7) {
        efficiencyAdjustment = adaptiveParams?.copEfficiencyBonusMedium || DEFAULT_WEIGHTS.COP_EFFICIENCY_BONUS_MEDIUM;
      } else if (combinedEfficiency < 0.4) {
        efficiencyAdjustment = -0.4;
      }

      targetTemp = midTemp + priceAdjustment + efficiencyAdjustment;
      reason = `Transition mode: Combined COP efficiency ${(combinedEfficiency * 100).toFixed(0)}%, adapting to both heating and hot water needs`;
    }

    // Apply real COP-based fine tuning
    if (metrics.optimizationFocus === 'hotwater' && metrics.realHotWaterCOP > 3) {
      // Excellent hot water performance allows more aggressive optimization
      targetTemp += 0.2;
      reason += `, excellent hot water COP(+0.2°C)`;
    } else if (metrics.optimizationFocus === 'both' && metrics.realHeatingCOP > 2) {
      // Good heating performance
      targetTemp += 0.3;
      reason += `, good heating COP(+0.3°C)`;
    } else if (metrics.realHeatingCOP < 1.5 && metrics.realHeatingCOP > 0) {
      // Poor heating performance - be more conservative
      targetTemp -= 0.5;
      reason += `, low heating COP(-0.5°C)`;
    }

    // Apply final comfort band constraints
    targetTemp = Math.max(comfortBand.minTemp, Math.min(comfortBand.maxTemp, targetTemp));

    return { targetTemp, reason, metrics };
  }
}
