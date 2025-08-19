import { ServiceBase } from './base/service-base';
import { ConfigurationService, ThermalConfig, OptimizationConfig } from './configuration-service';
import { COPCalculationService, COPCalculationData } from './cop-calculation-service';
import { ThermalModelService } from './thermal-model';
import { HomeyLogger } from '../util/logger';

export interface ThermalStrategy {
  action: 'preheat' | 'coast' | 'boost' | 'maintain';
  targetTemperature: number;
  duration: number; // in minutes
  confidence: number; // 0-1
  expectedSavings: number; // in currency units
  thermalMassUtilization: number; // 0-1
  reasoning: string;
}

export interface ThermalMassModel {
  capacity: number; // thermal mass capacity
  conductance: number; // heat transfer rate
  timeConstant: number; // hours
  currentCharge: number; // 0-1, current thermal energy stored
  maxDischargeRate: number; // °C/hour
  efficiency: number; // 0-1, efficiency factor
}

export interface ThermalOptimizationInput {
  currentTemp: number;
  targetTemp: number;
  outdoorTemp?: number;
  currentPrice: number;
  futureHourPrices: number[];
  weatherForecast?: any[];
  operationMode: 'heating' | 'cooling';
  timeOfDay: string; // ISO string
}

export interface ThermalOptimizationResult {
  strategy: ThermalStrategy;
  thermalMassState: ThermalMassModel;
  projectedSavings: {
    hourly: number;
    daily: number;
    confidence: number;
  };
  adjustments: {
    immediate: number; // temperature adjustment now
    scheduled: Array<{
      time: string;
      temperature: number;
      action: string;
    }>;
  };
  recommendations: string[];
}

export class ThermalOptimizationService extends ServiceBase {
  private thermalModel: ThermalMassModel | null = null;
  private thermalModelService: ThermalModelService | null = null;
  private strategyHistory: ThermalStrategy[] = [];
  private config: ThermalConfig | null = null;
  private optimizationConfig: OptimizationConfig | null = null;
  private homey: any;

  constructor(
    homey: any,
    private configService: ConfigurationService,
    private copService: COPCalculationService,
    logger: HomeyLogger
  ) {
    super(logger);
    this.homey = homey;
    this.initializeThermalModel();
  }

  private getDefaultThermalModel(): ThermalMassModel {
    return {
      capacity: 50,
      conductance: 2.5,
      timeConstant: 8,
      currentCharge: 0.5,
      maxDischargeRate: 6.25,
      efficiency: 0.85
    };
  }

  private getThermalModel(): ThermalMassModel {
    if (!this.thermalModel) {
      this.thermalModel = this.getDefaultThermalModel();
    }
    return this.thermalModel;
  }

  private async initializeThermalModel(): Promise<void> {
    try {
      this.config = await this.configService.getConfig('thermal');
      this.optimizationConfig = await this.configService.getConfig('optimization');

      this.thermalModel = {
        capacity: this.config.thermalMass.capacity,
        conductance: this.config.thermalMass.conductance,
        timeConstant: this.config.thermalMass.timeConstant,
        currentCharge: 0.5, // Start at 50%
        maxDischargeRate: this.config.thermalMass.capacity / this.config.thermalMass.timeConstant,
        efficiency: 0.85 // Default efficiency
      };

      if (this.optimizationConfig.thermalModel.useLearning) {
        this.thermalModelService = new ThermalModelService(this.homey);
        await this.initializeThermalMassFromHistory();
      }

      this.logInfo('Thermal optimization service initialized', {
        thermalModel: this.thermalModel,
        useLearning: this.optimizationConfig.thermalModel.useLearning,
        config: this.config
      });
    } catch (error) {
      this.logError(error as Error, { context: 'thermal model initialization' });
      throw this.createServiceError(
        'Failed to initialize thermal optimization service',
        'THERMAL_INIT_ERROR',
        true
      );
    }
  }

  async optimizeThermalStrategy(input: ThermalOptimizationInput): Promise<ThermalOptimizationResult> {
    if (!this.config || !this.optimizationConfig || !this.thermalModel) {
      await this.initializeThermalModel();
    }

    return this.executeWithRetry(async () => {
      // Update thermal mass state based on current conditions
      this.updateThermalMassState(input.currentTemp, input.targetTemp, input.outdoorTemp);

      // Calculate thermal strategy
      const strategy = await this.calculateThermalMassStrategy(
        input.currentTemp,
        input.targetTemp,
        input.currentPrice,
        input.futureHourPrices,
        input.outdoorTemp,
        input.timeOfDay
      );

      // Calculate projected savings
      const projectedSavings = await this.calculateProjectedSavings(strategy, input);

      // Generate adjustments
      const adjustments = this.generateAdjustments(strategy, input);

      // Generate recommendations
      const recommendations = this.generateRecommendations(strategy, input);

      // Store strategy in history
      this.strategyHistory.push(strategy);
      if (this.strategyHistory.length > 168) { // Keep one week of history
        this.strategyHistory.shift();
      }

      return {
        strategy,
        thermalMassState: this.thermalModel ? { ...this.thermalModel } : this.getDefaultThermalModel(),
        projectedSavings,
        adjustments,
        recommendations
      };
    });
  }

  private async calculateThermalMassStrategy(
    currentTemp: number,
    targetTemp: number,
    currentPrice: number,
    futureHourPrices: number[],
    outdoorTemp?: number,
    timeOfDay?: string
  ): Promise<ThermalStrategy> {
    const tempDiff = targetTemp - currentTemp;
    const priceData = [currentPrice, ...futureHourPrices.slice(0, 23)];
    
    // Find the most expensive and cheapest hours
    const avgPrice = priceData.reduce((sum, price) => sum + price, 0) / priceData.length;
    const currentPriceRatio = currentPrice / avgPrice;

    // Calculate COP for current conditions
    const copData: COPCalculationData = {
      temperature: currentTemp,
      outdoorTemp,
      operationMode: tempDiff > 0 ? 'heating' : 'cooling',
      seasonalMode: this.determineSeasonalMode()
    };

    const copResult = await this.copService.calculateCOP(copData);

    // Consider time of day for strategy
    const isNightTime = this.isNightTime(timeOfDay);
    const isPeakHour = this.isPeakHour(timeOfDay);

    // Determine optimal strategy based on thermal mass and pricing
    const thermalModel = this.getThermalModel();
    if (currentPriceRatio < 0.8 && thermalModel.currentCharge < 0.7) {
      // Cheap electricity and thermal mass can store more energy
      return this.calculatePreheatingStrategy(currentTemp, targetTemp, copResult.cop, currentPrice, isNightTime);
    } else if (currentPriceRatio > 1.2 && thermalModel.currentCharge > 0.3) {
      // Expensive electricity and we have stored thermal energy
      return this.calculateCoastingStrategy(currentTemp, targetTemp, copResult.cop, isPeakHour);
    } else if (Math.abs(tempDiff) > 1.5) {
      // Significant temperature difference, might need boost
      return this.calculateBoostStrategy(currentTemp, targetTemp, copResult.cop, currentPrice);
    } else {
      // Normal maintenance mode
      return this.calculateMaintenanceStrategy(currentTemp, targetTemp, copResult.cop);
    }
  }

  private calculatePreheatingStrategy(
    currentTemp: number,
    targetTemp: number,
    cop: number,
    currentPrice: number,
    isNightTime: boolean
  ): ThermalStrategy {
    const preheatingWindow = this.config!.strategy.preheatingWindow;
    const thermalModel = this.getThermalModel();
    const maxPreheating = Math.min(2.0, thermalModel.capacity * 0.3); // Max 2°C or 30% of thermal capacity
    
    const preheatingValue = this.calculatePreheatingValue(
      targetTemp,
      thermalModel.currentCharge,
      cop,
      currentPrice
    );

    // Nighttime allows more aggressive preheating
    const nightTimeMultiplier = isNightTime ? 1.2 : 1.0;
    const adjustedPreheating = preheatingValue * nightTimeMultiplier;

    const targetTemperature = targetTemp + Math.min(adjustedPreheating, maxPreheating);
    const expectedSavings = this.calculatePreheatingSavings(adjustedPreheating, cop, currentPrice);

    return {
      action: 'preheat',
      targetTemperature: Math.round(targetTemperature * 10) / 10,
      duration: preheatingWindow * 60, // Convert to minutes
      confidence: Math.min(0.9, cop / 4.0), // Higher COP = higher confidence
      expectedSavings,
      thermalMassUtilization: (adjustedPreheating / maxPreheating),
      reasoning: `Cheap electricity (${Math.round(currentPrice)}øre/kWh) and available thermal capacity. ${isNightTime ? 'Night time allows aggressive preheating.' : 'Preheating during low-cost period.'}`
    };
  }

  private calculateCoastingStrategy(
    currentTemp: number,
    targetTemp: number,
    cop: number,
    isPeakHour: boolean
  ): ThermalStrategy {
    const coastingThreshold = this.config!.strategy.coastingThreshold;
    const thermalModel = this.getThermalModel();
    const dischargeRate = thermalModel.maxDischargeRate;
    
    // Calculate how long we can coast
    const availableEnergy = thermalModel.currentCharge * thermalModel.capacity;
    const coastingDuration = Math.min(120, availableEnergy / dischargeRate * 60); // Max 2 hours

    const coastingSavings = this.calculateCoastingSavings(
      currentTemp,
      targetTemp,
      availableEnergy,
      cop
    );

    // Peak hours allow more aggressive coasting
    const peakHourMultiplier = isPeakHour ? 1.3 : 1.0;
    const coastingTarget = Math.max(
      targetTemp - 1.0, 
      targetTemp * coastingThreshold * peakHourMultiplier
    );

    return {
      action: 'coast',
      targetTemperature: Math.round(coastingTarget * 10) / 10,
      duration: coastingDuration,
      confidence: Math.min(0.8, thermalModel.currentCharge),
      expectedSavings: coastingSavings * peakHourMultiplier,
      thermalMassUtilization: thermalModel.currentCharge,
      reasoning: `High electricity prices and stored thermal energy available. ${isPeakHour ? 'Peak hour - maximizing thermal mass usage.' : 'Using stored thermal energy to reduce costs.'}`
    };
  }

  private calculateBoostStrategy(
    currentTemp: number,
    targetTemp: number,
    cop: number,
    currentPrice: number
  ): ThermalStrategy {
    const boostDuration = this.config!.strategy.boostDuration;
    const tempDiff = Math.abs(targetTemp - currentTemp);
    
    const boostValue = this.calculateBoostValue(tempDiff, cop, currentPrice);
    const boostTarget = currentTemp + (targetTemp > currentTemp ? boostValue : -boostValue);

    return {
      action: 'boost',
      targetTemperature: Math.round(boostTarget * 10) / 10,
      duration: boostDuration,
      confidence: 0.7, // Medium confidence for boost actions
      expectedSavings: 0, // Boost is for comfort, not savings
      thermalMassUtilization: 0.1, // Minimal thermal mass usage
      reasoning: `Significant temperature difference (${tempDiff.toFixed(1)}°C) requires rapid adjustment for comfort.`
    };
  }

  private calculateMaintenanceStrategy(
    currentTemp: number,
    targetTemp: number,
    cop: number
  ): ThermalStrategy {
    const thermalModel = this.getThermalModel();
    
    return {
      action: 'maintain',
      targetTemperature: targetTemp,
      duration: 60, // 1 hour maintenance cycle
      confidence: 0.9,
      expectedSavings: 0,
      thermalMassUtilization: thermalModel.currentCharge,
      reasoning: `Normal operation - maintaining target temperature with current thermal mass state.`
    };
  }

  private calculatePreheatingValue(
    targetTemp: number,
    currentCharge: number,
    cop: number,
    currentPrice: number
  ): number {
    // Calculate optimal preheating based on thermal mass available capacity
    const thermalModel = this.getThermalModel();
    const availableCapacity = (1.0 - currentCharge) * thermalModel.capacity;
    const priceAdvantage = Math.max(0, 1.0 - currentPrice / 100); // Assuming price in øre/kWh
    const copEfficiency = Math.min(1.0, cop / 4.0);
    
    return Math.min(
      availableCapacity * 0.5, // Use up to 50% of available capacity
      2.0, // Max 2°C preheating
      priceAdvantage * copEfficiency * 1.5 // Scale by price advantage and efficiency
    );
  }

  private calculateCoastingSavings(
    currentTemp: number,
    targetTemp: number,
    availableEnergy: number,
    cop: number
  ): number {
    // Estimate savings from using stored thermal energy instead of active heating
    const energyRequired = Math.abs(targetTemp - currentTemp) * 0.5; // Simplified calculation
    const usableEnergy = Math.min(availableEnergy, energyRequired);
    const electricitySaved = usableEnergy / cop; // kWh saved
    
    return electricitySaved * 100; // Assuming 100 øre/kWh average price
  }

  private calculateBoostValue(tempDiff: number, cop: number, currentPrice: number): number {
    // Calculate appropriate boost based on temperature difference and efficiency
    const baseBoost = Math.min(tempDiff * 0.7, 1.5); // Max 1.5°C boost
    const priceMultiplier = Math.max(0.5, 1.0 - (currentPrice / 200)); // Reduce boost if expensive
    const copMultiplier = Math.min(1.2, cop / 3.0); // Higher COP allows more aggressive boost
    
    return baseBoost * priceMultiplier * copMultiplier;
  }

  private calculatePreheatingSavings(preheatingValue: number, cop: number, currentPrice: number): number {
    // Estimate savings from preheating during cheap periods
    const energyStored = preheatingValue * 0.5; // kWh per degree stored (simplified)
    const electricityUsed = energyStored / cop;
    const electricityCost = electricityUsed * currentPrice / 100; // Convert øre to kr
    
    // Assume average price is 20% higher than current cheap price
    const futureCost = electricityCost * 1.2;
    return futureCost - electricityCost;
  }

  private updateThermalMassState(currentTemp: number, targetTemp: number, outdoorTemp?: number): void {
    const tempDiff = currentTemp - targetTemp;
    const chargeRate = 0.1; // Simplified charging rate per degree difference
    const thermalModel = this.getThermalModel();
    
    // Factor in outdoor temperature if available
    let outdoorFactor = 1.0;
    if (outdoorTemp !== undefined) {
      // Colder outdoor temperature makes it harder to maintain charge
      const outdoorImpact = Math.max(0.5, 1.0 - Math.abs(outdoorTemp - currentTemp) / 20);
      outdoorFactor = outdoorImpact;
    }
    
    if (tempDiff > 0) {
      // Above target temperature - thermal mass is charging
      thermalModel.currentCharge = Math.min(1.0, 
        thermalModel.currentCharge + (tempDiff * chargeRate * outdoorFactor));
    } else if (tempDiff < 0) {
      // Below target temperature - thermal mass is discharging
      thermalModel.currentCharge = Math.max(0.0, 
        thermalModel.currentCharge + (tempDiff * chargeRate * outdoorFactor));
    }

    // Update efficiency based on charge level
    thermalModel.efficiency = 0.7 + (thermalModel.currentCharge * 0.3); // 70-100% efficiency
  }

  private async calculateProjectedSavings(
    strategy: ThermalStrategy, 
    input: ThermalOptimizationInput
  ): Promise<{ hourly: number; daily: number; confidence: number }> {
    let hourly = strategy.expectedSavings;
    let daily = hourly * 24;
    let confidence = strategy.confidence;

    // Adjust based on strategy type
    switch (strategy.action) {
      case 'preheat':
        daily *= 1.2; // Preheating typically provides higher daily savings
        break;
      case 'coast':
        daily *= 0.8; // Coasting provides moderate savings
        break;
      case 'boost':
        daily = 0; // Boost is for comfort, no savings
        confidence = 0.5;
        break;
    }

    // Account for price volatility
    const priceVolatility = this.calculatePriceVolatility(input.futureHourPrices);
    confidence *= (1.0 - priceVolatility * 0.3);

    return {
      hourly: Math.round(hourly * 100) / 100,
      daily: Math.round(daily * 100) / 100,
      confidence: Math.round(confidence * 100) / 100
    };
  }

  private calculatePriceVolatility(prices: number[]): number {
    if (prices.length < 2) return 0;
    
    const avg = prices.reduce((sum, price) => sum + price, 0) / prices.length;
    const variance = prices.reduce((sum, price) => sum + Math.pow(price - avg, 2), 0) / prices.length;
    const stdDev = Math.sqrt(variance);
    
    return Math.min(1.0, stdDev / avg); // Normalized volatility
  }

  private generateAdjustments(
    strategy: ThermalStrategy, 
    input: ThermalOptimizationInput
  ): { immediate: number; scheduled: Array<{ time: string; temperature: number; action: string }> } {
    const immediate = strategy.targetTemperature - input.currentTemp;
    const scheduled: Array<{ time: string; temperature: number; action: string }> = [];

    // Generate scheduled adjustments based on strategy
    const now = new Date(input.timeOfDay || Date.now());
    
    for (let i = 1; i <= Math.min(6, strategy.duration / 60); i++) {
      const futureTime = new Date(now.getTime() + i * 60 * 60 * 1000);
      const adjustment = this.calculateFutureAdjustment(strategy, i);
      
      scheduled.push({
        time: futureTime.toISOString(),
        temperature: input.targetTemp + adjustment,
        action: `${strategy.action}_step_${i}`
      });
    }

    return { 
      immediate: Math.round(immediate * 10) / 10, 
      scheduled 
    };
  }

  private calculateFutureAdjustment(strategy: ThermalStrategy, hourOffset: number): number {
    switch (strategy.action) {
      case 'preheat':
        // Gradual reduction back to normal temperature
        return strategy.thermalMassUtilization * Math.exp(-hourOffset * 0.3);
      case 'coast':
        // Gradual discharge of thermal mass
        return -strategy.thermalMassUtilization * (1 - Math.exp(-hourOffset * 0.2));
      case 'boost':
        // Quick return to normal after boost
        return hourOffset > 2 ? 0 : strategy.thermalMassUtilization / hourOffset;
      default:
        return 0;
    }
  }

  private generateRecommendations(
    strategy: ThermalStrategy,
    input: ThermalOptimizationInput
  ): string[] {
    const recommendations: string[] = [];

    // Add strategy-specific recommendations
    recommendations.push(strategy.reasoning);

    // Add thermal mass recommendations
    const thermalModel = this.getThermalModel();
    if (thermalModel.currentCharge < 0.3) {
      recommendations.push('Thermal mass is low - consider preheating during next cheap period.');
    } else if (thermalModel.currentCharge > 0.8) {
      recommendations.push('Thermal mass is high - good opportunity for coasting during expensive periods.');
    }

    // Add price-based recommendations
    const avgPrice = input.futureHourPrices.reduce((sum, p) => sum + p, 0) / input.futureHourPrices.length;
    if (input.currentPrice < avgPrice * 0.8) {
      recommendations.push('Current price is low - consider storing thermal energy.');
    } else if (input.currentPrice > avgPrice * 1.2) {
      recommendations.push('Current price is high - minimize active heating if possible.');
    }

    return recommendations;
  }

  private determineSeasonalMode(): 'winter' | 'summer' | 'transition' {
    const month = new Date().getMonth();
    if (month >= 10 || month <= 2) return 'winter';
    if (month >= 5 && month <= 8) return 'summer';
    return 'transition';
  }

  private isNightTime(timeOfDay?: string): boolean {
    const hour = timeOfDay ? new Date(timeOfDay).getHours() : new Date().getHours();
    return hour >= 22 || hour <= 6;
  }

  private isPeakHour(timeOfDay?: string): boolean {
    const hour = timeOfDay ? new Date(timeOfDay).getHours() : new Date().getHours();
    // Typical peak hours: 7-9 AM and 5-8 PM
    return (hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 20);
  }

  private async initializeThermalMassFromHistory(): Promise<void> {
    if (!this.thermalModelService) return;

    try {
      // Use the existing thermal model service to get historical performance data
      const thermalCharacteristics = await this.thermalModelService.getThermalCharacteristics();
      
      if (thermalCharacteristics && thermalCharacteristics.modelConfidence > 0.3) {
        // Adjust thermal mass model based on learned characteristics
        const thermalModel = this.getThermalModel();
        thermalModel.efficiency = Math.min(1.0, 0.6 + thermalCharacteristics.modelConfidence * 0.4);
        thermalModel.capacity *= (1 + thermalCharacteristics.thermalMass * 0.2);
        
        this.logInfo('Thermal mass initialized from historical data', {
          modelConfidence: thermalCharacteristics.modelConfidence,
          adjustedEfficiency: thermalModel.efficiency,
          adjustedCapacity: thermalModel.capacity
        });
      }
    } catch (error) {
      this.logError(error as Error, { context: 'thermal mass history initialization' });
      // Continue with default values if historical data fails
    }
  }

  getThermalMassState(): ThermalMassModel {
    return { ...this.getThermalModel() };
  }

  getStrategyHistory(): ThermalStrategy[] {
    return [...this.strategyHistory];
  }

  async reconfigureThermal(newConfig: Partial<ThermalConfig>): Promise<void> {
    try {
      await this.configService.updateConfig('thermal', newConfig);
      await this.initializeThermalModel();
      this.logInfo('Thermal optimization service reconfigured', { newConfig });
    } catch (error) {
      this.logError(error as Error, { newConfig });
      throw this.createServiceError(
        'Failed to reconfigure thermal optimization service',
        'THERMAL_RECONFIG_ERROR',
        true
      );
    }
  }

  getStatistics(): Record<string, any> {
    return {
      thermalModel: this.thermalModel,
      strategyHistoryCount: this.strategyHistory.length,
      configLoaded: this.config !== null,
      thermalModelServiceEnabled: this.thermalModelService !== null,
      lastStrategy: this.strategyHistory[this.strategyHistory.length - 1],
      averageConfidence: this.strategyHistory.length > 0 
        ? this.strategyHistory.reduce((sum, s) => sum + s.confidence, 0) / this.strategyHistory.length 
        : 0
    };
  }

  async collectThermalDataPoint(
    currentTemp: number,
    targetTemp: number,
    outdoorTemp?: number
  ): Promise<void> {
    if (this.thermalModelService) {
      try {
        // Create a thermal data point from the provided parameters
        const dataPoint = {
          timestamp: new Date().toISOString(),
          indoorTemperature: currentTemp,
          targetTemperature: targetTemp,
          outdoorTemperature: outdoorTemp || 10, // Default outdoor temp if not provided
          heatingActive: Math.abs(currentTemp - targetTemp) > 0.5, // Simple heating detection
          weatherConditions: {
            windSpeed: 0,
            humidity: 50,
            cloudCover: 50,
            precipitation: 0
          }
        };
        
        this.thermalModelService.collectDataPoint(dataPoint);
        this.logDebug('Thermal data point collected', {
          currentTemp,
          targetTemp,
          outdoorTemp
        });
      } catch (error) {
        this.logError(error as Error, { context: 'thermal data collection' });
      }
    }
  }
}
