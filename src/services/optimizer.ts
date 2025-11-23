import { randomUUID } from 'crypto';
import { MelCloudApi } from './melcloud-api';
import { ThermalModelService } from './thermal-model';
import { COPHelper } from './cop-helper';
import { COPPredictor } from './cop-predictor';
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
import { applySetpointConstraints } from '../util/setpoint-constraints';
import { computePlanningBias, updateThermalResponse } from './planning-utils';
import { AdaptiveParametersLearner } from './adaptive-parameters';
import { classifyPriceUnified, classifyPriceAgainstHistorical, resolvePriceThresholds } from './price-classifier';
import { PriceHistoryTracker } from './price-history-tracker';

const DEFAULT_HOT_WATER_PEAK_HOURS = [6, 7, 8]; // Morning fallback window when usage data is flat
const MIN_SAVINGS_FOR_LEARNING = 0.05; // Minimum savings (SEK-equivalent) to trigger learning on no-change path

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
  // Added for Mode-Aware Optimization compatibility
  targetTemp?: number;
  priceNow?: number;
  priceAvg?: number;
  priceMin?: number;
  priceMax?: number;
  targetOriginal?: number | null;
  comfort?: number;
  timestamp?: string;
  kFactor?: number;
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
  changed?: boolean;
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
  private minSetpointChangeMinutes: number = 30;
  private lastSetpointChangeMs: number | null = null;
  private lastIssuedSetpointC: number | null = null;
  private lastZone2SetpointChangeMs: number | null = null;
  private lastZone2IssuedSetpointC: number | null = null;
  private lastTankSetpointChangeMs: number | null = null;
  private lastTankIssuedSetpointC: number | null = null;
  // Secondary zone constraints
  private enableZone2: boolean = false;
  private minTempZone2: number = 18;
  private maxTempZone2: number = 22;
  private tempStepZone2: number = 0.5;
  // Hot water tank constraints
  private enableTankControl: boolean = false;
  private minTankTemp: number = 40;
  private maxTankTemp: number = 50;
  private tankTempStep: number = 0.5;
  private thermalModelService: ThermalModelService | null = null;
  private useThermalLearning: boolean = false;
  private copHelper: COPHelper | null = null;
  private copPredictor: COPPredictor | null = null;
  private copWeight: number = 0.3;
  private autoSeasonalMode: boolean = true;
  private summerMode: boolean = false;
  private preheatCheapPercentile: number = 0.25; // User-configurable cheap price threshold
  private enhancedSavingsCalculator: EnhancedSavingsCalculator;
  private lastEnergyData: RealEnergyData | null = null;
  private optimizationMetrics: OptimizationMetrics | null = null;
  private timeZoneHelper!: TimeZoneHelper;
  private priceHistoryTracker: PriceHistoryTracker | null = null;

  // Home/Away state management
  private occupied: boolean = true;

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
  private adaptiveParametersLearner?: AdaptiveParametersLearner;

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
        // COP Predictor for Flow/Curve temperature optimization
        if (this.homey) {
          // Create a logger wrapper that includes warn method for COPPredictor
          const copLogger = {
            // @ts-ignore - Simple pass-through, TypeScript spread checking too strict
            log: (...args: unknown[]) => this.logger.log(...args),
            // @ts-ignore - Simple pass-through, TypeScript spread checking too strict
            warn: (...args: unknown[]) => this.logger.log('[WARN]', ...args),
            // @ts-ignore - Simple pass-through, TypeScript spread checking too strict
            error: (...args: unknown[]) => this.logger.error(...args)
          };
          this.copPredictor = new COPPredictor(homey, copLogger);
        }
        this.logger.log('COP helper initialized');

        // Load COP settings from Homey settings
        this.copWeight = homey.settings.get('cop_weight') || 0.3;
        this.autoSeasonalMode = homey.settings.get('auto_seasonal_mode') !== false;
        this.summerMode = homey.settings.get('summer_mode') === true;

        // Load price threshold settings
        const preheatPercentile = Number(homey.settings.get('preheat_cheap_percentile'));
        if (!Number.isNaN(preheatPercentile) && preheatPercentile >= 0.05 && preheatPercentile <= 0.5) {
          this.preheatCheapPercentile = preheatPercentile;
        }

        this.logger.log(`COP settings loaded - Weight: ${this.copWeight}, Auto Seasonal: ${this.autoSeasonalMode}, Summer Mode: ${this.summerMode}`);
        this.logger.log(`Price threshold settings loaded - Cheap Percentile: ${this.preheatCheapPercentile} (${(this.preheatCheapPercentile * 100).toFixed(1)}th percentile)`);

        // Initialize TimeZoneHelper with user settings
        const tzOffset = homey.settings.get('time_zone_offset') || 1; // Settings page default: UTC+01:00
        const useDST = homey.settings.get('use_dst') || false;
        const timeZoneName = homey.settings.get('time_zone_name');
        this.timeZoneHelper = new TimeZoneHelper(
          this.logger,
          Number(tzOffset),
          Boolean(useDST),
          typeof timeZoneName === 'string' && timeZoneName.length > 0 ? timeZoneName : undefined
        );
        this.logger.log('TimeZoneHelper initialized for Optimizer');

        // Initialize adaptive parameters learner
        this.adaptiveParametersLearner = new AdaptiveParametersLearner(homey);
        this.logger.log('Adaptive parameters learner initialized');

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

        // Load COP guards state from settings
        const copGuards = homey.settings.get('cop_guards_v1');
        if (copGuards && typeof copGuards === 'object') {
          if (Array.isArray(copGuards.history)) {
            this.heatingCOPRange.history = copGuards.history.slice(-100); // Ensure max 100
          }
          if (typeof copGuards.minObserved === 'number') {
            this.heatingCOPRange.minObserved = copGuards.minObserved;
          }
          if (typeof copGuards.maxObserved === 'number') {
            this.heatingCOPRange.maxObserved = copGuards.maxObserved;
          }
          if (typeof copGuards.updateCount === 'number') {
            this.heatingCOPRange.updateCount = copGuards.updateCount;
          }
          this.logger.log(`Heating COP guards restored - Range: ${this.heatingCOPRange.minObserved.toFixed(2)}-${this.heatingCOPRange.maxObserved.toFixed(2)}, ${this.heatingCOPRange.history.length} samples`);
        }

        const copGuardsHotWater = homey.settings.get('cop_guards_hotwater_v1');
        if (copGuardsHotWater && typeof copGuardsHotWater === 'object') {
          if (Array.isArray(copGuardsHotWater.history)) {
            this.hotWaterCOPRange.history = copGuardsHotWater.history.slice(-100); // Ensure max 100
          }
          if (typeof copGuardsHotWater.minObserved === 'number') {
            this.hotWaterCOPRange.minObserved = copGuardsHotWater.minObserved;
          }
          if (typeof copGuardsHotWater.maxObserved === 'number') {
            this.hotWaterCOPRange.maxObserved = copGuardsHotWater.maxObserved;
          }
          if (typeof copGuardsHotWater.updateCount === 'number') {
            this.hotWaterCOPRange.updateCount = copGuardsHotWater.updateCount;
          }
          this.logger.log(`Hot Water COP guards restored - Range: ${this.hotWaterCOPRange.minObserved.toFixed(2)}-${this.hotWaterCOPRange.maxObserved.toFixed(2)}, ${this.hotWaterCOPRange.history.length} samples`);
        }

        // Load home/away state
        const occupiedSetting = homey.settings.get('occupied');
        this.occupied = occupiedSetting !== false; // Default to true if not set
        this.logger.log(`Home/Away state loaded - Currently: ${this.occupied ? 'Home (Occupied)' : 'Away'}`);

        // Initialize thermal mass model from historical data (async, non-blocking)
        this.initializeThermalMassFromHistory().catch(error => {
          this.logger.log('Failed to initialize thermal mass from history (this is normal during initial setup):', error);
        });

      } catch (error) {
        this.logger.error('Failed to initialize COP helper:', error);
        this.copHelper = null;
      }

      // Initialize price history tracker for both Tibber and ENTSO-E
      // Tibber: Uses native levels primarily, but historical as fallback
      // ENTSO-E: Uses historical after 7 days, percentile before that
      if (this.priceProvider) {
        try {
          this.priceHistoryTracker = new PriceHistoryTracker(homey, this.logger);
          const providerType = this.priceProvider.constructor.name === 'TibberApi' ? 'Tibber' : 'ENTSO-E';
          this.logger.log(`Price history tracker initialized (${providerType} mode)`);
        } catch (error) {
          this.logger.error('Failed to initialize price history tracker:', error);
          this.priceHistoryTracker = null;
        }
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
   * Set home/away occupancy state
   * @param occupied True for home (occupied), false for away
   */
  setOccupied(occupied: boolean): void {
    const wasOccupied = this.occupied;
    this.occupied = occupied;

    if (this.homey) {
      this.homey.settings.set('occupied', occupied);
    }

    this.logger.log(`Home/Away state changed: ${wasOccupied ? 'Home' : 'Away'} → ${occupied ? 'Home (Occupied)' : 'Away'}`);
  }

  /**
   * Refresh occupancy state from settings (called when settings change)
   */
  refreshOccupancyFromSettings(): void {
    if (!this.homey) return;

    const occupiedSetting = this.homey.settings.get('occupied');
    const newOccupied = occupiedSetting !== false; // Default to true if not set

    if (newOccupied !== this.occupied) {
      this.occupied = newOccupied;
      this.logger.log(`Home/Away state refreshed from settings: ${this.occupied ? 'Home (Occupied)' : 'Away'}`);
    }
  }

  /**
   * Get current home/away occupancy state
   * @returns True if home (occupied), false if away
   */
  isOccupied(): boolean {
    return this.occupied;
  }

  /**
   * Get the appropriate comfort band (min/max temperatures) based on current occupancy
   * @returns Object with minTemp and maxTemp based on occupied/away settings
   */
  private getCurrentComfortBand(): { minTemp: number; maxTemp: number } {
    if (!this.homey) {
      // Fallback to default constraints if no homey instance
      return { minTemp: this.minTemp, maxTemp: this.maxTemp };
    }

    const toNumber = (value: unknown): number | null => {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : null;
    };

    if (this.occupied) {
      // Use occupied (home) comfort band - defaults match settings page HTML
      const comfortLowerOccupied = toNumber(this.homey.settings.get('comfort_lower_occupied')) ?? 20.0;
      const comfortUpperOccupied = toNumber(this.homey.settings.get('comfort_upper_occupied')) ?? 21.0;
      return {
        minTemp: Math.max(comfortLowerOccupied, 16),
        maxTemp: Math.min(comfortUpperOccupied, 26)
      };
    } else {
      // Use away comfort band - defaults match settings page HTML
      const comfortLowerAway = toNumber(this.homey.settings.get('comfort_lower_away')) ?? 19.0;
      const comfortUpperAway = toNumber(this.homey.settings.get('comfort_upper_away')) ?? 20.5;
      return {
        minTemp: Math.max(comfortLowerAway, 16),
        maxTemp: Math.min(comfortUpperAway, 26)
      };
    }
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
   * COP range tracking for adaptive normalization with outlier guards
   */
  /**
   * Heating COP range tracking for adaptive normalization
   */
  private heatingCOPRange: {
    minObserved: number;
    maxObserved: number;
    updateCount: number;
    history: number[];
  } = {
      minObserved: 2,
      maxObserved: 5,
      updateCount: 0,
      history: []
    };

  /**
   * Hot Water COP range tracking for adaptive normalization
   */
  private hotWaterCOPRange: {
    minObserved: number;
    maxObserved: number;
    updateCount: number;
    history: number[];
  } = {
      minObserved: 1.5,
      maxObserved: 3.5,
      updateCount: 0,
      history: []
    };

  /**
   * Update COP range based on observed values with outlier filtering
   * @param cop Observed COP value
   */
  /**
   * Update COP range based on observed values with outlier filtering
   * @param cop Observed COP value
   * @param type Type of COP ('heating' | 'hotwater')
   */
  private updateCOPRange(cop: number, type: 'heating' | 'hotwater' = 'heating'): void {
    const range = type === 'heating' ? this.heatingCOPRange : this.hotWaterCOPRange;
    const minValid = type === 'heating' ? 1.0 : 0.5;
    const maxValid = type === 'heating' ? 7.0 : 5.0;

    // Guard: reject non-finite, out-of-bounds values
    if (!Number.isFinite(cop) || cop < minValid || cop > maxValid) {
      // Only warn for extreme outliers
      if (cop > 0.1) {
        this.logger.warn(`${type} COP outlier rejected: ${cop} (valid range: ${minValid}-${maxValid})`);
      }
      return;
    }

    // Add to rolling history (max 100 entries)
    range.history.push(cop);
    if (range.history.length > 100) {
      range.history.shift();
    }
    range.updateCount++;

    // Recompute min/max using 5th and 95th percentile
    if (range.history.length >= 5) {
      const sorted = [...range.history].sort((a, b) => a - b);
      const p5Index = Math.floor(sorted.length * 0.05);
      const p95Index = Math.floor(sorted.length * 0.95);
      range.minObserved = sorted[p5Index];
      range.maxObserved = sorted[p95Index];
    }

    // Persist to settings
    if (this.homey) {
      if (type === 'heating') {
        this.homey.settings.set('cop_guards_v1', {
          minObserved: range.minObserved,
          maxObserved: range.maxObserved,
          updateCount: range.updateCount,
          history: range.history
        });
      } else {
        this.homey.settings.set('cop_guards_hotwater_v1', {
          minObserved: range.minObserved,
          maxObserved: range.maxObserved,
          updateCount: range.updateCount,
          history: range.history
        });
      }
    }

    // Log range updates periodically
    if (range.updateCount % 50 === 0) {
      this.logger.log(`${type} COP range updated after ${range.updateCount} observations: ${range.minObserved.toFixed(2)} - ${range.maxObserved.toFixed(2)} (${range.history.length} samples)`);
    }
  }

  /**
   * Get adaptive COP thresholds based on observed history
   * Returns dynamic thresholds for "good" and "bad" efficiency
   */
  private getAdaptiveCOPThresholds(): { good: number; bad: number } {
    // Fallback defaults if not enough history
    if (this.heatingCOPRange.history.length < 10) {
      return { good: 4.0, bad: 2.5 };
    }

    const min = this.heatingCOPRange.minObserved;
    const max = this.heatingCOPRange.maxObserved;
    const range = max - min;

    // Avoid division by zero or tiny ranges
    // Lowered to 0.2 to allow adaptive logic even with stable performance (e.g. 2.55-2.92 range = 0.37)
    if (range < 0.2) {
      return { good: 4.0, bad: 2.5 };
    }

    // Good = Top 25% of observed range
    // Bad = Bottom 25% of observed range
    return {
      good: min + (range * 0.75),
      bad: min + (range * 0.25)
    };
  }

  /**
   * Normalize COP value using adaptive range with clamping
   * @param cop COP value to normalize
   * @returns Normalized COP (0-1)
   */
  /**
   * Normalize COP value using adaptive range with clamping
   * @param cop COP value to normalize
   * @param type Type of COP ('heating' | 'hotwater')
   * @returns Normalized COP (0-1)
   */
  private normalizeCOP(cop: number, type: 'heating' | 'hotwater' = 'heating'): number {
    const range = type === 'heating' ? this.heatingCOPRange : this.hotWaterCOPRange;
    const rangeSpan = range.maxObserved - range.minObserved;

    if (rangeSpan <= 0) return 0.5; // Default if no range established

    // Clamp input COP to learned range, then normalize to 0-1
    const clampedCOP = Math.min(Math.max(cop, range.minObserved), range.maxObserved);
    return Math.min(Math.max(
      (clampedCOP - range.minObserved) / rangeSpan, 0
    ), 1);
  }

  /**
   * Calculate price level based on percentile (works for both Tibber and ENTSO-E APIs)
   * @param percentile Price percentile (0-100)
   * @returns Price level string
   */
  private calculatePriceLevel(percentile: number): string {
    const adaptiveThresholds = this.adaptiveParametersLearner?.getStrategyThresholds();
    const thresholds = resolvePriceThresholds({
      cheapPercentile: this.preheatCheapPercentile,
      veryCheapMultiplier: adaptiveThresholds?.veryChepMultiplier
    });

    if (percentile <= thresholds.veryCheap) return 'VERY_CHEAP';
    if (percentile <= thresholds.cheap) return 'CHEAP';
    if (percentile <= thresholds.expensive) return 'NORMAL';
    if (percentile <= thresholds.veryExpensive) return 'EXPENSIVE';
    return 'VERY_EXPENSIVE';
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
    copData: { heating: number; hotWater: number; outdoor: number },
    referenceTimeMs?: number
  ): ThermalStrategy {
    try {
      // Find cheapest periods in next 24 hours
      const nowMs = typeof referenceTimeMs === 'number' && Number.isFinite(referenceTimeMs)
        ? referenceTimeMs
        : Date.now();
      const upcomingPrices = futurePrices.filter(pricePoint => {
        const ts = Date.parse(pricePoint.time);
        if (!Number.isFinite(ts)) {
          return true;
        }
        return ts >= nowMs;
      });
      const next24hSource = upcomingPrices.length > 0 ? upcomingPrices : futurePrices;
      const next24h = next24hSource.slice(0, 24);
      const sortedPrices = [...next24h].sort((a, b) => a.price - b.price);
      const cheapest6Hours = sortedPrices.slice(0, 6); // Top 6 cheapest hours

      // Calculate current price percentile
      const currentPricePercentile = next24h.filter(p => p.price <= currentPrice).length / next24h.length;

      // Get normalized COP efficiency
      const heatingEfficiency = this.normalizeCOP(copData.heating);

      // Calculate thermal mass capacity for preheating
      const tempDelta = this.thermalMassModel.maxPreheatingTemp - currentTemp;
      const preheatingEnergy = tempDelta * this.thermalMassModel.thermalCapacity;

      // Get adaptive strategy thresholds (learned from outcomes, fallback to defaults)
      const adaptiveThresholds = this.adaptiveParametersLearner?.getStrategyThresholds() || {
        excellentCOPThreshold: 0.8,
        goodCOPThreshold: 0.5,
        minimumCOPThreshold: 0.2,
        veryChepMultiplier: 0.8,
        preheatAggressiveness: 2.0,
        coastingReduction: 1.5,
        boostIncrease: 0.5
      };

      // Strategy decision logic using adaptive thresholds
      if (currentPricePercentile <= (this.preheatCheapPercentile * adaptiveThresholds.veryChepMultiplier) &&
        heatingEfficiency > adaptiveThresholds.goodCOPThreshold && tempDelta > 0.5) {
        // Very cheap period (adaptive multiplier of user's cheap threshold) + good COP + room for preheating = PREHEAT
        const preheatingTarget = Math.min(
          targetTemp + (heatingEfficiency * adaptiveThresholds.preheatAggressiveness), // Adaptive aggressiveness
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

      } else if (currentPricePercentile >= (1.0 - this.preheatCheapPercentile * adaptiveThresholds.veryChepMultiplier) && currentTemp > targetTemp - 0.5) {
        // Very expensive period (adaptive mirror of cheap threshold) + above target = COAST
        const coastBand = this.getCurrentComfortBand();
        const coastingTarget = Math.max(
          targetTemp - adaptiveThresholds.coastingReduction,
          coastBand.minTemp
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

      } else if (currentPricePercentile <= this.preheatCheapPercentile && heatingEfficiency > adaptiveThresholds.excellentCOPThreshold && currentTemp < targetTemp - 1.0) {
        // Cheap period (user's threshold) + excellent COP + below target = BOOST
        const boostBand = this.getCurrentComfortBand();
        const boostTarget = Math.min(targetTemp + adaptiveThresholds.boostIncrease, boostBand.maxTemp);

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

      // Identify top 20% non-zero demand hours
      const ranked = hourlyDemand
        .map((demand, hour) => ({ demand, hour }))
        .filter(({ demand }) => demand > 0)
        .sort((a, b) => b.demand - a.demand);
      const topCount = ranked.length > 0 ? Math.max(1, Math.round(ranked.length * 0.2)) : 0;
      const peakHours = topCount > 0 ? ranked.slice(0, topCount).map(item => item.hour) : [];
      const selectedPeakHours = peakHours.length > 0 ? peakHours : DEFAULT_HOT_WATER_PEAK_HOURS;

      // Calculate minimum buffer (120% of peak demand)
      const maxDemand = Math.max(...hourlyDemand);
      const minimumBuffer = maxDemand > 0 ? maxDemand * 1.2 : (this.hotWaterUsagePattern?.minimumBuffer ?? 0);

      // Update pattern
      this.hotWaterUsagePattern = {
        hourlyDemand,
        peakHours: selectedPeakHours,
        minimumBuffer,
        lastLearningUpdate: new Date(),
        dataPoints: usageHistory.length
      };

      this.logger.log('Hot water usage pattern updated:', {
        dataPoints: usageHistory.length,
        peakHours: selectedPeakHours.join(', '),
        maxDemand: maxDemand.toFixed(2),
        minimumBuffer: minimumBuffer.toFixed(2)
      });

    } catch (error) {
      this.logger.error('Error learning hot water usage pattern:', error);
    }
  }

  /**
   * Refresh hot water usage pattern from the dedicated hot water service when available
   * Provides ongoing updates beyond the initial historical seeding.
   */
  private refreshHotWaterUsagePattern(): void {
    try {
      const service = (this.homey as any)?.hotWaterService;
      if (!service || typeof service.getUsageStatistics !== 'function') {
        return;
      }
      const stats = service.getUsageStatistics(14);
      const usageByHour: unknown = stats?.statistics?.usageByHourOfDay;
      const dataPointCount: number = Number(stats?.statistics?.dataPointCount) || 0;

      if (!Array.isArray(usageByHour) || usageByHour.length !== 24 || dataPointCount < 12) {
        return;
      }

      const hourlyDemand = usageByHour.map((value: unknown) => Number(value) || 0);
      const ranked = hourlyDemand
        .map((demand, hour) => ({ demand, hour }))
        .filter(({ demand }) => demand > 0)
        .sort((a, b) => b.demand - a.demand);
      const topCount = ranked.length > 0 ? Math.max(1, Math.round(ranked.length * 0.2)) : 0;
      const peakHoursRaw = topCount > 0 ? ranked.slice(0, topCount).map(entry => entry.hour) : [];
      const previousPeakHours = Array.isArray(this.hotWaterUsagePattern?.peakHours)
        ? this.hotWaterUsagePattern.peakHours
        : [];
      const fallbackPeakHours = previousPeakHours.length > 0 ? previousPeakHours : DEFAULT_HOT_WATER_PEAK_HOURS;
      const peakHours = peakHoursRaw.length > 0 ? peakHoursRaw : fallbackPeakHours;

      const maxDemand = Math.max(...hourlyDemand, 0);
      const minimumBuffer = maxDemand > 0 ? maxDemand * 1.2 : this.hotWaterUsagePattern.minimumBuffer;

      this.hotWaterUsagePattern = {
        hourlyDemand,
        peakHours,
        minimumBuffer,
        lastLearningUpdate: new Date(),
        dataPoints: Math.max(dataPointCount, this.hotWaterUsagePattern.dataPoints)
      };
    } catch (error) {
      this.logger.warn('Failed to refresh hot water usage pattern', error as Error);
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
    hotWaterCOP: number,
    referenceTimeMs?: number
  ): HotWaterSchedule {
    try {
      const nowMs = typeof referenceTimeMs === 'number' && Number.isFinite(referenceTimeMs)
        ? referenceTimeMs
        : Date.now();
      const upcomingPrices = priceData.filter(pricePoint => {
        const ts = Date.parse(pricePoint.time);
        if (!Number.isFinite(ts)) {
          return true;
        }
        return ts >= nowMs;
      });
      const priceWindow = upcomingPrices.length > 0 ? upcomingPrices : priceData;
      const next24h = priceWindow.slice(0, 24);
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

    // Convert user's cheap percentile to price ratio threshold (cheap percentile of 0.25 -> price ratio of ~0.75)
    const priceRatioThreshold = 1.0 - (this.preheatCheapPercentile * 1.2); // Slightly more aggressive for hot water

    if (currentPrice < avgPrice * priceRatioThreshold && hotWaterCOP > 2.5) {
      // Cheap electricity (based on user's threshold) + decent COP
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
   * Set price threshold settings
   * @param preheatCheapPercentile Percentile threshold for considering prices "cheap" (0.05-0.5)
   * @throws Error if validation fails
   */
  setPriceThresholds(preheatCheapPercentile: number): void {
    // Validate input
    this.preheatCheapPercentile = validateNumber(preheatCheapPercentile, 'preheatCheapPercentile', { min: 0.05, max: 0.5 });

    // Save to Homey settings if available
    if (this.homey) {
      try {
        this.homey.settings.set('preheat_cheap_percentile', this.preheatCheapPercentile);
      } catch (error) {
        this.logger.error('Failed to save price threshold settings to Homey settings:', error);
      }
    }

    this.logger.log(`Price threshold settings updated - Cheap Percentile: ${this.preheatCheapPercentile} (${(this.preheatCheapPercentile * 100).toFixed(1)}th percentile)`);
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
      if (realHeatingCOP > 0) this.updateCOPRange(realHeatingCOP, 'heating');
      if (realHotWaterCOP > 0) this.updateCOPRange(realHotWaterCOP, 'hotwater');

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
      this.refreshHotWaterUsagePattern();

      // Calculate daily energy consumption (kWh/day averaged over the period)
      const sampledDays = Math.max(1, Number((energyData as any)?.SampledDays) || 1);
      const dailyEnergyConsumption = (heatingConsumed + hotWaterConsumed) / sampledDays;

      // Calculate efficiency scores using adaptive COP normalization
      const heatingEfficiency = this.normalizeCOP(realHeatingCOP, 'heating');
      const hotWaterEfficiency = this.normalizeCOP(realHotWaterCOP, 'hotwater');

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
        heatingCOPRange: `${this.heatingCOPRange.minObserved.toFixed(1)}-${this.heatingCOPRange.maxObserved.toFixed(1)} (${this.heatingCOPRange.updateCount} obs)`,
        hotWaterCOPRange: `${this.hotWaterCOPRange.minObserved.toFixed(1)}-${this.hotWaterCOPRange.maxObserved.toFixed(1)} (${this.hotWaterCOPRange.updateCount} obs)`
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
          dailyEnergyConsumption: (heatingConsumed + hotWaterConsumed) / Math.max(1, Number((energyData as any).SampledDays) || 1),
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
   * Feed calibration data to COP Predictor
   * This should be called periodically when we have actual COP data from MEL Cloud
   */
  private async feedCOPCalibrationData(deviceState: MelCloudDevice, actualCOP: number): Promise<void> {
    if (!this.copPredictor) {
      return;
    }

    // We need flow temperature setpoint and outdoor temperature
    const flowSetpoint = deviceState.SetHeatFlowTemperatureZone1;
    const outdoorTemp = deviceState.OutdoorTemperature;

    if (!flowSetpoint || !Number.isFinite(outdoorTemp)) {
      return; // Can't calibrate without these values
    }

    // Only add calibration points when we have valid COP data
    if (actualCOP >= 1.0 && actualCOP <= 6.0) {
      this.copPredictor.addCalibrationPoint(flowSetpoint, outdoorTemp, actualCOP);
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
    outdoorTemp: number,
    precomputedMetrics?: OptimizationMetrics | null,
    deviceState?: MelCloudDevice
  ): Promise<{ targetTemp: number; reason: string; metrics?: OptimizationMetrics }> {
    // Get real energy metrics
    const metrics = precomputedMetrics ?? await this.getRealEnergyMetrics();

    // Feed calibration data to COP Predictor if we have metrics and device state
    if (metrics && metrics.realHeatingCOP > 0 && deviceState) {
      await this.feedCOPCalibrationData(deviceState, metrics.realHeatingCOP);
    }

    if (!metrics) {
      // Fall back to basic optimization if no real data available
      const basicTarget = await this.calculateOptimalTemperature(currentPrice, avgPrice, minPrice, maxPrice, currentTemp);
      return {
        targetTemp: basicTarget,
        reason: 'Using basic optimization (no real energy data available)'
      };
    }

    // Cache frequently used values - use user-configurable comfort bands instead of hardcoded values
    const comfortBand = this.getCurrentComfortBand();
    const tempRange = comfortBand.maxTemp - comfortBand.minTemp;
    const midTemp = (comfortBand.maxTemp + comfortBand.minTemp) / 2;

    // Normalize price between 0 and 1
    const normalizedPrice = maxPrice === minPrice
      ? 0.5
      : (currentPrice - minPrice) / (maxPrice - minPrice);

    // Calculate base target based on seasonal mode and real performance
    let targetTemp: number;
    let reason: string;

    if (metrics.seasonalMode === 'summer') {
      // Summer optimization: Focus on hot water efficiency and minimal heating
      const adaptiveParams = this.adaptiveParametersLearner?.getParameters();
      const priceWeight = adaptiveParams?.priceWeightSummer || 0.7; // Learned or fallback

      // Update COP range and normalize
      this.updateCOPRange(metrics.realHotWaterCOP);
      const hotWaterEfficiency = this.normalizeCOP(metrics.realHotWaterCOP);

      // Price adjustment (inverted: low price = higher temp)
      const priceAdjustment = (0.5 - normalizedPrice) * tempRange * priceWeight;

      // Efficiency bonus for excellent hot water COP
      let efficiencyAdjustment = 0;
      if (hotWaterEfficiency > 0.8) {
        efficiencyAdjustment = adaptiveParams?.copEfficiencyBonusHigh || 0.3; // Learned or fallback
      } else if (hotWaterEfficiency < 0.3) {
        efficiencyAdjustment = -0.5; // Penalty for poor COP
      }

      targetTemp = midTemp + priceAdjustment + efficiencyAdjustment;
      reason = `Summer mode: Hot water COP ${metrics.realHotWaterCOP.toFixed(2)} (${(hotWaterEfficiency * 100).toFixed(0)}% efficiency), price ${normalizedPrice > 0.6 ? 'high' : normalizedPrice < 0.4 ? 'low' : 'moderate'}`;

    } else if (metrics.seasonalMode === 'winter') {
      // Winter optimization: Balance heating efficiency with comfort and prices
      const adaptiveParams = this.adaptiveParametersLearner?.getParameters();
      const priceWeight = adaptiveParams?.priceWeightWinter || 0.4; // Learned or fallback

      // Update COP range and normalize  
      this.updateCOPRange(metrics.realHeatingCOP);
      const heatingEfficiency = this.normalizeCOP(metrics.realHeatingCOP);

      // Price adjustment (inverted: low price = higher temp)
      const priceAdjustment = (0.5 - normalizedPrice) * tempRange * priceWeight;

      // Get adaptive COP thresholds
      const adaptiveThresholds = this.adaptiveParametersLearner?.getStrategyThresholds() || {
        excellentCOPThreshold: 0.8,
        goodCOPThreshold: 0.5,
        minimumCOPThreshold: 0.2
      };

      // Efficiency-based comfort adjustment using adaptive thresholds
      let efficiencyAdjustment = 0;
      if (heatingEfficiency > adaptiveThresholds.excellentCOPThreshold) {
        // Excellent heating COP: maintain comfort
        efficiencyAdjustment = adaptiveParams?.copEfficiencyBonusMedium || 0.2; // Learned or fallback
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
      reason = `Winter mode: Heating COP ${metrics.realHeatingCOP.toFixed(2)} (${(heatingEfficiency * 100).toFixed(0)}% efficiency), outdoor ${outdoorTemp}°C, price ${normalizedPrice > 0.6 ? 'high' : normalizedPrice < 0.4 ? 'low' : 'moderate'}`;

    } else {
      // Transition mode: Balanced approach using both COPs
      const adaptiveParams = this.adaptiveParametersLearner?.getParameters();
      const priceWeight = adaptiveParams?.priceWeightTransition || 0.5; // Learned or fallback

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
        efficiencyAdjustment = adaptiveParams?.copEfficiencyBonusMedium || 0.2; // Learned or fallback
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
  private async optimizeHotWaterScheduling(currentPrice: number, priceData: any, metricsOverride?: OptimizationMetrics | null): Promise<{
    action: 'heat_now' | 'delay' | 'maintain';
    reason: string;
    scheduledTime?: string;
  }> {
    const metrics = metricsOverride ?? await this.getRealEnergyMetrics();

    if (!metrics || !this.lastEnergyData) {
      return { action: 'maintain', reason: 'No real energy data available for hot water optimization' };
    }

    // Calculate hot water efficiency score
    const hotWaterCOP = metrics.realHotWaterCOP;
    const dailyHotWaterConsumption = this.lastEnergyData.TotalHotWaterConsumed / 7; // kWh per day

    // Find cheapest hours in the next 24 hours
    const referenceTimeMs = priceData.current?.time ? Date.parse(priceData.current.time) : NaN;
    const nowMs = Number.isFinite(referenceTimeMs) ? referenceTimeMs : Date.now();
    const upcomingPrices = priceData.prices.filter((pricePoint: any) => {
      const ts = Date.parse(pricePoint.time);
      if (!Number.isFinite(ts)) {
        return true;
      }
      return ts >= nowMs;
    });
    const prices = (upcomingPrices.length > 0 ? upcomingPrices : priceData.prices).slice(0, 24); // Next 24 hours
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
      if (currentPercentile <= (this.preheatCheapPercentile * 1.6)) { // User's cheap threshold * 1.6 for hot water flexibility
        return {
          action: 'heat_now',
          reason: `Excellent hot water COP (${hotWaterCOP.toFixed(2)}, ${(hotWaterEfficiency * 100).toFixed(0)}th percentile) + reasonable electricity price (${(currentPercentile * 100).toFixed(0)}th percentile)`
        };
      } else if (currentPercentile >= (1.0 - this.preheatCheapPercentile * 0.8)) { // Mirror of cheap threshold
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

      // Detect Operation Mode (0=Room, 1=Flow, 2=Curve)
      // Prioritize HCControlType if available, as it's the standard field for many ATW units
      this.logger.log(`[DEBUG] Full Device State Keys: ${Object.keys(deviceState).join(', ')}`);
      this.logger.log(`[DEBUG] HCControlType value: ${deviceState.HCControlType} (type: ${typeof deviceState.HCControlType})`);
      this.logger.log(`[DEBUG] OperationModeZone1 value: ${deviceState.OperationModeZone1} (type: ${typeof deviceState.OperationModeZone1})`);

      const operationMode = deviceState.HCControlType ?? deviceState.OperationModeZone1 ?? 0;
      this.logger.log(`Detected Operation Mode: ${operationMode} (HCControlType: ${deviceState.HCControlType}, OperationModeZone1: ${deviceState.OperationModeZone1})`);
      let newTarget: number;
      let reason: string;
      let additionalInfo: any = {};
      const safeCurrentTarget = currentTarget ?? 20; // Define here for use across modes

      // --- MODE-SPECIFIC OPTIMIZATION ---
      if (operationMode === 1) {
        // === FLOW MODE (Direct Flow Temperature Control) ===
        // Strategy: Calculate ideal flow temp based on outdoor temp, then shift based on price

        // 1. Calculate Base Flow Temp (Linear Curve: -10C->50C, 15C->30C)
        // Slope = (30 - 50) / (15 - (-10)) = -20 / 25 = -0.8
        // Intercept: T_flow = 30 - (-0.8 * 15) = 30 + 12 = 42
        // Formula: Flow = 42 - 0.8 * Outdoor
        let baseFlowTarget = 42 - (0.8 * outdoorTemp);

        // Clamp base target to reasonable bounds before adjustment
        baseFlowTarget = Math.max(25, Math.min(55, baseFlowTarget));

        // 2. Apply Price-Based Adjustment
        // Stronger shifts allowed for flow temp (thermal mass absorbs it)
        let flowShift = 0;
        if (currentPrice < priceAvg * 0.8) flowShift = 5;       // Very Cheap: +5C
        else if (currentPrice < priceAvg) flowShift = 3;        // Cheap: +3C
        else if (currentPrice > priceMax * 0.9) flowShift = -5; // Very Expensive: -5C
        else if (currentPrice > priceAvg) flowShift = -3;       // Expensive: -3C

        newTarget = baseFlowTarget + flowShift;
        reason = `Flow Mode: Base ${baseFlowTarget.toFixed(1)}°C (at ${outdoorTemp}°C) + Shift ${flowShift}°C (Price)`;

        // 3. Apply Flow Mode Constraints
        const minFlow = 20;
        const maxFlow = 60;
        newTarget = Math.max(minFlow, Math.min(maxFlow, newTarget));
        newTarget = Math.round(newTarget); // Flow temps usually integers

      } else if (operationMode === 2) {
        // === CURVE MODE (Weather Compensation Shift) ===
        // Strategy: Adjust the curve shift parameter (usually -9 to +9 or -5 to +5)
        // Base is 0 (no shift)

        let curveShift = 0;
        if (currentPrice < priceAvg * 0.8) curveShift = 2;       // Very Cheap: +2
        else if (currentPrice < priceAvg) curveShift = 1;        // Cheap: +1
        else if (currentPrice > priceMax * 0.9) curveShift = -2; // Very Expensive: -2
        else if (currentPrice > priceAvg) curveShift = -1;       // Expensive: -1

        newTarget = curveShift;
        reason = `Curve Mode: Shift ${curveShift > 0 ? '+' : ''}${curveShift} (Price)`;

        // 3. Apply Curve Mode Constraints
        // Assuming standard range -5 to +5 for safety, though some units go to +/-9
        newTarget = Math.max(-5, Math.min(5, newTarget));

      } else {
        // === ROOM MODE (Legacy/Default Logic) ===

        // Use thermal learning model if available
        if (this.useThermalLearning && this.thermalModelService) {
          try {
            // Get comfort profile from user settings (using settings page defaults)
            const comfortProfile = {
              dayStart: Number(this.homey?.settings.get('day_start_hour')) || 6,
              dayEnd: Number(this.homey?.settings.get('day_end_hour')) || 22,
              nightTempReduction: Number(this.homey?.settings.get('night_temp_reduction')) || 2,
              preHeatHours: Number(this.homey?.settings.get('pre_heat_hours')) || 1
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

        // Apply constraints - use user-configurable comfort bands (ROOM MODE ONLY)
        const constraints = this.getCurrentComfortBand();
        newTarget = Math.max(constraints.minTemp, Math.min(constraints.maxTemp, newTarget));

        // Apply step constraint (don't change by more than tempStep)
        const maxChange = this.tempStep;
        if (Math.abs(newTarget - safeCurrentTarget) > maxChange) {
          newTarget = safeCurrentTarget + (newTarget > safeCurrentTarget ? maxChange : -maxChange);
        }

        // Round to nearest step
        newTarget = Math.round(newTarget / this.tempStep) * this.tempStep;
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

      // Calculate savings and comfort impact (for reporting)
      // Note: In Flow/Curve modes, these metrics are approximations as "target" isn't room temp
      const savings = this.calculateSavings(safeCurrentTarget, newTarget, currentPrice);
      const comfort = this.calculateComfortImpact(safeCurrentTarget, newTarget);

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
    const correlationId = randomUUID();
    const logDecision = (event: string, payload: Record<string, unknown>) => {
      if (this.logger && typeof (this.logger as any).optimization === 'function') {
        (this.logger as any).optimization(event, { correlationId, ...payload });
      } else if (this.logger && typeof this.logger.log === 'function') {
        this.logger.log(`${event}: ${JSON.stringify({ correlationId, ...payload })}`);
      }
    };
    logDecision('optimizer.run.start', {
      note: 'Starting enhanced optimization with real energy data analysis'
    });

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
          this.logger.log('Weather data fetched:', weatherConditions);
        } catch (weatherError) {
          this.logger.error('Error getting weather data:', weatherError);
        }
      }

      // Get price data (ENTSO-E/Tibber)
      if (!this.priceProvider) {
        throw new Error('Price provider not initialized');
      }
      let priceData;
      try {
        priceData = await this.priceProvider.getPrices();
      } catch (error) {
        logDecision('inputs.prices.error', {
          message: error instanceof Error ? error.message : String(error)
        });
        const holdTemp = currentTarget ?? currentTemp ?? 20;
        return {
          success: true,
          action: 'no_change',
          fromTemp: holdTemp,
          toTemp: holdTemp,
          reason: 'Price fetch failed; holding last setpoint',
          priceData: {
            current: 0,
            average: 0,
            min: 0,
            max: 0
          }
        };
      }
      logDecision('inputs.prices', {
        priceCount: Array.isArray(priceData.prices) ? priceData.prices.length : 0,
        currency: priceData.currencyCode,
        currentPrice: priceData.current?.price
      });
      const currentPrice = priceData.current.price;
      const avgPrice = priceData.prices.reduce((sum, p) => sum + p.price, 0) / priceData.prices.length;
      const minPrice = Math.min(...priceData.prices.map((p: any) => p.price));
      const maxPrice = Math.max(...priceData.prices.map((p: any) => p.price));
      const referenceTs = priceData.current?.time ? Date.parse(priceData.current.time) : NaN;
      const windowStart = Number.isFinite(referenceTs) ? referenceTs : Date.now();
      const windowEnd = windowStart + (24 * 60 * 60 * 1000);
      const percentileWindowCandidates = priceData.prices.filter((p: any) => {
        const ts = Date.parse(p.time);
        if (!Number.isFinite(ts)) {
          return true;
        }
        return ts >= windowStart && ts < windowEnd;
      });
      const percentileWindow = percentileWindowCandidates.length > 0 ? percentileWindowCandidates : priceData.prices;
      const percentileBase = percentileWindow.length > 0 ? percentileWindow : priceData.prices;
      const adaptiveThresholds = this.adaptiveParametersLearner?.getStrategyThresholds();

      // Determine which classification method to use
      let priceClassification;
      let classificationMethod = 'percentile';

      // Priority 1: Use Tibber's native price level if available
      if (priceData.current?.level) {
        // Tibber provides native classification (VERY_CHEAP, CHEAP, NORMAL, EXPENSIVE, VERY_EXPENSIVE)
        // Create a classification object that matches our expected format
        priceClassification = {
          label: priceData.current.level as any,
          percentile: priceData.current.level === 'VERY_CHEAP' ? 5 :
            priceData.current.level === 'CHEAP' ? 20 :
              priceData.current.level === 'NORMAL' ? 50 :
                priceData.current.level === 'EXPENSIVE' ? 80 : 95,
          normalized: (currentPrice - minPrice) / (maxPrice - minPrice),
          min: minPrice,
          max: maxPrice,
          avg: avgPrice,
          thresholds: {
            veryCheap: 10,
            cheap: 25,
            expensive: 75,
            veryExpensive: 90
          }
        };
        classificationMethod = 'tibber_native';
        this.logger.log(
          `Using Tibber native price classification: ${priceData.current.level} (price: ${currentPrice.toFixed(4)} kr/kWh)`
        );
      }
      // Priority 2: Use historical classification if available (Tibber with sufficient history - fallback)
      else if (this.priceHistoryTracker) {
        const historicalThresholds = this.priceHistoryTracker.getThresholds();
        if (historicalThresholds && this.priceHistoryTracker.hasSufficientData(7)) {
          // Use historical classification
          priceClassification = classifyPriceAgainstHistorical(currentPrice, historicalThresholds);
          classificationMethod = 'historical';
          this.logger.log(
            `Using historical price classification (${historicalThresholds.sampleSize} samples over ${Math.ceil(historicalThresholds.sampleSize / 24)} days)`
          );
        } else {
          // Not enough history yet, fall back to percentile
          priceClassification = classifyPriceUnified(percentileBase, currentPrice, {
            cheapPercentile: this.preheatCheapPercentile,
            veryCheapMultiplier: adaptiveThresholds?.veryChepMultiplier
          });
          const status = this.priceHistoryTracker.getStatus();
          this.logger.log(
            `Insufficient historical data (${status.daysOfData} days), using percentile classification`
          );
        }
      }
      // Priority 3: No price tracker (ENTSO-E or disabled), use percentile method
      else {
        priceClassification = classifyPriceUnified(percentileBase, currentPrice, {
          cheapPercentile: this.preheatCheapPercentile,
          veryCheapMultiplier: adaptiveThresholds?.veryChepMultiplier
        });
      }
      const pricePercentile = priceClassification.percentile;
      const priceLevel: string = priceClassification.label;

      // Record current price in history tracker for future reference
      if (this.priceHistoryTracker) {
        try {
          this.priceHistoryTracker.addPrice(currentPrice);
        } catch (error) {
          this.logger.error('Failed to record price in history:', error);
        }
      }
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
      const planningReferenceTime = priceData.current?.time ? new Date(priceData.current.time) : new Date();
      const planningReferenceTimeMs = planningReferenceTime.getTime();

      let thermalResponse = 1;
      let previousIndoorTemp: number | null = null;
      let previousIndoorTempTs: number | null = null;
      if (this.homey) {
        try {
          const rawResponse = this.homey.settings.get('thermal_response');
          const numericResponse = typeof rawResponse === 'number' ? rawResponse : Number(rawResponse);
          if (Number.isFinite(numericResponse) && numericResponse >= 0.5 && numericResponse <= 1.5) {
            thermalResponse = numericResponse;
          }
          const rawPrevTemp = this.homey.settings.get('optimizer_last_indoor_temp');
          if (typeof rawPrevTemp === 'number' && Number.isFinite(rawPrevTemp)) {
            previousIndoorTemp = rawPrevTemp;
          }
          const rawPrevTs = this.homey.settings.get('optimizer_last_indoor_temp_ts');
          if (typeof rawPrevTs === 'number' && Number.isFinite(rawPrevTs)) {
            previousIndoorTempTs = rawPrevTs;
          }
        } catch { }
      }

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

      // Collect thermal data point for learning
      // Only collect if target is within reasonable room temp range (10-35°C)
      // In Flow/Curve mode, currentTarget might be Flow Temp (e.g. 40) or Shift (e.g. -2)
      if (this.useThermalLearning && this.thermalModelService) {
        try {
          // Determine effective target for thermal learning
          // In Room Mode: Use actual target
          // In Flow/Curve Mode: Use user's desired comfort temperature (Virtual Target)
          let thermalModelTarget = currentTarget ?? 20;

          // Check if target is likely a Flow Temp (>35) or Curve Shift (<10)
          // If so, use the user's comfort settings as the "Virtual Target"
          if (thermalModelTarget > 35 || thermalModelTarget < 10) {
            const comfortBand = this.getCurrentComfortBand();
            // Use the average of min/max comfort as the "Virtual Target"
            thermalModelTarget = (comfortBand.minTemp + comfortBand.maxTemp) / 2;
            this.logger.log(`Using Virtual Target ${thermalModelTarget}°C for thermal learning (Mode: Flow/Curve)`);
          }

          if (thermalModelTarget >= 10 && thermalModelTarget <= 35) {
            const dataPoint = {
              timestamp: new Date().toISOString(),
              indoorTemperature: currentTemp ?? 20,
              outdoorTemperature: outdoorTemp,
              targetTemperature: thermalModelTarget,
              heatingActive: !deviceState.IdleZone1,
              weatherConditions: {
                windSpeed: weatherConditions.windSpeed,
                humidity: weatherConditions.humidity,
                cloudCover: weatherConditions.cloudCover,
                precipitation: weatherConditions.precipitation
              }
            };
            this.thermalModelService.collectDataPoint(dataPoint);
            this.logger.log('Thermal data point collected', {
              indoorTemp: dataPoint.indoorTemperature,
              outdoorTemp: dataPoint.outdoorTemperature,
              targetTemp: dataPoint.targetTemperature,
              heatingActive: dataPoint.heatingActive
            });
          } else {
            this.logger.log(`Skipping thermal data collection: Target ${thermalModelTarget} is still invalid`);
          }
        } catch (error) {
          this.logger.error('Error collecting thermal data point:', error);
        }
      }

      // Use enhanced optimization with real energy data
      const cachedMetrics = await this.getRealEnergyMetrics();

      // --- HOT WATER OPTIMIZATION (Run before heating logic) ---
      let hotWaterAction: any = null;
      let tankStatus: { setpointApplied: boolean; error?: string } | undefined;
      let tankResult: TankOptimizationResult | null = null;

      // Use cachedMetrics for optimization focus
      const optFocus = cachedMetrics?.optimizationFocus ?? 'both';

      if (optFocus === 'hotwater' || optFocus === 'both') {
        // Use pattern-based hot water scheduling if we have usage data
        if (this.hotWaterUsagePattern && this.hotWaterUsagePattern.dataPoints >= 14) {
          const currentHour = this.timeZoneHelper.getLocalTime().hour;
          const hotWaterSchedule = this.optimizeHotWaterSchedulingByPattern(
            currentHour,
            priceData.prices,
            cachedMetrics?.realHotWaterCOP ?? 2.5,
            planningReferenceTimeMs
          );

          hotWaterAction = {
            action: hotWaterSchedule.currentAction,
            reason: hotWaterSchedule.reasoning,
            scheduledTime: undefined
          };
          this.logger.log('Pattern-based hot water optimization:', {
            action: hotWaterSchedule.currentAction,
            reason: hotWaterSchedule.reasoning,
            schedulePoints: hotWaterSchedule.schedulePoints.length,
            estimatedSavings: hotWaterSchedule.estimatedSavings
          });
        } else {
          // Fallback to price/COP based optimization
          const hotWaterOpt = await this.optimizeHotWaterScheduling(
            currentPrice,
            priceData,
            cachedMetrics ?? undefined
          );
          hotWaterAction = hotWaterOpt;
        }

        if (hotWaterAction) {
          this.logger.log('Hot water optimization:', {
            action: hotWaterAction.action,
            reason: hotWaterAction.reason,
            scheduledTime: hotWaterAction.scheduledTime
          });
        }

        // Handle hot water tank optimization (Application)
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

            // Issue #7 fix: Increase tank deadband to equal step size
            const tankDeadband = Math.max(0.5, this.tankTempStep);
            const tankConstraints = applySetpointConstraints({
              proposedC: tankTarget,
              currentTargetC: currentTankTarget,
              minC: this.minTankTemp,
              maxC: this.maxTankTemp,
              stepC: this.tankTempStep,
              deadbandC: tankDeadband,
              minChangeMinutes: this.minSetpointChangeMinutes,
              lastChangeMs: this.lastTankSetpointChangeMs
            });

            tankTarget = tankConstraints.constrainedC;
            const tankChange = Math.abs(tankConstraints.deltaC);
            const tankLockout = tankConstraints.lockoutActive;

            if (
              tankConstraints.reason !== 'within constraints' &&
              !tankReason.includes(tankConstraints.reason)
            ) {
              tankReason += ` | ${tankConstraints.reason}`;
            }

            const tankDuplicate = this.lastTankIssuedSetpointC !== null &&
              Math.abs((this.lastTankIssuedSetpointC as number) - tankTarget) < 1e-4;
            const changeApplied = tankConstraints.changed && !tankLockout && !tankDuplicate;

            if (changeApplied) {
              try {
                await this.melCloud.setTankTemperature(this.deviceId, this.buildingId, tankTarget);
                this.logger.log(`Tank temperature adjusted from ${currentTankTarget.toFixed(1)}°C to ${tankTarget.toFixed(1)}°C`);
                tankStatus = { setpointApplied: true };
                this.lastTankSetpointChangeMs = tankConstraints.evaluatedAtMs;
                this.lastTankIssuedSetpointC = tankTarget;
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
              const tankHoldReason = tankDuplicate
                ? 'duplicate target'
                : tankLockout
                  ? `lockout ${this.minSetpointChangeMinutes}m`
                  : `change ${tankChange.toFixed(2)}°C below deadband ${tankDeadband.toFixed(2)}°C`;
              tankStatus = { setpointApplied: false, error: tankHoldReason };
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
      }

      // --- MODE-AWARE OPTIMIZATION START ---
      // Get operation mode from device state
      // HCControlType: 0=Room, 1=Flow, 2=Curve (approximate mapping, needs verification)
      // OperationModeZone1: 0=Room, 1=Flow, 2=Curve (often mirrors HCControlType)
      const hcControl = deviceState.HCControlType;
      const opMode = deviceState.OperationModeZone1;

      // Aggressive Debug Logging for Mode Detection
      this.logger.log('--- MODE DETECTION DEBUG ---');
      this.logger.log(`HCControlType: ${hcControl} (${typeof hcControl})`);
      this.logger.log(`OperationModeZone1: ${opMode} (${typeof opMode})`);
      this.logger.log('Full Device State Keys:', Object.keys(deviceState).join(', '));
      this.logger.log('----------------------------');

      // DIAGNOSTIC: Check for flow temperature fields (for COP prediction feature)
      this.logger.log(`🌡️ FLOW TEMP DIAGNOSTIC:`);
      this.logger.log(`  SetHeatFlowTemperatureZone1: ${deviceState.SetHeatFlowTemperatureZone1} (setpoint)`);
      this.logger.log(`  FlowTemperatureZone1: ${(deviceState as any).FlowTemperatureZone1 ?? 'NOT AVAILABLE'} (actual)`);
      this.logger.log(`  ReturnTemperatureZone1: ${(deviceState as any).ReturnTemperatureZone1 ?? 'NOT AVAILABLE'} (actual)`);
      this.logger.log(`----------------------------`);


      // Determine effective mode (Prioritize OperationModeZone1 as it seems more specific)
      // HCControlType: 1 might just mean "Water Temp Control" (covering both Flow and Curve)
      // OperationModeZone1: 1=Flow, 2=Curve
      let effectiveMode = 0; // Default to Room

      if (opMode !== undefined && opMode !== null) {
        effectiveMode = Number(opMode);
      } else if (hcControl !== undefined && hcControl !== null) {
        effectiveMode = Number(hcControl);
      }

      this.logger.log(`Effective Optimization Mode: ${effectiveMode === 1 ? 'FLOW' : effectiveMode === 2 ? 'CURVE' : 'ROOM'} (${effectiveMode})`);

      // Get user comfort settings for constraints
      const modeConstraintsBand = this.getCurrentComfortBand();
      const minComfortTemp = modeConstraintsBand.minTemp;
      const maxComfortTemp = modeConstraintsBand.maxTemp;

      // Handle Flow Mode (1)
      if (effectiveMode === 1) {
        this.logger.log('Executing Flow Temperature Optimization...');

        // 1. Calculate Base Flow Target (Virtual Target)
        // Simple compensation curve: 42°C at 0°C outdoor, slope -0.8
        // This should ideally be user-configurable
        const baseFlow = 42 - (0.8 * outdoorTemp);
        const clampedBase = Math.max(25, Math.min(55, baseFlow));

        // 2. Apply Price-Based Adjustment
        // Cheap: +3 to +5°C (Store heat)
        // Expensive: -3 to -5°C (Coast)
        let flowShift = 0;
        let reason = `Base Flow: ${clampedBase.toFixed(1)}°C (Outdoor: ${outdoorTemp.toFixed(1)}°C)`;

        // Use price classification from earlier
        if (priceClassification.label === 'CHEAP' || priceClassification.label === 'VERY_CHEAP') {
          // COMFORT SAFEGUARD: Don't overheat if already too hot
          if (currentTemp && currentTemp > maxComfortTemp) {
            flowShift = 0;
            reason += ` (Cheap but Hot: ${currentTemp}°C > ${maxComfortTemp}°C, skipping boost)`;
          } else {
            flowShift = 5;
            reason += ' + Cheap Price Boost (+5°C)';
          }
        } else if (priceClassification.label === 'EXPENSIVE' || priceClassification.label === 'VERY_EXPENSIVE') {
          // COMFORT SAFEGUARD: Don't cut heat if already cold
          if (currentTemp && currentTemp < minComfortTemp) {
            flowShift = 0;
            reason += ` (Expensive but Cold: ${currentTemp}°C < ${minComfortTemp}°C, skipping cut)`;
          } else {
            flowShift = -5;
            reason += ' - Expensive Price Cut (-5°C)';
          }
        } else {
          reason += ' (Normal Price)';
        }

        let targetFlow = Math.max(25, Math.min(60, clampedBase + flowShift));

        // 4. COP Efficiency Adjustment (New Feature)
        if (this.copPredictor) {
          const prediction = this.copPredictor.predictCOP(targetFlow, outdoorTemp);
          const adaptiveThresholds = this.getAdaptiveCOPThresholds();

          reason += ` [Pred COP: ${prediction.predictedCOP.toFixed(2)}]`;

          // Efficiency Nudge using Adaptive Thresholds:
          // If very efficient (> good threshold) and cheap, boost slightly more (+1)
          // If inefficient (< bad threshold) and expensive, cut slightly more (-1)
          if (prediction.predictedCOP > adaptiveThresholds.good && (priceClassification.label === 'CHEAP' || priceClassification.label === 'VERY_CHEAP')) {
            targetFlow += 1;
            reason += ` + Eff. Boost (COP > ${adaptiveThresholds.good.toFixed(1)})`;
          } else if (prediction.predictedCOP < adaptiveThresholds.bad && (priceClassification.label === 'EXPENSIVE' || priceClassification.label === 'VERY_EXPENSIVE')) {
            targetFlow -= 1;
            reason += ` - Eff. Cut (COP < ${adaptiveThresholds.bad.toFixed(1)})`;
          }

          // COMFORT PROTECTION: If COP is good but price is expensive, reduce the penalty
          // This prevents aggressive temperature cuts when the heat pump is running efficiently
          if (prediction.predictedCOP > adaptiveThresholds.good && flowShift < 0) {
            targetFlow += 1; // Offset 1°C of the price-based cut
            reason += ` + Comfort Prot. (Good COP)`;
          }
        }

        targetFlow = Math.max(25, Math.min(60, targetFlow));

        // 3. Apply to Device
        if (this.melCloud) {
          await this.melCloud.setFlowTemperature(this.deviceId, this.buildingId, targetFlow, 1);
        }

        // Return result immediately for Flow Mode
        return {
          success: true,
          action: 'temperature_adjusted',
          fromTemp: currentTarget ?? 0,
          toTemp: targetFlow,
          priceData: {
            current: currentPrice,
            average: avgPrice,
            min: minPrice,
            max: maxPrice,
            level: priceClassification.label,
            percentile: priceClassification.percentile
          },
          targetTemp: targetFlow, // This is flow temp, not room temp
          reason: `[FLOW MODE] ${reason}`,
          priceNow: currentPrice,
          priceAvg: avgPrice,
          priceMin: minPrice,
          priceMax: maxPrice,
          indoorTemp: currentTemp,
          outdoorTemp: outdoorTemp,
          targetOriginal: currentTarget, // Likely flow temp in this mode
          savings: 0, // Hard to calc without room temp impact
          comfort: 0,
          timestamp: new Date().toISOString(),
          kFactor: this.thermalModel.K
        };
      }

      // Handle Curve Mode (2)
      if (effectiveMode === 2) {
        this.logger.log('Executing Curve Shift Optimization...');

        // 1. Base Shift is 0
        let curveShift = 0;
        let reason = 'Base Shift: 0';

        // 2. Apply Price-Based Shift
        // Range typically -5 to +5 or -9 to +9
        if (priceClassification.label === 'CHEAP' || priceClassification.label === 'VERY_CHEAP') {
          // COMFORT SAFEGUARD: Don't overheat if already too hot
          if (currentTemp && currentTemp > maxComfortTemp) {
            curveShift = 0;
            reason += ` (Cheap but Hot: ${currentTemp}°C > ${maxComfortTemp}°C, skipping boost)`;
          } else {
            curveShift = 2;
            reason += ' + Cheap Price Boost (+2)';
          }
        } else if (priceClassification.label === 'EXPENSIVE' || priceClassification.label === 'VERY_EXPENSIVE') {
          // COMFORT SAFEGUARD: Don't cut heat if already cold
          if (currentTemp && currentTemp < minComfortTemp) {
            curveShift = 0;
            reason += ` (Expensive but Cold: ${currentTemp}°C < ${minComfortTemp}°C, skipping cut)`;
          } else {
            curveShift = -2;
            reason += ' - Expensive Price Cut (-2)';
          }
        } else {
          reason += ' (Normal Price)';
        }

        // 3. COP Efficiency Adjustment (New Feature)
        if (this.copPredictor && deviceState.SetHeatFlowTemperatureZone1 !== undefined) {
          // Estimate new flow temp: Current Flow Target + (New Shift - Current Shift)
          // Note: SetTemperatureZone1 is the current shift in Curve Mode
          const currentShift = deviceState.SetTemperatureZone1 || 0;
          const currentFlowTarget = deviceState.SetHeatFlowTemperatureZone1;
          const estimatedFlowTarget = currentFlowTarget + (curveShift - currentShift);

          const prediction = this.copPredictor.predictCOP(estimatedFlowTarget, outdoorTemp);
          const adaptiveThresholds = this.getAdaptiveCOPThresholds();

          reason += ` [Pred COP: ${prediction.predictedCOP.toFixed(2)}]`;

          // Efficiency Nudge for Curve using Adaptive Thresholds:
          // If very efficient (> good threshold) and cheap, boost shift (+1)
          // If inefficient (< bad threshold) and expensive, cut shift (-1)
          if (prediction.predictedCOP > adaptiveThresholds.good && (priceClassification.label === 'CHEAP' || priceClassification.label === 'VERY_CHEAP')) {
            curveShift += 1;
            reason += ` + Eff. Boost (COP > ${adaptiveThresholds.good.toFixed(1)})`;
          } else if (prediction.predictedCOP < adaptiveThresholds.bad && (priceClassification.label === 'EXPENSIVE' || priceClassification.label === 'VERY_EXPENSIVE')) {
            curveShift -= 1;
            reason += ` - Eff. Cut (COP < ${adaptiveThresholds.bad.toFixed(1)})`;
          }
        }

        // 4. Apply to Device
        if (this.melCloud) {
          await this.melCloud.setCurveShift(this.deviceId, this.buildingId, curveShift, 1);
        }

        // Return result immediately for Curve Mode
        return {
          success: true,
          action: 'temperature_adjusted',
          fromTemp: currentTarget ?? 0,
          toTemp: curveShift,
          priceData: {
            current: currentPrice,
            average: avgPrice,
            min: minPrice,
            max: maxPrice,
            level: priceClassification.label,
            percentile: priceClassification.percentile
          },
          targetTemp: curveShift, // This is shift value
          reason: `[CURVE MODE] ${reason}`,
          priceNow: currentPrice,
          priceAvg: avgPrice,
          priceMin: minPrice,
          priceMax: maxPrice,
          indoorTemp: currentTemp,
          outdoorTemp: outdoorTemp,
          targetOriginal: currentTarget,
          savings: 0,
          comfort: 0,
          timestamp: new Date().toISOString(),
          kFactor: this.thermalModel.K
        };
      }

      // Fallthrough to Standard Room Optimization (Mode 0 or unknown)
      this.logger.log('Executing Standard Room Optimization...');
      // --- MODE-AWARE OPTIMIZATION END ---

      const optimizationResult = await this.calculateOptimalTemperatureWithRealData(
        currentPrice,
        avgPrice,
        minPrice,
        maxPrice,
        currentTemp || 20,
        outdoorTemp,
        cachedMetrics ?? undefined,
        deviceState
      );

      let targetTemp = optimizationResult.targetTemp;
      let adjustmentReason = optimizationResult.reason;

      // Optional: Use pure Optimization Engine when enabled (robust boolean parsing)

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

      const planningBiasResult = computePlanningBias(priceData.prices, planningReferenceTime, {
        windowHours: 6,
        lookaheadHours: 12,
        cheapPercentile: 25,
        expensivePercentile: 75,
        cheapBiasC: 0.5,
        expensiveBiasC: 0.3,
        maxAbsBiasC: 0.7
      });
      const scaledPlanningBiasRaw = planningBiasResult.biasC * thermalResponse;
      const scaledPlanningBias = Math.abs(scaledPlanningBiasRaw) < 1e-6
        ? 0
        : Math.max(-0.7, Math.min(0.7, scaledPlanningBiasRaw));
      if (scaledPlanningBias !== 0) {
        targetTemp += scaledPlanningBias;
        adjustmentReason += ` + Planning ${scaledPlanningBias > 0 ? '+' : ''}${scaledPlanningBias.toFixed(2)}°C`;
      }
      logDecision('optimizer.planning.bias', {
        rawBiasC: planningBiasResult.biasC,
        thermalResponse,
        scaledBiasC: scaledPlanningBias,
        windowHours: planningBiasResult.windowHours,
        hasCheap: planningBiasResult.hasCheap,
        hasExpensive: planningBiasResult.hasExpensive
      });

      // Use user-configurable comfort bands for constraints
      const constraintsBand = this.getCurrentComfortBand();
      const safeCurrentTarget = Number.isFinite(currentTarget as number)
        ? (currentTarget as number)
        : Number.isFinite(currentTemp as number)
          ? (currentTemp as number)
          : constraintsBand.minTemp;
      const zone1ConstraintsInitial = applySetpointConstraints({
        proposedC: targetTemp,
        currentTargetC: safeCurrentTarget,
        minC: constraintsBand.minTemp,
        maxC: constraintsBand.maxTemp,
        stepC: this.tempStep,
        deadbandC: this.deadband,
        minChangeMinutes: this.minSetpointChangeMinutes,
        lastChangeMs: this.lastSetpointChangeMs
      });
      adjustmentReason += zone1ConstraintsInitial.reason !== 'within constraints'
        ? ` | ${zone1ConstraintsInitial.reason}`
        : '';
      logDecision('constraints.zone1.initial', {
        proposed: targetTemp,
        currentTarget: safeCurrentTarget,
        result: zone1ConstraintsInitial
      });
      targetTemp = zone1ConstraintsInitial.constrainedC;

      // Check if adjustment is needed
      let tempDifference = Math.abs(zone1ConstraintsInitial.deltaC);
      let lockoutActive = zone1ConstraintsInitial.lockoutActive;
      let isSignificantChange = zone1ConstraintsInitial.changed && !lockoutActive;
      let melCloudSetpointApplied = true;
      let melCloudSetpointError: string | undefined;
      let setpointApplied = false;

      // Enhanced logging with real energy metrics
      const priceRange = Math.max(maxPrice - minPrice, 0.0001);
      const priceNormalizedValue = Math.min(Math.max((currentPrice - minPrice) / priceRange, 0), 1);
      let duplicateTarget = this.lastIssuedSetpointC !== null &&
        Math.abs((this.lastIssuedSetpointC as number) - targetTemp) < 1e-4;

      const logData: any = {
        targetTemp: targetTemp.toFixed(1),
        tempDifference: tempDifference.toFixed(2),
        isSignificantChange,
        lockoutActive,
        duplicateTarget,
        adjustmentReason,
        priceNormalized: priceNormalizedValue.toFixed(2),
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



      // Thermal Mass Strategy (Standard Room Optimization only)
      let thermalStrategy = null;
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
            },
            planningReferenceTimeMs
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
        }
      }

      // Reapply constraints after any secondary adjustments (e.g., thermal strategy)
      let expectedDelta = 0;
      const finalConstraintsBand = this.getCurrentComfortBand();
      const zone1FinalConstraints = applySetpointConstraints({
        proposedC: targetTemp,
        currentTargetC: safeCurrentTarget,
        minC: finalConstraintsBand.minTemp,
        maxC: finalConstraintsBand.maxTemp,
        stepC: this.tempStep,
        deadbandC: this.deadband,
        minChangeMinutes: this.minSetpointChangeMinutes,
        lastChangeMs: this.lastSetpointChangeMs
      });
      logDecision('constraints.zone1.final', {
        proposed: targetTemp,
        currentTarget: safeCurrentTarget,
        result: zone1FinalConstraints,
        thermalStrategyApplied: Boolean(thermalStrategy && thermalStrategy.action !== 'maintain')
      });
      if (
        zone1FinalConstraints.reason !== 'within constraints' &&
        !adjustmentReason.includes(zone1FinalConstraints.reason)
      ) {
        adjustmentReason += ` | ${zone1FinalConstraints.reason}`;
      }
      targetTemp = zone1FinalConstraints.constrainedC;
      const rawExpectedDelta = zone1FinalConstraints.changed ? zone1FinalConstraints.deltaC : 0;
      const clampLimit = 2; // prevent unrealistic deltas from skewing thermal response learning
      expectedDelta = Math.max(-clampLimit, Math.min(clampLimit, rawExpectedDelta));
      tempDifference = Math.abs(zone1FinalConstraints.deltaC);
      lockoutActive = zone1FinalConstraints.lockoutActive;
      isSignificantChange = zone1FinalConstraints.changed && !lockoutActive;
      logData.targetTemp = targetTemp.toFixed(1);
      logData.tempDifference = tempDifference.toFixed(2);
      logData.isSignificantChange = isSignificantChange;
      logData.lockoutActive = lockoutActive;
      duplicateTarget = this.lastIssuedSetpointC !== null &&
        Math.abs((this.lastIssuedSetpointC as number) - targetTemp) < 1e-4;
      logData.duplicateTarget = duplicateTarget;
      logData.planningBias = scaledPlanningBias.toFixed(2);
      logData.thermalResponse = thermalResponse.toFixed(2);

      logDecision('optimizer.run.summary', logData);
      this.logger.log(
        `[ThermalModel] Adaptive interpretation: priceNormalized=${priceNormalizedValue.toFixed(2)}, percentile=${pricePercentile.toFixed(1)}% → '${priceLevel}' (thermal inertia thresholds).`,
        { thresholds: priceClassification.thresholds }
      );
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

          const zone2Deadband = Math.max(0.1, this.tempStepZone2 / 2);
          const zone2Constraints = applySetpointConstraints({
            proposedC: zone2Target,
            currentTargetC: currentTargetZone2,
            minC: this.minTempZone2,
            maxC: this.maxTempZone2,
            stepC: this.tempStepZone2,
            deadbandC: zone2Deadband,
            minChangeMinutes: this.minSetpointChangeMinutes,
            lastChangeMs: this.lastZone2SetpointChangeMs
          });
          logDecision('constraints.zone2.final', {
            proposed: zone2Target,
            currentTarget: currentTargetZone2,
            result: zone2Constraints
          });

          zone2Target = zone2Constraints.constrainedC;
          const zone2Change = Math.abs(zone2Constraints.deltaC);
          const zone2Lockout = zone2Constraints.lockoutActive;

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

          if (
            zone2Constraints.reason !== 'within constraints' &&
            !zone2Reason.includes(zone2Constraints.reason)
          ) {
            zone2Reason += ` | ${zone2Constraints.reason}`;
          }

          const zone2Duplicate = this.lastZone2IssuedSetpointC !== null &&
            Math.abs((this.lastZone2IssuedSetpointC as number) - zone2Target) < 1e-4;
          const zone2ShouldApply = zone2Constraints.changed && !zone2Lockout && !zone2Duplicate;

          if (zone2ShouldApply) {
            await this.melCloud.setZoneTemperature(this.deviceId, this.buildingId, zone2Target, 2);
            this.logger.log(`Zone2 temperature adjusted from ${currentTargetZone2.toFixed(1)}°C to ${zone2Target.toFixed(1)}°C`);
            this.lastZone2SetpointChangeMs = zone2Constraints.evaluatedAtMs;
            this.lastZone2IssuedSetpointC = zone2Target;
          } else {
            const zone2HoldReason = zone2Duplicate
              ? 'duplicate target'
              : zone2Lockout
                ? `lockout ${this.minSetpointChangeMinutes}m`
                : `change ${zone2Change.toFixed(2)}°C below deadband ${zone2Deadband.toFixed(2)}°C`;
            this.logger.log(`Zone2 hold (${zone2HoldReason}) – keeping ${currentTargetZone2.toFixed(1)}°C`);
          }

          zone2Result = {
            fromTemp: currentTargetZone2,
            toTemp: zone2Target,
            reason: zone2Reason,
            targetOriginal: currentTargetZone2,
            targetTemp: zone2Target,
            indoorTemp: currentTempZone2,
            success: zone2ShouldApply,
            changed: zone2ShouldApply
          };
        } catch (zone2Error) {
          this.logger.error('Zone2 optimization failed', zone2Error as Error);
        }
      }



      // Anti–short-cycling lockout: avoid frequent setpoint changes
      try {
        const last = (this.homey && Number(this.homey.settings.get('last_setpoint_change_ms'))) || this.lastSetpointChangeMs || 0;
        const sinceMin = last > 0 ? (Date.now() - last) / 60000 : Infinity;
        lockoutActive = sinceMin < this.minSetpointChangeMinutes;
        if (lockoutActive) {
          this.logger.log(`Setpoint change lockout active (${sinceMin.toFixed(1)}m since last < ${this.minSetpointChangeMinutes}m)`);
        }
      } catch { }

      // Apply temperature change if significant and not within lockout window
      if (isSignificantChange && !lockoutActive && !duplicateTarget) {
        const apiStart = Date.now();
        try {
          await this.melCloud.setDeviceTemperature(this.deviceId, this.buildingId, targetTemp);
          setpointApplied = true;
          melCloudSetpointApplied = true;
          logDecision('optimizer.setpoint.applied', {
            targetTemp,
            from: safeCurrentTarget,
            delta: targetTemp - safeCurrentTarget,
            latencyMs: Date.now() - apiStart
          });
        } catch (error) {
          melCloudSetpointApplied = false;
          melCloudSetpointError = (error instanceof Error) ? error.message : String(error);
          this.logger.error('Failed to apply MELCloud temperature change during optimization:', error);
          logDecision('optimizer.setpoint.error', {
            error: melCloudSetpointError,
            latencyMs: Date.now() - apiStart
          });
        }
        if (setpointApplied) {
          try {
            const now = Date.now();
            this.lastSetpointChangeMs = now;
            if (this.homey) this.homey.settings.set('last_setpoint_change_ms', now);
            this.lastIssuedSetpointC = targetTemp;
          } catch { }
        }
      } else {
        logDecision('optimizer.setpoint.skipped', {
          isSignificantChange,
          lockoutActive,
          duplicateTarget
        });
      }

      const updateThermalResponseIfPossible = () => {
        const nowMs = Date.now();
        const indoorTemp = typeof currentTemp === 'number' && Number.isFinite(currentTemp) ? currentTemp : null;
        if (indoorTemp !== null) {
          if (this.homey) {
            try {
              this.homey.settings.set('optimizer_last_indoor_temp', indoorTemp);
              this.homey.settings.set('optimizer_last_indoor_temp_ts', nowMs);
            } catch { }
          }
          if (
            previousIndoorTemp !== null &&
            previousIndoorTempTs !== null &&
            nowMs - previousIndoorTempTs >= 20 * 60 * 1000 &&
            Math.abs(indoorTemp - previousIndoorTemp) < 5
          ) {
            const observedDelta = indoorTemp - previousIndoorTemp;
            const updatedThermalResponse = updateThermalResponse(thermalResponse, observedDelta, expectedDelta, {
              alpha: 0.1,
              min: 0.5,
              max: 1.5
            });
            if (Math.abs(updatedThermalResponse - thermalResponse) > 1e-6) {
              if (this.homey) {
                try {
                  this.homey.settings.set('thermal_response', updatedThermalResponse);
                } catch { }
              }
              logDecision('optimizer.thermal.update', {
                previous: thermalResponse,
                observedDelta,
                expectedDelta,
                updated: updatedThermalResponse
              });
              thermalResponse = updatedThermalResponse;
            }
          }
        }
      };

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

        // Learn from optimization outcome (adaptive parameter learning)
        const comfortViolations = 0; // Could be calculated based on temperature vs comfort bands
        const currentCOP = optimizationResult.metrics?.realHeatingCOP || optimizationResult.metrics?.realHotWaterCOP;
        this.learnFromOptimizationOutcome(savingsNumeric, comfortViolations, currentCOP);

        updateThermalResponseIfPossible();

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
          : duplicateTarget
            ? 'Duplicate target – already applied recently'
            : `Temperature difference ${tempDifference.toFixed(1)}°C below deadband ${this.deadband}°C`;

      if (!setpointApplied) {
        // No change either due to small delta or lockout
        this.logger.log(`No enhanced temperature adjustment applied: ${failureOrHoldReason}`);
        logDecision('optimizer.setpoint.hold', {
          reason: failureOrHoldReason
        });

        // Issue #1 fix: Always calculate zone1 savings when holding below comfort max
        // Old logic: relied on optional baseline calculator, often returned undefined
        // New logic: Use comfort band maxTemp as consistent baseline
        // Rationale: If optimizer holds at lower temp, that's energy/cost savings vs "dumb thermostat"
        let savingsNumericNoChange = 0;
        try {
          // Use comfort band max as baseline (what a non-optimizing thermostat would target)
          const baselineSetpoint = constraintsBand.maxTemp;

          // Credit savings if holding at least 0.1°C below baseline (meaningful difference)
          // Changed from 1e-3 (0.001°C) to avoid floating-point sensitivity
          if (baselineSetpoint > safeCurrentTarget + 0.1) {
            savingsNumericNoChange += await this.calculateRealHourlySavings(
              baselineSetpoint,
              safeCurrentTarget,
              currentPrice,
              optimizationResult.metrics,
              'zone1'
            );
          }
        } catch (baselineErr) {
          this.logger.warn('Failed to estimate baseline savings during hold', baselineErr as Error);
        }
        // Issue #2 fix: Calculate baseline savings for zone2 and tank when holding below max
        try {
          if (zone2Result && this.enableZone2) {
            const zone2CurrentTarget = zone2Result.toTemp; // Held setpoint
            const zone2BaselineTarget = this.maxTempZone2;
            if (zone2BaselineTarget > zone2CurrentTarget + 0.1) {
              savingsNumericNoChange += await this.calculateRealHourlySavings(
                zone2BaselineTarget,
                zone2CurrentTarget,
                currentPrice,
                optimizationResult.metrics,
                'zone2'
              );
            }
          }
          if (tankResult && this.enableTankControl) {
            const tankCurrentTarget = tankResult.toTemp;
            const tankBaselineTarget = this.maxTankTemp;
            if (tankBaselineTarget > tankCurrentTarget + 0.5) {
              savingsNumericNoChange += await this.calculateRealHourlySavings(
                tankBaselineTarget,
                tankCurrentTarget,
                currentPrice,
                optimizationResult.metrics,
                'tank'
              );
            }
          }
        } catch (savingsErr) {
          this.logger.warn('Failed to calculate secondary savings contributions (no change path)', savingsErr as Error);
        }

        // Learn from no-change outcome (adaptive parameter learning)
        // Only learn if savings are meaningful and not during lockout
        if (
          Number.isFinite(savingsNumericNoChange) &&
          savingsNumericNoChange >= MIN_SAVINGS_FOR_LEARNING &&
          !lockoutActive
        ) {
          const currentCOP = optimizationResult?.metrics?.realHeatingCOP ?? optimizationResult?.metrics?.realHotWaterCOP ?? null;
          this.learnFromOptimizationOutcome(savingsNumericNoChange, 0, currentCOP ?? undefined);
          this.logger.log(`Learned from hold: savings=${savingsNumericNoChange.toFixed(3)}, COP=${currentCOP?.toFixed(2) ?? 'N/A'}`);
        }

        updateThermalResponseIfPossible();
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
      const errorBand = this.getCurrentComfortBand();
      return {
        success: false,
        action: 'no_change',
        fromTemp: errorBand.minTemp,
        toTemp: errorBand.minTemp,
        reason: `Enhanced optimization failed: ${message}`,
        priceData: {
          current: 0,
          average: 0,
          min: 0,
          max: 0
        }
      };
    }
    const fallbackBand = this.getCurrentComfortBand();
    return {
      success: false,
      action: 'no_change',
      fromTemp: fallbackBand.minTemp,
      toTemp: fallbackBand.minTemp,
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
      const tempDelta = oldTemp - newTemp;
      if (!isFinite(tempDelta) || tempDelta === 0 || !isFinite(currentPrice)) return 0;

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

      const dailyEnergyImpact = Math.abs(tempDelta) * perDegFactor * dailyConsumption; // kWh
      const gridFeeRaw = (this.homey as any)?.settings?.get?.('grid_fee_per_kwh');
      const gridFeeValue = Number(gridFeeRaw);
      const gridFee = Number.isFinite(gridFeeValue) ? gridFeeValue : 0;
      const effectivePrice = (Number.isFinite(currentPrice) ? currentPrice : 0) + gridFee;
      const dailyCostImpact = dailyEnergyImpact * Math.sign(tempDelta) * effectivePrice;
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

    const clampK = (value: number): number => Math.min(10, Math.max(0.1, value));
    const clampS = (value: number): number => Math.min(1, Math.max(0.01, value));
    const DEFAULT_S = 0.7;

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
          const rawK = confidence > 0.3
            ? (characteristics.heatingRate / 0.5) * baseK
            : baseK;
          const newK = clampK(rawK);

          const thermalMass = characteristics.thermalMass;
          const rawS = (typeof thermalMass === 'number' && Number.isFinite(thermalMass))
            ? thermalMass
            : (typeof previousS === 'number' ? previousS : (typeof this.thermalModel.S === 'number' ? this.thermalModel.S : DEFAULT_S));
          const newS = clampS(rawS);

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

          // Issue #3 fix: Force thermal model update to persist learned confidence
          // Without this, confidence was read but not saved back to settings
          // causing it to reset to 0 on next run (chicken-egg loop)
          try {
            this.thermalModelService.forceModelUpdate();
            this.logger.log('Thermal model confidence persisted after calibration');
          } catch (persistErr) {
            this.logger.error('Failed to persist thermal model confidence', persistErr);
          }

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
      const newK = clampK(baseK * (0.9 + Math.random() * 0.2));
      const rawS = typeof previousS === 'number'
        ? previousS
        : (typeof this.thermalModel.S === 'number' ? this.thermalModel.S : DEFAULT_S);
      const newS = clampS(rawS);

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
   * Learn from optimization outcome (called after each optimization cycle)
   * @param actualSavings Energy savings achieved
   * @param comfortViolations Number of comfort violations
   * @param currentCOP Current COP performance
   */
  public learnFromOptimizationOutcome(actualSavings: number, comfortViolations: number, currentCOP?: number): void {
    if (!this.adaptiveParametersLearner) return;

    // Determine current season based on month
    const month = new Date().getMonth();
    let season: 'summer' | 'winter' | 'transition';
    if (month >= 5 && month <= 8) {
      season = 'summer';
    } else if (month >= 11 || month <= 2) {
      season = 'winter';
    } else {
      season = 'transition';
    }

    this.adaptiveParametersLearner.learnFromOutcome(season, actualSavings, comfortViolations, currentCOP);
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
    // Get the appropriate comfort band based on occupancy
    const comfortBand = this.getCurrentComfortBand();
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

    // Apply final comfort band constraints
    targetTemp = Math.max(comfortBand.minTemp, Math.min(comfortBand.maxTemp, targetTemp));

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
