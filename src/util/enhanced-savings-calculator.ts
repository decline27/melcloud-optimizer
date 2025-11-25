/**
 * Enhanced Savings Calculator
 * Provides sophisticated daily savings calculations that account for:
 * - Compounding effects throughout the day
 * - Historical optimization data
 * - Time-weighted savings projections
 * - Seasonal and COP-based adjustments
 */

import { Logger } from './logger';
import { ThermalModelService } from '../services/thermal-model';
import { HotWaterService } from '../services/hot-water';
import { FixedBaselineCalculator, BaselineConfig, BaselineComparison } from './fixed-baseline-calculator';
import { COPHelper } from '../services/cop-helper';

export interface OptimizationData {
  timestamp: string;
  savings: number;
  targetTemp: number;
  targetOriginal: number;
  priceNow: number;
  priceAvg: number;
  indoorTemp?: number;
  outdoorTemp?: number;
  cop?: {
    heating?: number;
    hotWater?: number;
    seasonal?: number;
    weight?: number;
  };
}

export interface SavingsCalculationResult {
  dailySavings: number;
  compoundedSavings: number;
  projectedSavings: number;
  confidence: number;
  method: string;
  breakdown: {
    actualSavings: number;
    currentHourSavings: number;
    projectedHours: number;
    projectedAmount: number;
  };
  // New baseline comparison fields
  baselineComparison?: BaselineComparison;
}

export class EnhancedSavingsCalculator {
  private logger: Logger;
  private thermalModelService?: ThermalModelService;
  private hotWaterService?: HotWaterService;
  private copHelper?: COPHelper;
  private fixedBaselineCalculator?: FixedBaselineCalculator;

  constructor(
    logger: Logger, 
    thermalModelService?: ThermalModelService,
    hotWaterService?: HotWaterService,
    copHelper?: COPHelper
  ) {
    this.logger = logger;
    this.thermalModelService = thermalModelService;
    this.hotWaterService = hotWaterService;
    this.copHelper = copHelper;
    
    // Initialize fixed baseline calculator if we have the required services
    if (logger) {
      this.fixedBaselineCalculator = new FixedBaselineCalculator(
        logger,
        thermalModelService,
        copHelper,
        hotWaterService
      );
    }
  }

  private safeDebug(message: string, context?: Record<string, any>): void {
    const loggerAny = this.logger as any;
    if (loggerAny && typeof loggerAny.debug === 'function') {
      loggerAny.debug(message, context);
    } else if (loggerAny && typeof loggerAny.log === 'function') {
      loggerAny.log(message, context);
    } else {
      console.debug(message, context);
    }
  }

  private safeError(message: string, error: unknown): void {
    const loggerAny = this.logger as any;
    if (loggerAny && typeof loggerAny.error === 'function') {
      loggerAny.error(message, error);
    } else if (loggerAny && typeof loggerAny.log === 'function') {
      loggerAny.log(`${message} ${error instanceof Error ? error.message : String(error)}`);
    } else {
      console.error(message, error);
    }
  }

  /**
   * Check if advanced services are available for enhanced calculations
   */
  private hasAdvancedServices(): boolean {
    return !!(this.thermalModelService && this.hotWaterService);
  }

  /**
   * Get enhanced calculation method description
   */
  private getEnhancedMethod(): string {
    const hasThermal = !!this.thermalModelService;
    const hasHotWater = !!this.hotWaterService;
    
    if (hasThermal && hasHotWater) {
      return 'thermal_and_usage_aware';
    } else if (hasThermal) {
      return 'thermal_aware';
    } else if (hasHotWater) {
      return 'usage_aware';
    }
    return 'basic_enhanced';
  }

  /**
   * Calculate enhanced daily savings with compounding effects and baseline comparison
   * @param currentHourSavings Current hour's savings
   * @param historicalOptimizations Historical optimization data from today
   * @param currentHour Current hour (0-23)
   * @param futurePriceFactors Optional multipliers for each remaining hour vs current price
   * @param baselineOptions Optional baseline calculation parameters
   * @returns Enhanced savings calculation result with baseline comparison
   */
  calculateEnhancedDailySavingsWithBaseline(
    currentHourSavings: number,
    historicalOptimizations: OptimizationData[] = [],
    currentHour: number,
    futurePriceFactors?: number[],
    baselineOptions?: {
      actualConsumptionKWh?: number;
      actualCost?: number;
      pricePerKWh?: number;
      outdoorTemps?: number[];
      baselineConfig?: Partial<BaselineConfig>;
      enableBaseline?: boolean;
    }
  ): SavingsCalculationResult {
    // First calculate standard enhanced savings
    const standardResult = this.calculateEnhancedDailySavings(
      currentHourSavings,
      historicalOptimizations,
      currentHour,
      futurePriceFactors
    );

    // Add baseline comparison if requested and calculator is available
    if (baselineOptions?.enableBaseline && this.fixedBaselineCalculator && baselineOptions) {
      try {
        const {
          actualConsumptionKWh = 1.0,
          actualCost = currentHourSavings,
          pricePerKWh = 1.0,
          outdoorTemps = [],
          baselineConfig = {}
        } = baselineOptions;

        const baselineComparison = this.fixedBaselineCalculator.compareToBaseline(
          actualConsumptionKWh,
          actualCost,
          standardResult.dailySavings,
          'day',
          outdoorTemps,
          pricePerKWh,
          baselineConfig
        );

        standardResult.baselineComparison = baselineComparison;

        this.safeDebug('Enhanced savings with baseline comparison:', {
          standardSavings: standardResult.dailySavings.toFixed(2),
          baselineSavings: baselineComparison.baselineSavings.toFixed(2),
          baselinePercentage: baselineComparison.baselinePercentage.toFixed(1),
          confidence: baselineComparison.confidenceLevel.toFixed(2)
        });

      } catch (error) {
        this.safeError('Error calculating baseline comparison:', error);
        // Continue without baseline comparison
      }
    }

    return standardResult;
  }

  /**
   * Calculate enhanced daily savings with compounding effects
   * @param currentHourSavings Current hour's savings
   * @param historicalOptimizations Historical optimization data from today
   * @param currentHour Current hour (0-23)
   * @returns Enhanced savings calculation result
   */
  calculateEnhancedDailySavings(
    currentHourSavings: number,
    historicalOptimizations: OptimizationData[] = [],
    currentHour: number,
    futurePriceFactors?: number[] // optional multipliers for each remaining hour vs current price
  ): SavingsCalculationResult {
    try {
      // Filter optimizations from today only
      const todayMidnight = new Date();
      todayMidnight.setHours(0, 0, 0, 0);
      
      const todayOptimizations = historicalOptimizations.filter(opt => {
        const optDate = new Date(opt.timestamp);
        return optDate >= todayMidnight && optDate.getHours() < currentHour;
      });

      // Calculate actual savings accumulated so far today
      const actualSavings = todayOptimizations.reduce((sum, opt) => sum + (opt.savings || 0), 0);

      // Calculate compounded savings (considering thermal inertia effects)
      const compoundedSavings = this.calculateCompoundedSavings(
        todayOptimizations,
        currentHourSavings,
        currentHour
      );

      // Calculate projected savings for remaining hours
      const remainingHours = 24 - (todayOptimizations.length + 1); // +1 for current hour
    const projectedSavings = this.calculateProjectedSavings(
      currentHourSavings,
      todayOptimizations,
      remainingHours,
      currentHour,
      futurePriceFactors
    );

    // Calculate total daily savings
    const totalDailySavings = actualSavings + currentHourSavings + projectedSavings;

    // Clamp projection to avoid overly optimistic numbers
    const avgRecent = todayOptimizations.length > 0
      ? todayOptimizations.reduce((sum, opt) => sum + (opt.savings || 0), 0) / todayOptimizations.length
      : currentHourSavings;
    const maxProjection = Math.max(0, avgRecent) * remainingHours * 1.1;
    const clampedProjected = Math.min(Math.max(projectedSavings, 0), maxProjection);
    const clampedTotal = actualSavings + currentHourSavings + clampedProjected;

      // Calculate confidence based on data quality and amount
      const confidence = this.calculateConfidence(todayOptimizations, currentHour);

      // Determine calculation method used
      const method = this.getCalculationMethod(todayOptimizations, currentHour, futurePriceFactors);
      const enhancedMethod = this.getEnhancedMethod();

    const result: SavingsCalculationResult = {
      dailySavings: clampedTotal,
      compoundedSavings: compoundedSavings,
      projectedSavings: clampedProjected,
      confidence: confidence,
      method: enhancedMethod !== 'basic_enhanced' ? `${method}_${enhancedMethod}` : method,
      breakdown: {
        actualSavings: actualSavings,
        currentHourSavings: currentHourSavings,
        projectedHours: remainingHours,
        projectedAmount: clampedProjected
      }
    };

      this.safeDebug('Enhanced daily savings calculation:', {
        currentHour,
        actualSavings: actualSavings.toFixed(4),
        currentHourSavings: currentHourSavings.toFixed(4),
        projectedSavings: projectedSavings.toFixed(4),
        totalDailySavings: totalDailySavings.toFixed(4),
        confidence: confidence.toFixed(2),
        method: result.method,
        hasAdvancedServices: this.hasAdvancedServices(),
        thermalService: !!this.thermalModelService,
        hotWaterService: !!this.hotWaterService
      });

      return result;
    } catch (error) {
      this.safeError('Error in enhanced daily savings calculation:', error);
      
      // Fallback to simple calculation
      return {
        dailySavings: currentHourSavings * 24,
        compoundedSavings: currentHourSavings * 24,
        projectedSavings: currentHourSavings * 23,
        confidence: 0.1,
        method: 'fallback',
        breakdown: {
          actualSavings: 0,
          currentHourSavings: currentHourSavings,
          projectedHours: 23,
          projectedAmount: currentHourSavings * 23
        }
      };
    }
  }

  /**
   * Calculate compounded savings considering thermal inertia and cumulative effects
   */
  private calculateCompoundedSavings(
    todayOptimizations: OptimizationData[],
    currentHourSavings: number,
    currentHour: number
  ): number {
    const baselineProjection = currentHourSavings * 24;

    if (todayOptimizations.length === 0) {
      return baselineProjection; // No history yet; project a full day at current rate
    }

    // Calculate thermal inertia factor based on temperature changes
    const thermalInertiaFactor = this.calculateThermalInertiaFactor(todayOptimizations);
    
    // Calculate cumulative effect factor
    const cumulativeEffectFactor = this.calculateCumulativeEffectFactor(todayOptimizations, currentHour);
    
    // Base savings from actual optimizations
    const baseSavings = todayOptimizations.reduce((sum, opt) => sum + (opt.savings || 0), 0);
    
    // Apply compounding factors conservatively and cap
    const compoundedSavings = baseSavings * (1 + Math.min(thermalInertiaFactor + cumulativeEffectFactor, 0.05)); // max +5%
    
    // Add current hour only once; projections are handled separately
    return Math.max(compoundedSavings + currentHourSavings, baselineProjection);
  }

  /**
   * Calculate thermal inertia factor based on temperature changes
   * Uses real thermal characteristics when available, falls back to hardcoded values
   */
  private calculateThermalInertiaFactor(optimizations: OptimizationData[]): number {
    if (optimizations.length === 0) return 0;

    // Calculate average temperature change magnitude
    const avgTempChange = optimizations.reduce((sum, opt) => {
      return sum + Math.abs(opt.targetTemp - opt.targetOriginal);
    }, 0) / optimizations.length;

    // Use real thermal characteristics if available
    if (this.thermalModelService) {
      try {
        const characteristics = this.thermalModelService.getThermalCharacteristics();
        
        // Issue #6 fix: Use graduated blending instead of binary 0.3 cutoff
        // Old: if (confidence > 0.3) use learned, else use 0.02 hardcoded
        // New: Blend learned and default based on confidence level
        // Rationale: Rewards early learning, provides smooth UX, no sudden jumps
        
        const confidence = Math.min(1, Math.max(0, characteristics.modelConfidence));
        const thermalMassMultiplier = characteristics.thermalMass * 0.15; // Max 15%
        
        // Blend learned factor (based on thermal mass) with default factor (0.02)
        // At confidence=0: pure default (0.02)
        // At confidence=0.5: 50% learned + 50% default
        // At confidence=1.0: pure learned (thermal mass * 0.15)
        const learnedFactor = thermalMassMultiplier * confidence;
        const defaultFactor = 0.02 * (1 - confidence);
        const blendedMultiplier = learnedFactor + defaultFactor;
        
        this.safeDebug('Using blended thermal characteristics for inertia calculation:', {
          avgTempChange: avgTempChange.toFixed(2),
          thermalMass: characteristics.thermalMass.toFixed(3),
          modelConfidence: confidence.toFixed(3),
          blendedMultiplier: blendedMultiplier.toFixed(4),
          calculatedBonus: (avgTempChange * blendedMultiplier).toFixed(4)
        });
        
        // Cap the result, but use learned thermalMassMultiplier as ceiling when confidence is high
        const maxCap = Math.max(0.05, thermalMassMultiplier); // cap thermal bonus at 5%+
        return Math.min(avgTempChange * blendedMultiplier, maxCap);
      } catch (error) {
        this.safeError('Error getting thermal characteristics, using fallback:', error);
      }
    }

    // Fallback to original hardcoded calculation
    // Thermal inertia provides additional savings when temperature changes are larger
    // because the building retains the temperature longer
    return Math.min(avgTempChange * 0.02, 0.05); // Max 5% bonus
  }

  /**
   * Calculate cumulative effect factor based on optimization consistency
   */
  private calculateCumulativeEffectFactor(optimizations: OptimizationData[], currentHour: number): number {
    if (optimizations.length < 2) return 0;

    // Calculate consistency of optimization direction
    let consistentOptimizations = 0;
    for (let i = 1; i < optimizations.length; i++) {
      const prevChange = optimizations[i-1].targetTemp - optimizations[i-1].targetOriginal;
      const currChange = optimizations[i].targetTemp - optimizations[i].targetOriginal;
      
      if (Math.sign(prevChange) === Math.sign(currChange)) {
        consistentOptimizations++;
      }
    }

    const consistencyRatio = consistentOptimizations / (optimizations.length - 1);
    
    // Consistent optimizations in the same direction provide cumulative benefits
    return consistencyRatio * 0.05; // Max 5% bonus for full consistency
  }

  /**
   * Calculate projected savings for remaining hours with intelligent weighting
   * Includes weather-aware adjustments when thermal model is available
   */
  private calculateProjectedSavings(
    currentHourSavings: number,
    todayOptimizations: OptimizationData[],
    remainingHours: number,
    currentHour: number,
    futurePriceFactors?: number[]
  ): number {
    if (remainingHours <= 0) return 0;

    // If explicit price multipliers are provided, use them for a price-aware projection
    const usePriceFactors = Array.isArray(futurePriceFactors) && futurePriceFactors.length > 0;

    // Use weighted average of today's optimizations if available
    if (todayOptimizations.length >= 2) {
      const recentOptimizations = todayOptimizations.slice(-3); // Last 3 hours
      const avgRecentSavings = recentOptimizations.reduce((sum, opt) => sum + (opt.savings || 0), 0) / recentOptimizations.length;
      
      // Weight recent savings more heavily than current hour
      const weightedSavings = (avgRecentSavings * 0.7) + (currentHourSavings * 0.3);
      const base = Math.max(0, weightedSavings);
      
      if (usePriceFactors) {
        // Sum factors for the remaining hours (pad/truncate as needed)
        const factors = futurePriceFactors!.slice(0, remainingHours);
        const sumFactors = factors.reduce((s, f) => s + (Number.isFinite(f) ? Math.max(f, 0) : 1), 0);
        return base * Math.min(sumFactors, remainingHours * 1.1);
      } else {
        // Apply time-of-day factor (evening hours typically have higher prices)
        const timeOfDayFactor = this.getTimeOfDayFactor(currentHour, remainingHours);
        return base * remainingHours * timeOfDayFactor;
      }
    }

    // Calculate base projected savings
    let baseSavings: number;
    if (usePriceFactors) {
      const factors = futurePriceFactors!.slice(0, remainingHours);
      const sumFactors = factors.reduce((s, f) => s + (Number.isFinite(f) ? Math.max(f, 0) : 1), 0);
      baseSavings = Math.max(0, currentHourSavings) * Math.min(sumFactors, remainingHours * 1.1);
    } else {
      const timeOfDayFactor = this.getTimeOfDayFactor(currentHour, remainingHours);
      baseSavings = Math.max(0, currentHourSavings) * remainingHours * timeOfDayFactor;
    }

    // Apply weather-aware adjustments if thermal model is available
    const weatherAdjustedSavings = this.applyWeatherAdjustments(baseSavings, todayOptimizations);
    
    return weatherAdjustedSavings;
  }

  /**
   * Apply weather-aware adjustments to projected savings
   */
  private applyWeatherAdjustments(baseSavings: number, todayOptimizations: OptimizationData[]): number {
    if (!this.thermalModelService || todayOptimizations.length === 0) {
      return baseSavings;
    }

    try {
      const characteristics = this.thermalModelService.getThermalCharacteristics();
      
      if (characteristics.modelConfidence < 0.3) {
        return baseSavings; // Not enough confidence in weather impact data
      }

      // Calculate average outdoor temperature trends from today's data
      const outdoorTemps = todayOptimizations
        .filter(opt => opt.outdoorTemp !== undefined)
        .map(opt => opt.outdoorTemp!);

      if (outdoorTemps.length < 2) {
        return baseSavings; // Not enough weather data
      }

      // Calculate temperature trend (getting warmer or colder)
      const tempTrend = outdoorTemps[outdoorTemps.length - 1] - outdoorTemps[0];
      
      // Apply weather adjustment based on thermal characteristics
      let weatherMultiplier = 1.0;
      
      // If it's getting colder, heating will be more important = higher savings potential
      // If it's getting warmer, heating will be less important = lower savings potential
      const tempImpact = tempTrend * characteristics.outdoorTempImpact;
      weatherMultiplier += tempImpact * 0.1; // Scale the impact
      
      // Ensure reasonable bounds
      weatherMultiplier = Math.max(0.9, Math.min(1.1, weatherMultiplier));
      
      this.safeDebug('Applied weather adjustments to projected savings:', {
        baseSavings: baseSavings.toFixed(4),
        tempTrend: tempTrend.toFixed(2),
        outdoorTempImpact: characteristics.outdoorTempImpact.toFixed(3),
        weatherMultiplier: weatherMultiplier.toFixed(3),
        adjustedSavings: (baseSavings * weatherMultiplier).toFixed(4)
      });

      return baseSavings * weatherMultiplier;
      
    } catch (error) {
      this.safeError('Error applying weather adjustments:', error);
      return baseSavings;
    }
  }

  /**
   * Get time-of-day factor for savings projection
   * Uses learned usage patterns when available, falls back to hardcoded hours
   */
  private getTimeOfDayFactor(currentHour: number, remainingHours: number): number {
    // Try to use learned hot water usage patterns first
    if (this.hotWaterService) {
      try {
        const patterns = (this.hotWaterService as any).getUsagePatterns?.();
        
        if (patterns && patterns.hourlyUsagePattern && patterns.confidence > 30) {
          let totalFactor = 0;
          
          for (let i = 0; i < remainingHours; i++) {
            const hour = (currentHour + 1 + i) % 24;
            const usageLevel = patterns.hourlyUsagePattern[hour] || 1;
            
            // Convert usage pattern to savings multiplier
            // Higher usage typically correlates with higher savings potential
            // Scale usage (typically 0.5-3.0) to factor range (0.6-1.4)
            const usageFactor = 0.6 + (Math.min(usageLevel, 3) * 0.27);
            totalFactor += usageFactor;
          }
          
          this.safeDebug('Using learned usage patterns for time-of-day factors:', {
            currentHour,
            remainingHours,
            patternsConfidence: patterns.confidence,
            avgFactor: (totalFactor / remainingHours).toFixed(3)
          });
          
          return totalFactor / remainingHours;
        }
      } catch (error) {
        this.safeError('Error getting usage patterns, using fallback:', error);
      }
    }

    // Fallback to original hardcoded time-of-day calculation
    // Peak hours (17-21) typically have higher electricity prices
    // Off-peak hours (23-06) typically have lower prices
    
    let totalFactor = 0;
    for (let i = 0; i < remainingHours; i++) {
      const hour = (currentHour + 1 + i) % 24;
      
      if (hour >= 17 && hour <= 21) {
        totalFactor += 1.02; // Peak hours - mild uplift
      } else if (hour >= 23 || hour <= 6) {
        totalFactor += 0.98; // Off-peak hours - mild reduction
      } else {
        totalFactor += 1.0; // Normal hours
      }
    }
    
    return totalFactor / remainingHours;
  }

  /**
   * Calculate confidence level based on data quality and amount
   * Integrates real model confidence from thermal and hot water services
   */
  private calculateConfidence(todayOptimizations: OptimizationData[], currentHour: number): number {
    let confidence = 0.5; // Base confidence

    // Increase confidence based on number of data points
    const dataPointsFactor = Math.min(todayOptimizations.length / 8, 1) * 0.3; // Max 30% from data points
    confidence += dataPointsFactor;

    // Increase confidence based on time of day (more data = higher confidence)
    const timeOfDayFactor = Math.min(currentHour / 24, 1) * 0.15; // Max 15% from time progression (softer)
    confidence += timeOfDayFactor;

    // Decrease confidence if savings are highly variable
    if (todayOptimizations.length >= 2) {
      const savingsVariance = this.calculateSavingsVariance(todayOptimizations);
      const variancePenalty = Math.min(savingsVariance * 0.1, 0.2); // Max 20% penalty
      confidence -= variancePenalty;
    }

    // Enhance with real model confidence from services
    const serviceConfidences: number[] = [];
    
    // Add thermal model confidence
    if (this.thermalModelService) {
      try {
        const characteristics = this.thermalModelService.getThermalCharacteristics();
        if (characteristics.modelConfidence > 0) {
          serviceConfidences.push(characteristics.modelConfidence);
        }
      } catch (error) {
        this.safeError('Error getting thermal model confidence:', error);
      }
    }

    // Add hot water usage pattern confidence  
    if (this.hotWaterService) {
      try {
        const patterns = (this.hotWaterService as any).getUsagePatterns?.();
        if (patterns && patterns.confidence > 0) {
          serviceConfidences.push(patterns.confidence / 100); // Convert percentage to decimal
        }
      } catch (error) {
        this.safeError('Error getting hot water pattern confidence:', error);
      }
    }

    // Blend service confidences with basic confidence
    if (serviceConfidences.length > 0) {
      const avgServiceConfidence = serviceConfidences.reduce((sum, conf) => sum + conf, 0) / serviceConfidences.length;
      
      // Weight: 70% basic calculation, 30% service models (softer)
      confidence = (confidence * 0.7) + (avgServiceConfidence * 0.3);
      
      this.safeDebug('Enhanced confidence calculation:', {
        basicConfidence: confidence.toFixed(3),
        serviceConfidences: serviceConfidences.map(c => c.toFixed(3)),
        avgServiceConfidence: avgServiceConfidence.toFixed(3),
        finalConfidence: confidence.toFixed(3)
      });
    }

    return Math.max(0.1, Math.min(0.9, confidence)); // cap at 0.9 to avoid overconfidence
  }

  /**
   * Calculate variance in savings to assess consistency
   */
  private calculateSavingsVariance(optimizations: OptimizationData[]): number {
    if (optimizations.length < 2) return 0;

    const avgSavings = optimizations.reduce((sum, opt) => sum + opt.savings, 0) / optimizations.length;
    const variance = optimizations.reduce((sum, opt) => {
      return sum + Math.pow(opt.savings - avgSavings, 2);
    }, 0) / optimizations.length;

    return Math.sqrt(variance) / Math.abs(avgSavings); // Coefficient of variation
  }

  /**
   * Determine which calculation method was used
   */
  private getCalculationMethod(todayOptimizations: OptimizationData[], currentHour: number, futurePriceFactors?: number[]): string {
    const priceAware = Array.isArray(futurePriceFactors) && futurePriceFactors.length > 0;
    if (priceAware) {
      return 'price_aware_projection';
    }
    if (todayOptimizations.length === 0) {
      return 'simple_projection';
    } else if (todayOptimizations.length >= 3) {
      return 'enhanced_with_compounding';
    } else if (todayOptimizations.length >= 1) {
      return 'weighted_projection';
    } else {
      return 'current_hour_only';
    }
  }

  /**
   * Get intelligent baseline configuration based on system analysis
   * Uses smart defaults that represent typical non-optimized heat pump operation
   */
  public getDefaultBaselineConfig(): BaselineConfig {
    // Determine intelligent defaults based on available services
    let operatingProfile: 'always_on' | '24_7' | 'schedule' = 'schedule';
    let assumedHeatingCOP = 2.2;
    let assumedHotWaterCOP = 1.8;
    
    // If we have learned COP data, use more conservative versions
    if (this.copHelper) {
      try {
        // Use 80% of current seasonal COP as baseline (representing less efficient operation)
        const seasonalCOP = this.copHelper.getSeasonalCOP();
        if (typeof seasonalCOP === 'number' && seasonalCOP > 1.5) {
          assumedHeatingCOP = Math.max(1.8, seasonalCOP * 0.8);
        }
      } catch (error) {
        // Use defaults if COP data unavailable
      }
    }
    
    // If we have hot water patterns, determine if user likely uses scheduling
    if (this.hotWaterService) {
      try {
        const patterns = (this.hotWaterService as any).getUsagePatterns?.();
        if (patterns && patterns.hourlyUsagePattern) {
          // Analyze if usage shows clear day/night patterns
          const nightHours = [0, 1, 2, 3, 4, 5, 22, 23];
          const dayHours = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];
          
          const nightUsage = nightHours.reduce((sum, h) => sum + (patterns.hourlyUsagePattern[h] || 0), 0) / nightHours.length;
          const dayUsage = dayHours.reduce((sum, h) => sum + (patterns.hourlyUsagePattern[h] || 0), 0) / dayHours.length;
          
          // If day usage is significantly higher than night, assume scheduling is used
          if (dayUsage > nightUsage * 1.5) {
            operatingProfile = 'schedule';
          } else if (nightUsage > dayUsage * 0.8) {
            // If night usage is substantial, assume always-on operation
            operatingProfile = 'always_on';
          }
        }
      } catch (error) {
        // Use default if analysis fails
      }
    }
    
    return {
      heatingSetpoint: 21.0,      // EU standard comfort temperature
      hotWaterSetpoint: 60.0,     // Legionella prevention requirement
      operatingProfile: operatingProfile,
      assumedHeatingCOP: assumedHeatingCOP,
      assumedHotWaterCOP: assumedHotWaterCOP,
      scheduleConfig: {
        dayStart: 6,              // Typical European wake time
        dayEnd: 23,              // Typical European bedtime  
        nightTempReduction: 3.0   // Standard night setback
      }
    };
  }

  /**
   * Check if baseline calculations are available
   */
  public hasBaselineCapability(): boolean {
    return !!this.fixedBaselineCalculator;
  }

  /**
   * Get the fixed baseline calculator instance
   */
  public getBaselineCalculator(): FixedBaselineCalculator | undefined {
    return this.fixedBaselineCalculator;
  }
}
