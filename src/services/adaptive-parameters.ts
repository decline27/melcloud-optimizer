/**
 * Adaptive Business Logic Parameters
 * 
 * Learns and adapts the business logic parameters that were previously hardcoded.
 * Follows the same pattern as thermal learning but for optimization strategy parameters.
 */

export interface AdaptiveParameters {
  // Price sensitivity weights by season (learned from comfort vs savings outcomes)
  priceWeightSummer: number;
  priceWeightWinter: number;
  priceWeightTransition: number;
  
  // COP efficiency adjustment factors (learned from actual COP performance)
  copEfficiencyBonusHigh: number;  // For excellent COP
  copEfficiencyBonusMedium: number; // For good COP
  
  // Strategy thresholds (learned from outcome performance)
  excellentCOPThreshold: number;    // Threshold for "excellent" COP performance (was hardcoded 0.8)
  goodCOPThreshold: number;         // Threshold for "good" COP performance (was hardcoded 0.5)
  minimumCOPThreshold: number;      // Minimum acceptable COP (was hardcoded 0.2)
  veryChepMultiplier: number;      // Multiplier for "very cheap" price detection (was hardcoded 0.8)
  preheatAggressiveness: number;    // Temperature boost aggressiveness (was hardcoded 2.0)
  coastingReduction: number;        // Temperature reduction when coasting (was hardcoded 1.5)
  boostIncrease: number;           // Temperature increase for boost mode (was hardcoded 0.5)
  
  // COP-based temperature adjustment magnitudes (learned from comfort/savings outcomes)
  copAdjustmentExcellent: number;   // Temperature bonus for excellent COP (was hardcoded 0.2)
  copAdjustmentPoor: number;        // Temperature reduction for poor COP (was hardcoded 0.8)
  copAdjustmentVeryPoor: number;    // Temperature reduction for very poor COP (was hardcoded 1.2)
  summerModeReduction: number;      // Temperature reduction in summer mode (was hardcoded 0.5)
  
  // Confidence in learned parameters (0-1)
  confidence: number;
  
  // Last updated timestamp
  lastUpdated: string;
  
  // Number of optimization cycles used for learning
  learningCycles: number;
}

// Settings key for storing adaptive parameters
const ADAPTIVE_PARAMETERS_SETTINGS_KEY = 'adaptive_business_parameters';

// Default parameters (current hardcoded values that will be adapted)
const DEFAULT_PARAMETERS: AdaptiveParameters = {
  priceWeightSummer: 0.7,
  priceWeightWinter: 0.4,
  priceWeightTransition: 0.5,
  copEfficiencyBonusHigh: 0.3,
  copEfficiencyBonusMedium: 0.2,
  
  // Strategy thresholds (currently hardcoded in optimizer, will be learned)
  excellentCOPThreshold: 0.8,      // Current hardcoded value in optimizer
  goodCOPThreshold: 0.5,           // Current hardcoded value in optimizer
  minimumCOPThreshold: 0.2,        // Current hardcoded value in optimizer
  veryChepMultiplier: 0.8,        // Current hardcoded value (80% of cheap threshold)
  preheatAggressiveness: 2.0,      // Current hardcoded value (2.0°C boost)
  coastingReduction: 1.5,          // Current hardcoded value (1.5°C reduction)
  boostIncrease: 0.5,             // Current hardcoded value (0.5°C increase)
  
  // COP-based temperature adjustment magnitudes
  copAdjustmentExcellent: 0.2,     // Current hardcoded value (+0.2°C bonus)
  copAdjustmentPoor: 0.8,          // Current hardcoded value (-0.8°C reduction)
  copAdjustmentVeryPoor: 1.2,      // Current hardcoded value (-1.2°C reduction)
  summerModeReduction: 0.5,        // Current hardcoded value (-0.5°C in summer)
  
  confidence: 0,
  lastUpdated: new Date().toISOString(),
  learningCycles: 0
};

export class AdaptiveParametersLearner {
  private parameters: AdaptiveParameters;
  
  constructor(private homey: any) {
    this.parameters = this.loadStoredParameters() || { ...DEFAULT_PARAMETERS };
  }
  
  /**
   * Load stored parameters from Homey settings
   * Includes migration logic for new parameters
   */
  private loadStoredParameters(): AdaptiveParameters | null {
    try {
      const stored = this.homey.settings.get(ADAPTIVE_PARAMETERS_SETTINGS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        
        // Migration: Add new parameters if they don't exist (for existing installations)
        const migrated: AdaptiveParameters = {
          ...DEFAULT_PARAMETERS, // Start with all defaults
          ...parsed,              // Override with stored values
        };
        
        // If migration occurred (new fields were added), save the migrated version
        if (Object.keys(migrated).length > Object.keys(parsed).length) {
          this.homey.log('Migrating adaptive parameters with new strategy thresholds');
          setTimeout(() => {
            this.parameters = migrated;
            this.saveParameters();
          }, 1000); // Delayed save to avoid constructor side effects
        }
        
        return migrated;
      }
      return null;
    } catch (error) {
      this.homey.error('Error loading adaptive parameters:', error);
      return null;
    }
  }
  
  /**
   * Save parameters to Homey settings
   */
  private saveParameters(): void {
    try {
      this.homey.settings.set(ADAPTIVE_PARAMETERS_SETTINGS_KEY, JSON.stringify(this.parameters));
    } catch (error) {
      this.homey.error('Error saving adaptive parameters:', error);
    }
  }
  
  /**
   * Get current parameters (with fallbacks to defaults if confidence is low)
   */
  public getParameters(): AdaptiveParameters {
    // If confidence is too low, blend with defaults for stability
    if (this.parameters.confidence < 0.3) {
      const blendFactor = this.parameters.confidence; // 0-0.3 range
      return {
        priceWeightSummer: this.blendValue(this.parameters.priceWeightSummer, DEFAULT_PARAMETERS.priceWeightSummer, blendFactor),
        priceWeightWinter: this.blendValue(this.parameters.priceWeightWinter, DEFAULT_PARAMETERS.priceWeightWinter, blendFactor),
        priceWeightTransition: this.blendValue(this.parameters.priceWeightTransition, DEFAULT_PARAMETERS.priceWeightTransition, blendFactor),
        copEfficiencyBonusHigh: this.blendValue(this.parameters.copEfficiencyBonusHigh, DEFAULT_PARAMETERS.copEfficiencyBonusHigh, blendFactor),
        copEfficiencyBonusMedium: this.blendValue(this.parameters.copEfficiencyBonusMedium, DEFAULT_PARAMETERS.copEfficiencyBonusMedium, blendFactor),
        
        // Strategy thresholds with confidence blending
        excellentCOPThreshold: this.blendValue(this.parameters.excellentCOPThreshold, DEFAULT_PARAMETERS.excellentCOPThreshold, blendFactor),
        goodCOPThreshold: this.blendValue(this.parameters.goodCOPThreshold, DEFAULT_PARAMETERS.goodCOPThreshold, blendFactor),
        minimumCOPThreshold: this.blendValue(this.parameters.minimumCOPThreshold, DEFAULT_PARAMETERS.minimumCOPThreshold, blendFactor),
        veryChepMultiplier: this.blendValue(this.parameters.veryChepMultiplier, DEFAULT_PARAMETERS.veryChepMultiplier, blendFactor),
        preheatAggressiveness: this.blendValue(this.parameters.preheatAggressiveness, DEFAULT_PARAMETERS.preheatAggressiveness, blendFactor),
        coastingReduction: this.blendValue(this.parameters.coastingReduction, DEFAULT_PARAMETERS.coastingReduction, blendFactor),
        boostIncrease: this.blendValue(this.parameters.boostIncrease, DEFAULT_PARAMETERS.boostIncrease, blendFactor),
        
        // COP adjustment magnitudes with confidence blending
        copAdjustmentExcellent: this.blendValue(this.parameters.copAdjustmentExcellent, DEFAULT_PARAMETERS.copAdjustmentExcellent, blendFactor),
        copAdjustmentPoor: this.blendValue(this.parameters.copAdjustmentPoor, DEFAULT_PARAMETERS.copAdjustmentPoor, blendFactor),
        copAdjustmentVeryPoor: this.blendValue(this.parameters.copAdjustmentVeryPoor, DEFAULT_PARAMETERS.copAdjustmentVeryPoor, blendFactor),
        summerModeReduction: this.blendValue(this.parameters.summerModeReduction, DEFAULT_PARAMETERS.summerModeReduction, blendFactor),
        
        confidence: this.parameters.confidence,
        lastUpdated: this.parameters.lastUpdated,
        learningCycles: this.parameters.learningCycles
      };
    }
    
    return { ...this.parameters };
  }
  
  /**
   * Blend learned value with default for stability
   */
  private blendValue(learned: number, defaultVal: number, confidence: number): number {
    return defaultVal + (learned - defaultVal) * confidence;
  }
  
  /**
   * Learn from optimization outcome
   * @param season Current season ('summer', 'winter', 'transition')
   * @param actualSavings Actual energy savings achieved
   * @param comfortViolations Number of times comfort was compromised
   * @param copPerformance Current COP performance (if available)
   */
  public learnFromOutcome(
    season: 'summer' | 'winter' | 'transition',
    actualSavings: number,
    comfortViolations: number,
    copPerformance?: number
  ): void {
    this.parameters.learningCycles++;
    
    // Simple adaptive learning: adjust price sensitivity based on comfort vs savings trade-off
    const comfortSatisfied = comfortViolations === 0;
    const goodSavings = actualSavings > 0;
    
    let currentWeight = this.getPriceWeight(season);
    
    if (comfortSatisfied && goodSavings) {
      // Success: can be slightly more aggressive
      currentWeight *= 1.02;
    } else if (!comfortSatisfied) {
      // Comfort violated: be less aggressive with price optimization
      currentWeight *= 0.98;
    } else if (!goodSavings) {
      // No savings: be more aggressive
      currentWeight *= 1.01;
    }
    
    // Keep within reasonable bounds
    currentWeight = Math.max(0.2, Math.min(0.9, currentWeight));
    this.setPriceWeight(season, currentWeight);
    
    // Learn COP efficiency adjustments and thresholds
    if (typeof copPerformance === 'number' && copPerformance > 0) {
      this.learnCOPThresholds(copPerformance, comfortSatisfied, goodSavings);
      
      if (copPerformance > 4.0) {
        // Excellent COP: can afford slightly higher bonus
        this.parameters.copEfficiencyBonusHigh = Math.min(0.5, this.parameters.copEfficiencyBonusHigh * 1.01);
      } else if (copPerformance < 2.5) {
        // Poor COP: reduce efficiency bonus
        this.parameters.copEfficiencyBonusHigh = Math.max(0.1, this.parameters.copEfficiencyBonusHigh * 0.99);
      }
    }
    
    // Learn strategy aggressiveness based on outcomes
    this.learnStrategyAggressiveness(comfortSatisfied, goodSavings, actualSavings);
    
    // Update confidence (gradually increases with learning cycles)
    this.parameters.confidence = Math.min(1.0, this.parameters.learningCycles / 100); // Full confidence after 100 cycles
    this.parameters.lastUpdated = new Date().toISOString();
    
    this.saveParameters();
  }
  
  /**
   * Get price weight for season
   */
  private getPriceWeight(season: 'summer' | 'winter' | 'transition'): number {
    switch (season) {
      case 'summer': return this.parameters.priceWeightSummer;
      case 'winter': return this.parameters.priceWeightWinter;
      case 'transition': return this.parameters.priceWeightTransition;
    }
  }
  
  /**
   * Set price weight for season
   */
  private setPriceWeight(season: 'summer' | 'winter' | 'transition', weight: number): void {
    switch (season) {
      case 'summer': this.parameters.priceWeightSummer = weight; break;
      case 'winter': this.parameters.priceWeightWinter = weight; break;
      case 'transition': this.parameters.priceWeightTransition = weight; break;
    }
  }

  /**
   * Learn and adapt COP thresholds based on actual performance outcomes
   * @param copPerformance Current COP performance
   * @param comfortSatisfied Whether comfort was maintained
   * @param goodSavings Whether good savings were achieved
   */
  private learnCOPThresholds(copPerformance: number, comfortSatisfied: boolean, goodSavings: boolean): void {
    const learningRate = 0.001; // Very gradual learning to prevent oscillation
    
    // If we had good results with a COP below our "excellent" threshold, maybe we can lower it
    if (comfortSatisfied && goodSavings && copPerformance < this.parameters.excellentCOPThreshold) {
      // Gradually lower the excellent threshold if performance was good with lower COP
      this.parameters.excellentCOPThreshold = Math.max(
        0.3, // Never go below reasonable minimum
        this.parameters.excellentCOPThreshold - learningRate
      );
    }
    
    // If we had poor results with COP above our thresholds, maybe we need to raise them
    if (!comfortSatisfied || !goodSavings) {
      if (copPerformance < this.parameters.goodCOPThreshold) {
        // Poor performance with low COP - maybe raise the minimum threshold
        this.parameters.minimumCOPThreshold = Math.min(
          0.4, // Don't go too high
          this.parameters.minimumCOPThreshold + learningRate
        );
      }
    }
    
    // Ensure thresholds maintain logical order: excellent > good > minimum
    this.parameters.goodCOPThreshold = Math.max(
      this.parameters.minimumCOPThreshold + 0.1,
      Math.min(this.parameters.excellentCOPThreshold - 0.1, this.parameters.goodCOPThreshold)
    );
  }

  /**
   * Learn and adapt strategy aggressiveness based on outcomes
   * @param comfortSatisfied Whether comfort was maintained
   * @param goodSavings Whether good savings were achieved
   * @param actualSavings Actual savings amount
   */
  private learnStrategyAggressiveness(comfortSatisfied: boolean, goodSavings: boolean, actualSavings: number): void {
    const learningRate = 0.002; // Very gradual learning
    
    if (!comfortSatisfied) {
      // Comfort was violated - reduce aggressiveness
      this.parameters.preheatAggressiveness = Math.max(0.5, this.parameters.preheatAggressiveness - learningRate * 5);
      this.parameters.coastingReduction = Math.max(0.5, this.parameters.coastingReduction - learningRate * 3);
      this.parameters.boostIncrease = Math.max(0.2, this.parameters.boostIncrease - learningRate * 2);
      
      // Be more conservative with price detection too
      this.parameters.veryChepMultiplier = Math.min(0.95, this.parameters.veryChepMultiplier + learningRate);
      
      // Learn COP adjustment magnitudes - reduce aggressiveness
      this.learnCOPAdjustmentMagnitudes(comfortSatisfied, goodSavings);
      
    } else if (goodSavings && actualSavings > 0.5) { // Good savings (> 0.5 currency units)
      // Good results - can be slightly more aggressive
      this.parameters.preheatAggressiveness = Math.min(3.0, this.parameters.preheatAggressiveness + learningRate);
      this.parameters.coastingReduction = Math.min(2.5, this.parameters.coastingReduction + learningRate);
      
      // Be more aggressive with price detection
      this.parameters.veryChepMultiplier = Math.max(0.6, this.parameters.veryChepMultiplier - learningRate * 0.5);
      
      // Learn COP adjustment magnitudes
      this.learnCOPAdjustmentMagnitudes(comfortSatisfied, goodSavings);
      
    } else if (!goodSavings) {
      // No savings despite actions - maybe be more aggressive to find opportunities
      this.parameters.veryChepMultiplier = Math.max(0.6, this.parameters.veryChepMultiplier - learningRate);
    }
  }

  /**
   * Get strategy thresholds for use by optimizer
   * Provides a convenient interface for the optimizer to get adaptive thresholds
   */
  public getStrategyThresholds() {
    const params = this.getParameters();
    return {
      excellentCOPThreshold: params.excellentCOPThreshold,
      goodCOPThreshold: params.goodCOPThreshold,
      minimumCOPThreshold: params.minimumCOPThreshold,
      veryChepMultiplier: params.veryChepMultiplier,
      preheatAggressiveness: params.preheatAggressiveness,
      coastingReduction: params.coastingReduction,
      boostIncrease: params.boostIncrease,
      // COP adjustment magnitudes
      copAdjustmentExcellent: params.copAdjustmentExcellent,
      copAdjustmentPoor: params.copAdjustmentPoor,
      copAdjustmentVeryPoor: params.copAdjustmentVeryPoor,
      summerModeReduction: params.summerModeReduction
    };
  }

  /**
   * Learn COP adjustment magnitudes based on comfort/savings outcomes
   * @param comfortSatisfied Whether comfort was maintained
   * @param goodSavings Whether good savings were achieved
   * @param copPerformance Current COP performance (normalized 0-1)
   */
  private learnCOPAdjustmentMagnitudes(comfortSatisfied: boolean, goodSavings: boolean, copPerformance?: number): void {
    const learningRate = 0.002; // Very gradual learning
    
    if (!comfortSatisfied) {
      // Comfort violated - reduce adjustment magnitudes (be less aggressive)
      this.parameters.copAdjustmentPoor = Math.max(0.3, this.parameters.copAdjustmentPoor - learningRate * 3);
      this.parameters.copAdjustmentVeryPoor = Math.max(0.5, this.parameters.copAdjustmentVeryPoor - learningRate * 3);
      this.parameters.summerModeReduction = Math.max(0.2, this.parameters.summerModeReduction - learningRate * 2);
      // Increase excellent bonus slightly to favor efficient periods
      this.parameters.copAdjustmentExcellent = Math.min(0.5, this.parameters.copAdjustmentExcellent + learningRate);
      
    } else if (goodSavings) {
      // Good savings with comfort maintained - can be more aggressive
      this.parameters.copAdjustmentPoor = Math.min(1.5, this.parameters.copAdjustmentPoor + learningRate);
      this.parameters.copAdjustmentVeryPoor = Math.min(2.0, this.parameters.copAdjustmentVeryPoor + learningRate);
      this.parameters.summerModeReduction = Math.min(1.0, this.parameters.summerModeReduction + learningRate);
    }
  }
}