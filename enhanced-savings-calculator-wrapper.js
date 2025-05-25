/**
 * Enhanced Savings Calculator Wrapper for JavaScript compatibility
 * Provides the same functionality as the TypeScript EnhancedSavingsCalculator
 * but in plain JavaScript for use in api.js and other JS files
 */

/**
 * Enhanced Savings Calculator
 * Provides sophisticated daily savings calculations that account for:
 * - Compounding effects throughout the day
 * - Historical optimization data
 * - Time-weighted savings projections
 * - Seasonal and COP-based adjustments
 */
class EnhancedSavingsCalculator {
  constructor(logger) {
    this.logger = logger;
  }

  /**
   * Calculate enhanced daily savings with compounding effects
   * @param {number} currentHourSavings Current hour's savings
   * @param {Array} historicalOptimizations Historical optimization data from today
   * @param {number} currentHour Current hour (0-23)
   * @returns {Object} Enhanced savings calculation result
   */
  calculateEnhancedDailySavings(currentHourSavings, historicalOptimizations = [], currentHour = new Date().getHours()) {
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
        currentHour
      );

      // Calculate total daily savings
      const totalDailySavings = actualSavings + currentHourSavings + projectedSavings;

      // Calculate confidence based on data quality and amount
      const confidence = this.calculateConfidence(todayOptimizations, currentHour);

      // Determine calculation method used
      const method = this.getCalculationMethod(todayOptimizations, currentHour);

      const result = {
        dailySavings: totalDailySavings,
        compoundedSavings: compoundedSavings,
        projectedSavings: projectedSavings,
        confidence: confidence,
        method: method,
        breakdown: {
          actualSavings: actualSavings,
          currentHourSavings: currentHourSavings,
          projectedHours: remainingHours,
          projectedAmount: projectedSavings
        }
      };

      if (this.logger && this.logger.debug) {
        this.logger.debug('Enhanced daily savings calculation:', {
          currentHour,
          actualSavings: actualSavings.toFixed(4),
          currentHourSavings: currentHourSavings.toFixed(4),
          projectedSavings: projectedSavings.toFixed(4),
          totalDailySavings: totalDailySavings.toFixed(4),
          confidence: confidence.toFixed(2),
          method
        });
      }

      return result;
    } catch (error) {
      if (this.logger && this.logger.error) {
        this.logger.error('Error in enhanced daily savings calculation:', error);
      }
      
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
  calculateCompoundedSavings(todayOptimizations, currentHourSavings, currentHour) {
    if (todayOptimizations.length === 0) {
      return currentHourSavings * 24;
    }

    // Calculate thermal inertia factor based on temperature changes
    const thermalInertiaFactor = this.calculateThermalInertiaFactor(todayOptimizations);
    
    // Calculate cumulative effect factor
    const cumulativeEffectFactor = this.calculateCumulativeEffectFactor(todayOptimizations, currentHour);
    
    // Base savings from actual optimizations
    const baseSavings = todayOptimizations.reduce((sum, opt) => sum + (opt.savings || 0), 0);
    
    // Apply compounding factors
    const compoundedSavings = baseSavings * (1 + thermalInertiaFactor + cumulativeEffectFactor);
    
    // Add current hour and project remaining hours with compounding
    const remainingHours = 24 - (todayOptimizations.length + 1);
    const projectedWithCompounding = (currentHourSavings + (currentHourSavings * remainingHours)) * 
                                   (1 + thermalInertiaFactor * 0.5); // Reduced factor for projections
    
    return compoundedSavings + projectedWithCompounding;
  }

  /**
   * Calculate thermal inertia factor based on temperature changes
   */
  calculateThermalInertiaFactor(optimizations) {
    if (optimizations.length === 0) return 0;

    // Calculate average temperature change magnitude
    const avgTempChange = optimizations.reduce((sum, opt) => {
      return sum + Math.abs(opt.targetTemp - opt.targetOriginal);
    }, 0) / optimizations.length;

    // Thermal inertia provides additional savings when temperature changes are larger
    // because the building retains the temperature longer
    return Math.min(avgTempChange * 0.02, 0.1); // Max 10% bonus
  }

  /**
   * Calculate cumulative effect factor based on optimization consistency
   */
  calculateCumulativeEffectFactor(optimizations, currentHour) {
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
   */
  calculateProjectedSavings(currentHourSavings, todayOptimizations, remainingHours, currentHour) {
    if (remainingHours <= 0) return 0;

    // Use weighted average of today's optimizations if available
    if (todayOptimizations.length >= 2) {
      const recentOptimizations = todayOptimizations.slice(-3); // Last 3 hours
      const avgRecentSavings = recentOptimizations.reduce((sum, opt) => sum + opt.savings, 0) / recentOptimizations.length;
      
      // Weight recent savings more heavily than current hour
      const weightedSavings = (avgRecentSavings * 0.7) + (currentHourSavings * 0.3);
      
      // Apply time-of-day factor (evening hours typically have higher prices)
      const timeOfDayFactor = this.getTimeOfDayFactor(currentHour, remainingHours);
      
      return weightedSavings * remainingHours * timeOfDayFactor;
    }

    // Fallback to current hour savings with time-of-day adjustment
    const timeOfDayFactor = this.getTimeOfDayFactor(currentHour, remainingHours);
    return currentHourSavings * remainingHours * timeOfDayFactor;
  }

  /**
   * Get time-of-day factor for savings projection
   */
  getTimeOfDayFactor(currentHour, remainingHours) {
    // Peak hours (17-21) typically have higher electricity prices
    // Off-peak hours (23-06) typically have lower prices
    
    let totalFactor = 0;
    for (let i = 0; i < remainingHours; i++) {
      const hour = (currentHour + 1 + i) % 24;
      
      if (hour >= 17 && hour <= 21) {
        totalFactor += 1.2; // Peak hours - 20% higher savings potential
      } else if (hour >= 23 || hour <= 6) {
        totalFactor += 0.8; // Off-peak hours - 20% lower savings potential
      } else {
        totalFactor += 1.0; // Normal hours
      }
    }
    
    return totalFactor / remainingHours;
  }

  /**
   * Calculate confidence level based on data quality and amount
   */
  calculateConfidence(todayOptimizations, currentHour) {
    let confidence = 0.5; // Base confidence

    // Increase confidence based on number of data points
    const dataPointsFactor = Math.min(todayOptimizations.length / 8, 1) * 0.3; // Max 30% from data points
    confidence += dataPointsFactor;

    // Increase confidence based on time of day (more data = higher confidence)
    const timeOfDayFactor = Math.min(currentHour / 24, 1) * 0.2; // Max 20% from time progression
    confidence += timeOfDayFactor;

    // Decrease confidence if savings are highly variable
    if (todayOptimizations.length >= 2) {
      const savingsVariance = this.calculateSavingsVariance(todayOptimizations);
      const variancePenalty = Math.min(savingsVariance * 0.1, 0.2); // Max 20% penalty
      confidence -= variancePenalty;
    }

    return Math.max(0.1, Math.min(1.0, confidence));
  }

  /**
   * Calculate variance in savings to assess consistency
   */
  calculateSavingsVariance(optimizations) {
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
  getCalculationMethod(todayOptimizations, currentHour) {
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
}

module.exports = { EnhancedSavingsCalculator };
