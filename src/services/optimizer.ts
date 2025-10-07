import { MelCloudApi } from './melcloud-api';
import { ThermalModelService } from './thermal-model';
import { COPHelper } from './cop-helper';
import { validateNumber, validateBoolean } from '../util/validation';
import {
  MelCloudDevice,
  TibberPriceInfo,
  PriceProvider,
  WeatherData,
  ThermalModel,
  OptimizationResult,
  HomeyApp
} from '../types';
import { isError } from '../util/error-handler';
import { EnhancedSavingsCalculator, OptimizationData, SavingsCalculationResult } from '../util/enhanced-savings-calculator';
import { HomeyLogger } from '../util/logger';
import { TimeZoneHelper } from '../util/time-zone-helper';
import { DefaultEngineConfig, computeHeatingDecision } from '../../optimization/engine';

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
  indoorTemp?: number | null;
  outdoorTemp?: number | null;
  priceData: {
    current: number;
    average: number;
    min: number;
    max: number;
    level?: string;
    percentile?: number;
    nextHour?: number;
  };
  savings?: number;
  energyMetrics?: OptimizationMetrics;
  hotWaterAction?: {
    action: 'heat_now' | 'delay' | 'maintain';
    reason: string;
    scheduledTime?: string;
  };
  // Optional weather snapshot for timeline/details integration
  weather?: {
    current?: Partial<WeatherData>;
    adjustment?: { adjustment: number; reason: string };
    trend?: { trend: string; details: string };
  };
  priceForecast?: {
    position?: string;
    recommendation?: string;
    upcomingChanges?: any;
    bestTimes?: any;
    worstTimes?: any;
  };
  zone2Data?: SecondaryZoneResult;
  tankData?: TankOptimizationResult;
  melCloudStatus?: {
    setpointApplied: boolean;
    error?: string;
  };
  tankStatus?: {
    setpointApplied: boolean;
    error?: string;
  };
}

interface SecondaryZoneResult {
  fromTemp: number;
  toTemp: number;
  reason: string;
  targetOriginal?: number;
  targetTemp?: number;
  indoorTemp?: number;
  success?: boolean;
}

interface TankOptimizationResult {
  fromTemp: number;
  toTemp: number;
  reason: string;
  success?: boolean;
  changed?: boolean;
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
  // Safety: avoid frequent setpoint changes (anti–short-cycling proxy)
  private minSetpointChangeMinutes: number = 5;
  private lastSetpointChangeMs: number | null = null;
  // Secondary zone constraints
  private enableZone2: boolean = false;
  private minTempZone2: number = 18;
  private maxTempZone2: number = 22;
  private tempStepZone2: number = 0.5;
  // Hot water tank constraints
  private enableTankControl: boolean = false;
  private minTankTemp: number = 40;
  private maxTankTemp: number = 50;
  private tankTempStep: number = 1.0;
  private thermalModelService: ThermalModelService | null = null;
  private useThermalLearning: boolean = false;
  private copHelper: COPHelper | null = null;
  private copWeight: number = 0.3;
  private autoSeasonalMode: boolean = true;
  private summerMode: boolean = false;
  private enhancedSavingsCalculator: EnhancedSavingsCalculator;
  private lastEnergyData: RealEnergyData | null = null;
  private optimizationMetrics: OptimizationMetrics | null = null;
  private timeZoneHelper!: TimeZoneHelper;

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
    private priceProvider: PriceProvider | null,
    private readonly deviceId: string,
    private readonly buildingId: number,
    private readonly logger: HomeyLogger,
    private readonly weatherApi?: { getCurrentWeather(): Promise<WeatherData> },
    private readonly homey?: HomeyApp
  ) {
    // Initialize thermal learning model first if homey instance is provided
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

        this.logger.log(`COP settings loaded - Weight: ${this.copWeight}, Auto Seasonal: ${this.autoSeasonalMode}, Summer Mode: ${this.summerMode}`);
        
        // Initialize TimeZoneHelper with user settings
        const tzOffset = homey.settings.get('time_zone_offset') || 2;
        const useDST = homey.settings.get('use_dst') || false;
        const timeZoneName = homey.settings.get('time_zone_name');
        this.timeZoneHelper = new TimeZoneHelper(
          this.logger,
          Number(tzOffset),
          Boolean(useDST),
          typeof timeZoneName === 'string' && timeZoneName.length > 0 ? timeZoneName : undefined
        );
        this.logger.log('TimeZoneHelper initialized for Optimizer');
        
        // Load safety constraints
        const mins = Number(homey.settings.get('min_setpoint_change_minutes'));
        if (!Number.isNaN(mins) && mins > 0 && mins < 180) {
          this.minSetpointChangeMinutes = mins;
        }
        const persistedLast = Number(homey.settings.get('last_setpoint_change_ms'));
        if (Number.isFinite(persistedLast) && persistedLast > 0) {
          this.lastSetpointChangeMs = persistedLast;
        }
        const db = Number(homey.settings.get('deadband_c'));
        if (!Number.isNaN(db) && db > 0.1 && db < 2) {
          this.deadband = db;
        }

        // Load temperature constraint settings
        const tempStep = Number(homey.settings.get('temp_step_max'));
        if (!Number.isNaN(tempStep) && tempStep >= 0.5 && tempStep <= 1.0) {
          this.tempStep = tempStep;
        }
        
        const minTempZone2 = Number(homey.settings.get('min_temp_zone2'));
        if (!Number.isNaN(minTempZone2) && minTempZone2 >= 16 && minTempZone2 <= 22) {
          this.minTempZone2 = minTempZone2;
        }
        
        const maxTempZone2 = Number(homey.settings.get('max_temp_zone2'));
        if (!Number.isNaN(maxTempZone2) && maxTempZone2 >= 20 && maxTempZone2 <= 26) {
          this.maxTempZone2 = maxTempZone2;
        }
        
        const tempStepZone2 = Number(homey.settings.get('temp_step_zone2'));
        if (!Number.isNaN(tempStepZone2) && tempStepZone2 >= 0.1 && tempStepZone2 <= 2.0) {
          this.tempStepZone2 = tempStepZone2;
        }

        this.logger.log(`Temperature constraint settings loaded - Main: ${this.minTemp}°C-${this.maxTemp}°C (${this.tempStep}°C), Zone2: ${this.minTempZone2}°C-${this.maxTempZone2}°C (${this.tempStepZone2}°C)`);

        // Load hot water tank settings
        this.enableTankControl = homey.settings.get('enable_tank_control') !== false;
        
        const minTankTemp = Number(homey.settings.get('min_tank_temp'));
        if (!Number.isNaN(minTankTemp) && minTankTemp >= 30 && minTankTemp <= 45) {
          this.minTankTemp = minTankTemp;
        }
        
        const maxTankTemp = Number(homey.settings.get('max_tank_temp'));
        if (!Number.isNaN(maxTankTemp) && maxTankTemp >= 40 && maxTankTemp <= 60) {
          this.maxTankTemp = maxTankTemp;
        }
        
        const tankTempStep = Number(homey.settings.get('tank_temp_step'));
        if (!Number.isNaN(tankTempStep) && tankTempStep >= 1.0 && tankTempStep <= 5.0) {
          this.tankTempStep = tankTempStep;
        }

        this.logger.log(`Hot water tank settings loaded - Enabled: ${this.enableTankControl}, Min: ${this.minTankTemp}°C, Max: ${this.maxTankTemp}°C, Step: ${this.tankTempStep}°C`);

        // Initialize thermal mass model from historical data (async, non-blocking)
        this.initializeThermalMassFromHistory().catch(error => {
          this.logger.log('Failed to initialize thermal mass from history (this is normal during initial setup):', error);
        });
        
      } catch (error) {
        this.logger.error('Failed to initialize COP helper:', error);
        this.copHelper = null;
      }
    } else {
      // Initialize TimeZoneHelper with defaults when no homey instance
      this.timeZoneHelper = new TimeZoneHelper(this.logger, 2, false);
      this.logger.log('TimeZoneHelper initialized with defaults (no homey instance)');
    }

    // Initialize enhanced savings calculator after all services are set up
    // Get references to hot water service if available
    const hotWaterService = (this.homey as any)?.hotWaterService;
    
    // Initialize enhanced savings calculator with available services
    this.enhancedSavingsCalculator = new EnhancedSavingsCalculator(
      this.logger,
      this.thermalModelService || undefined,
      hotWaterService,
      this.copHelper || undefined
    );

    this.logger.log('Enhanced savings calculator initialized with services:', {
      thermalService: !!this.thermalModelService,
      hotWaterService: !!hotWaterService,
      copHelper: !!this.copHelper,
      baselineCapability: this.enhancedSavingsCalculator.hasBaselineCapability()
    });
  }

  /**
   * Initialize thermal mass model from historical data
   */
  private async initializeThermalMassFromHistory(): Promise<void> {
    try {
      if (!this.homey) return;
      
      // Validate device ID before attempting to fetch data
      const numericDeviceId = parseInt(this.deviceId, 10);
      if (isNaN(numericDeviceId) || numericDeviceId <= 0) {
        this.logger.log(`Cannot initialize thermal mass from history - invalid device ID: ${this.deviceId}. This is normal during initial setup.`);
        return;
      }
      
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
        const avgHeatingConsumption = recentData.reduce((sum, day) => sum + (day.TotalHeatingConsumed || 0), 0) / recentData.length;
        
        if (avgHeatingConsumption > 0) {
          // Estimate thermal capacity based on daily consumption
          // Typical relationship: higher consumption = larger thermal mass
          this.thermalMassModel.thermalCapacity = Math.max(1.5, Math.min(4.0, avgHeatingConsumption / 10));
          
          // Estimate heat loss rate based on outdoor temperature correlation
          // This would need outdoor temperature data for proper calculation
          // For now, use a reasonable default based on consumption
          this.thermalMassModel.heatLossRate = avgHeatingConsumption > 20 ? 1.0 : 0.6;
          
          this.thermalMassModel.lastCalibration = new Date();
          
          this.logger.log('Thermal mass model calibrated:', {
            thermalCapacity: this.thermalMassModel.thermalCapacity.toFixed(2),
            heatLossRate: this.thermalMassModel.heatLossRate.toFixed(2),
            avgHeatingConsumption: avgHeatingConsumption.toFixed(1),
            hotWaterDataPoints: this.hotWaterUsagePattern.dataPoints
          });
        }
      }
      
    } catch (error: unknown) {
      this.logger.error('Failed to initialize thermal mass from history:', error);
      // Keep default values on error
    }
  }

  public setPriceProvider(provider: PriceProvider | null): void {
    this.priceProvider = provider;
    this.logger.info(`Price provider updated: ${provider ? provider.constructor.name : 'none'}`);
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
   * Configure Zone2 temperature constraints and enablement
   */
  setZone2TemperatureConstraints(enableZone2: boolean, minTempZone2: number, maxTempZone2: number, tempStepZone2: number): void {
    this.enableZone2 = enableZone2;
    this.minTempZone2 = validateNumber(minTempZone2, 'minTempZone2', { min: 10, max: 30 });
    this.maxTempZone2 = validateNumber(maxTempZone2, 'maxTempZone2', { min: 10, max: 30 });

    if (this.maxTempZone2 <= this.minTempZone2) {
      throw new Error(`Invalid Zone2 temperature range: max (${maxTempZone2}) must be greater than min (${minTempZone2})`);
    }

    this.tempStepZone2 = validateNumber(tempStepZone2 || 0.5, 'tempStepZone2', { min: 0.1, max: 2 });

    this.logger.log(`Zone2 constraints updated - Enabled: ${enableZone2}, Min: ${this.minTempZone2}°C, Max: ${this.maxTempZone2}°C, Step: ${this.tempStepZone2}°C`);
  }

  /**
   * Configure hot water tank control constraints and enablement
   */
  setTankTemperatureConstraints(enableTankControl: boolean, minTankTemp: number, maxTankTemp: number, tankTempStep: number): void {
    this.enableTankControl = enableTankControl;
    this.minTankTemp = validateNumber(minTankTemp, 'minTankTemp', { min: 30, max: 70 });
    this.maxTankTemp = validateNumber(maxTankTemp, 'maxTankTemp', { min: 30, max: 70 });

    if (this.maxTankTemp <= this.minTankTemp) {
      throw new Error(`Invalid tank temperature range: max (${maxTankTemp}) must be greater than min (${minTankTemp})`);
    }

    this.tankTempStep = validateNumber(tankTempStep || 1, 'tankTempStep', { min: 0.5, max: 5 });

    this.logger.log(`Tank constraints updated - Enabled: ${enableTankControl}, Min: ${this.minTankTemp}°C, Max: ${this.maxTankTemp}°C, Step: ${this.tankTempStep}°C`);
  }

  /**
   * Expose current thermal model configuration
   */
  public getThermalModel(): ThermalModel {
    return { ...this.thermalModel };
  }

  /**
   * Get the enhanced savings calculator instance
   */
  public getEnhancedSavingsCalculator(): EnhancedSavingsCalculator {
    return this.enhancedSavingsCalculator;
  }

  /**
   * COP range tracking for adaptive normalization
   */
  private copRange: { minObserved: number; maxObserved: number; updateCount: number } = {
    minObserved: 1,
    maxObserved: 5,
    updateCount: 0
  };

  /**
   * Update COP range based on observed values
   * @param cop Observed COP value
   */
  private updateCOPRange(cop: number): void {
    if (cop > 0) {
      this.copRange.minObserved = Math.min(this.copRange.minObserved, cop);
      this.copRange.maxObserved = Math.max(this.copRange.maxObserved, cop);
      this.copRange.updateCount++;
      
      // Log range updates periodically
      if (this.copRange.updateCount % 50 === 0) {
        this.logger.log(`COP range updated after ${this.copRange.updateCount} observations: ${this.copRange.minObserved.toFixed(2)} - ${this.copRange.maxObserved.toFixed(2)}`);
      }
    }
  }

  /**
   * Normalize COP value using adaptive range
   * @param cop COP value to normalize
   * @returns Normalized COP (0-1)
   */
  private normalizeCOP(cop: number): number {
    const range = this.copRange.maxObserved - this.copRange.minObserved;
    if (range <= 0) return 0.5; // Default if no range established
    
    return Math.min(Math.max(
      (cop - this.copRange.minObserved) / range, 0
    ), 1);
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
      const currentPricePercentile = next24h.filter(p => p.price <= currentPrice).length / next24h.length;
      
      // Get normalized COP efficiency
      const heatingEfficiency = this.normalizeCOP(copData.heating);
      
      // Calculate thermal mass capacity for preheating
      const tempDelta = this.thermalMassModel.maxPreheatingTemp - currentTemp;
      const preheatingEnergy = tempDelta * this.thermalMassModel.thermalCapacity;
      
      // Strategy decision logic
      if (currentPricePercentile <= 0.2 && heatingEfficiency > 0.7 && tempDelta > 0.5) {
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
        
      } else if (currentPricePercentile >= 0.8 && currentTemp > targetTemp - 0.5) {
        // Very expensive period + above target = COAST
        const coastingTarget = Math.max(
          targetTemp - 1.5,
          this.minTemp
        );
        
        // Calculate how long we can coast based on thermal mass
        const coastingHours = Math.min(
          (currentTemp - coastingTarget) / this.thermalMassModel.heatLossRate,
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
        
      } else if (currentPricePercentile <= 0.3 && heatingEfficiency > 0.8 && currentTemp < targetTemp - 1.0) {
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
          confidenceLevel: heatingEfficiency
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
      
    } catch (error: unknown) {
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
      const avgCheapPrice = cheapestHours.reduce((sum, h) => sum + h.price, 0) / cheapestHours.length;
      const priceDifference = currentPrice - avgCheapPrice;
      
      // Energy for preheating
      const extraEnergy = (preheatingTarget - 20) * this.thermalMassModel.thermalCapacity;
      const energyWithCOP = extraEnergy / copData.heating;
      
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
      const energyWithCOP = extraEnergy / copData.heating;
      
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
          hourlyDemand[i] = hourlyDemand[i] / hourlyCount[i];
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
          const pricePercentile = next24h.filter(p => p.price <= next24h[priceIndex].price).length / next24h.length;

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
    const avgPrice = priceData.reduce((sum, p) => sum + p.price, 0) / priceData.length;
    
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

      const avgPrice = priceData.reduce((sum, p) => sum + p.price, 0) / priceData.length;
      
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
      
      // Extract enhanced COP values with sensible fallbacks when the live value is missing
      const derivedHeatingCOP = (enhancedCOPData.daily as any)?.heatingCOP
        ?? (enhancedCOPData.daily as any)?.averageCOP
        ?? enhancedCOPData.historical.heating
        ?? 0;
      const derivedHotWaterCOP = (enhancedCOPData.daily as any)?.hotWaterCOP
        ?? (enhancedCOPData.daily as any)?.averageCOP
        ?? enhancedCOPData.historical.hotWater
        ?? 0;

      const realHeatingCOP = enhancedCOPData.current.heating > 0
        ? enhancedCOPData.current.heating
        : derivedHeatingCOP;
      const realHotWaterCOP = enhancedCOPData.current.hotWater > 0
        ? enhancedCOPData.current.hotWater
        : derivedHotWaterCOP;
      
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
        heatingCOP: derivedHeatingCOP,
        hotWaterCOP: derivedHotWaterCOP,
        averageCOP: (energyData as any).averageCOP ?? null,
        AverageHeatingCOP: enhancedCOPData.historical.heating,
        AverageHotWaterCOP: enhancedCOPData.historical.hotWater
      };

      this.lastEnergyData = safeEnergyData;

      // Calculate daily energy consumption (kWh/day averaged over the period)
      const dailyEnergyConsumption = (heatingConsumed + hotWaterConsumed) / 7;

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

      const heatingCOPDisplay = realHeatingCOP > 0 ? realHeatingCOP.toFixed(2) : 'n/a';
      const hotWaterCOPDisplay = realHotWaterCOP > 0 ? realHotWaterCOP.toFixed(2) : 'n/a';
      const heatingEfficiencyDisplay = realHeatingCOP > 0 ? (heatingEfficiency * 100).toFixed(0) + '%' : 'n/a';
      const hotWaterEfficiencyDisplay = realHotWaterCOP > 0 ? (hotWaterEfficiency * 100).toFixed(0) + '%' : 'n/a';

      this.logger.log(`Enhanced energy metrics calculated:`, {
        heatingCOP: heatingCOPDisplay,
        hotWaterCOP: hotWaterCOPDisplay,
        heatingEfficiency: heatingEfficiencyDisplay,
        hotWaterEfficiency: hotWaterEfficiencyDisplay,
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

    // Normalize price between 0 and 1
    const normalizedPrice = maxPrice === minPrice
      ? 0.5 
      : (currentPrice - minPrice) / (maxPrice - minPrice);

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
    const currentPercentile = prices.filter((p: any) => p.price <= currentPrice).length / prices.length;

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
      if (!this.priceProvider) {
        throw new Error('Price provider not initialized');
      }
      const priceData = await this.priceProvider.getPrices();
      const currentPrice = priceData.current.price;

      // Calculate price statistics
      const prices = priceData.prices.map((p: any) => p.price);
      const priceAvg = prices.reduce((sum: number, price: number) => sum + price, 0) / prices.length;
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

      // Apply constraints
      newTarget = Math.max(this.minTemp, Math.min(this.maxTemp, newTarget));

      // Apply step constraint (don't change by more than tempStep)
      const maxChange = this.tempStep;
      const safeCurrentTarget = currentTarget ?? 20;
      if (Math.abs(newTarget - safeCurrentTarget) > maxChange) {
        newTarget = safeCurrentTarget + (newTarget > safeCurrentTarget ? maxChange : -maxChange);
      }

      // Round to nearest step
      newTarget = Math.round(newTarget / this.tempStep) * this.tempStep;

      // Calculate savings and comfort impact
      const savings = this.calculateSavings(safeCurrentTarget, newTarget, currentPrice);
      const comfort = this.calculateComfortImpact(safeCurrentTarget, newTarget);

      // Set new temperature if different
      if (newTarget !== safeCurrentTarget) {
        try {
          await this.melCloud.setDeviceTemperature(this.deviceId, this.buildingId, newTarget);
          this.logger.log(`Changed temperature from ${safeCurrentTarget}°C to ${newTarget}°C: ${reason}`);
        } catch (error) {
          this.logger.error('Failed to set MELCloud target temperature:', error);
          const errMsg = (error instanceof Error) ? error.message : String(error);
          reason = `Temperature change requested but MELCloud rejected: ${errMsg}`;
          newTarget = safeCurrentTarget;
        }
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
      throw error;
    }
    throw new Error('Enhanced optimization exited without producing a result');
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
      if (!this.priceProvider) {
        throw new Error('Price provider not initialized');
      }
      const priceData = await this.priceProvider.getPrices();
      const currentPrice = priceData.current.price;
      const avgPrice = priceData.prices.reduce((sum, p) => sum + p.price, 0) / priceData.prices.length;
      const minPrice = Math.min(...priceData.prices.map((p: any) => p.price));
      const maxPrice = Math.max(...priceData.prices.map((p: any) => p.price));
      const priceLevel: string = (priceData.current as any)?.level || 'NORMAL';
      const pricePercentile = priceData.prices.length > 0
        ? (priceData.prices.filter((p: any) => p.price <= currentPrice).length / priceData.prices.length) * 100
        : 0;
      let nextHourPrice: number | undefined;
      try {
        const currentTs = priceData.current?.time ? new Date(priceData.current.time) : new Date();
        const next = priceData.prices.find((p: any) => {
          try {
            return new Date(p.time) > currentTs;
          } catch {
            return false;
          }
        });
        if (next && typeof next.price === 'number' && Number.isFinite(next.price)) {
          nextHourPrice = next.price;
        }
      } catch {
        nextHourPrice = undefined;
      }
      const priceForecast = (priceData as any)?.forecast || null;

      // Validate price freshness (failsafe)
      try {
        const t = (priceData.current && (priceData.current as any).time) ? new Date((priceData.current as any).time).getTime() : NaN;
        const ageMin = Number.isFinite(t) ? (Date.now() - t) / 60000 : Infinity;
        if (!(ageMin >= 0 && ageMin <= 65)) {
          this.logger.warn(`Price data appears stale or in the future (age=${ageMin.toFixed(1)} min). Holding setpoint.`);
          return {
            success: true,
            action: 'no_change',
            fromTemp: currentTarget ?? currentTemp ?? 20,
            toTemp: currentTarget ?? currentTemp ?? 20,
            reason: 'Stale price data; safe hold',
            priceData: { current: currentPrice, average: avgPrice, min: minPrice, max: maxPrice }
          };
        }
      } catch (e) {
        this.logger.warn('Failed to validate price freshness; proceeding cautiously');
      }

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

      // Optional: Use pure Optimization Engine when enabled (robust boolean parsing)
      let useEngine = false;
      if (this.homey) {
        try {
          const ue = this.homey.settings.get('use_engine');
          useEngine = (ue === true) || (ue === 'true') || (ue === 1);
        } catch {}
      }
      if (useEngine) {
        try {
          const occupied = this.homey ? (this.homey.settings.get('occupied') !== false) : true;
          const comfortLowerOcc = Number(this.homey?.settings.get('comfort_lower_occupied'));
          const comfortUpperOcc = Number(this.homey?.settings.get('comfort_upper_occupied'));
          const comfortLowerAway = Number(this.homey?.settings.get('comfort_lower_away'));
          const comfortUpperAway = Number(this.homey?.settings.get('comfort_upper_away'));

          const engineCfg = {
            ...DefaultEngineConfig,
            comfortOccupied: {
              lowerC: Number.isFinite(comfortLowerOcc) ? comfortLowerOcc : DefaultEngineConfig.comfortOccupied.lowerC,
              upperC: Number.isFinite(comfortUpperOcc) ? comfortUpperOcc : DefaultEngineConfig.comfortOccupied.upperC,
            },
            comfortAway: {
              lowerC: Number.isFinite(comfortLowerAway) ? comfortLowerAway : DefaultEngineConfig.comfortAway.lowerC,
              upperC: Number.isFinite(comfortUpperAway) ? comfortUpperAway : DefaultEngineConfig.comfortAway.upperC,
            },
            minSetpointC: this.minTemp,
            maxSetpointC: this.maxTemp,
            safety: {
              deadbandC: this.deadband,
              minSetpointChangeMinutes: this.minSetpointChangeMinutes,
              extremeWeatherMinC: Number(this.homey?.settings.get('extreme_weather_min_temp')) || DefaultEngineConfig.safety.extremeWeatherMinC,
            },
            preheat: {
              enable: this.homey?.settings.get('preheat_enable') !== false,
              horizonHours: Number(this.homey?.settings.get('preheat_horizon_hours')) || DefaultEngineConfig.preheat.horizonHours,
              cheapPercentile: Number(this.homey?.settings.get('preheat_cheap_percentile')) || DefaultEngineConfig.preheat.cheapPercentile,
            },
            thermal: {
              rThermal: Number(this.homey?.settings.get('r_thermal')) || DefaultEngineConfig.thermal.rThermal,
              cThermal: Number(this.homey?.settings.get('c_thermal')) || DefaultEngineConfig.thermal.cThermal,
            }
          } as typeof DefaultEngineConfig;

          const engineDecision = computeHeatingDecision(engineCfg, {
            now: new Date(),
            occupied,
            prices: priceData.prices,
            currentPrice,
            telemetry: { indoorC: currentTemp ?? 20, targetC: currentTarget ?? 20 },
            weather: { outdoorC: outdoorTemp },
            lastSetpointChangeMs: this.lastSetpointChangeMs ?? (this.homey ? Number(this.homey.settings.get('last_setpoint_change_ms')) : null)
          });

          // Explicit ON marker with config snapshot for easier troubleshooting
          try {
            this.logger.log('Engine: ON', {
              occupied,
              bands: {
                occupied: [engineCfg.comfortOccupied.lowerC, engineCfg.comfortOccupied.upperC],
                away: [engineCfg.comfortAway.lowerC, engineCfg.comfortAway.upperC]
              },
              safety: { deadband: this.deadband, minChangeMin: this.minSetpointChangeMinutes },
              preheat: { enable: engineCfg.preheat.enable, horizon: engineCfg.preheat.horizonHours, cheapPct: engineCfg.preheat.cheapPercentile }
            });
          } catch {}

          if (engineDecision.action === 'set_target') {
            targetTemp = engineDecision.toC;
            adjustmentReason = `Engine: ${engineDecision.reason}`;
          } else {
            targetTemp = currentTarget ?? targetTemp;
            adjustmentReason = `Engine: ${engineDecision.reason}`;
          }

          this.logger.log('Engine decision applied', {
            from: currentTarget ?? 20,
            to: targetTemp,
            reason: adjustmentReason
          });
        } catch (e) {
          this.logger.error('Engine decision failed; using optimizer result', e);
        }
      } else {
        try {
          const raw = this.homey ? this.homey.settings.get('use_engine') : undefined;
          this.logger.log('Engine: OFF', { use_engine_setting: raw });
        } catch {}
      }

      // Apply weather-based adjustment when available (uses forecast + price context)
      let weatherInfo: any = null;
      let weatherAdjustment: { adjustment: number; reason: string } | null = null;
      let weatherTrend: any = null;
      if (this.weatherApi && typeof (this.weatherApi as any).getForecast === 'function' && typeof (this.weatherApi as any).calculateWeatherBasedAdjustment === 'function') {
        try {
          const forecast = await (this.weatherApi as any).getForecast();
          weatherAdjustment = (this.weatherApi as any).calculateWeatherBasedAdjustment(
            forecast,
            currentTemp,
            currentTarget,
            currentPrice,
            avgPrice
          );
          weatherTrend = (this.weatherApi as any).getWeatherTrend ? (this.weatherApi as any).getWeatherTrend(forecast) : null;

          if (weatherAdjustment && typeof weatherAdjustment.adjustment === 'number' && Math.abs(weatherAdjustment.adjustment) >= 0.1) {
            targetTemp += weatherAdjustment.adjustment;
            adjustmentReason += ` + Weather: ${weatherAdjustment.reason} (${weatherAdjustment.adjustment > 0 ? '+' : ''}${weatherAdjustment.adjustment.toFixed(1)}°C)`;
          }

          weatherInfo = {
            current: forecast && forecast.current ? forecast.current : undefined,
            adjustment: weatherAdjustment,
            trend: weatherTrend
          };
        } catch (wErr) {
          this.logger.error('Weather-based adjustment failed', wErr as Error);
        }
      }

      // Clamp to valid range
      if (targetTemp < this.minTemp) {
        targetTemp = this.minTemp;
        adjustmentReason += ` (clamped to minimum ${this.minTemp}°C)`;
      } else if (targetTemp > this.maxTemp) {
        targetTemp = this.maxTemp;
        adjustmentReason += ` (clamped to maximum ${this.maxTemp}°C)`;
      }

      // Apply step constraint (don't change by more than tempStep)
      const maxChange = this.tempStep;
      const safeCurrentTarget = currentTarget ?? 20;
      if (Math.abs(targetTemp - safeCurrentTarget) > maxChange) {
        targetTemp = safeCurrentTarget + (targetTemp > safeCurrentTarget ? maxChange : -maxChange);
        adjustmentReason += ` (limited to ${maxChange}°C step)`;
      }

      // Round to nearest step
      targetTemp = Math.round(targetTemp / this.tempStep) * this.tempStep;

      // Check if adjustment is needed
      let tempDifference = Math.abs(targetTemp - safeCurrentTarget);
      let isSignificantChange = tempDifference >= this.deadband;
      let melCloudSetpointApplied = true;
      let melCloudSetpointError: string | undefined;
      let setpointApplied = false;

      // Enhanced logging with real energy metrics
      const logData: any = {
        targetTemp: targetTemp.toFixed(1),
        tempDifference: tempDifference.toFixed(1),
        isSignificantChange,
        adjustmentReason,
        priceNormalized: ((currentPrice - minPrice) / (maxPrice - minPrice)).toFixed(2),
        pricePercentile: `${pricePercentile.toFixed(0)}%`
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

      // Perform hot water optimization if applicable
      let hotWaterAction = null;
      let thermalStrategy = null;
      let tankStatus: { setpointApplied: boolean; error?: string } | undefined;
      
      if (optimizationResult.metrics?.optimizationFocus === 'hotwater' || 
          optimizationResult.metrics?.optimizationFocus === 'both') {
        
        // Use thermal mass strategy if available
        if (this.thermalMassModel && priceData.prices && priceData.prices.length >= 24) {
          const targetBeforeStrategy = targetTemp;
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
              fromTemp: targetBeforeStrategy,
              toTemp: thermalStrategy.targetTemp,
              reasoning: thermalStrategy.reasoning,
              estimatedSavings: thermalStrategy.estimatedSavings,
              confidence: thermalStrategy.confidenceLevel
            });
          }
          
          // Use pattern-based hot water scheduling if we have usage data
          if (this.hotWaterUsagePattern && this.hotWaterUsagePattern.dataPoints > 50) {
            const currentHour = this.timeZoneHelper.getLocalTime().hour;
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

      // Reapply constraints after any secondary adjustments (e.g., thermal strategy)
      if (thermalStrategy && thermalStrategy.action !== 'maintain') {
        targetTemp = Math.max(this.minTemp, Math.min(this.maxTemp, targetTemp));
        const maxChangeAfterStrategy = this.tempStep;
        if (Math.abs(targetTemp - safeCurrentTarget) > maxChangeAfterStrategy) {
          targetTemp = safeCurrentTarget + (targetTemp > safeCurrentTarget ? maxChangeAfterStrategy : -maxChangeAfterStrategy);
          adjustmentReason += ` (limited to ${maxChangeAfterStrategy}°C step after thermal strategy)`;
        }
        targetTemp = Math.round(targetTemp / this.tempStep) * this.tempStep;

        tempDifference = Math.abs(targetTemp - safeCurrentTarget);
        isSignificantChange = tempDifference >= this.deadband;
        logData.targetTemp = targetTemp.toFixed(1);
        logData.tempDifference = tempDifference.toFixed(1);
        logData.isSignificantChange = isSignificantChange;
      }

      this.logger.log('Enhanced optimization result:', logData);

      // Handle secondary zone optimization (Zone2)
      const deviceSupportsZone2 = deviceState.SetTemperatureZone2 !== undefined;
      if (this.enableZone2 && !deviceSupportsZone2) {
        this.logger.log('WARNING: Zone2 temperature optimization enabled in settings, but device does not expose Zone2');
      }

      let zone2Result: SecondaryZoneResult | null = null;
      if (this.enableZone2 && deviceSupportsZone2) {
        try {
          const currentTempZone2 = deviceState.RoomTemperatureZone2 ?? currentTemp ?? 21;
          const currentTargetZone2 = deviceState.SetTemperatureZone2 ?? currentTempZone2;

          let zone2Target = await this.calculateOptimalTemperature(
            currentPrice,
            avgPrice,
            minPrice,
            maxPrice,
            currentTempZone2
          );

          if (weatherAdjustment && Math.abs(weatherAdjustment.adjustment) >= 0.1) {
            zone2Target += weatherAdjustment.adjustment;
          }

          zone2Target = Math.max(this.minTempZone2, Math.min(this.maxTempZone2, zone2Target));

          const maxZone2Change = this.tempStepZone2;
          if (Math.abs(zone2Target - currentTargetZone2) > maxZone2Change) {
            zone2Target = currentTargetZone2 + (zone2Target > currentTargetZone2 ? maxZone2Change : -maxZone2Change);
          }

          zone2Target = Math.round(zone2Target / this.tempStepZone2) * this.tempStepZone2;

          const zone2Deadband = Math.max(0.1, this.tempStepZone2 / 2);
          const zone2Change = Math.abs(zone2Target - currentTargetZone2);

          let zone2Reason = 'No change needed';
          if (zone2Target < currentTargetZone2) {
            zone2Reason = weatherAdjustment && typeof weatherAdjustment.reason === 'string'
              ? `Tibber price level ${priceLevel} and ${weatherAdjustment.reason.toLowerCase()} – reducing Zone2 temperature`
              : `Tibber price level ${priceLevel} – reducing Zone2 temperature`;
          } else if (zone2Target > currentTargetZone2) {
            zone2Reason = weatherAdjustment && typeof weatherAdjustment.reason === 'string'
              ? `Tibber price level ${priceLevel} and ${weatherAdjustment.reason.toLowerCase()} – increasing Zone2 temperature`
              : `Tibber price level ${priceLevel} – increasing Zone2 temperature`;
          }

          if (zone2Change >= zone2Deadband) {
            await this.melCloud.setZoneTemperature(this.deviceId, this.buildingId, zone2Target, 2);
            this.logger.log(`Zone2 temperature adjusted from ${currentTargetZone2.toFixed(1)}°C to ${zone2Target.toFixed(1)}°C`);
          } else {
            this.logger.log(`Zone2 change ${zone2Change.toFixed(2)}°C below deadband ${zone2Deadband.toFixed(2)}°C – keeping ${currentTargetZone2.toFixed(1)}°C`);
          }

          zone2Result = {
            fromTemp: currentTargetZone2,
            toTemp: zone2Target,
            reason: zone2Reason,
            targetOriginal: currentTargetZone2,
            targetTemp: zone2Target,
            indoorTemp: currentTempZone2,
            success: zone2Change >= zone2Deadband
          };
        } catch (zone2Error) {
          this.logger.error('Zone2 optimization failed', zone2Error as Error);
        }
      }

      // Handle hot water tank optimization
      let tankResult: TankOptimizationResult | null = null;
      const currentTankTarget = deviceState.SetTankWaterTemperature;
      if (this.enableTankControl && currentTankTarget !== undefined) {
        try {
          let tankTarget = currentTankTarget;
          let tankReason = 'Maintaining current tank temperature';

          const hotWaterService = (this.homey as any)?.hotWaterService;
          if (hotWaterService && typeof hotWaterService.getOptimalTankTemperature === 'function') {
            try {
              tankTarget = hotWaterService.getOptimalTankTemperature(
                this.minTankTemp,
                this.maxTankTemp,
                currentPrice,
                priceLevel
              );
              tankReason = `Optimized using learned hot water usage patterns with Tibber price level ${priceLevel}`;
            } catch (hwErr) {
              this.logger.error('Hot water service optimization failed, falling back to price heuristics', hwErr as Error);
            }
          }

          if (tankTarget === currentTankTarget) {
            if (priceLevel === 'VERY_CHEAP' || priceLevel === 'CHEAP') {
              tankTarget = this.maxTankTemp;
              tankReason = `Tibber price level ${priceLevel}, pre-heating tank`;
            } else if (priceLevel === 'EXPENSIVE' || priceLevel === 'VERY_EXPENSIVE') {
              tankTarget = this.minTankTemp;
              tankReason = `Tibber price level ${priceLevel}, conserving energy`;
            } else {
              tankTarget = (this.minTankTemp + this.maxTankTemp) / 2;
              tankReason = `Tibber price level ${priceLevel}, maintaining mid-range tank temperature`;
            }
          }

          tankTarget = Math.max(this.minTankTemp, Math.min(this.maxTankTemp, tankTarget));
          tankTarget = Math.round(tankTarget / this.tankTempStep) * this.tankTempStep;

          const tankDeadband = Math.max(0.2, this.tankTempStep / 2);
          const tankChange = Math.abs(tankTarget - currentTankTarget);

          const changeApplied = tankChange >= tankDeadband;

          if (changeApplied) {
            try {
              await this.melCloud.setTankTemperature(this.deviceId, this.buildingId, tankTarget);
              this.logger.log(`Tank temperature adjusted from ${currentTankTarget.toFixed(1)}°C to ${tankTarget.toFixed(1)}°C`);
              tankStatus = { setpointApplied: true };
              tankResult = {
                fromTemp: currentTankTarget,
                toTemp: tankTarget,
                reason: tankReason,
                success: true,
                changed: true
              };
            } catch (error) {
              const errMsg = (error instanceof Error) ? error.message : String(error);
              this.logger.error('Failed to update MELCloud tank temperature:', error);
              tankStatus = { setpointApplied: false, error: errMsg };
              tankResult = {
                fromTemp: currentTankTarget,
                toTemp: tankTarget,
                reason: `${tankReason} (command failed)`,
                success: false,
                changed: true
              };
            }
          } else {
            this.logger.log(`Tank change ${tankChange.toFixed(2)}°C below deadband ${tankDeadband.toFixed(2)}°C – keeping ${currentTankTarget.toFixed(1)}°C`);
            tankResult = {
              fromTemp: currentTankTarget,
              toTemp: currentTankTarget,
              reason: tankReason,
              success: true,
              changed: false
            };
          }
        } catch (tankError) {
          this.logger.error('Tank optimization failed', tankError as Error);
          tankStatus = {
            setpointApplied: false,
            error: (tankError instanceof Error) ? tankError.message : String(tankError)
          };
        }
      }

      // Anti–short-cycling lockout: avoid frequent setpoint changes
      let lockoutActive = false;
      try {
        const last = (this.homey && Number(this.homey.settings.get('last_setpoint_change_ms'))) || this.lastSetpointChangeMs || 0;
        const sinceMin = last > 0 ? (Date.now() - last) / 60000 : Infinity;
        lockoutActive = sinceMin < this.minSetpointChangeMinutes;
        if (lockoutActive) {
          this.logger.log(`Setpoint change lockout active (${sinceMin.toFixed(1)}m since last < ${this.minSetpointChangeMinutes}m)`);
        }
      } catch {}

      // Apply temperature change if significant and not within lockout window
      if (isSignificantChange && !lockoutActive) {
        try {
          await this.melCloud.setDeviceTemperature(this.deviceId, this.buildingId, targetTemp);
          setpointApplied = true;
          melCloudSetpointApplied = true;
        } catch (error) {
          melCloudSetpointApplied = false;
          melCloudSetpointError = (error instanceof Error) ? error.message : String(error);
          this.logger.error('Failed to apply MELCloud temperature change during optimization:', error);
        }
        if (setpointApplied) {
          try {
            const now = Date.now();
            this.lastSetpointChangeMs = now;
            if (this.homey) this.homey.settings.set('last_setpoint_change_ms', now);
          } catch {}
        }
      }

      if (setpointApplied) {
        const savingsZone1 = await this.calculateRealHourlySavings(
          safeCurrentTarget,
          targetTemp,
          currentPrice,
          optimizationResult.metrics,
          'zone1'
        );
        let additionalSavings = 0;
        try {
          if (zone2Result && typeof zone2Result.fromTemp === 'number' && typeof zone2Result.toTemp === 'number') {
            additionalSavings += await this.calculateRealHourlySavings(
              zone2Result.fromTemp,
              zone2Result.toTemp,
              currentPrice,
              optimizationResult.metrics,
              'zone2'
            );
          }
          if (tankResult && typeof tankResult.fromTemp === 'number' && typeof tankResult.toTemp === 'number') {
            additionalSavings += await this.calculateRealHourlySavings(
              tankResult.fromTemp,
              tankResult.toTemp,
              currentPrice,
              optimizationResult.metrics,
              'tank'
            );
          }
        } catch (savingsErr) {
          this.logger.warn('Failed to calculate secondary savings contributions', savingsErr as Error);
        }
        const savingsNumeric = savingsZone1 + additionalSavings;

        this.logger.log(`Enhanced temperature adjusted from ${safeCurrentTarget.toFixed(1)}°C to ${targetTemp.toFixed(1)}°C`, {
          reason: adjustmentReason,
          savingsEstimated: this.estimateCostSavings(targetTemp, safeCurrentTarget, currentPrice, avgPrice, optimizationResult.metrics),
          savingsNumeric
        });

        return {
          success: true,
          action: 'temperature_adjusted',
          fromTemp: safeCurrentTarget,
          toTemp: targetTemp,
          reason: adjustmentReason,
          indoorTemp: currentTemp ?? null,
          outdoorTemp,
          priceData: {
            current: currentPrice,
            average: avgPrice,
            min: minPrice,
            max: maxPrice,
            level: priceLevel,
            percentile: pricePercentile,
            nextHour: nextHourPrice
          },
          savings: savingsNumeric,
          energyMetrics: optimizationResult.metrics,
          weather: weatherInfo || undefined,
          hotWaterAction: hotWaterAction || undefined,
          priceForecast: priceForecast ? {
            position: priceForecast.currentPosition,
            recommendation: priceForecast.recommendation,
            upcomingChanges: priceForecast.upcomingChanges,
            bestTimes: priceForecast.bestTimes,
            worstTimes: priceForecast.worstTimes
          } : undefined,
          zone2Data: zone2Result || undefined,
          tankData: tankResult || undefined,
          melCloudStatus: {
            setpointApplied: true
          },
          tankStatus
        };
      }

      const failureOrHoldReason = !melCloudSetpointApplied && melCloudSetpointError
        ? `Temperature change requested but MELCloud rejected: ${melCloudSetpointError}`
        : lockoutActive
          ? `Setpoint change lockout (${this.minSetpointChangeMinutes}m) to prevent cycling`
          : `Temperature difference ${tempDifference.toFixed(1)}°C below deadband ${this.deadband}°C`;

      if (!setpointApplied) {
        // No change either due to small delta or lockout
        this.logger.log(`No enhanced temperature adjustment needed (difference: ${tempDifference.toFixed(1)}°C < deadband: ${this.deadband}°C)`);

        let savingsNumericNoChange = 0;
        try {
          if (zone2Result && typeof zone2Result.fromTemp === 'number' && typeof zone2Result.toTemp === 'number') {
            savingsNumericNoChange += await this.calculateRealHourlySavings(
              zone2Result.fromTemp,
              zone2Result.toTemp,
              currentPrice,
              optimizationResult.metrics,
              'zone2'
            );
          }
          if (tankResult && typeof tankResult.fromTemp === 'number' && typeof tankResult.toTemp === 'number') {
            savingsNumericNoChange += await this.calculateRealHourlySavings(
              tankResult.fromTemp,
              tankResult.toTemp,
              currentPrice,
              optimizationResult.metrics,
              'tank'
            );
          }
        } catch (savingsErr) {
          this.logger.warn('Failed to calculate secondary savings contributions (no change path)', savingsErr as Error);
        }
        return {
          success: true,
          action: 'no_change',
          fromTemp: safeCurrentTarget,
          toTemp: safeCurrentTarget,
          reason: failureOrHoldReason,
          indoorTemp: currentTemp ?? null,
          outdoorTemp,
          priceData: {
            current: currentPrice,
            average: avgPrice,
            min: minPrice,
            max: maxPrice,
            level: priceLevel,
            percentile: pricePercentile,
            nextHour: nextHourPrice
          },
          savings: savingsNumericNoChange,
          energyMetrics: optimizationResult.metrics,
          weather: weatherInfo || undefined,
          hotWaterAction: hotWaterAction || undefined,
          priceForecast: priceForecast ? {
            position: priceForecast.currentPosition,
            recommendation: priceForecast.recommendation,
            upcomingChanges: priceForecast.upcomingChanges,
            bestTimes: priceForecast.bestTimes,
            worstTimes: priceForecast.worstTimes
          } : undefined,
          zone2Data: zone2Result || undefined,
          tankData: tankResult || undefined,
          melCloudStatus: {
            setpointApplied: melCloudSetpointApplied,
            error: melCloudSetpointError
          },
          tankStatus
        };
      }

    } catch (error: unknown) {
      const err = (error instanceof Error) ? error : new Error(String(error as any));
      this.logger.error('Enhanced optimization failed', err);
      const message = err.message;
      return {
        success: false,
        action: 'no_change',
        fromTemp: this.minTemp,
        toTemp: this.minTemp,
        reason: `Enhanced optimization failed: ${message}`,
        priceData: {
          current: 0,
          average: 0,
          min: 0,
          max: 0
        }
      };
    }
    return {
      success: false,
      action: 'no_change',
      fromTemp: this.minTemp,
      toTemp: this.minTemp,
      reason: 'Enhanced optimization exited unexpectedly',
      priceData: {
        current: 0,
        average: 0,
        min: 0,
        max: 0
      }
    };
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

    const currencyCode = (this.homey as any)?.settings?.get('currency') || (this.homey as any)?.settings?.get('currency_code') || 'NOK';
    return `Estimated ${tempDifference > 0 ? 'cost increase' : 'savings'}: ${Math.abs(weeklyCostImpact).toFixed(2)} ${currencyCode}/week`;
  }

  /**
   * Calculate hourly cost savings using real energy metrics (numeric result)
   * Falls back to simple heuristic when metrics are not available
   */
  public async calculateRealHourlySavings(
    oldTemp: number,
    newTemp: number,
    currentPrice: number,
    metrics?: OptimizationMetrics,
    kind: 'zone1' | 'zone2' | 'tank' = 'zone1'
  ): Promise<number> {
    try {
      const tempDiff = newTemp - oldTemp;
      if (!isFinite(tempDiff) || tempDiff === 0 || !isFinite(currentPrice)) return 0;

      if (!metrics) {
        // Fallback to simple calculation if we don't have metrics
        return this.calculateSavings(oldTemp, newTemp, currentPrice);
      }

      // Base daily consumption (kWh/day)
      let dailyConsumption = metrics.dailyEnergyConsumption;
      if (!isFinite(dailyConsumption) || dailyConsumption <= 0) {
        return this.calculateSavings(oldTemp, newTemp, currentPrice);
      }

      // Seasonal factors
      let perDegFactor: number; // fraction of daily energy per °C
      if (metrics.seasonalMode === 'winter') perDegFactor = 0.15 * (metrics.heatingEfficiency || 0.5);
      else if (metrics.seasonalMode === 'summer') perDegFactor = 0.05;
      else perDegFactor = 0.10;

      // Surface adjustments
      if (kind === 'zone2') perDegFactor *= 0.9;
      if (kind === 'tank') perDegFactor *= 0.5;

      const dailyEnergyImpact = Math.abs(tempDiff) * perDegFactor * dailyConsumption; // kWh
      const dailyCostImpact = dailyEnergyImpact * (tempDiff > 0 ? currentPrice : -currentPrice);
      const hourlyCostImpact = dailyCostImpact / 24;
      return Number.isFinite(hourlyCostImpact) ? hourlyCostImpact : 0;
    } catch {
      return this.calculateSavings(oldTemp, newTemp, currentPrice);
    }
  }

  /**
   * Project daily savings using Tibber price data and historical optimizations
   */
  public async calculateDailySavings(
    hourlySavings: number,
    historicalOptimizations: OptimizationData[] = []
  ): Promise<number> {
    try {
      const result = await this.calculateEnhancedDailySavingsUsingTibber(
        hourlySavings,
        historicalOptimizations
      );
      return typeof result?.dailySavings === 'number'
        ? result.dailySavings
        : hourlySavings * 24;
    } catch (error) {
      this.logger.error('Error calculating daily savings projection:', error);
      return hourlySavings * 24;
    }
  }

  /**
   * Retrieve in-memory footprint details from the thermal model service
   */
  public getThermalModelMemoryUsage(): ReturnType<ThermalModelService['getMemoryUsage']> | null {
    if (!this.thermalModelService) {
      return null;
    }
    return this.thermalModelService.getMemoryUsage();
  }

  /**
   * Force cleanup/aggregation in the thermal model service
   */
  public forceThermalDataCleanup(): ReturnType<ThermalModelService['forceDataCleanup']> | { success: false; message: string } {
    if (!this.thermalModelService) {
      return { success: false, message: 'Thermal model service not initialized' };
    }
    return this.thermalModelService.forceDataCleanup();
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
    analysis?: string;
  }> {
    this.logger.log('Starting weekly calibration');

    try {
      const previousK = this.thermalModel.K;
      const previousS = this.thermalModel.S;

      // If using thermal learning model, update it with collected data
      if (this.useThermalLearning && this.thermalModelService) {
        try {
          // The thermal model service automatically updates its model
          // We just need to get the current characteristics
          const characteristics = this.thermalModelService.getThermalCharacteristics();
          const confidence = typeof characteristics.modelConfidence === 'number'
            ? characteristics.modelConfidence
            : 0;

          // Update our simple K-factor based on the thermal model's characteristics
          // This maintains compatibility with the existing system
          const baseK = previousK;
          const newK = confidence > 0.3
            ? (characteristics.heatingRate / 0.5) * baseK
            : baseK;

          const thermalMass = characteristics.thermalMass;
          const newS = (typeof thermalMass === 'number' && Number.isFinite(thermalMass))
            ? thermalMass
            : (typeof previousS === 'number' ? previousS : 0.1);

          // Update thermal model
          this.setThermalModel(newK, newS);

          const heatingRate = typeof characteristics.heatingRate === 'number' && Number.isFinite(characteristics.heatingRate)
            ? characteristics.heatingRate
            : NaN;
          const coolingRate = typeof characteristics.coolingRate === 'number' && Number.isFinite(characteristics.coolingRate)
            ? characteristics.coolingRate
            : NaN;

          this.logger.log(`Calibrated thermal model using learning data: K=${newK.toFixed(2)}, S=${newS.toFixed(2)}`);
          this.logger.log(
            `Thermal characteristics: Heating rate=${Number.isFinite(heatingRate) ? heatingRate.toFixed(3) : 'n/a'}, ` +
            `Cooling rate=${Number.isFinite(coolingRate) ? coolingRate.toFixed(3) : 'n/a'}, ` +
            `Thermal mass=${Number.isFinite(thermalMass) ? thermalMass.toFixed(2) : 'n/a'}`
          );

          // Return result
          return {
            oldK: previousK,
            newK,
            oldS: previousS,
            newS,
            timestamp: new Date().toISOString(),
            thermalCharacteristics: characteristics,
            analysis: `Learning-based calibration (confidence ${(confidence * 100).toFixed(0)}%)`
          };
        } catch (modelError) {
          this.logger.error('Error updating thermal model from learning data:', modelError);
          // Fall back to basic calibration
        }
      }

      // Basic calibration (used as fallback or when thermal learning is disabled)
      const baseK = previousK;
      const newK = baseK * (0.9 + Math.random() * 0.2);
      const newS = typeof previousS === 'number' ? previousS : (this.thermalModel.S || 0.1);

      // Update thermal model
      this.setThermalModel(newK, newS);

      this.logger.log(`Calibrated thermal model using basic method: K=${newK.toFixed(2)}, S=${newS.toFixed(2)}`);

      // Return result
      return {
        oldK: previousK,
        newK,
        oldS: previousS,
        newS,
        timestamp: new Date().toISOString(),
        method: 'basic',
        analysis: 'Basic calibration applied (learning data unavailable)'
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

          // In summer mode, further reduce heating temperature
          if (isSummerMode) {
            const summerAdjustment = -0.5 * this.copWeight; // Reduce heating in summer
            targetTemp += summerAdjustment;
            this.logger.log(`Applied summer mode adjustment: ${summerAdjustment.toFixed(2)}°C`);
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
  public calculateSavings(
    oldTemp: number,
    newTemp: number,
    currentPrice: number,
    kind: 'zone1' | 'zone2' | 'tank' = 'zone1'
  ): number {
    const tempDiff = Number(oldTemp) - Number(newTemp);
    if (!Number.isFinite(tempDiff) || !Number.isFinite(currentPrice)) return 0;

    const gridFee: number = Number(this.homey?.settings.get('grid_fee_per_kwh')) || 0;
    const effectivePrice = currentPrice + (Number.isFinite(gridFee) ? gridFee : 0);

    // Use real daily consumption data from MELCloud when available, fallback to 1.0 kWh/h
    let baseHourlyConsumptionKWh = 1.0;

    try {
      const dailyFromMetrics = this.optimizationMetrics?.dailyEnergyConsumption;
      if (Number.isFinite(dailyFromMetrics) && (dailyFromMetrics || 0) > 0) {
        baseHourlyConsumptionKWh = Math.max(0, (dailyFromMetrics as number) / 24);
      }
    } catch (_) { /* keep default fallback */ }

    const perDegPct = kind === 'tank' ? 2.0 : kind === 'zone2' ? 4.0 : 5.0;
    const kindMultiplier = kind === 'tank' ? 0.8 : kind === 'zone2' ? 0.9 : 1.0;
    const energySavingPercent = tempDiff * perDegPct * kindMultiplier;
    const savings = (energySavingPercent / 100) * baseHourlyConsumptionKWh * effectivePrice;
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
    historicalOptimizations: OptimizationData[] = [],
    futurePriceFactors?: number[]
  ): SavingsCalculationResult {
    return this.enhancedSavingsCalculator.calculateEnhancedDailySavings(
      currentHourSavings,
      historicalOptimizations,
      this.timeZoneHelper.getLocalTime().hour,
      futurePriceFactors
    );
  }

  /**
   * Calculate enhanced daily savings using the configured price provider (price-aware projection)
   */
  async calculateEnhancedDailySavingsUsingTibber(
    currentHourSavings: number,
    historicalOptimizations: OptimizationData[] = []
  ): Promise<SavingsCalculationResult> {
    try {
      const currentHour = this.timeZoneHelper.getLocalTime().hour;
      const gridFee: number = Number(this.homey?.settings.get('grid_fee_per_kwh')) || 0;
      if (!this.priceProvider) {
        throw new Error('Price provider not initialized');
      }
      const pd = await this.priceProvider.getPrices();
      const now = new Date();
      const currentEffective = (Number(pd.current?.price) || 0) + (Number.isFinite(gridFee) ? gridFee : 0);
      let priceFactors: number[] | undefined = undefined;
      if (currentEffective > 0 && Array.isArray(pd.prices)) {
        const upcoming = pd.prices.filter(p => new Date(p.time) > now);
        priceFactors = upcoming.map(p => {
          const eff = (Number(p.price) || 0) + (Number.isFinite(gridFee) ? gridFee : 0);
          return currentEffective > 0 ? eff / currentEffective : 1;
        });
      }
      return this.enhancedSavingsCalculator.calculateEnhancedDailySavings(
        currentHourSavings,
        historicalOptimizations,
        currentHour,
        priceFactors
      );
    } catch (_) {
      // Fallback to non-price-aware calculation
      return this.calculateEnhancedDailySavings(currentHourSavings, historicalOptimizations);
    }
  }

  /**
   * Calculate enhanced daily savings with fixed baseline comparison
   * @param currentHourSavings Current hour's savings
   * @param historicalOptimizations Historical optimization data
   * @param actualConsumptionKWh Actual energy consumption for baseline comparison
   * @param actualCost Actual cost for baseline comparison
   * @param enableBaseline Whether to enable baseline comparison
   * @returns Enhanced savings calculation result with baseline comparison
   */
  async calculateEnhancedDailySavingsWithBaseline(
    currentHourSavings: number,
    historicalOptimizations: OptimizationData[] = [],
    actualConsumptionKWh: number = 1.0,
    actualCost: number = currentHourSavings,
    enableBaseline: boolean = true
  ): Promise<SavingsCalculationResult> {
    try {
      // Get current price
      const gridFee: number = Number(this.homey?.settings.get('grid_fee_per_kwh')) || 0;
      let pricePerKWh = 1.0; // Default fallback
      let priceFactors: number[] | undefined = undefined;
      
      if (this.priceProvider) {
        const pd = await this.priceProvider.getPrices();
        const now = new Date();
        const currentEffective = (Number(pd.current?.price) || 0) + (Number.isFinite(gridFee) ? gridFee : 0);
        if (currentEffective > 0) {
          pricePerKWh = currentEffective;
          
          // Also get price factors for future projections
          if (Array.isArray(pd.prices)) {
            const upcoming = pd.prices.filter(p => new Date(p.time) > now);
            priceFactors = upcoming.map(p => {
              const eff = (Number(p.price) || 0) + (Number.isFinite(gridFee) ? gridFee : 0);
              return currentEffective > 0 ? eff / currentEffective : 1;
            });
          }
        }
      }

      // Get outdoor temperature data for baseline calculation
      const outdoorTemps: number[] = [];
      if (this.weatherApi && enableBaseline) {
        try {
          const weather = await this.weatherApi.getCurrentWeather();
          if (weather && weather.temperature) {
            outdoorTemps.push(weather.temperature);
          }
        } catch (error) {
          this.logger.error('Error getting weather for baseline calculation:', error);
        }
      }

      // Get intelligent baseline configuration (automatically determined)
      const baselineConfig = this.enhancedSavingsCalculator.getDefaultBaselineConfig();

      return this.enhancedSavingsCalculator.calculateEnhancedDailySavingsWithBaseline(
        currentHourSavings,
        historicalOptimizations,
        this.timeZoneHelper.getLocalTime().hour,
        priceFactors,
        {
          actualConsumptionKWh,
          actualCost,
          pricePerKWh,
          outdoorTemps,
          baselineConfig,
          enableBaseline: enableBaseline && this.enhancedSavingsCalculator.hasBaselineCapability()
        }
      );
    } catch (error) {
      this.logger.error('Error in enhanced daily savings with baseline:', error);
      // Fallback to standard calculation
      return this.calculateEnhancedDailySavings(currentHourSavings, historicalOptimizations);
    }
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
   * Cleanup method to properly stop thermal model service and other resources
   * Prevents memory leaks when the optimizer is destroyed
   */
  public cleanup(): void {
    try {
      if (this.thermalModelService) {
        this.thermalModelService.stop();
        this.thermalModelService = null;
        this.logger.log('Thermal model service stopped and cleaned up');
      }

      if (this.copHelper) {
        // COP helper doesn't have intervals to clean, but clear the reference
        this.copHelper = null;
        this.logger.log('COP helper reference cleared');
      }

      this.logger.log('Optimizer cleanup completed successfully');
    } catch (error) {
      this.logger.error('Error during optimizer cleanup:', error);
    }
  }
}
