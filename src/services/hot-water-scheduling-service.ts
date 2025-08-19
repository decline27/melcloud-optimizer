import { ServiceBase } from './base/service-base';
import { ConfigurationService, HotWaterConfig } from './configuration-service';
import { COPCalculationService, COPCalculationData } from './cop-calculation-service';
import { HomeyLogger } from '../util/logger';

export interface HotWaterUsagePattern {
  peakHours: string[];
  averageDaily: number; // liters
  efficiency: number; // 0-1
  seasonalAdjustment: number; // 0-1
  userLearningData: Array<{
    hour: number;
    usage: number;
    confidence: number;
  }>;
}

export interface HotWaterSchedule {
  immediate: {
    action: 'heat' | 'maintain' | 'off';
    targetTemp: number;
    duration: number; // minutes
  };
  hourly: Array<{
    hour: number;
    action: 'preheat' | 'maintain' | 'off';
    targetTemp: number;
    priority: number; // 1-10
  }>;
  daily: {
    totalEnergy: number; // kWh
    estimatedCost: number;
    peakPrepTimes: string[];
  };
}

export interface HotWaterOptimizationInput {
  currentTemp: number;
  currentPrice: number;
  futureHourPrices: number[];
  usageHistory?: Array<{ timestamp: string; amount: number }>;
  seasonalMode: 'winter' | 'summer' | 'transition';
  outdoorTemp?: number;
}

export interface HotWaterOptimizationResult {
  schedule: HotWaterSchedule;
  usagePattern: HotWaterUsagePattern;
  projectedSavings: {
    hourly: number;
    daily: number;
    weekly: number;
    confidence: number;
  };
  recommendations: string[];
}

/**
 * Hot Water Scheduling Service
 * 
 * Provides comprehensive hot water optimization with usage pattern analysis,
 * scheduling optimization for energy efficiency, and integration with thermal
 * optimization for maximum savings. Includes user behavior learning for
 * adaptive scheduling.
 */
export class HotWaterSchedulingService extends ServiceBase {
  private usagePattern!: HotWaterUsagePattern;
  private config: HotWaterConfig | null = null;
  private scheduleHistory: HotWaterSchedule[] = [];

  constructor(
    private configService: ConfigurationService,
    private copService: COPCalculationService,
    logger: HomeyLogger
  ) {
    super(logger);
    // Initialize with defaults - configuration will be loaded on first use
    this.usagePattern = {
      peakHours: ['07:00', '19:00'],
      averageDaily: 200,
      efficiency: 0.85,
      seasonalAdjustment: 1.0,
      userLearningData: []
    };
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.config) {
      try {
        this.config = await this.configService.getConfig('hotWater');
        
        // Update usage pattern with configuration values
        this.usagePattern.peakHours = this.config.usage.defaultPeaks;
        this.usagePattern.efficiency = this.config.usage.efficiency;

        this.logInfo('Hot water scheduling service initialized', {
          usagePattern: this.usagePattern,
          config: this.config
        });
      } catch (error) {
        this.logError(error as Error, { context: 'hot water initialization' });
        throw this.createServiceError(
          'Failed to initialize hot water scheduling service',
          'HOTWATER_INIT_ERROR',
          true
        );
      }
    }
  }

  /**
   * Optimize hot water schedule based on usage patterns, pricing, and COP calculations
   */
  async optimizeHotWaterSchedule(input: HotWaterOptimizationInput): Promise<HotWaterOptimizationResult> {
    await this.ensureInitialized();

    return this.executeWithRetry(async () => {
      // Learn from usage history if provided
      if (input.usageHistory && this.config!.usage.learnPattern) {
        this.learnFromUsageHistory(input.usageHistory);
      }

      // Calculate COP for hot water heating
      const copData: COPCalculationData = {
        temperature: input.currentTemp,
        outdoorTemp: input.outdoorTemp,
        operationMode: 'hotwater',
        seasonalMode: input.seasonalMode
      };

      const copResult = await this.copService.calculateCOP(copData);

      // Optimize schedule based on usage patterns and pricing
      const schedule = this.calculateOptimalSchedule(
        input.currentTemp,
        input.currentPrice,
        input.futureHourPrices,
        copResult.cop
      );

      // Calculate projected savings
      const projectedSavings = this.calculateProjectedSavings(schedule, input);

      // Generate recommendations
      const recommendations = this.generateRecommendations(schedule, input);

      // Store in history
      this.scheduleHistory.push(schedule);
      if (this.scheduleHistory.length > 168) { // One week of history
        this.scheduleHistory.shift();
      }

      this.logInfo('Hot water schedule optimized', {
        schedule: schedule.immediate,
        projectedSavings,
        recommendationCount: recommendations.length
      });

      return {
        schedule,
        usagePattern: { ...this.usagePattern },
        projectedSavings,
        recommendations
      };
    });
  }

  /**
   * Learn usage patterns from historical data
   */
  private learnFromUsageHistory(usageHistory: Array<{ timestamp: string; amount: number }>): void {
    // Analyze usage patterns by hour of day
    const hourlyUsage = new Array(24).fill(0);
    const hourlyCounts = new Array(24).fill(0);

    usageHistory.forEach(entry => {
      const hour = new Date(entry.timestamp).getUTCHours(); // Use UTC hours for consistency
      hourlyUsage[hour] += entry.amount;
      hourlyCounts[hour]++;
    });

    // Update usage pattern with learned data
    this.usagePattern.userLearningData = hourlyUsage.map((usage, hour) => ({
      hour,
      usage: hourlyCounts[hour] > 0 ? usage / hourlyCounts[hour] : 0,
      confidence: Math.min(1.0, hourlyCounts[hour] / 7) // Higher confidence with more data points (7 days)
    }));

    // Calculate total daily average from all usage history
    const totalUsage = usageHistory.reduce((sum, entry) => sum + entry.amount, 0);
    if (usageHistory.length > 0) {
      this.usagePattern.averageDaily = totalUsage;
    }

    // Identify new peak hours based on learned data
    const averageHourlyUsage = this.usagePattern.averageDaily / 24;
    const learntPeaks = this.usagePattern.userLearningData
      .filter(data => data.usage >= averageHourlyUsage * 1.2) // Greater than or equal to 20% above average
      .sort((a, b) => b.usage - a.usage)
      .slice(0, 3) // Top 3 peak hours
      .map(data => `${data.hour.toString().padStart(2, '0')}:00`);

    if (learntPeaks.length > 0) {
      this.usagePattern.peakHours = learntPeaks;
      this.logInfo('Hot water usage patterns updated from history', {
        newPeaks: learntPeaks,
        averageDaily: this.usagePattern.averageDaily
      });
    }
  }

  /**
   * Calculate optimal schedule based on pricing and usage patterns
   */
  private calculateOptimalSchedule(
    currentTemp: number,
    currentPrice: number,
    futureHourPrices: number[],
    cop: number
  ): HotWaterSchedule {
    const priceData = [currentPrice, ...futureHourPrices.slice(0, 23)];
    const avgPrice = priceData.reduce((sum, price) => sum + price, 0) / priceData.length;

    // Determine immediate action
    const immediate = this.determineImmediateAction(currentTemp, currentPrice, avgPrice, cop);

    // Plan hourly schedule
    const hourly = this.planHourlySchedule(priceData, avgPrice, cop);

    // Calculate daily summary
    const daily = this.calculateDailySummary(hourly, cop);

    return { immediate, hourly, daily };
  }

  /**
   * Determine immediate action based on current conditions
   */
  private determineImmediateAction(
    currentTemp: number,
    currentPrice: number,
    avgPrice: number,
    cop: number
  ): { action: 'heat' | 'maintain' | 'off'; targetTemp: number; duration: number } {
    const minTemp = this.config!.scheduling.minTemperature;
    const maxTemp = this.config!.scheduling.maxTemperature;
    const currentHour = new Date().getHours();
    
    // Check if we're approaching a peak usage time
    const isApproachingPeak = this.usagePattern.peakHours.some(peakHour => {
      const peakHourNum = parseInt(peakHour.split(':')[0]);
      const hourDiff = (peakHourNum - currentHour + 24) % 24;
      return hourDiff <= 2 && hourDiff > 0; // 1-2 hours before peak
    });

    // Check if it's currently cheap electricity
    const isCheapElectricity = currentPrice < avgPrice * 0.8;

    if (currentTemp < minTemp) {
      // Must heat - below minimum
      return {
        action: 'heat',
        targetTemp: minTemp + 5, // Heat 5°C above minimum for buffer
        duration: 30
      };
    } else if (isApproachingPeak && currentTemp < maxTemp && isCheapElectricity) {
      // Preheat before peak usage with cheap electricity
      return {
        action: 'heat',
        targetTemp: Math.min(maxTemp, currentTemp + 10),
        duration: 45
      };
    } else if (currentTemp > maxTemp) {
      // Too hot - turn off
      return {
        action: 'off',
        targetTemp: currentTemp,
        duration: 60
      };
    } else {
      // Maintain current temperature
      return {
        action: 'maintain',
        targetTemp: currentTemp,
        duration: 30
      };
    }
  }

  /**
   * Plan hourly schedule for the next 24 hours
   */
  private planHourlySchedule(
    priceData: number[],
    avgPrice: number,
    cop: number
  ): Array<{ hour: number; action: 'preheat' | 'maintain' | 'off'; targetTemp: number; priority: number }> {
    const schedule: Array<{ hour: number; action: 'preheat' | 'maintain' | 'off'; targetTemp: number; priority: number }> = [];
    const now = new Date();

    for (let i = 0; i < 24; i++) {
      const hour = (now.getHours() + i) % 24;
      const price = priceData[i] || avgPrice;
      const priceRatio = price / avgPrice;
      
      // Check if this is a peak usage hour
      const isPeakHour = this.usagePattern.peakHours.some(peakHour => {
        return parseInt(peakHour.split(':')[0]) === hour;
      });

      // Check if this is the hour before a peak
      const isPrePeakHour = this.usagePattern.peakHours.some(peakHour => {
        const peakHourNum = parseInt(peakHour.split(':')[0]);
        return (peakHourNum - 1 + 24) % 24 === hour;
      });

      let action: 'preheat' | 'maintain' | 'off' = 'maintain';
      let targetTemp = this.config!.scheduling.minTemperature + 5; // Default safe temperature
      let priority = 5; // Medium priority

      if (isPeakHour) {
        // During peak usage - maintain high temperature
        action = 'maintain';
        targetTemp = this.config!.scheduling.maxTemperature - 5;
        priority = 10; // Highest priority
      } else if (isPrePeakHour && priceRatio < 1.2) {
        // Hour before peak and not too expensive - preheat
        action = 'preheat';
        targetTemp = this.config!.scheduling.maxTemperature;
        priority = 8;
      } else if (priceRatio < 0.5) {
        // Very cheap electricity - aggressive preheating opportunity
        action = 'preheat';
        targetTemp = this.config!.scheduling.maxTemperature;
        priority = 9;
      } else if (priceRatio < 0.7) {
        // Moderately cheap electricity - opportunity to preheat
        action = 'preheat';
        targetTemp = this.config!.scheduling.maxTemperature;
        priority = 7;
      } else if (priceRatio > 2.0) {
        // Extremely expensive electricity - minimize heating
        action = 'off';
        targetTemp = this.config!.scheduling.minTemperature;
        priority = 1;
      } else if (priceRatio > 1.5) {
        // Very expensive electricity - minimize heating
        action = 'off';
        targetTemp = this.config!.scheduling.minTemperature;
        priority = 2;
      }

      schedule.push({ hour, action, targetTemp, priority });
    }

    return schedule;
  }

  /**
   * Calculate daily energy and cost summary
   */
  private calculateDailySummary(
    hourlySchedule: Array<{ hour: number; action: string; targetTemp: number; priority: number }>,
    cop: number
  ): { totalEnergy: number; estimatedCost: number; peakPrepTimes: string[] } {
    let totalEnergy = 0;
    let estimatedCost = 0;
    const peakPrepTimes: string[] = [];

    hourlySchedule.forEach(scheduleItem => {
      // Estimate energy consumption per hour based on action
      let hourlyEnergy = 0;
      
      switch (scheduleItem.action) {
        case 'preheat':
          hourlyEnergy = 3.0; // kWh for active heating
          break;
        case 'maintain':
          hourlyEnergy = 1.5; // kWh for maintenance
          break;
        case 'off':
          hourlyEnergy = 0.2; // kWh for standby
          break;
      }

      // Adjust for COP efficiency
      const electricalEnergy = hourlyEnergy / cop;
      totalEnergy += electricalEnergy;

      // Estimate cost (simplified - would need actual hourly prices)
      estimatedCost += electricalEnergy * 100; // Assuming 100 øre/kWh average

      // Track preheat times
      if (scheduleItem.action === 'preheat') {
        peakPrepTimes.push(`${scheduleItem.hour.toString().padStart(2, '0')}:00`);
      }
    });

    return {
      totalEnergy: Math.round(totalEnergy * 100) / 100,
      estimatedCost: Math.round(estimatedCost * 100) / 100,
      peakPrepTimes
    };
  }

  /**
   * Calculate projected savings compared to baseline
   */
  private calculateProjectedSavings(
    schedule: HotWaterSchedule,
    input: HotWaterOptimizationInput
  ): { hourly: number; daily: number; weekly: number; confidence: number } {
    // Compare optimized schedule vs always-on baseline
    const baselineEnergy = 4.0; // kWh per hour for always-on heating
    const optimizedEnergy = schedule.daily.totalEnergy / 24;
    
    const hourlySavings = (baselineEnergy - optimizedEnergy) * input.currentPrice / 100;
    const dailySavings = hourlySavings * 24;
    const weeklySavings = dailySavings * 7;

    // Calculate confidence based on usage pattern data quality
    let confidence = 0.5; // Default confidence without learning data
    
    if (this.usagePattern.userLearningData.length > 0) {
      const avgConfidence = this.usagePattern.userLearningData.reduce((sum, data) => sum + data.confidence, 0) / this.usagePattern.userLearningData.length;
      confidence = Math.max(0.5, avgConfidence); // Minimum 0.5 confidence
    }

    return {
      hourly: Math.max(0, Math.round(hourlySavings * 100) / 100),
      daily: Math.max(0, Math.round(dailySavings * 100) / 100),
      weekly: Math.max(0, Math.round(weeklySavings * 100) / 100),
      confidence: Math.round(confidence * 100) / 100
    };
  }

  /**
   * Generate optimization recommendations
   */
  private generateRecommendations(
    schedule: HotWaterSchedule,
    input: HotWaterOptimizationInput
  ): string[] {
    const recommendations: string[] = [];

    // Check if usage patterns could be optimized
    if (this.usagePattern.userLearningData.length > 0) {
      const peakUsage = Math.max(...this.usagePattern.userLearningData.map(d => d.usage));
      const avgUsage = this.usagePattern.userLearningData.reduce((sum, d) => sum + d.usage, 0) / 24;
      
      if (peakUsage > avgUsage * 3) {
        recommendations.push("Consider spreading hot water usage throughout the day to improve efficiency");
      }
    }

    // Check temperature settings
    if (input.currentTemp > this.config!.scheduling.maxTemperature + 5) {
      recommendations.push("Current hot water temperature is higher than necessary - consider reducing setpoint");
    }

    // Check for preheating opportunities - look for multiple cheap hours
    const currentPrice = input.currentPrice;
    const cheapHours = input.futureHourPrices.filter(price => price < currentPrice * 0.8).length;
    if (cheapHours >= 6) {
      recommendations.push("Multiple cheap electricity periods ahead - schedule preheating to maximize savings");
    }

    // Seasonal adjustments
    if (input.seasonalMode === 'winter' && input.outdoorTemp !== undefined && input.outdoorTemp < 0) {
      recommendations.push("Cold weather detected - consider increasing minimum temperature for faster recovery");
    }

    // Smart mode suggestions
    if (!this.config!.scheduling.smartMode) {
      recommendations.push("Enable smart mode for automatic learning and optimization");
    }

    // Efficiency improvements
    if (this.usagePattern.efficiency < 0.8) {
      recommendations.push("Hot water system efficiency is below optimal - check insulation and piping");
    }

    return recommendations;
  }

  /**
   * Get current usage pattern for reporting
   */
  public getUsagePattern(): HotWaterUsagePattern {
    return { ...this.usagePattern };
  }

  /**
   * Get schedule history for analysis
   */
  public getScheduleHistory(): HotWaterSchedule[] {
    return [...this.scheduleHistory];
  }

  /**
   * Update usage pattern manually (for testing or manual adjustments)
   */
  public updateUsagePattern(pattern: Partial<HotWaterUsagePattern>): void {
    this.usagePattern = { ...this.usagePattern, ...pattern };
    this.logInfo('Hot water usage pattern updated manually', { 
      updatedFields: Object.keys(pattern) 
    });
  }

  /**
   * Clear learning data and reset to defaults
   */
  public resetLearningData(): void {
    this.usagePattern.userLearningData = [];
    this.usagePattern.peakHours = this.config?.usage.defaultPeaks || ['07:00', '19:00'];
    this.usagePattern.averageDaily = 200;
    this.logInfo('Hot water learning data reset to defaults');
  }
}
