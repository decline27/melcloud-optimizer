import { MelCloudApi } from './melcloud-api';
import { TibberApi } from './tibber-api';
import { ThermalModelService } from './thermal-model';
import { COPHelper } from './cop-helper';
import { validateNumber, validateBoolean } from '../util/validation';
import {
  MelCloudDevice,
  TibberPriceInfo,
  WeatherData,
  ThermalModel,
  OptimizationResult,
  HomeyApp,
  isError
} from '../types';
import { EnhancedSavingsCalculator, OptimizationData, SavingsCalculationResult } from '../util/enhanced-savings-calculator';
import { HomeyLogger } from '../util/logger';

/**
 * Real energy data from MELCloud API
 */
interface RealEnergyData {
  TotalHeatingConsumed: number;
  TotalHeatingProduced: number;
  TotalHotWaterConsumed: number;
  TotalHotWaterProduced: number;
  TotalCoolingConsumed: number;
  TotalCoolingProduced: number;
  CoP?: number[];
  AverageHeatingCOP?: number;
  AverageHotWaterCOP?: number;
  // New explicit fields (preferred)
  heatingCOP?: number | null;
  hotWaterCOP?: number | null;
  coolingCOP?: number | null;
  averageCOP?: number | null;
}

/**
 * Enhanced optimization metrics using real energy data
 */
interface OptimizationMetrics {
  realHeatingCOP: number;
  realHotWaterCOP: number;
  dailyEnergyConsumption: number;
  heatingEfficiency: number;
  hotWaterEfficiency: number;
  seasonalMode: 'summer' | 'winter' | 'transition';
  optimizationFocus: 'heating' | 'hotwater' | 'both';
}

/**
 * Thermal mass model for strategic heating
 */
interface ThermalMassModel {
  thermalCapacity: number;      // kWh/°C - Energy needed to heat home by 1°C
  heatLossRate: number;         // °C/hour - Temperature loss rate
  maxPreheatingTemp: number;    // Maximum safe preheat temperature
  preheatingEfficiency: number; // Efficiency factor for preheating strategy
  lastCalibration: Date;        // When the model was last updated
}

/**
 * Thermal strategy recommendation
 */
interface ThermalStrategy {
  action: 'preheat' | 'coast' | 'maintain' | 'boost';
  targetTemp: number;
  reasoning: string;
  estimatedSavings: number;
  duration?: number; // Hours for the strategy
  confidenceLevel: number; // 0-1 confidence in the strategy
}

/**
 * Hot water usage pattern learning
 */
interface HotWaterUsagePattern {
  hourlyDemand: number[];      // 24-hour demand pattern (kWh per hour)
  peakHours: number[];         // Hours with high demand
  minimumBuffer: number;       // Minimum hot water energy to maintain (kWh)
  lastLearningUpdate: Date;    // When pattern was last updated
  dataPoints: number;          // Number of data points used for learning
}

/**
 * Hot water schedule recommendation
 */
interface HotWaterSchedule {
  schedulePoints: SchedulePoint[];
  currentAction: 'heat_now' | 'delay' | 'maintain';
  reasoning: string;
  estimatedSavings: number;
}

/**
 * Schedule point for hot water heating
 */
interface SchedulePoint {
  hour: number;
  reason: string;
  priority: number; // 0-1, higher = more important
  cop: number;
  pricePercentile: number;
}

interface EnhancedOptimizationResult {
  success: boolean;
  action: 'temperature_adjusted' | 'no_change';
  fromTemp: number;
  toTemp: number;
  reason: string;
  priceData: {
    current: number;
    average: number;
    min: number;
    max: number;
  };
  energyMetrics?: OptimizationMetrics;
  hotWaterAction?: {
    action: 'heat_now' | 'delay' | 'maintain';
    reason: string;
    scheduledTime?: string;
  };
}

/**
 * Optimizer Service
 * Handles the optimization logic for MELCloud devices based on electricity prices
 * and thermal characteristics of the home
 */
export class Optimizer {
  private thermalModel: ThermalModel = { K: 0.5 };
  private minTemp: number = 18;
  private maxTemp: number = 22;
  private tempStep: number = 0.5;
  private deadband: number = 0.3; // Minimum temperature change to trigger adjustment
  private thermalModelService: ThermalModelService | null = null;
  private useThermalLearning: boolean = false;
  private copHelper: COPHelper | null = null;
  private copWeight: number = 0.3;
  private autoSeasonalMode: boolean = true;
  private summerMode: boolean = false;
  
  // Tank temperature settings
  private minTankTemp: number = 41;
  private maxTankTemp: number = 53;
  private tankTempStep: number = 1;
  private enableTankControl: boolean = true;
  private enhancedSavingsCalculator: EnhancedSavingsCalculator;
  private lastEnergyData: RealEnergyData | null = null;
  private optimizationMetrics: OptimizationMetrics | null = null;

  // Thermal mass optimization properties
  private thermalMassModel: ThermalMassModel = {
    thermalCapacity: 2.5,        // Default: 2.5 kWh per °C for average home
    heatLossRate: 0.8,           // Default: 0.8°C per hour heat loss
    maxPreheatingTemp: 23,       // Default: Max 23°C for preheating
    preheatingEfficiency: 0.85,  // Default: 85% efficiency for preheating
    lastCalibration: new Date()
  };
  
  private hotWaterUsagePattern: HotWaterUsagePattern = {
    hourlyDemand: new Array(24).fill(0.5), // Default: 0.5 kWh per hour
    peakHours: [7, 8, 18, 19, 20],         // Default: Morning and evening peaks
    minimumBuffer: 2.0,                     // Default: 2 kWh minimum
    lastLearningUpdate: new Date(),
    dataPoints: 0
  };

  private thermalStrategyHistory: ThermalStrategy[] = [];

  /**
   * Constructor
   * @param melCloud MELCloud API instance
   * @param tibber Tibber API instance
   * @param deviceId MELCloud device ID
   * @param buildingId MELCloud building ID
   * @param logger Logger instance
   * @param weatherApi Weather API instance (optional)
   * @param homey Homey app instance (optional, required for thermal learning)
   */
  constructor(
    private readonly melCloud: MelCloudApi,
    private readonly tibber: TibberApi,
    private readonly deviceId: string,
    private readonly buildingId: number,
    private readonly logger: HomeyLogger,
    private readonly weatherApi?: { getCurrentWeather(): Promise<WeatherData> },
    private readonly homey?: HomeyApp
  ) {
    // Initialize enhanced savings calculator with proper Logger instance
    // Use the existing logger since it already implements the Logger interface
    this.enhancedSavingsCalculator = new EnhancedSavingsCalculator(this.logger);

    // Initialize thermal learning model if homey instance is provided
    if (homey) {
      try {
        this.thermalModelService = new ThermalModelService(homey);
        this.useThermalLearning = true;
        this.logger.log('Thermal learning model initialized');
      } catch (error) {
        this.logger.error('Failed to initialize thermal learning model:', error);
        this.useThermalLearning = false;
      }

      // Initialize COP helper
      try {
        this.copHelper = new COPHelper(homey, this.logger);
        this.logger.log('COP helper initialized');

        // Load COP settings from Homey settings
        this.copWeight = homey.settings.get('cop_weight') || 0.3;
        this.autoSeasonalMode = homey.settings.get('auto_seasonal_mode') !== false;
        this.summerMode = homey.settings.get('summer_mode') === true;
        
        // Load tank temperature settings
        this.minTankTemp = homey.settings.get('min_tank_temp') || 41;
        this.maxTankTemp = homey.settings.get('max_tank_temp') || 53;
        this.tankTempStep = homey.settings.get('tank_temp_step') || 1;
        this.enableTankControl = homey.settings.get('enable_tank_control') !== false;

        this.logger.log(`COP settings loaded - Weight: ${this.copWeight}, Auto Seasonal: ${this.autoSeasonalMode}, Summer Mode: ${this.summerMode}`);
        
        // Load persisted COP range data
        this.loadCOPRange();
        
        // Initialize thermal mass model from historical data
        this.initializeThermalMassFromHistory();
        
      } catch (error) {
        this.logger.error('Failed to initialize COP helper:', error);
        this.copHelper = null;
      }
    }
  }

  /**
   * Initialize thermal mass model from historical data
   */
  private async initializeThermalMassFromHistory(): Promise<void> {
    try {
      if (!this.homey) return;
      
      // Get recent energy data to learn thermal characteristics
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const fromDate = sevenDaysAgo.toISOString().split('T')[0]; // YYYY-MM-DD format
      const toDate = new Date().toISOString().split('T')[0];
      
      const recentData = await this.melCloud.getEnergyData(this.deviceId, this.buildingId, fromDate, toDate);
      
      if (recentData && Array.isArray(recentData) && recentData.length > 0) {
        // Learn hot water usage patterns
        const hotWaterHistory = recentData.map(day => ({
          timestamp: day.Date || new Date().toISOString(),
          amount: day.TotalHotWaterConsumed || 0
        }));
        
        this.learnHotWaterUsage(hotWaterHistory);
        
        // Calibrate thermal mass based on energy consumption patterns
        const heatingValues = recentData.map(day => day.TotalHeatingConsumed || 0);
        const avgHeatingConsumption = this.safeAverage(heatingValues, 0);
        
        if (avgHeatingConsumption > 0) {
          // Advanced thermal mass calibration using physics-based modeling
          const calibrationResult = this.calibrateThermalMassAdvanced(recentData, avgHeatingConsumption);
          
          this.thermalMassModel.thermalCapacity = calibrationResult.thermalCapacity;
          this.thermalMassModel.heatLossRate = calibrationResult.heatLossRate;
          this.thermalMassModel.preheatingEfficiency = calibrationResult.preheatingEfficiency;
          
          this.thermalMassModel.lastCalibration = new Date();
          
          this.logger.log('Thermal mass model calibrated:', {
            thermalCapacity: this.thermalMassModel.thermalCapacity.toFixed(2),
            heatLossRate: this.thermalMassModel.heatLossRate.toFixed(2),
            avgHeatingConsumption: avgHeatingConsumption.toFixed(1),
            hotWaterDataPoints: this.hotWaterUsagePattern.dataPoints
          });
        }
      }
      
    } catch (error) {
      this.logger.error('Failed to initialize thermal mass from history:', error);
      // Keep default values on error
    }
  }

  /**
   * Set thermal model parameters
   * @param K K-factor (thermal responsiveness)
   * @param S S-factor (optional)
   * @throws Error if validation fails
   */
  setThermalModel(K: number, S?: number): void {
    // Validate K-factor
    const validatedK = validateNumber(K, 'K', { min: 0.1, max: 10 });

    // Validate S-factor if provided
    let validatedS: number | undefined = undefined;
    if (S !== undefined) {
      validatedS = validateNumber(S, 'S', { min: 0.01, max: 1 });
    }

    this.thermalModel = { K: validatedK, S: validatedS };
    this.logger.log(`Thermal model updated - K: ${validatedK}${validatedS !== undefined ? `, S: ${validatedS}` : ''}`);
  }

  /**
   * Set temperature constraints
   * @param minTemp Minimum temperature
   * @param maxTemp Maximum temperature
   * @param tempStep Temperature step
   * @throws Error if validation fails
   */
  setTemperatureConstraints(minTemp: number, maxTemp: number, tempStep: number): void {
    // Validate inputs
    this.minTemp = validateNumber(minTemp, 'minTemp', { min: 10, max: 30 });
    this.maxTemp = validateNumber(maxTemp, 'maxTemp', { min: 10, max: 30 });

    // Ensure maxTemp is greater than minTemp
    if (this.maxTemp <= this.minTemp) {
      throw new Error(`Invalid temperature range: maxTemp (${maxTemp}) must be greater than minTemp (${minTemp})`);
    }

    this.tempStep = validateNumber(tempStep, 'tempStep', { min: 0.1, max: 1 });

    this.logger.log(`Temperature constraints set - Min: ${this.minTemp}°C, Max: ${this.maxTemp}°C, Step: ${this.tempStep}°C`);
  }

  /**
   * Enhanced COP range tracking with percentile-based learning
   */
  private copRange: {
    minObserved: number;
    maxObserved: number;
    updateCount: number;
    observations: number[];
    p5: number;  // 5th percentile
    p95: number; // 95th percentile
    lastPersistTime: Date;
  } = {
    minObserved: 2.0,  // More realistic starting range for heat pumps
    maxObserved: 4.0,
    updateCount: 0,
    observations: [],
    p5: 2.0,
    p95: 4.0,
    lastPersistTime: new Date()
  };
  
  private readonly MAX_COP_OBSERVATIONS = 500;  // Limit memory usage
  private readonly COP_RANGE_PERSIST_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
  
  /**
   * Adaptive price threshold management
   */
  private priceThresholds: {
    cheap: number;    // Below this percentile = cheap
    expensive: number; // Above this percentile = expensive
    moderate: number;  // Between cheap and moderate = good opportunity
    lastUpdate: Date;
    priceHistory: number[];
    volatilityIndex: number;
  } = {
    cheap: 0.25,      // Start with 25th percentile
    expensive: 0.75,  // Start with 75th percentile  
    moderate: 0.40,   // Start with 40th percentile
    lastUpdate: new Date(),
    priceHistory: [],
    volatilityIndex: 0.5
  };

  /**
   * Update COP range based on observed values with percentile-based learning
   * @param cop Observed COP value
   */
  private updateCOPRange(cop: number): void {
    if (!cop || cop <= 0 || cop > 10 || !isFinite(cop)) {
      // Filter out invalid COP values
      return;
    }

    // Add to observations array
    this.copRange.observations.push(cop);
    this.copRange.updateCount++;
    
    // Keep only recent observations to prevent memory growth
    if (this.copRange.observations.length > this.MAX_COP_OBSERVATIONS) {
      this.copRange.observations = this.copRange.observations.slice(-this.MAX_COP_OBSERVATIONS);
    }
    
    // Update min/max (for backward compatibility)
    this.copRange.minObserved = Math.min(this.copRange.minObserved, cop);
    this.copRange.maxObserved = Math.max(this.copRange.maxObserved, cop);
    
    // Recalculate percentiles every 10 observations
    if (this.copRange.updateCount % 10 === 0) {
      this.recalculateCOPPercentiles();
    }
    
    // Log range updates periodically
    if (this.copRange.updateCount % 50 === 0) {
      this.logger.log(`COP range updated after ${this.copRange.updateCount} observations:`, {
        percentileRange: `P5: ${this.copRange.p5.toFixed(2)} - P95: ${this.copRange.p95.toFixed(2)}`,
        absoluteRange: `Min: ${this.copRange.minObserved.toFixed(2)} - Max: ${this.copRange.maxObserved.toFixed(2)}`,
        observations: this.copRange.observations.length
      });
    }
    
    // Persist COP range periodically
    const now = new Date();
    if (now.getTime() - this.copRange.lastPersistTime.getTime() > this.COP_RANGE_PERSIST_INTERVAL) {
      this.persistCOPRange();
      this.copRange.lastPersistTime = now;
    }
  }
  
  /**
   * Recalculate COP percentiles from observations
   */
  private recalculateCOPPercentiles(): void {
    if (this.copRange.observations.length < 5) {
      return; // Need at least 5 observations for meaningful percentiles
    }
    
    const sorted = [...this.copRange.observations].sort((a, b) => a - b);
    const length = sorted.length;
    
    // Calculate 5th and 95th percentiles
    const p5Index = Math.floor(length * 0.05);
    const p95Index = Math.floor(length * 0.95);
    
    this.copRange.p5 = sorted[p5Index] || sorted[0];
    this.copRange.p95 = sorted[p95Index] || sorted[length - 1];
    
    // Ensure reasonable bounds
    this.copRange.p5 = Math.max(0.5, this.copRange.p5);
    this.copRange.p95 = Math.min(8.0, this.copRange.p95);
    
    // Ensure p95 > p5
    if (this.copRange.p95 <= this.copRange.p5) {
      this.copRange.p95 = this.copRange.p5 + 1.0;
    }
  }
  
  /**
   * Persist COP range to Homey settings
   */
  private persistCOPRange(): void {
    if (!this.homey) return;
    
    try {
      const copRangeData = {
        p5: this.copRange.p5,
        p95: this.copRange.p95,
        minObserved: this.copRange.minObserved,
        maxObserved: this.copRange.maxObserved,
        updateCount: this.copRange.updateCount,
        observations: this.copRange.observations.slice(-100), // Keep last 100 observations
        lastUpdate: new Date().toISOString()
      };
      
      this.homey.settings.set('cop_range_data', copRangeData);
      this.logger.log('COP range data persisted to settings');
    } catch (error) {
      this.logger.error('Failed to persist COP range data:', error);
    }
  }
  
  /**
   * Load COP range from Homey settings
   */
  private loadCOPRange(): void {
    if (!this.homey) return;
    
    try {
      const copRangeData = this.homey.settings.get('cop_range_data');
      if (copRangeData && typeof copRangeData === 'object') {
        this.copRange.p5 = copRangeData.p5 || 2.0;
        this.copRange.p95 = copRangeData.p95 || 4.0;
        this.copRange.minObserved = copRangeData.minObserved || 2.0;
        this.copRange.maxObserved = copRangeData.maxObserved || 4.0;
        this.copRange.updateCount = copRangeData.updateCount || 0;
        this.copRange.observations = Array.isArray(copRangeData.observations) 
          ? copRangeData.observations.slice(-this.MAX_COP_OBSERVATIONS)
          : [];
        
        this.logger.log('COP range data loaded from settings:', {
          percentileRange: `P5: ${this.copRange.p5.toFixed(2)} - P95: ${this.copRange.p95.toFixed(2)}`,
          observations: this.copRange.observations.length,
          updateCount: this.copRange.updateCount
        });
      }
    } catch (error) {
      this.logger.error('Failed to load COP range data:', error);
      // Keep default values
    }
  }

  /**
   * Normalize COP value using percentile-based adaptive range
   * @param cop COP value to normalize
   * @returns Normalized COP (0-1)
   */
  private normalizeCOP(cop: number): number {
    if (!cop || cop <= 0 || !isFinite(cop)) {
      return 0; // Poor COP
    }
    
    // Use percentile range for more stable normalization
    const range = this.copRange.p95 - this.copRange.p5;
    if (range <= 0) {
      return 0.5; // Default if no range established
    }
    
    // Normalize using percentile range
    const normalized = this.safeDivide(cop - this.copRange.p5, range, 0.5);
    
    // Clamp to 0-1 range but allow some values outside percentiles
    return Math.min(Math.max(normalized, 0), 1);
  }
  
  /**
   * Get COP efficiency category for logging and decision making
   * @param cop COP value
   * @returns Efficiency category
   */
  private getCOPEfficiencyCategory(cop: number): 'excellent' | 'good' | 'fair' | 'poor' | 'very_poor' {
    const normalized = this.normalizeCOP(cop);
    
    if (normalized >= 0.8) return 'excellent';
    if (normalized >= 0.6) return 'good';
    if (normalized >= 0.4) return 'fair';
    if (normalized >= 0.2) return 'poor';
    return 'very_poor';
  }

  /**
   * Calculate thermal mass strategy for strategic heating
   * @param currentTemp Current indoor temperature
   * @param targetTemp Target temperature
   * @param currentPrice Current electricity price
   * @param futurePrices Future price forecast (next 24 hours)
   * @param copData Current COP data
   * @returns Thermal strategy recommendation
   */
  private calculateThermalMassStrategy(
    currentTemp: number,
    targetTemp: number,
    currentPrice: number,
    futurePrices: any[],
    copData: { heating: number; hotWater: number; outdoor: number }
  ): ThermalStrategy {
    try {
      // Find cheapest periods in next 24 hours
      const next24h = futurePrices.slice(0, 24);
      const sortedPrices = [...next24h].sort((a, b) => a.price - b.price);
      const cheapest6Hours = sortedPrices.slice(0, 6); // Top 6 cheapest hours
      
      // Calculate current price percentile
      const currentPricePercentile = this.safeDivide(
        next24h.filter(p => p.price <= currentPrice).length,
        next24h.length,
        0.5
      );
      
      // Get normalized COP efficiency
      const heatingEfficiency = this.normalizeCOP(copData.heating);
      
      // Calculate thermal mass capacity for preheating
      const tempDelta = this.thermalMassModel.maxPreheatingTemp - currentTemp;
      const preheatingEnergy = tempDelta * this.thermalMassModel.thermalCapacity;
      
      // Update price thresholds based on recent price patterns
      this.updatePriceThresholds(next24h.map(p => p.price));
      
      // Strategy decision logic using adaptive thresholds
      if (currentPricePercentile <= this.priceThresholds.cheap && heatingEfficiency > 0.7 && tempDelta > 0.5) {
        // Very cheap period + good COP + room for preheating = PREHEAT
        const preheatingTarget = Math.min(
          targetTemp + (heatingEfficiency * 2.0), // More aggressive with higher COP
          this.thermalMassModel.maxPreheatingTemp
        );
        
        const estimatedSavings = this.calculatePreheatingValue(
          preheatingTarget, 
          cheapest6Hours, 
          copData,
          currentPrice
        );
        
        return {
          action: 'preheat',
          targetTemp: preheatingTarget,
          reasoning: `Excellent conditions for preheating: price ${(currentPricePercentile * 100).toFixed(0)}th percentile, COP ${copData.heating.toFixed(2)} (${(heatingEfficiency * 100).toFixed(0)}% efficiency)`,
          estimatedSavings,
          duration: 2, // 2 hours of preheating
          confidenceLevel: Math.min(heatingEfficiency + 0.2, 0.9)
        };
        
      } else if (currentPricePercentile >= this.priceThresholds.expensive && currentTemp > targetTemp - 0.5) {
        // Very expensive period + above target = COAST
        const coastingTarget = Math.max(
          targetTemp - 1.5,
          this.minTemp
        );
        
        // Calculate how long we can coast based on thermal mass
        const coastingHours = Math.min(
          this.safeDivide(currentTemp - coastingTarget, this.thermalMassModel.heatLossRate, 0),
          4 // Maximum 4 hours of coasting
        );
        
        const estimatedSavings = this.calculateCoastingSavings(
          currentPrice,
          coastingHours,
          copData
        );
        
        return {
          action: 'coast',
          targetTemp: coastingTarget,
          reasoning: `Expensive period (${(currentPricePercentile * 100).toFixed(0)}th percentile): using thermal mass, can coast for ${coastingHours.toFixed(1)} hours`,
          estimatedSavings,
          duration: coastingHours,
          confidenceLevel: 0.8
        };
        
      } else if (currentPricePercentile <= this.priceThresholds.moderate && heatingEfficiency > 0.8 && currentTemp < targetTemp - 1.0) {
        // Cheap period + excellent COP + below target = BOOST
        const boostTarget = Math.min(targetTemp + 0.5, this.maxTemp);
        
        const estimatedSavings = this.calculateBoostValue(
          boostTarget,
          currentPrice,
          copData
        );
        
        return {
          action: 'boost',
          targetTemp: boostTarget,
          reasoning: `Excellent opportunity: cheap electricity (${(currentPricePercentile * 100).toFixed(0)}th percentile) + high COP (${copData.heating.toFixed(2)})`,
          estimatedSavings,
          duration: 1,
          confidenceLevel: Math.min(Math.max(heatingEfficiency, 0), 1)
        };
        
      } else {
        // Normal operation
        return {
          action: 'maintain',
          targetTemp: targetTemp,
          reasoning: `Normal operation: price ${(currentPricePercentile * 100).toFixed(0)}th percentile, COP ${copData.heating.toFixed(2)}`,
          estimatedSavings: 0,
          confidenceLevel: 0.7
        };
      }
      
    } catch (error) {
      this.logger.error('Error calculating thermal mass strategy:', error);
      return {
        action: 'maintain',
        targetTemp: targetTemp,
        reasoning: 'Error in thermal calculation - using standard operation',
        estimatedSavings: 0,
        confidenceLevel: 0.3
      };
    }
  }

  /**
   * Calculate value of preheating strategy
   */
  private calculatePreheatingValue(
    preheatingTarget: number,
    cheapestHours: any[],
    copData: { heating: number; hotWater: number; outdoor: number },
    currentPrice: number
  ): number {
    try {
      const avgCheapPrice = this.safeAverage(cheapestHours.map(h => h.price), 0);
      const priceDifference = currentPrice - avgCheapPrice;
      
      // Energy for preheating
      const extraEnergy = (preheatingTarget - 20) * this.thermalMassModel.thermalCapacity;
      const energyWithCOP = this.safeDivide(extraEnergy, copData.heating, extraEnergy);
      
      // Savings from using cheaper electricity
      const savingsFromCheaperElectricity = energyWithCOP * priceDifference;
      
      // Efficiency bonus from good COP
      const efficiencyBonus = extraEnergy * 0.1 * this.normalizeCOP(copData.heating);
      
      return Math.max(savingsFromCheaperElectricity + efficiencyBonus, 0);
    } catch (error) {
      return 0;
    }
  }

  /**
   * Calculate value of coasting strategy
   */
  private calculateCoastingSavings(
    currentPrice: number,
    coastingHours: number,
    copData: { heating: number; hotWater: number; outdoor: number }
  ): number {
    try {
      // Estimate energy that would have been used for heating
      const avgHeatingPower = 2.0; // kW average heating power
      const energySaved = avgHeatingPower * coastingHours;
      
      // Cost savings from not heating during expensive period
      const costSavings = energySaved * currentPrice;
      
      return costSavings;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Calculate value of boost strategy
   */
  private calculateBoostValue(
    boostTarget: number,
    currentPrice: number,
    copData: { heating: number; hotWater: number; outdoor: number }
  ): number {
    try {
      // Extra energy for boost
      const extraEnergy = (boostTarget - 20) * this.thermalMassModel.thermalCapacity;
      const energyWithCOP = this.safeDivide(extraEnergy, copData.heating, extraEnergy);
      
      // Value from using high COP period
      const copEfficiency = this.normalizeCOP(copData.heating);
      const efficiencyValue = extraEnergy * 0.15 * copEfficiency;
      
      return efficiencyValue;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Learn hot water usage patterns from historical data
   * @param usageHistory Array of hot water usage events
   */
  private learnHotWaterUsage(usageHistory: Array<{ timestamp: string; amount: number }>): void {
    try {
      if (!usageHistory || usageHistory.length < 7) {
        // Need at least a week of data
        return;
      }

      // Reset hourly demand
      const hourlyDemand = new Array(24).fill(0);
      const hourlyCount = new Array(24).fill(0);

      // Analyze usage patterns
      usageHistory.forEach(usage => {
        const date = new Date(usage.timestamp);
        const hour = date.getHours();
        
        hourlyDemand[hour] += usage.amount;
        hourlyCount[hour]++;
      });

      // Calculate average demand per hour
      for (let i = 0; i < 24; i++) {
        if (hourlyCount[i] > 0) {
          hourlyDemand[i] = this.safeDivide(hourlyDemand[i], hourlyCount[i], 0.5);
        }
      }

      // Identify peak hours (above 80th percentile)
      const sortedDemand = [...hourlyDemand].sort((a, b) => b - a);
      const peakThreshold = sortedDemand[Math.floor(sortedDemand.length * 0.2)];
      
      const peakHours = hourlyDemand
        .map((demand, hour) => ({ demand, hour }))
        .filter(h => h.demand >= peakThreshold)
        .map(h => h.hour);

      // Calculate minimum buffer (120% of peak demand)
      const maxDemand = Math.max(...hourlyDemand);
      const minimumBuffer = maxDemand * 1.2;

      // Update pattern
      this.hotWaterUsagePattern = {
        hourlyDemand,
        peakHours,
        minimumBuffer,
        lastLearningUpdate: new Date(),
        dataPoints: usageHistory.length
      };

      this.logger.log('Hot water usage pattern updated:', {
        dataPoints: usageHistory.length,
        peakHours: peakHours.join(', '),
        maxDemand: maxDemand.toFixed(2),
        minimumBuffer: minimumBuffer.toFixed(2)
      });

    } catch (error) {
      this.logger.error('Error learning hot water usage pattern:', error);
    }
  }

  /**
   * Optimize hot water scheduling based on usage patterns
   * @param currentHour Current hour (0-23)
   * @param priceData Next 24 hours price data
   * @param hotWaterCOP Current hot water COP
   * @returns Hot water schedule recommendation
   */
  private optimizeHotWaterSchedulingByPattern(
    currentHour: number,
    priceData: any[],
    hotWaterCOP: number
  ): HotWaterSchedule {
    try {
      const next24h = priceData.slice(0, 24);
      const schedulePoints: SchedulePoint[] = [];

      // For each peak demand hour, find optimal heating time
      this.hotWaterUsagePattern.peakHours.forEach(peakHour => {
        // Calculate when to start heating (2 hours before peak)
        const heatingDuration = 2;
        const startHour = (peakHour - heatingDuration + 24) % 24;
        
        // Find valid heating window (4 hours before peak)
        const validHours = [];
        for (let i = 0; i < 4; i++) {
          const hour = (peakHour - i + 24) % 24;
          if (hour >= currentHour || hour < currentHour - 12) { // Future hours only
            validHours.push(hour);
          }
        }

        if (validHours.length > 0) {
          // Find cheapest hour in valid window
          const cheapestHour = validHours.reduce((min, hour) => {
            const priceIndex = (hour - currentHour + 24) % 24;
            const minPriceIndex = (min - currentHour + 24) % 24;
            
            if (priceIndex < next24h.length && minPriceIndex < next24h.length) {
              return next24h[priceIndex].price < next24h[minPriceIndex].price ? hour : min;
            }
            return min;
          });

          const priceIndex = (cheapestHour - currentHour + 24) % 24;
          const pricePercentile = this.safeDivide(
            next24h.filter(p => p.price <= next24h[priceIndex].price).length,
            next24h.length,
            0.5
          );

          schedulePoints.push({
            hour: cheapestHour,
            reason: `Prepare for peak demand at ${peakHour}:00`,
            priority: this.hotWaterUsagePattern.hourlyDemand[peakHour],
            cop: hotWaterCOP,
            pricePercentile
          });
        }
      });

      // Sort by priority (highest first)
      schedulePoints.sort((a, b) => b.priority - a.priority);

      // Determine current action
      const currentAction = this.determineCurrentHotWaterAction(
        currentHour,
        schedulePoints,
        hotWaterCOP,
        next24h
      );

      // Calculate estimated savings
      const estimatedSavings = this.calculateHotWaterScheduleSavings(
        schedulePoints,
        hotWaterCOP,
        next24h
      );

      return {
        schedulePoints,
        currentAction,
        reasoning: `Predictive scheduling based on usage pattern (peaks: ${this.hotWaterUsagePattern.peakHours.join(', ')}h)`,
        estimatedSavings
      };

    } catch (error) {
      this.logger.error('Error optimizing hot water scheduling:', error);
      return {
        schedulePoints: [],
        currentAction: 'maintain',
        reasoning: 'Error in scheduling - maintaining current operation',
        estimatedSavings: 0
      };
    }
  }

  /**
   * Determine current hot water action based on schedule
   */
  private determineCurrentHotWaterAction(
    currentHour: number,
    schedulePoints: SchedulePoint[],
    hotWaterCOP: number,
    priceData: any[]
  ): 'heat_now' | 'delay' | 'maintain' {
    
    // Check if current hour is a scheduled heating time
    const isScheduledNow = schedulePoints.some(point => point.hour === currentHour);
    
    if (isScheduledNow) {
      return 'heat_now';
    }

    // Check if we're approaching a peak and haven't heated yet
    const nextPeak = this.hotWaterUsagePattern.peakHours.find(peak => {
      const hoursUntilPeak = (peak - currentHour + 24) % 24;
      return hoursUntilPeak <= 2 && hoursUntilPeak > 0;
    });

    if (nextPeak && hotWaterCOP > 0) {
      // Emergency heating before peak
      return 'heat_now';
    }

    // Check if current price is exceptional
    const currentPrice = priceData[0]?.price || 0;
    const avgPrice = this.safeAverage(priceData.map(p => p.price), 0);
    
    if (currentPrice < avgPrice * 0.7 && hotWaterCOP > 2.5) {
      // Very cheap electricity + decent COP
      return 'heat_now';
    }

    return 'maintain';
  }

  /**
   * Calculate estimated savings from hot water schedule
   */
  private calculateHotWaterScheduleSavings(
    schedulePoints: SchedulePoint[],
    hotWaterCOP: number,
    priceData: any[]
  ): number {
    try {
      if (schedulePoints.length === 0) return 0;

      const avgPrice = this.safeAverage(priceData.map(p => p.price), 0);
      
      let totalSavings = 0;
      schedulePoints.forEach(point => {
        const hourIndex = Math.min(point.hour, priceData.length - 1);
        const scheduledPrice = priceData[hourIndex]?.price || avgPrice;
        
        // Savings from scheduling during cheaper time
        const priceSavings = (avgPrice - scheduledPrice) * 2; // 2 kWh typical heating
        
        // COP efficiency bonus
        const copEfficiency = this.normalizeCOP(point.cop);
        const efficiencyBonus = 2 * 0.1 * copEfficiency; // Energy * rate * efficiency
        
        totalSavings += (priceSavings + efficiencyBonus) * point.priority;
      });

      return Math.max(totalSavings, 0);
    } catch (error) {
      return 0;
    }
  }

  /**
   * Set COP settings
   * @param copWeight Weight given to COP in optimization
   * @param autoSeasonalMode Whether to automatically switch between summer and winter modes
   * @param summerMode Whether to use summer mode (only used when autoSeasonalMode is false)
   * @throws Error if validation fails
   */
  setCOPSettings(copWeight: number, autoSeasonalMode: boolean, summerMode: boolean): void {
    // Validate inputs
    this.copWeight = validateNumber(copWeight, 'copWeight', { min: 0, max: 1 });
    this.autoSeasonalMode = validateBoolean(autoSeasonalMode, 'autoSeasonalMode');
    this.summerMode = validateBoolean(summerMode, 'summerMode');

    // Save to Homey settings if available
    if (this.homey) {
      try {
        this.homey.settings.set('cop_weight', this.copWeight);
        this.homey.settings.set('auto_seasonal_mode', this.autoSeasonalMode);
        this.homey.settings.set('summer_mode', this.summerMode);
        this.homey.settings.set('min_tank_temp', this.minTankTemp);
        this.homey.settings.set('max_tank_temp', this.maxTankTemp);
        this.homey.settings.set('tank_temp_step', this.tankTempStep);
        this.homey.settings.set('enable_tank_control', this.enableTankControl);
      } catch (error) {
        this.logger.error('Failed to save COP settings to Homey settings:', error);
      }
    }

    this.logger.log(`COP settings updated - Weight: ${this.copWeight}, Auto Seasonal: ${this.autoSeasonalMode}, Summer Mode: ${this.summerMode}`);
  }

  /**
   * Get real energy data from MELCloud API and calculate optimization metrics
   * Uses enhanced COP data with real-time calculations and predictions
   * @returns Promise resolving to optimization metrics
   */
  private async getRealEnergyMetrics(): Promise<OptimizationMetrics | null> {
    try {
      // Use enhanced COP data for more accurate optimization
      const enhancedCOPData = await this.melCloud.getEnhancedCOPData(this.deviceId, this.buildingId);
      
      // Extract enhanced COP values
      const realHeatingCOP = enhancedCOPData.current.heating || 0;
      const realHotWaterCOP = enhancedCOPData.current.hotWater || 0;
      
      // Update COP ranges with current values
      if (realHeatingCOP > 0) this.updateCOPRange(realHeatingCOP);
      if (realHotWaterCOP > 0) this.updateCOPRange(realHotWaterCOP);

      // Get daily energy totals
      const energyData = enhancedCOPData.daily;
      
      // Extract energy consumption data
      const heatingConsumed = energyData.TotalHeatingConsumed || 0;
      const heatingProduced = energyData.TotalHeatingProduced || 0;
      const hotWaterConsumed = energyData.TotalHotWaterConsumed || 0;
      const hotWaterProduced = energyData.TotalHotWaterProduced || 0;

      // Create type-safe energy data object
      const safeEnergyData: RealEnergyData = {
        TotalHeatingConsumed: heatingConsumed,
        TotalHeatingProduced: heatingProduced,
        TotalHotWaterConsumed: hotWaterConsumed,
        TotalHotWaterProduced: hotWaterProduced,
        TotalCoolingConsumed: 0,
        TotalCoolingProduced: 0,
        CoP: energyData.CoP || [],
  // Prefer explicit COP fields when present in the daily report
  heatingCOP: (energyData as any).heatingCOP ?? (energyData as any).averageCOP ?? enhancedCOPData.historical.heating,
  hotWaterCOP: (energyData as any).hotWaterCOP ?? (energyData as any).averageCOP ?? enhancedCOPData.historical.hotWater,
  averageCOP: (energyData as any).averageCOP ?? null,
  AverageHeatingCOP: enhancedCOPData.historical.heating,
  AverageHotWaterCOP: enhancedCOPData.historical.hotWater
      };

      this.lastEnergyData = safeEnergyData;

      // Calculate daily energy consumption (kWh/day averaged over the period)
      const dailyEnergyConsumption = this.safeDivide(heatingConsumed + hotWaterConsumed, 7, 0);

      // Calculate efficiency scores using adaptive COP normalization
      const heatingEfficiency = this.normalizeCOP(realHeatingCOP);
      const hotWaterEfficiency = this.normalizeCOP(realHotWaterCOP);

      // Enhanced seasonal mode detection using real energy patterns and trends
      let seasonalMode: 'summer' | 'winter' | 'transition';
      let optimizationFocus: 'heating' | 'hotwater' | 'both';

      // Use trend analysis from enhanced COP data
      const trends = enhancedCOPData.trends;

      if (heatingConsumed < 1) { // Less than 1 kWh heating in 7 days
        seasonalMode = 'summer';
        optimizationFocus = 'hotwater';
      } else if (heatingConsumed > hotWaterConsumed * 2) {
        seasonalMode = 'winter';
        optimizationFocus = trends.heatingTrend === 'declining' ? 'both' : 'heating';
      } else {
        seasonalMode = 'transition';
        // Use trend analysis to determine focus
        if (trends.heatingTrend === 'improving' && trends.hotWaterTrend === 'stable') {
          optimizationFocus = 'heating';
        } else if (trends.hotWaterTrend === 'improving' && trends.heatingTrend === 'stable') {
          optimizationFocus = 'hotwater';
        } else {
          optimizationFocus = 'both';
        }
      }

      const metrics: OptimizationMetrics = {
        realHeatingCOP,
        realHotWaterCOP,
        dailyEnergyConsumption,
        heatingEfficiency,
        hotWaterEfficiency,
        seasonalMode,
        optimizationFocus
      };

      this.optimizationMetrics = metrics;

      this.logger.log(`Enhanced energy metrics calculated:`, {
        heatingCOP: realHeatingCOP.toFixed(2),
        hotWaterCOP: realHotWaterCOP.toFixed(2),
        heatingEfficiency: (heatingEfficiency * 100).toFixed(0) + '%',
        hotWaterEfficiency: (hotWaterEfficiency * 100).toFixed(0) + '%',
        dailyConsumption: dailyEnergyConsumption.toFixed(1) + ' kWh/day',
        seasonalMode,
        optimizationFocus,
        heatingTrend: trends.heatingTrend,
        hotWaterTrend: trends.hotWaterTrend,
        copRange: `${this.copRange.minObserved.toFixed(1)}-${this.copRange.maxObserved.toFixed(1)} (${this.copRange.updateCount} obs)`
      });

      return metrics;
    } catch (error) {
      this.logger.error('Error getting enhanced energy metrics:', error);
      
      // Fallback to basic energy data if enhanced version fails
      try {
        const energyData = await this.melCloud.getDailyEnergyTotals(this.deviceId, this.buildingId);
        
  const heatingConsumed = energyData.TotalHeatingConsumed || 0;
  const hotWaterConsumed = energyData.TotalHotWaterConsumed || 0;
  // Prefer explicit fields if present, then averageCOP, then legacy Average* fields
  const realHeatingCOP = ((energyData.heatingCOP ?? energyData.averageCOP ?? energyData.AverageHeatingCOP) as number) || 0;
  const realHotWaterCOP = ((energyData.hotWaterCOP ?? energyData.averageCOP ?? energyData.AverageHotWaterCOP) as number) || 0;
        
        this.logger.log('Using fallback energy metrics calculation');
        
        return {
          realHeatingCOP,
          realHotWaterCOP,
          dailyEnergyConsumption: (heatingConsumed + hotWaterConsumed) / 7,
          heatingEfficiency: Math.min(realHeatingCOP / 3, 1),
          hotWaterEfficiency: Math.min(realHotWaterCOP / 3, 1),
          seasonalMode: heatingConsumed < 1 ? 'summer' : 'winter',
          optimizationFocus: 'both'
        };
      } catch (fallbackError) {
        this.logger.error('Error with fallback energy metrics:', fallbackError);
        return null;
      }
    }
  }

  /**
   * Calculate enhanced temperature optimization using real energy data
   * @param currentPrice Current electricity price
   * @param avgPrice Average electricity price
   * @param minPrice Minimum electricity price
   * @param maxPrice Maximum electricity price
   * @param currentTemp Current room temperature
   * @param outdoorTemp Outdoor temperature
   * @returns Optimal target temperature with reasoning
   */
  private async calculateOptimalTemperatureWithRealData(
    currentPrice: number,
    avgPrice: number,
    minPrice: number,
    maxPrice: number,
    currentTemp: number,
    outdoorTemp: number
  ): Promise<{ targetTemp: number; reason: string; metrics?: OptimizationMetrics }> {
    // Get real energy metrics
    const metrics = await this.getRealEnergyMetrics();
    
    if (!metrics) {
      // Fall back to basic optimization if no real data available
      const basicTarget = await this.calculateOptimalTemperature(currentPrice, avgPrice, minPrice, maxPrice, currentTemp);
      return { 
        targetTemp: basicTarget, 
        reason: 'Using basic optimization (no real energy data available)' 
      };
    }

    // Cache frequently used values
    const tempRange = this.maxTemp - this.minTemp;
    const midTemp = (this.maxTemp + this.minTemp) / 2;

    // Normalize price between 0 and 1 with safe division
    const normalizedPrice = maxPrice === minPrice
      ? 0.5 
      : this.safeDivide(currentPrice - minPrice, maxPrice - minPrice, 0.5);

    // Calculate base target based on seasonal mode and real performance
    let targetTemp: number;
    let reason: string;

    if (metrics.seasonalMode === 'summer') {
      // Summer optimization: Focus on hot water efficiency and minimal heating
      const priceWeight = 0.7; // Higher price sensitivity in summer
      
      // Update COP range and normalize
      this.updateCOPRange(metrics.realHotWaterCOP);
      const hotWaterEfficiency = this.normalizeCOP(metrics.realHotWaterCOP);
      
      // Price adjustment (inverted: low price = higher temp)
      const priceAdjustment = (0.5 - normalizedPrice) * tempRange * priceWeight;
      
      // Efficiency bonus for excellent hot water COP
      let efficiencyAdjustment = 0;
      if (hotWaterEfficiency > 0.8) {
        efficiencyAdjustment = 0.3; // Small bonus for excellent COP
      } else if (hotWaterEfficiency < 0.3) {
        efficiencyAdjustment = -0.5; // Penalty for poor COP
      }
      
      targetTemp = midTemp + priceAdjustment + efficiencyAdjustment;
      reason = `Summer mode: Hot water COP ${metrics.realHotWaterCOP.toFixed(2)} (${(hotWaterEfficiency * 100).toFixed(0)}% efficiency), price ${normalizedPrice > 0.6 ? 'high' : normalizedPrice < 0.4 ? 'low' : 'moderate'}`;

    } else if (metrics.seasonalMode === 'winter') {
      // Winter optimization: Balance heating efficiency with comfort and prices
      const priceWeight = 0.4; // Lower price sensitivity in winter (comfort priority)
      
      // Update COP range and normalize  
      this.updateCOPRange(metrics.realHeatingCOP);
      const heatingEfficiency = this.normalizeCOP(metrics.realHeatingCOP);
      
      // Price adjustment (inverted: low price = higher temp)
      const priceAdjustment = (0.5 - normalizedPrice) * tempRange * priceWeight;
      
      // Efficiency-based comfort adjustment
      let efficiencyAdjustment = 0;
      if (heatingEfficiency > 0.8) {
        // Excellent heating COP: maintain comfort
        efficiencyAdjustment = 0.2;
      } else if (heatingEfficiency > 0.5) {
        // Good heating COP: slight reduction
        efficiencyAdjustment = -0.1;
      } else if (heatingEfficiency > 0.2) {
        // Poor heating COP: significant reduction
        efficiencyAdjustment = -0.5;
      } else {
        // Very poor heating COP: maximum conservation
        efficiencyAdjustment = -0.8;
      }
      
      // Outdoor temperature adjustment: colder outside = need higher inside for comfort
      const outdoorAdjustment = outdoorTemp < 5 ? 0.5 : outdoorTemp > 15 ? -0.3 : 0;
      
      targetTemp = midTemp + priceAdjustment + efficiencyAdjustment + outdoorAdjustment;
      reason = `Winter mode: Heating COP ${metrics.realHeatingCOP.toFixed(2)} (${(heatingEfficiency * 100).toFixed(0)}% efficiency), outdoor ${outdoorTemp}°C, price ${normalizedPrice > 0.6 ? 'high' : normalizedPrice < 0.4 ? 'low' : 'moderate'}`;

    } else {
      // Transition mode: Balanced approach using both COPs
      const priceWeight = 0.5;
      
      // Update COP ranges for both systems
      this.updateCOPRange(metrics.realHeatingCOP);
      this.updateCOPRange(metrics.realHotWaterCOP);
      
      const heatingEfficiency = this.normalizeCOP(metrics.realHeatingCOP);
      const hotWaterEfficiency = this.normalizeCOP(metrics.realHotWaterCOP);
      const combinedEfficiency = (heatingEfficiency + hotWaterEfficiency) / 2;
      
      const priceAdjustment = (0.5 - normalizedPrice) * tempRange * priceWeight;
      
      // Combined efficiency adjustment
      let efficiencyAdjustment = 0;
      if (combinedEfficiency > 0.7) {
        efficiencyAdjustment = 0.2;
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
      reason += `, excellent hot water COP (+0.2°C)`;
    } else if (metrics.optimizationFocus === 'both' && metrics.realHeatingCOP > 2) {
      // Good heating performance
      targetTemp += 0.3;
      reason += `, good heating COP (+0.3°C)`;
    } else if (metrics.realHeatingCOP < 1.5 && metrics.realHeatingCOP > 0) {
      // Poor heating performance - be more conservative
      targetTemp -= 0.5;
      reason += `, low heating COP (-0.5°C)`;
    }

    return { targetTemp, reason, metrics };
  }

  /**
   * Enhanced hot water optimization using real COP data
   * @param currentPrice Current electricity price
   * @param priceData Full price data for scheduling
   * @returns Hot water optimization recommendation
   */
  private async optimizeHotWaterScheduling(currentPrice: number, priceData: any): Promise<{
    action: 'heat_now' | 'delay' | 'maintain';
    reason: string;
    scheduledTime?: string;
  }> {
    const metrics = await this.getRealEnergyMetrics();
    
    if (!metrics || !this.lastEnergyData) {
      return { action: 'maintain', reason: 'No real energy data available for hot water optimization' };
    }

    // Calculate hot water efficiency score
    const hotWaterCOP = metrics.realHotWaterCOP;
    const dailyHotWaterConsumption = this.lastEnergyData.TotalHotWaterConsumed / 7; // kWh per day

    // Find cheapest hours in the next 24 hours
    const prices = priceData.prices.slice(0, 24); // Next 24 hours
    const sortedPrices = [...prices].sort((a: any, b: any) => a.price - b.price);
    const cheapestHours = sortedPrices.slice(0, 4); // Top 4 cheapest hours

    // Update COP range for adaptive normalization
    this.updateCOPRange(hotWaterCOP);
    const hotWaterEfficiency = this.normalizeCOP(hotWaterCOP);

    // Current price percentile
    const currentPercentile = this.safeDivide(
      prices.filter((p: any) => p.price <= currentPrice).length,
      prices.length,
      0.5
    );

    // Improved COP-based hot water optimization
    if (hotWaterEfficiency > 0.8) {
      // Excellent hot water COP (>80th percentile): More flexible timing
      if (currentPercentile <= 0.4) { // Current price in cheapest 40%
        return {
          action: 'heat_now',
          reason: `Excellent hot water COP (${hotWaterCOP.toFixed(2)}, ${(hotWaterEfficiency * 100).toFixed(0)}th percentile) + reasonable electricity price (${(currentPercentile * 100).toFixed(0)}th percentile)`
        };
      } else if (currentPercentile >= 0.8) { // Current price in most expensive 20%
        const nextCheapHour = cheapestHours[0];
        return {
          action: 'delay',
          reason: `High COP but very expensive electricity - delay to ${nextCheapHour.time}`,
          scheduledTime: nextCheapHour.time
        };
      }
    } else if (hotWaterEfficiency > 0.5) {
      // Good hot water COP: Moderate optimization
      if (currentPercentile <= 0.3) { // Only during cheapest 30%
        return {
          action: 'heat_now',
          reason: `Good hot water COP (${hotWaterCOP.toFixed(2)}, ${(hotWaterEfficiency * 100).toFixed(0)}th percentile) + cheap electricity (${(currentPercentile * 100).toFixed(0)}th percentile)`
        };
      }
    } else if (hotWaterEfficiency > 0.2) {
      // Poor hot water COP: Conservative approach
      if (currentPercentile <= 0.15) { // Only during cheapest 15%
        return {
          action: 'heat_now',
          reason: `Poor hot water COP (${hotWaterCOP.toFixed(2)}, ${(hotWaterEfficiency * 100).toFixed(0)}th percentile) - only during cheapest electricity (${(currentPercentile * 100).toFixed(0)}th percentile)`
        };
      } else {
        const nextCheapHour = cheapestHours[0];
        return {
          action: 'delay',
          reason: `Poor COP - wait for cheapest electricity at ${nextCheapHour.time}`,
          scheduledTime: nextCheapHour.time
        };
      }
    } else if (hotWaterCOP > 0) {
      // Very poor hot water COP: Emergency heating only
      if (currentPercentile <= 0.1) { // Only during cheapest 10%
        return {
          action: 'heat_now',
          reason: `Very poor hot water COP (${hotWaterCOP.toFixed(2)}) - emergency heating during absolute cheapest electricity`
        };
      } else {
        const nextCheapHour = cheapestHours[0];
        return {
          action: 'delay',
          reason: `Very poor COP - critical: wait for absolute cheapest electricity at ${nextCheapHour.time}`,
          scheduledTime: nextCheapHour.time
        };
      }
    }

    return { action: 'maintain', reason: 'Maintaining current hot water schedule' };
  }

  /**
   * Handle API errors with proper type checking
   */
  private handleApiError(error: unknown): never {
    if (isError(error)) {
      this.logger.error('API error:', error.message);
      // For test environment, preserve the original error message
      if (process.env.NODE_ENV === 'test') {
        throw error;
      } else {
        throw new Error(`API error: ${error.message}`);
      }
    } else {
      this.logger.error('Unknown API error:', String(error));
      throw new Error(`Unknown API error: ${String(error)}`);
    }
  }

  /**
   * Run hourly optimization
   * @returns Promise resolving to optimization result
   */
  async runHourlyOptimization(): Promise<OptimizationResult> {
    this.logger.log('Starting hourly optimization');

    try {
      // Get current device state
      const deviceState = await this.melCloud.getDeviceState(this.deviceId, this.buildingId);
      const currentTemp = deviceState.RoomTemperature || deviceState.RoomTemperatureZone1;
      const currentTarget = deviceState.SetTemperature || deviceState.SetTemperatureZone1;
      const outdoorTemp = deviceState.OutdoorTemperature || 0;

      // Check if temperature data is missing and log an error
      if (currentTemp === undefined && deviceState.RoomTemperature === undefined && deviceState.RoomTemperatureZone1 === undefined) {
        this.logger.error('Missing indoor temperature data in device state', deviceState);
      }

      if (currentTarget === undefined && deviceState.SetTemperature === undefined && deviceState.SetTemperatureZone1 === undefined) {
        this.logger.error('Missing target temperature data in device state', deviceState);
      }

      // Get electricity prices
      const priceData = await this.tibber.getPrices();
      
      // Validate price data structure
      if (!priceData || !priceData.current || typeof priceData.current.price !== 'number') {
        this.logger.error('Invalid price data received from Tibber API', priceData);
        throw new Error('Invalid price data received from Tibber API');
      }
      
      const currentPrice = priceData.current.price;

      // Calculate price statistics
      const prices = priceData.prices.map((p: any) => p.price);
      const priceAvg = this.safeAverage(prices, 0);
      const priceMin = Math.min(...prices);
      const priceMax = Math.max(...prices);

      // Get weather data if available
      let weatherConditions = {
        temperature: outdoorTemp,
        windSpeed: 0,
        humidity: 50,
        cloudCover: 50,
        precipitation: 0
      };

      if (this.weatherApi) {
        try {
          const weather = await this.weatherApi.getCurrentWeather();
          weatherConditions = {
            temperature: weather.temperature || outdoorTemp,
            windSpeed: weather.windSpeed || 0,
            humidity: weather.humidity || 50,
            cloudCover: weather.cloudCover || 50,
            precipitation: weather.precipitation || 0
          };
        } catch (weatherError) {
          this.logger.error('Error getting weather data:', weatherError);
        }
      }

      // Collect thermal data point if thermal learning is enabled
      if (this.useThermalLearning && this.thermalModelService) {
        try {
          // Create data point
          const dataPoint = {
            timestamp: new Date().toISOString(),
            indoorTemperature: currentTemp ?? 20,
            outdoorTemperature: outdoorTemp,
            targetTemperature: currentTarget ?? 20,
            heatingActive: !deviceState.IdleZone1,
            weatherConditions: {
              windSpeed: weatherConditions.windSpeed,
              humidity: weatherConditions.humidity,
              cloudCover: weatherConditions.cloudCover,
              precipitation: weatherConditions.precipitation
            }
          };

          // Add to collector
          this.thermalModelService.collectDataPoint(dataPoint);
        } catch (error) {
          this.logger.error('Error collecting thermal data point:', error);
        }
      }

      let newTarget: number;
      let reason: string;
      let additionalInfo: any = {};

      // Use thermal learning model if available
      if (this.useThermalLearning && this.thermalModelService) {
        try {
          // Get comfort profile (if available)
          const comfortProfile = {
            dayStart: 7,
            dayEnd: 23,
            nightTempReduction: 2,
            preHeatHours: 2
          };

          // Get thermal model recommendation
          const recommendation = this.thermalModelService.getHeatingRecommendation(
            priceData.prices,
            currentTarget ?? 20,
            currentTemp ?? 20,
            outdoorTemp,
            weatherConditions,
            comfortProfile
          );

          newTarget = recommendation.recommendedTemperature;
          reason = recommendation.explanation;

          // Get time to target prediction
          const timeToTarget = this.thermalModelService.getTimeToTarget(
            currentTemp ?? 20,
            newTarget,
            outdoorTemp,
            weatherConditions
          );

          // Add thermal model data to result
          additionalInfo = {
            thermalModel: {
              characteristics: this.thermalModelService.getThermalCharacteristics(),
              timeToTarget: timeToTarget.timeToTarget,
              confidence: timeToTarget.confidence,
              recommendation: recommendation
            }
          };

          this.logger.log(`Thermal model recommendation: ${newTarget}°C (${reason})`);

        } catch (modelError) {
          this.logger.error('Error using thermal model, falling back to basic optimization:', modelError);
          // Fall back to basic optimization
          newTarget = await this.calculateOptimalTemperature(currentPrice, priceAvg, priceMin, priceMax, currentTemp ?? 20);
          reason = newTarget < (currentTarget ?? 20) ? 'Price is above average, reducing temperature' :
                  newTarget > (currentTarget ?? 20) ? 'Price is below average, increasing temperature' :
                  'No change needed';
        }
      } else {
        // Use basic optimization
        newTarget = await this.calculateOptimalTemperature(currentPrice, priceAvg, priceMin, priceMax, currentTemp ?? 20);
        reason = newTarget < (currentTarget ?? 20) ? 'Price is above average, reducing temperature' :
                newTarget > (currentTarget ?? 20) ? 'Price is below average, increasing temperature' :
                'No change needed';
      }

      // If COP helper is available, add COP info to the reason
      if (this.copHelper && this.copWeight > 0) {
        try {
          const seasonalCOP = await this.copHelper.getSeasonalCOP();
          if (seasonalCOP > 0) {
            // Add COP info to the reason
            reason += ` (COP: ${seasonalCOP.toFixed(2)})`;
          }
        } catch (error) {
          this.logger.error('Error getting COP data for reason:', error);
        }
      }

      // Apply safe temperature constraints
      const safeCurrentTarget = currentTarget ?? 20;
      const constraintResult = this.applySafeTemperatureConstraints(newTarget, safeCurrentTarget, reason);
      newTarget = constraintResult.temp;
      reason = constraintResult.reason;

      // Calculate savings and comfort impact
      const savings = this.calculateSavings(safeCurrentTarget, newTarget, currentPrice);
      const comfort = this.calculateComfortImpact(safeCurrentTarget, newTarget);

      // Set new temperature if different
      if (newTarget !== safeCurrentTarget) {
        await this.melCloud.setDeviceTemperature(this.deviceId, this.buildingId, newTarget);
        this.logger.log(`Changed temperature from ${safeCurrentTarget}°C to ${newTarget}°C: ${reason}`);
      } else {
        this.logger.log(`Keeping temperature at ${safeCurrentTarget}°C: ${reason}`);
      }

      // Get COP data if available
      let copData = null;
      if (this.copHelper) {
        try {
          const seasonalCOP = await this.copHelper.getSeasonalCOP();
          const latestCOP = await this.copHelper.getLatestCOP();
          const isSummerMode = this.autoSeasonalMode ? this.copHelper.isSummerSeason() : this.summerMode;

          copData = {
            heating: latestCOP.heating,
            hotWater: latestCOP.hotWater,
            seasonal: seasonalCOP,
            weight: this.copWeight,
            isSummerMode,
            autoSeasonalMode: this.autoSeasonalMode
          };
        } catch (error) {
          this.logger.error('Error getting COP data for result:', error);
        }
      }

      // Return result
      return {
        targetTemp: newTarget,
        reason,
        priceNow: currentPrice,
        priceAvg,
        priceMin,
        priceMax,
        indoorTemp: currentTemp,
        outdoorTemp: deviceState.OutdoorTemperature,
        targetOriginal: currentTarget,
        savings,
        comfort,
        timestamp: new Date().toISOString(),
        kFactor: this.thermalModel.K,
        cop: copData,
        ...additionalInfo
      };
    } catch (error) {
      this.logger.error('Error in hourly optimization', error);
      this.handleApiError(error);
    }
  }

  /**
   * Enhanced optimization using real energy data - complements the existing optimization
   * @returns Promise resolving to enhanced optimization result
   */
  async runEnhancedOptimization(): Promise<EnhancedOptimizationResult> {
    this.logger.log('Starting enhanced optimization with real energy data analysis');

    try {
      // Get current device state
      const deviceState = await this.melCloud.getDeviceState(this.deviceId, this.buildingId);
      const currentTemp = deviceState.RoomTemperature || deviceState.RoomTemperatureZone1;
      const currentTarget = deviceState.SetTemperature || deviceState.SetTemperatureZone1;
      const outdoorTemp = deviceState.OutdoorTemperature || 0;

      // Validate temperature data
      if (currentTemp === undefined && deviceState.RoomTemperature === undefined && deviceState.RoomTemperatureZone1 === undefined) {
        throw new Error('No temperature data available from device');
      }

      // Get Tibber price data
      const priceData = await this.tibber.getPrices();
      
      // Validate price data structure
      if (!priceData || !priceData.current || typeof priceData.current.price !== 'number') {
        this.logger.error('Invalid price data received from Tibber API', priceData);
        throw new Error('Invalid price data received from Tibber API');
      }
      
      if (!priceData.prices || !Array.isArray(priceData.prices) || priceData.prices.length === 0) {
        this.logger.error('No price forecast data available', priceData);
        throw new Error('No price forecast data available');
      }
      
      const currentPrice = priceData.current.price;
      
      // Filter out invalid price entries and calculate statistics safely
      const validPrices = priceData.prices.filter(p => p && typeof p.price === 'number').map(p => p.price);
      if (validPrices.length === 0) {
        this.logger.error('No valid price data in forecast', priceData.prices);
        throw new Error('No valid price data in forecast');
      }
      
      const avgPrice = validPrices.reduce((sum, price) => sum + price, 0) / validPrices.length;
      const minPrice = Math.min(...validPrices);
      const maxPrice = Math.max(...validPrices);

      this.logger.log('Enhanced optimization state:', {
        currentTemp: currentTemp?.toFixed(1),
        currentTarget: currentTarget?.toFixed(1),
        outdoorTemp: outdoorTemp.toFixed(1),
        currentPrice: currentPrice.toFixed(3),
        avgPrice: avgPrice.toFixed(3)
      });

      // Use enhanced optimization with real energy data
      const optimizationResult = await this.calculateOptimalTemperatureWithRealData(
        currentPrice,
        avgPrice,
        minPrice,
        maxPrice,
        currentTemp || 20,
        outdoorTemp
      );

      let targetTemp = optimizationResult.targetTemp;
      let adjustmentReason = optimizationResult.reason;

      // Apply safe temperature constraints
      const safeCurrentTarget = currentTarget ?? 20;
      const constraintResult = this.applySafeTemperatureConstraints(targetTemp, safeCurrentTarget, adjustmentReason);
      targetTemp = constraintResult.temp;
      adjustmentReason = constraintResult.reason;

      // Check if adjustment is needed
      const tempDifference = Math.abs(targetTemp - safeCurrentTarget);
      const isSignificantChange = tempDifference >= this.deadband;

      // Enhanced logging with real energy metrics
      const logData: any = {
        targetTemp: targetTemp.toFixed(1),
        tempDifference: tempDifference.toFixed(1),
        isSignificantChange,
        adjustmentReason,
        priceNormalized: this.safeDivide(currentPrice - minPrice, maxPrice - minPrice, 0.5).toFixed(2),
        pricePercentile: (this.safeDivide(
          priceData.prices.filter((p: any) => p.price <= currentPrice).length,
          priceData.prices.length,
          0.5
        ) * 100).toFixed(0) + '%'
      };

      if (optimizationResult.metrics) {
        logData.realMetrics = {
          heatingCOP: optimizationResult.metrics.realHeatingCOP.toFixed(2),
          hotWaterCOP: optimizationResult.metrics.realHotWaterCOP.toFixed(2),
          seasonalMode: optimizationResult.metrics.seasonalMode,
          optimizationFocus: optimizationResult.metrics.optimizationFocus,
          dailyConsumption: optimizationResult.metrics.dailyEnergyConsumption.toFixed(1) + ' kWh/day'
        };
      }

      this.logger.log('Enhanced optimization result:', logData);

      // Perform hot water optimization if applicable
      let hotWaterAction = null;
      let thermalStrategy = null;
      
      if (optimizationResult.metrics?.optimizationFocus === 'hotwater' || 
          optimizationResult.metrics?.optimizationFocus === 'both') {
        
        // Use thermal mass strategy if available
        if (this.thermalMassModel && priceData.prices && priceData.prices.length >= 24) {
          thermalStrategy = this.calculateThermalMassStrategy(
            currentTemp || 20,
            targetTemp,
            currentPrice,
            priceData.prices,
            {
              heating: optimizationResult.metrics.realHeatingCOP,
              hotWater: optimizationResult.metrics.realHotWaterCOP,
              outdoor: outdoorTemp
            }
          );
          
          // Apply thermal strategy to target temperature
          if (thermalStrategy.action !== 'maintain') {
            targetTemp = thermalStrategy.targetTemp;
            adjustmentReason += ` + Thermal mass ${thermalStrategy.action}: ${thermalStrategy.reasoning}`;
            
            this.logger.log('Thermal mass strategy applied:', {
              action: thermalStrategy.action,
              fromTemp: targetTemp,
              toTemp: thermalStrategy.targetTemp,
              reasoning: thermalStrategy.reasoning,
              estimatedSavings: thermalStrategy.estimatedSavings,
              confidence: thermalStrategy.confidenceLevel
            });
          }
          
          // Use pattern-based hot water scheduling if we have usage data
          if (this.hotWaterUsagePattern && this.hotWaterUsagePattern.dataPoints > 50) {
            const currentHour = new Date().getHours();
            const hotWaterSchedule = this.optimizeHotWaterSchedulingByPattern(
              currentHour,
              priceData.prices,
              optimizationResult.metrics.realHotWaterCOP
            );
            
            hotWaterAction = {
              action: hotWaterSchedule.currentAction,
              reason: hotWaterSchedule.reasoning,
              scheduledTime: undefined // Pattern-based doesn't use specific time
            };
            
            this.logger.log('Pattern-based hot water optimization:', {
              action: hotWaterSchedule.currentAction,
              reason: hotWaterSchedule.reasoning,
              schedulePoints: hotWaterSchedule.schedulePoints.length,
              estimatedSavings: hotWaterSchedule.estimatedSavings
            });
          } else {
            // Fallback to price/COP based optimization
            const hotWaterOpt = await this.optimizeHotWaterScheduling(currentPrice, priceData);
            hotWaterAction = hotWaterOpt;
          }
        } else {
          // Fallback to simple price/COP based optimization
          const hotWaterOpt = await this.optimizeHotWaterScheduling(currentPrice, priceData);
          hotWaterAction = hotWaterOpt;
        }
        
        this.logger.log('Hot water optimization:', {
          action: hotWaterAction.action,
          reason: hotWaterAction.reason,
          scheduledTime: hotWaterAction.scheduledTime
        });
      }

      // Apply temperature change if significant
      if (isSignificantChange) {
        await this.melCloud.setDeviceTemperature(this.deviceId, this.buildingId, targetTemp);
        
        this.logger.log(`Enhanced temperature adjusted from ${safeCurrentTarget.toFixed(1)}°C to ${targetTemp.toFixed(1)}°C`, {
          reason: adjustmentReason,
          savings: this.estimateCostSavings(targetTemp, safeCurrentTarget, currentPrice, avgPrice, optimizationResult.metrics)
        });

        return {
          success: true,
          action: 'temperature_adjusted',
          fromTemp: safeCurrentTarget,
          toTemp: targetTemp,
          reason: adjustmentReason,
          priceData: {
            current: currentPrice,
            average: avgPrice,
            min: minPrice,
            max: maxPrice
          },
          energyMetrics: optimizationResult.metrics,
          hotWaterAction: hotWaterAction || undefined
        };
      } else {
        this.logger.log(`No enhanced temperature adjustment needed (difference: ${tempDifference.toFixed(1)}°C < deadband: ${this.deadband}°C)`);

        return {
          success: true,
          action: 'no_change',
          fromTemp: safeCurrentTarget,
          toTemp: safeCurrentTarget,
          reason: `Temperature difference ${tempDifference.toFixed(1)}°C below deadband ${this.deadband}°C`,
          priceData: {
            current: currentPrice,
            average: avgPrice,
            min: minPrice,
            max: maxPrice
          },
          energyMetrics: optimizationResult.metrics,
          hotWaterAction: hotWaterAction || undefined
        };
      }

    } catch (error) {
      this.handleApiError(error);
    }
  }

  /**
   * Estimate cost savings from temperature adjustment using real energy data
   */
  private estimateCostSavings(
    newTemp: number, 
    oldTemp: number, 
    currentPrice: number, 
    avgPrice: number,
    metrics?: OptimizationMetrics
  ): string {
    if (!metrics) {
      return 'No real energy data for savings calculation';
    }

    const tempDifference = newTemp - oldTemp;
    const dailyConsumption = metrics.dailyEnergyConsumption;
    
    // Estimate energy impact based on temperature change and real COP
    let energyImpactFactor = 0;
    
    if (metrics.seasonalMode === 'summer') {
      // Minimal heating impact in summer, mainly hot water efficiency
      energyImpactFactor = Math.abs(tempDifference) * 0.05; // 5% per degree
    } else if (metrics.seasonalMode === 'winter') {
      // Significant heating impact in winter
      const heatingEfficiency = Math.max(metrics.realHeatingCOP, 1) / 3; // Normalize to 0-1
      energyImpactFactor = Math.abs(tempDifference) * 0.15 * heatingEfficiency; // 15% per degree, adjusted for COP
    } else {
      // Transition season
      energyImpactFactor = Math.abs(tempDifference) * 0.10; // 10% per degree
    }

    const dailyEnergyImpact = dailyConsumption * energyImpactFactor;
    const dailyCostImpact = dailyEnergyImpact * (tempDifference > 0 ? currentPrice : -currentPrice);
    const weeklyCostImpact = dailyCostImpact * 7;

    return `Estimated ${tempDifference > 0 ? 'cost increase' : 'savings'}: ${Math.abs(weeklyCostImpact).toFixed(2)} NOK/week`;
  }

  /**
   * Run weekly calibration
   * @returns Promise resolving to calibration result
   */
  async runWeeklyCalibration(): Promise<{
    oldK: number;
    newK: number;
    oldS?: number;
    newS: number;
    timestamp: string;
    thermalCharacteristics?: any;
    method?: string;
  }> {
    this.logger.log('Starting weekly calibration');

    try {
      // If using thermal learning model, update it with collected data
      if (this.useThermalLearning && this.thermalModelService) {
        try {
          // The thermal model service automatically updates its model
          // We just need to get the current characteristics
          const characteristics = this.thermalModelService.getThermalCharacteristics();

          // Update our simple K-factor based on the thermal model's characteristics
          // This maintains compatibility with the existing system
          const newK = characteristics.modelConfidence > 0.3
            ? (characteristics.heatingRate / 0.5) * this.thermalModel.K
            : this.thermalModel.K;

          const newS = characteristics.thermalMass;

          // Update thermal model
          this.setThermalModel(newK, newS);

          this.logger.log(`Calibrated thermal model using learning data: K=${newK.toFixed(2)}, S=${newS.toFixed(2)}`);
          this.logger.log(`Thermal characteristics: Heating rate=${characteristics.heatingRate.toFixed(3)}, Cooling rate=${characteristics.coolingRate.toFixed(3)}, Thermal mass=${characteristics.thermalMass.toFixed(2)}`);

          // Return result
          return {
            oldK: this.thermalModel.K,
            newK,
            oldS: this.thermalModel.S,
            newS,
            timestamp: new Date().toISOString(),
            thermalCharacteristics: characteristics
          };
        } catch (modelError) {
          this.logger.error('Error updating thermal model from learning data:', modelError);
          // Fall back to basic calibration
        }
      }

      // Basic calibration (used as fallback or when thermal learning is disabled)
      const newK = this.thermalModel.K * (0.9 + Math.random() * 0.2);
      const newS = this.thermalModel.S || 0.1;

      // Update thermal model
      this.setThermalModel(newK, newS);

      this.logger.log(`Calibrated thermal model using basic method: K=${newK.toFixed(2)}, S=${newS.toFixed(2)}`);

      // Return result
      return {
        oldK: this.thermalModel.K,
        newK,
        oldS: this.thermalModel.S,
        newS,
        timestamp: new Date().toISOString(),
        method: 'basic'
      };
    } catch (error) {
      this.logger.error('Error in weekly calibration', error);
      this.handleApiError(error);
    }
  }

  /**
   * Calculate optimal temperature based on price
   * @param currentPrice Current electricity price
   * @param avgPrice Average electricity price
   * @param minPrice Minimum electricity price
   * @param maxPrice Maximum electricity price
   * @param currentTemp Current room temperature
   * @returns Optimal target temperature
   */
  private async calculateOptimalTemperature(
    currentPrice: number,
    avgPrice: number,
    minPrice: number,
    maxPrice: number,
    currentTemp: number
  ): Promise<number> {
    // Cache frequently used values
    const tempRange = this.maxTemp - this.minTemp;
    const midTemp = (this.maxTemp + this.minTemp) / 2;

    // Normalize price between 0 and 1 more efficiently with safe division
    const normalizedPrice = maxPrice === minPrice
      ? 0.5 // Handle edge case of equal prices
      : this.safeDivide(currentPrice - minPrice, maxPrice - minPrice, 0.5);

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
          this.updateCOPRange(seasonalCOP);
          
          // Use adaptive COP normalization based on observed range
          const normalizedCOP = this.normalizeCOP(seasonalCOP);
          
          // Calculate COP efficiency factor (0 = poor, 1 = excellent)
          const copEfficiencyFactor = normalizedCOP;
          
          let copAdjustment = 0;
          
          if (copEfficiencyFactor > 0.8) {
            // Excellent COP (>80th percentile): Maintain comfort, allow normal price response
            copAdjustment = 0.2; // Small bonus for excellent efficiency
            this.logger.log(`Excellent COP: Maintaining comfort with small bonus (+0.2°C)`);
          } else if (copEfficiencyFactor > 0.5) {
            // Good COP: Slight comfort reduction during expensive periods
            const priceAdjustmentReduction = 0.3; // Reduce price response by 30%
            copAdjustment = -priceAdjustmentReduction * Math.abs(targetTemp - midTemp);
            this.logger.log(`Good COP: Reducing temperature adjustment by 30%`);
          } else if (copEfficiencyFactor > 0.2) {
            // Poor COP: Significant comfort reduction to save energy
            copAdjustment = -0.8 * this.copWeight; // Reduce temperature
            this.logger.log(`Poor COP: Reducing temperature for efficiency (-0.8°C)`);
          } else {
            // Very poor COP: Maximum energy conservation
            copAdjustment = -1.2 * this.copWeight;
            this.logger.log(`Very poor COP: Maximum energy conservation (-1.2°C)`);
          }

          // Apply the corrected adjustment
          targetTemp += copAdjustment;

          this.logger.log(`Applied COP adjustment: ${copAdjustment.toFixed(2)}°C (COP: ${seasonalCOP.toFixed(2)}, Efficiency: ${(copEfficiencyFactor * 100).toFixed(0)}%, Weight: ${this.copWeight})`);

          // In summer mode, only reduce heating temperature if heating is the primary concern
          if (isSummerMode) {
            // Check if we have optimization metrics to determine focus
            const shouldApplySummerHeatingReduction = !this.optimizationMetrics || 
              this.optimizationMetrics.seasonalMode !== 'summer' || 
              this.optimizationMetrics.optimizationFocus === 'heating' ||
              this.optimizationMetrics.optimizationFocus === 'both';
              
            if (shouldApplySummerHeatingReduction) {
              const summerAdjustment = -0.5 * this.copWeight; // Reduce heating in summer
              targetTemp += summerAdjustment;
              this.logger.log(`Applied summer mode heating adjustment: ${summerAdjustment.toFixed(2)}°C (optimization focus: ${this.optimizationMetrics?.optimizationFocus || 'unknown'})`);
            } else {
              this.logger.log(`Skipped summer mode heating adjustment - hot water optimization focus`);
            }
          }
        }
      } catch (error) {
        this.logger.error('Error applying COP adjustment:', error);
      }
    }

    return targetTemp;
  }

  /**
   * Calculate savings from temperature change
   * @param oldTemp Original temperature
   * @param newTemp New temperature
   * @param currentPrice Current electricity price
   * @returns Estimated savings
   */
  private calculateSavings(oldTemp: number, newTemp: number, currentPrice: number): number {
    // Validate inputs to prevent NaN propagation
    if (!Number.isFinite(oldTemp) || !Number.isFinite(newTemp) || !Number.isFinite(currentPrice)) {
      this.logger.error('Invalid input to calculateSavings:', { oldTemp, newTemp, currentPrice });
      return 0; // Return 0 instead of NaN for invalid inputs
    }

    // Simple model: each degree lower saves about 5% energy
    const tempDiff = oldTemp - newTemp;
    const energySavingPercent = tempDiff * 5;

    // Convert to monetary value (very rough estimate)
    // Assuming average consumption of 1 kWh per hour
    const hourlyConsumption = 1; // kWh
    const savings = (energySavingPercent / 100) * hourlyConsumption * currentPrice;

    // Ensure we return a finite number
    return Number.isFinite(savings) ? savings : 0;
  }

  /**
   * Calculate enhanced daily savings using historical data and compounding effects
   * @param currentHourSavings Current hour's savings
   * @param historicalOptimizations Historical optimization data
   * @returns Enhanced savings calculation result
   */
  calculateEnhancedDailySavings(
    currentHourSavings: number,
    historicalOptimizations: OptimizationData[] = []
  ): SavingsCalculationResult {
    return this.enhancedSavingsCalculator.calculateEnhancedDailySavings(
      currentHourSavings,
      historicalOptimizations,
      new Date().getHours()
    );
  }

  /**
   * Calculate comfort impact of temperature change
   * @param oldTemp Original temperature
   * @param newTemp New temperature
   * @returns Comfort impact (-1 to 1, negative means less comfortable)
   */
  private calculateComfortImpact(oldTemp: number, newTemp: number): number {
    // Simple model: deviation from 21°C reduces comfort
    const idealTemp = 21;
    const oldDeviation = Math.abs(oldTemp - idealTemp);
    const newDeviation = Math.abs(newTemp - idealTemp);

    // Positive means improved comfort, negative means reduced comfort
    return oldDeviation - newDeviation;
  }

  /**
   * Perform safe division with fallback for zero denominators
   * @param numerator The numerator
   * @param denominator The denominator
   * @param fallback The fallback value if denominator is zero
   * @returns Safe division result
   */
  private safeDivide(numerator: number, denominator: number, fallback: number = 0): number {
    if (denominator === 0 || !isFinite(denominator) || isNaN(denominator)) {
      return fallback;
    }
    const result = numerator / denominator;
    return isFinite(result) ? result : fallback;
  }

  /**
   * Calculate safe average from array with validation
   * @param values Array of numbers
   * @param fallback Fallback value if array is empty or invalid
   * @returns Safe average
   */
  private safeAverage(values: number[], fallback: number = 0): number {
    if (!values || values.length === 0) return fallback;
    const validValues = values.filter(v => isFinite(v) && !isNaN(v));
    if (validValues.length === 0) return fallback;
    return this.safeDivide(validValues.reduce((sum, v) => sum + v, 0), validValues.length, fallback);
  }

  /**
   * Apply safe temperature constraints with proper ordering
   * @param targetTemp Target temperature to constrain
   * @param currentTemp Current target temperature (for step limiting)
   * @param reason Current reason string (will be modified if constraints applied)
   * @returns Constrained temperature and updated reason
   */
  private applySafeTemperatureConstraints(targetTemp: number, currentTemp: number, reason: string): { temp: number; reason: string } {
    let constrainedTemp = targetTemp;
    let updatedReason = reason;
    
    // Step 1: Apply min/max bounds first
    if (constrainedTemp < this.minTemp) {
      constrainedTemp = this.minTemp;
      updatedReason += ` (clamped to minimum ${this.minTemp}°C)`;
    } else if (constrainedTemp > this.maxTemp) {
      constrainedTemp = this.maxTemp;
      updatedReason += ` (clamped to maximum ${this.maxTemp}°C)`;
    }
    
    // Step 2: Apply step constraint but respect bounds
    const maxChange = this.tempStep;
    if (Math.abs(constrainedTemp - currentTemp) > maxChange) {
      const stepLimitedTemp = currentTemp + (constrainedTemp > currentTemp ? maxChange : -maxChange);
      
      // Ensure step-limited temperature still respects bounds
      constrainedTemp = Math.max(this.minTemp, Math.min(this.maxTemp, stepLimitedTemp));
      updatedReason += ` (limited to ${maxChange}°C step)`;
    }
    
    // Step 3: Round to nearest step and ensure still within bounds
    constrainedTemp = Math.round(constrainedTemp / this.tempStep) * this.tempStep;
    constrainedTemp = Math.max(this.minTemp, Math.min(this.maxTemp, constrainedTemp));
    
    // Step 4: Validate final temperature
    if (isNaN(constrainedTemp) || constrainedTemp < 5 || constrainedTemp > 35) {
      this.logger.error(`Invalid constrained temperature: ${constrainedTemp}, using fallback`, {
        originalTarget: targetTemp,
        currentTemp,
        minTemp: this.minTemp,
        maxTemp: this.maxTemp,
        tempStep: this.tempStep
      });
      constrainedTemp = Math.max(this.minTemp, Math.min(this.maxTemp, currentTemp));
      updatedReason += ` (fallback due to invalid constraint result)`;
    }
    
    return { temp: constrainedTemp, reason: updatedReason };
  }
  
  /**
   * Advanced thermal mass calibration using physics-based modeling
   */
  private calibrateThermalMassAdvanced(
    historicalData: any[], 
    avgHeatingConsumption: number
  ): { thermalCapacity: number; heatLossRate: number; preheatingEfficiency: number } {
    try {
      // Analyze energy consumption patterns to understand building characteristics
      const consumptionAnalysis = this.analyzeConsumptionPatterns(historicalData);
      
      // Estimate thermal capacity using multiple factors
      // Base thermal capacity on consumption, with corrections for efficiency and building type
      let thermalCapacity = avgHeatingConsumption / 8; // Start with simplified relationship
      
      // Apply corrections based on consumption variability
      if (consumptionAnalysis.variabilityCoeff > 0.3) {
        // High variability suggests poor insulation or larger thermal mass
        thermalCapacity *= 1.2;
      } else if (consumptionAnalysis.variabilityCoeff < 0.15) {
        // Low variability suggests good insulation or smaller thermal mass
        thermalCapacity *= 0.8;
      }
      
      // Apply seasonal correction if available
      if (consumptionAnalysis.seasonalRatio > 2.0) {
        // High seasonal variation suggests larger thermal mass
        thermalCapacity *= 1.15;
      }
      
      // Bound thermal capacity to realistic range (1.5 - 6.0 kWh/°C)
      thermalCapacity = Math.max(1.5, Math.min(6.0, thermalCapacity));
      
      // Estimate heat loss rate using consumption efficiency analysis
      let heatLossRate = this.estimateHeatLossRate(
        avgHeatingConsumption, 
        thermalCapacity, 
        consumptionAnalysis
      );
      
      // Estimate preheating efficiency based on historical performance
      let preheatingEfficiency = this.estimatePreheatingEfficiency(
        consumptionAnalysis,
        thermalCapacity,
        heatLossRate
      );
      
      this.logger.log('Advanced thermal mass calibration completed:', {
        thermalCapacity: thermalCapacity.toFixed(2),
        heatLossRate: heatLossRate.toFixed(3),
        preheatingEfficiency: preheatingEfficiency.toFixed(3),
        consumptionAnalysis: {
          variability: consumptionAnalysis.variabilityCoeff.toFixed(3),
          seasonalRatio: consumptionAnalysis.seasonalRatio.toFixed(2),
          avgDailyConsumption: avgHeatingConsumption.toFixed(1)
        }
      });
      
      return {
        thermalCapacity,
        heatLossRate,
        preheatingEfficiency
      };
    } catch (error) {
      this.logger.error('Error in advanced thermal mass calibration:', error);
      // Fallback to simple calculation
      return {
        thermalCapacity: Math.max(1.5, Math.min(4.0, avgHeatingConsumption / 10)),
        heatLossRate: avgHeatingConsumption > 20 ? 1.0 : 0.6,
        preheatingEfficiency: 0.85
      };
    }
  }
  
  /**
   * Analyze consumption patterns to understand building characteristics
   */
  private analyzeConsumptionPatterns(historicalData: any[]): {
    variabilityCoeff: number;
    seasonalRatio: number;
    trendSlope: number;
    peakConsumption: number;
    baselineConsumption: number;
  } {
    if (historicalData.length < 3) {
      return {
        variabilityCoeff: 0.2,
        seasonalRatio: 1.5,
        trendSlope: 0,
        peakConsumption: 0,
        baselineConsumption: 0
      };
    }
    
    const heatingConsumptions = historicalData.map(d => d.TotalHeatingConsumed || 0);
    const validConsumptions = heatingConsumptions.filter(c => c > 0);
    
    if (validConsumptions.length === 0) {
      return {
        variabilityCoeff: 0.2,
        seasonalRatio: 1.5,
        trendSlope: 0,
        peakConsumption: 0,
        baselineConsumption: 0
      };
    }
    
    // Calculate coefficient of variation (standard deviation / mean)
    const mean = this.safeAverage(validConsumptions, 0);
    const variance = validConsumptions.reduce((sum, val) => {
      return sum + Math.pow(val - mean, 2);
    }, 0) / validConsumptions.length;
    const stdDev = Math.sqrt(variance);
    const variabilityCoeff = this.safeDivide(stdDev, mean, 0.2);
    
    // Estimate seasonal ratio (max consumption / min consumption)
    const maxConsumption = Math.max(...validConsumptions);
    const minConsumption = Math.min(...validConsumptions.filter(c => c > 0));
    const seasonalRatio = this.safeDivide(maxConsumption, minConsumption, 1.5);
    
    // Simple trend analysis (first half vs second half)
    const firstHalf = validConsumptions.slice(0, Math.floor(validConsumptions.length / 2));
    const secondHalf = validConsumptions.slice(Math.floor(validConsumptions.length / 2));
    const firstHalfAvg = this.safeAverage(firstHalf, 0);
    const secondHalfAvg = this.safeAverage(secondHalf, 0);
    const trendSlope = secondHalfAvg - firstHalfAvg;
    
    return {
      variabilityCoeff,
      seasonalRatio,
      trendSlope,
      peakConsumption: maxConsumption,
      baselineConsumption: minConsumption
    };
  }
  
  /**
   * Estimate heat loss rate using physical modeling
   */
  private estimateHeatLossRate(
    avgConsumption: number, 
    thermalCapacity: number, 
    analysis: any
  ): number {
    // Base heat loss rate on consumption and thermal capacity relationship
    // Heat loss rate = (average power / thermal capacity) / temperature difference
    // Assuming average 15°C indoor/outdoor temperature difference
    const avgPowerKW = avgConsumption / 24; // Convert daily kWh to average kW
    const baseHeatLossRate = this.safeDivide(avgPowerKW, thermalCapacity * 15, 0.5);
    
    // Apply corrections based on consumption patterns
    let correctedRate = baseHeatLossRate;
    
    // Higher variability often indicates poorer building envelope
    if (analysis.variabilityCoeff > 0.3) {
      correctedRate *= 1.25; // Increase heat loss rate
    } else if (analysis.variabilityCoeff < 0.15) {
      correctedRate *= 0.8; // Decrease heat loss rate (better insulation)
    }
    
    // Bound to realistic range (0.3 - 2.0 °C/hour)
    return Math.max(0.3, Math.min(2.0, correctedRate));
  }
  
  /**
   * Estimate preheating efficiency based on building characteristics
   */
  private estimatePreheatingEfficiency(
    analysis: any,
    thermalCapacity: number,
    heatLossRate: number
  ): number {
    // Base efficiency starts at 85%
    let efficiency = 0.85;
    
    // Better thermal mass (higher capacity, lower heat loss) = better efficiency
    const thermalRatio = this.safeDivide(thermalCapacity, heatLossRate, 3);
    
    if (thermalRatio > 4) {
      efficiency = 0.92; // Excellent building
    } else if (thermalRatio > 3) {
      efficiency = 0.88; // Good building
    } else if (thermalRatio < 2) {
      efficiency = 0.75; // Poor building
    }
    
    // Lower consumption variability suggests better controllability
    if (analysis.variabilityCoeff < 0.2) {
      efficiency *= 1.05;
    } else if (analysis.variabilityCoeff > 0.4) {
      efficiency *= 0.95;
    }
    
    // Bound to realistic range
    return Math.max(0.6, Math.min(0.95, efficiency));
  }
  
  /**
   * Update adaptive price thresholds based on recent price patterns
   */
  private updatePriceThresholds(recentPrices: number[]): void {
    if (!recentPrices || recentPrices.length < 24) {
      return; // Need at least 24 hours of price data
    }
    
    // Add recent prices to history
    this.priceThresholds.priceHistory.push(...recentPrices);
    
    // Keep only last 7 days of price history (168 hours)
    if (this.priceThresholds.priceHistory.length > 168) {
      this.priceThresholds.priceHistory = this.priceThresholds.priceHistory.slice(-168);
    }
    
    // Only update thresholds if we have enough historical data and it's been a while
    const hoursSinceLastUpdate = (Date.now() - this.priceThresholds.lastUpdate.getTime()) / (1000 * 60 * 60);
    if (this.priceThresholds.priceHistory.length >= 48 && hoursSinceLastUpdate >= 12) {
      this.recalculatePriceThresholds();
      this.priceThresholds.lastUpdate = new Date();
    }
  }
  
  /**
   * Recalculate price thresholds based on historical volatility and patterns
   */
  private recalculatePriceThresholds(): void {
    const prices = this.priceThresholds.priceHistory;
    if (prices.length < 24) return;
    
    // Calculate price volatility (coefficient of variation)
    const mean = this.safeAverage(prices, 0);
    const variance = prices.reduce((sum, price) => {
      return sum + Math.pow(price - mean, 2);
    }, 0) / prices.length;
    const stdDev = Math.sqrt(variance);
    const volatilityIndex = this.safeDivide(stdDev, mean, 0.2);
    
    this.priceThresholds.volatilityIndex = volatilityIndex;
    
    // Adjust thresholds based on volatility
    if (volatilityIndex > 0.4) {
      // High volatility - use more extreme thresholds to capture real opportunities
      this.priceThresholds.cheap = 0.15;      // 15th percentile
      this.priceThresholds.expensive = 0.85;  // 85th percentile
      this.priceThresholds.moderate = 0.30;   // 30th percentile
    } else if (volatilityIndex > 0.25) {
      // Moderate volatility - balanced approach
      this.priceThresholds.cheap = 0.20;      // 20th percentile
      this.priceThresholds.expensive = 0.80;  // 80th percentile
      this.priceThresholds.moderate = 0.35;   // 35th percentile
    } else {
      // Low volatility - more conservative thresholds
      this.priceThresholds.cheap = 0.30;      // 30th percentile
      this.priceThresholds.expensive = 0.70;  // 70th percentile
      this.priceThresholds.moderate = 0.45;   // 45th percentile
    }
    
    this.logger.log('Price thresholds updated:', {
      volatilityIndex: volatilityIndex.toFixed(3),
      cheap: (this.priceThresholds.cheap * 100).toFixed(0) + 'th percentile',
      moderate: (this.priceThresholds.moderate * 100).toFixed(0) + 'th percentile',
      expensive: (this.priceThresholds.expensive * 100).toFixed(0) + 'th percentile',
      priceHistoryDays: (prices.length / 24).toFixed(1)
    });
  }
}
