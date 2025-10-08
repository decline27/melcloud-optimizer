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
  
  // Confidence in learned parameters (0-1)
  confidence: number;
  
  // Last updated timestamp
  lastUpdated: string;
  
  // Number of optimization cycles used for learning
  learningCycles: number;
}

// Settings key for storing adaptive parameters
const ADAPTIVE_PARAMETERS_SETTINGS_KEY = 'adaptive_business_parameters';

// Default parameters (current hardcoded values)
const DEFAULT_PARAMETERS: AdaptiveParameters = {
  priceWeightSummer: 0.7,
  priceWeightWinter: 0.4,
  priceWeightTransition: 0.5,
  copEfficiencyBonusHigh: 0.3,
  copEfficiencyBonusMedium: 0.2,
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
   */
  private loadStoredParameters(): AdaptiveParameters | null {
    try {
      const stored = this.homey.settings.get(ADAPTIVE_PARAMETERS_SETTINGS_KEY);
      if (stored) {
        return JSON.parse(stored);
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
    
    // Learn COP efficiency adjustments
    if (typeof copPerformance === 'number' && copPerformance > 0) {
      if (copPerformance > 4.0) {
        // Excellent COP: can afford slightly higher bonus
        this.parameters.copEfficiencyBonusHigh = Math.min(0.5, this.parameters.copEfficiencyBonusHigh * 1.01);
      } else if (copPerformance < 2.5) {
        // Poor COP: reduce efficiency bonus
        this.parameters.copEfficiencyBonusHigh = Math.max(0.1, this.parameters.copEfficiencyBonusHigh * 0.99);
      }
    }
    
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
}