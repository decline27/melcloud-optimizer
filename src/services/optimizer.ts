import { randomUUID } from 'crypto';
import { HomeyLogger } from '../util/logger';
import { MelCloudApi } from './melcloud-api';
import { PriceAnalyzer } from './price-analyzer';
import { ThermalController } from './thermal-controller';
import { COPHelper } from './cop-helper';
import { ThermalModelService } from './thermal-model';
import { EnhancedSavingsCalculator, SavingsCalculationResult, OptimizationData } from '../util/enhanced-savings-calculator';
import { HotWaterOptimizer } from './hot-water-optimizer';
import { ZoneOptimizer } from './zone-optimizer';
import { ConstraintManager } from './constraint-manager';
import { StateManager } from './state-manager';
import { SettingsLoader } from './settings-loader';
import { TimeZoneHelper } from '../util/time-zone-helper';
import {
  OptimizationMetrics,
  SchedulePoint,
  TankOptimizationResult,
  SecondaryZoneResult,
  OptimizationResult,
  EnhancedOptimizationResult,
  HotWaterUsagePattern,
  PriceProvider,
  TibberPriceInfo,
  WeatherData,
  HomeyApp,
  RealEnergyData,
  ThermalModel,
  ThermalMassModel,
  HotWaterSchedule,
  MelCloudDevice,
  HotWaterService,
  hasHotWaterService
} from '../types';
import { validateNumber, validateBoolean } from '../util/validation';
import { isError } from '../util/error-handler';
import { computePlanningBias, updateThermalResponse } from './planning-utils';
import { applySetpointConstraints } from '../util/setpoint-constraints';
import { SettingsAccessor } from '../util/settings-accessor';
import { EnhancedCOPData, getCOPValue } from '../types/enhanced-cop-data';

import { AdaptiveParametersLearner } from './adaptive-parameters';
import { COP_THRESHOLDS, DEFAULT_WEIGHTS, COMFORT_CONSTANTS, OPTIMIZATION_CONSTANTS } from '../constants';

const DEFAULT_HOT_WATER_PEAK_HOURS = [6, 7, 8]; // Morning fallback window when usage data is flat
const MIN_SAVINGS_FOR_LEARNING = 0.05; // Minimum savings (SEK-equivalent) to trigger learning on no-change path

type DecisionLogger = (event: string, payload: Record<string, unknown>) => void;
type ConstraintResult = ReturnType<typeof applySetpointConstraints>;

interface ForecastCapableWeatherApi {
  getCurrentWeather(): Promise<WeatherData>;
  getForecast?(): Promise<unknown>;
  calculateWeatherBasedAdjustment?(
    forecast: unknown,
    currentTemp: number | null,
    targetTemp: number | null,
    currentPrice: number | null,
    avgPrice: number | null
  ): WeatherAdjustmentInfo;
  getWeatherTrend?(forecast: unknown): unknown;
}

interface WeatherAdjustmentInfo {
  adjustment: number;
  reason: string;
}

interface WeatherTrendInfo {
  trend: string;
  details: string;
}

interface WeatherInfo {
  current?: Partial<WeatherData>;
  adjustment?: WeatherAdjustmentInfo;
  trend?: WeatherTrendInfo;
  tempAdjustment?: number;
  condition?: string;
}

interface OptimizationInputs {
  deviceState: MelCloudDevice;
  currentTemp: number | undefined;
  currentTarget: number | undefined;
  outdoorTemp: number;
  priceData: TibberPriceInfo;
  priceStats: {
    currentPrice: number;
    avgPrice: number;
    minPrice: number;
    maxPrice: number;
    pricePercentile: number;
    priceLevel: string;
    nextHourPrice?: number;
  };
  priceClassification: ReturnType<PriceAnalyzer['analyzePrice']>;
  priceForecast: any;
  planningReferenceTime: Date;
  planningReferenceTimeMs: number;
  thermalResponse: number;
  previousIndoorTemp: number | null;
  previousIndoorTempTs: number | null;
  constraintsBand: { minTemp: number; maxTemp: number };
  safeCurrentTarget: number;
}

interface Zone1OptimizationResult {
  targetTemp: number;
  reason: string;
  metrics?: OptimizationMetrics;
  thermalStrategy: any | null;
  hotWaterAction: any;
  constraints: ConstraintResult;
  expectedDelta: number;
  tempDifference: number;
  duplicateTarget: boolean;
  lockoutActive: boolean;
  changed: boolean;
  needsApply: boolean;
  priceNormalized: number;
  weatherInfo?: WeatherInfo | null;
  planningBias?: number;
  safeCurrentTarget: number;
  indoorTemp: number | undefined;
  outdoorTemp: number;
}

interface AppliedChanges {
  zone1Applied: boolean;
  zone1Error?: string;
  zone1HoldReason?: string;
  lockoutActive?: boolean;
  duplicateTarget?: boolean;
  zone2Applied: boolean;
  zone2Error?: string;
  tankApplied: boolean;
  tankError?: string;
}

interface CombinedSavings {
  zone1: number;
  zone2: number;
  tank: number;
  total: number;
}

interface TankOptimizationPlan extends TankOptimizationResult {
  needsApply?: boolean;
  lockoutActive?: boolean;
  duplicateTarget?: boolean;
  evaluatedAtMs?: number;
  holdReason?: string;
}

class OptimizationAbort extends Error {
  constructor(public readonly result: EnhancedOptimizationResult) {
    super(result.reason ?? 'Optimization aborted');
    this.name = 'OptimizationAbort';
  }
}

/**
 * Optimizer Service
 * Handles the optimization logic for MELCloud devices based on electricity prices
 * and thermal characteristics of the home
 */
export class Optimizer {
  private priceAnalyzer: PriceAnalyzer;
  private thermalController: ThermalController;
  private hotWaterOptimizer: HotWaterOptimizer;
  private zoneOptimizer: ZoneOptimizer;

  // New service-based architecture
  private constraintManager: ConstraintManager;
  private stateManager: StateManager;
  private settingsLoader?: SettingsLoader;
  private settingsAccessor?: SettingsAccessor;

  private minSetpointChangeMinutes: number = COMFORT_CONSTANTS.DEFAULT_MIN_SETPOINT_CHANGE_MINUTES;

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

  // Home/Away state management
  private occupied: boolean = true;

  private hotWaterUsagePattern: HotWaterUsagePattern = {
    hourlyDemand: new Array(24).fill(0.5),
    peakHours: [7, 8, 18, 19, 20],
    minimumBuffer: 2.0,
    lastLearningUpdate: new Date(),
    dataPoints: 0
  };

  private adaptiveParametersLearner?: AdaptiveParametersLearner;

  // Initialization state tracking
  private initialized: boolean = false;
  private initializationPromise: Promise<void> | null = null;

  constructor(
    private readonly melCloud: MelCloudApi,
    priceProvider: PriceProvider | null,
    private readonly deviceId: string,
    private readonly buildingId: number,
    private readonly logger: HomeyLogger,
    private readonly weatherApi?: ForecastCapableWeatherApi,
    private readonly homey?: HomeyApp
  ) {
    // Initialize services first
    this.constraintManager = new ConstraintManager(this.logger);
    this.stateManager = new StateManager(this.logger);

    // Initialize adaptive parameters learner first
    if (homey) {
      this.settingsAccessor = new SettingsAccessor(homey, this.logger);
      this.adaptiveParametersLearner = new AdaptiveParametersLearner(homey);
      this.logger.log('Adaptive parameters learner initialized');

      // Initialize settings loader
      this.settingsLoader = new SettingsLoader(homey, this.logger);
    }

    // Initialize services (SYNCHRONOUS ONLY)
    this.priceAnalyzer = new PriceAnalyzer(this.logger, this.adaptiveParametersLearner);
    this.priceAnalyzer.setPriceProvider(priceProvider);

    // Initialize ThermalController first (needed by ZoneOptimizer)
    this.thermalController = new ThermalController(
      this.logger,
      this.thermalModelService || undefined, // thermalModelService is null here, so it will be undefined
      this.adaptiveParametersLearner
    );

    this.hotWaterOptimizer = new HotWaterOptimizer(this.logger, this.priceAnalyzer);
    this.zoneOptimizer = new ZoneOptimizer(this.logger, this.melCloud, this.priceAnalyzer, this.thermalController);

    // Initialize thermal learning model if homey instance is provided
    if (homey) {
      try {
        this.thermalModelService = new ThermalModelService(homey);
        this.useThermalLearning = true;
        this.logger.log('Thermal learning model initialized');
        // Note: thermalController already initialized with undefined and will handle missing thermalModelService correctly
      } catch (error) {
        this.logger.error('Failed to initialize thermal learning model:', error);
        this.useThermalLearning = false;
      }
    } else {
      this.useThermalLearning = false;
    }

    // Initialize COP helper (SYNCHRONOUS ONLY)
    if (homey) {
      try {
        this.copHelper = new COPHelper(homey, this.logger);
        this.logger.log('COP helper initialized');

        // Load settings (SYNCHRONOUS) using SettingsLoader
        this.loadSettings();

        // Initialize TimeZoneHelper with settings from SettingsLoader
        const tzSettings = this.settingsLoader!.loadTimezoneSettings();
        this.timeZoneHelper = new TimeZoneHelper(
          this.logger,
          tzSettings.offset,
          tzSettings.useDST,
          tzSettings.name
        );
        this.logger.log('TimeZoneHelper initialized for Optimizer');

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
    const hotWaterService = this.getHotWaterService();

    // Initialize enhanced savings calculator with available services
    this.enhancedSavingsCalculator = new EnhancedSavingsCalculator(
      this.logger,
      this.thermalModelService || undefined,
      hotWaterService,
      this.copHelper || undefined
    );

    this.logger.log('Optimizer constructed (call initialize() for async setup)');
    this.logger.log('Enhanced savings calculator initialized with services:', {
      thermalService: !!this.thermalModelService,
      hotWaterService: !!hotWaterService,
      copHelper: !!this.copHelper,
      baselineCapability: this.enhancedSavingsCalculator.hasBaselineCapability()
    });
  }

  /**
   * Load settings from Homey instance
   * Extracted from constructor for clarity
   */
  private loadSettings(): void {
    if (!this.homey || !this.settingsLoader) return;

    // Load all settings using SettingsLoader
    const settings = this.settingsLoader.loadAllSettings();

    // Apply COP settings
    this.copWeight = settings.cop.weight;
    this.autoSeasonalMode = settings.cop.autoSeasonalMode;
    this.summerMode = settings.cop.summerMode;

    // Load price threshold settings
    this.priceAnalyzer.setThresholds(settings.price.cheapPercentile);

    // Apply constraint settings
    this.minSetpointChangeMinutes = settings.constraints.minSetpointChangeMinutes;

    // Load and apply Zone 1 constraints (using current values as basis)
    const zone1Min = this.settingsLoader.getNumber('min_temp', COMFORT_CONSTANTS.DEFAULT_MIN_TEMP, { min: 10, max: 30 });
    const zone1Max = this.settingsLoader.getNumber('max_temp', COMFORT_CONSTANTS.DEFAULT_MAX_TEMP, { min: 10, max: 30 });
    this.constraintManager.setZone1Constraints(zone1Min, zone1Max, settings.constraints.tempStepMax);
    this.constraintManager.setZone1Deadband(settings.constraints.deadband);

    // Load and apply Zone 2 constraints
    const enableZone2 = this.settingsLoader.getBoolean('enable_zone2', false);
    const zone2Min = this.settingsLoader.getNumber('min_temp_zone2', COMFORT_CONSTANTS.DEFAULT_MIN_TEMP_ZONE2, { min: 10, max: 30 });
    const zone2Max = this.settingsLoader.getNumber('max_temp_zone2', COMFORT_CONSTANTS.DEFAULT_MAX_TEMP_ZONE2, { min: 10, max: 30 });
    const zone2Step = this.settingsLoader.getNumber('temp_step_zone2', COMFORT_CONSTANTS.DEFAULT_TEMP_STEP_ZONE2, { min: 0.1, max: 2 });
    this.constraintManager.setZone2Constraints(enableZone2, zone2Min, zone2Max, zone2Step);

    // Load and apply tank constraints
    const enableTank = this.settingsLoader.getBoolean('enable_tank_control', false);
    const tankMin = this.settingsLoader.getNumber('min_tank_temp', COMFORT_CONSTANTS.DEFAULT_MIN_TANK_TEMP, { min: 30, max: 70 });
    const tankMax = this.settingsLoader.getNumber('max_tank_temp', COMFORT_CONSTANTS.DEFAULT_MAX_TANK_TEMP, { min: 30, max: 70 });
    const tankStep = this.settingsLoader.getNumber('tank_temp_step', COMFORT_CONSTANTS.DEFAULT_TANK_TEMP_STEP, { min: 0.5, max: 5 });
    this.constraintManager.setTankConstraints(enableTank, tankMin, tankMax, tankStep);

    // Load state from settings
    this.stateManager.loadFromSettings(this.homey);

    // Load COP guards state from settings
    const copGuards = this.homey.settings.get('cop_guards_v1');
    if (copGuards && typeof copGuards === 'object') {
      if (Array.isArray(copGuards.history)) {
        this.copRange.history = copGuards.history.slice(-100); // Ensure max 100
      }
      if (typeof copGuards.minObserved === 'number') {
        this.copRange.minObserved = copGuards.minObserved;
      }
      if (typeof copGuards.maxObserved === 'number') {
        this.copRange.maxObserved = copGuards.maxObserved;
      }
      if (typeof copGuards.updateCount === 'number') {
        this.copRange.updateCount = copGuards.updateCount;
      }
      this.logger.log(`COP guards restored - Range: ${this.copRange.minObserved.toFixed(2)} - ${this.copRange.maxObserved.toFixed(2)}, ${this.copRange.history.length} samples`);
    }

    // Load home/away state
    this.occupied = settings.occupancy.occupied;
  }

  /**
   * Async initialization - must be called after construction
   * @returns Promise that resolves when initialization is complete
   */
  initialize(): Promise<void> {
    // Prevent multiple simultaneous initializations
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    // If already initialized, return immediately
    if (this.initialized) {
      return Promise.resolve();
    }

    // Create initialization promise
    this.initializationPromise = (async () => {
      try {
        await this.performAsyncInitialization();
        const thermalReady = this.thermalController.getThermalMassModel() !== null;
        if (!thermalReady) {
          throw new Error('Thermal mass model not initialized');
        }
        this.initialized = true;
        this.logger.log('Optimizer initialization complete');
      } catch (error) {
        this.logger.error('Optimizer initialization failed:', error);
        // Don't set initialized = true, allow retry on next ensureInitialized()
        throw error;
      } finally {
        this.initializationPromise = null;
      }
    })();

    return this.initializationPromise;
  }

  /**
   * Perform async initialization tasks
   */
  private async performAsyncInitialization(): Promise<void> {
    try {
      await this.initializeThermalMassFromHistory();
    } catch (error) {
      this.logger.log('Failed to initialize thermal mass from history (this is normal during initial setup):', error);
      // Non-fatal - optimizer can work without historical thermal data
      throw error;
    }
  }

  /**
   * Check if optimizer is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Ensure optimizer is initialized before critical operations
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      this.logger.warn('Optimizer not initialized, initializing now...');
      await this.initialize();
    }
  }

  /**
   * Get initialization status for debugging
   */
  public getInitializationStatus(): {
    initialized: boolean;
    thermalMassInitialized: boolean;
    copHelperInitialized: boolean;
    servicesInitialized: boolean;
  } {
    return {
      initialized: this.initialized,
      thermalMassInitialized: this.thermalController.getThermalMassModel() !== null,
      copHelperInitialized: this.copHelper !== null,
      servicesInitialized: true // Always true after constructor
    };
  }

  /**
   * Type-safe accessor for hot water service
   * @returns HotWaterService instance if available, undefined otherwise
   */
  private getHotWaterService(): HotWaterService | undefined {
    if (hasHotWaterService(this.homey)) {
      return this.homey.hotWaterService;
    }
    return undefined;
  }

  // Helper methods for cleaner service access throughout the class

  private getZone1Constraints() {
    return this.constraintManager.getZone1Constraints();
  }

  private getZone2Constraints() {
    return this.constraintManager.getZone2Constraints();
  }

  private getTankConstraints() {
    return this.constraintManager.getTankConstraints();
  }

  private getZone1State() {
    return this.stateManager.getZone1LastChange();
  }

  private getZone2State() {
    return this.stateManager.getZone2LastChange();
  }

  private getTankState() {
    return this.stateManager.getTankLastChange();
  }

  /**
   * Type-safe accessor for currency setting
   * @returns Currency code (defaults to 'NOK' if not set)
   */
  private getCurrency(): string {
    if (this.settingsLoader) {
      return this.settingsLoader.getCurrency();
    }
    if (!this.homey) {
      return 'NOK';
    }

    const currency = this.homey.settings.get('currency') ||
      this.homey.settings.get('currency_code');

    return typeof currency === 'string' ? currency : 'NOK';
  }

  /**
   * Type-safe accessor for grid fee setting
   * @returns Grid fee per kWh (defaults to 0 if not set or invalid)
   */
  private getGridFee(): number {
    if (this.settingsLoader) {
      return this.settingsLoader.getGridFee();
    }
    if (!this.homey) {
      return 0;
    }

    const gridFee = this.homey.settings.get('grid_fee_per_kwh');
    return typeof gridFee === 'number' && Number.isFinite(gridFee) ? gridFee : 0;
  }

  /**
   * Initialize thermal mass model from historical data
   * (Now private, only called via initialize())
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
          const thermalCapacity = Math.max(1.5, Math.min(4.0, avgHeatingConsumption / 10));

          // Estimate heat loss rate based on outdoor temperature correlation
          // This would need outdoor temperature data for proper calculation
          // For now, use a reasonable default based on consumption
          const heatLossRate = avgHeatingConsumption > 20 ? 1.0 : 0.6;

          // Create thermal mass model
          const thermalMassModel: ThermalMassModel = {
            thermalCapacity: thermalCapacity, // Using estimated thermalCapacity
            heatLossRate: heatLossRate, // Using estimated heatLossRate
            maxPreheatingTemp: 23,
            efficiencyFactor: 0.9,
            preheatingEfficiency: 0.9,
            lastCalibration: new Date(),
            lastUpdated: new Date()
          };

          this.thermalController.setThermalMassModel(thermalMassModel);

          this.logger.log('Thermal mass model initialized from history:', {
            capacity: thermalCapacity.toFixed(2),
            heatLoss: heatLossRate.toFixed(2),
            dataPoints: recentData.length // Using recentData.length as a proxy for valid models
          });
        }
      }

    } catch (error: unknown) {
      this.logger.log('Failed to initialize thermal mass from history:', error);
      this.logger.error('Failed to initialize thermal mass from history:', error);
      // Keep default values on error
    }
  }

  public setPriceProvider(provider: PriceProvider | null): void {
    this.priceAnalyzer.setPriceProvider(provider);
  }

  /**
   * Set thermal model parameters
   * @param K K-factor (thermal responsiveness)
   * @param S S-factor (optional)
   * @throws Error if validation fails
   */
  setThermalModel(K: number, S?: number): void {
    this.thermalController.setThermalModel(K, S);
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
    const validMin = validateNumber(minTemp, 'minTemp', { min: 10, max: 30 });
    const validMax = validateNumber(maxTemp, 'maxTemp', { min: 10, max: 30 });

    // Ensure maxTemp is greater than minTemp
    if (validMax <= validMin) {
      throw new Error(`Invalid temperature range: maxTemp(${maxTemp}) must be greater than minTemp(${minTemp})`);
    }

    const validStep = validateNumber(tempStep, 'tempStep', { min: 0.1, max: 1 });

    // Use ConstraintManager to set constraints
    this.constraintManager.setZone1Constraints(validMin, validMax, validStep);

    this.logger.log(`Temperature constraints set - Min: ${validMin}°C, Max: ${validMax}°C, Step: ${validStep}°C`);
  }

  /**
   * Configure Zone2 temperature constraints and enablement
   */
  setZone2TemperatureConstraints(enableZone2: boolean, minTempZone2: number, maxTempZone2: number, tempStepZone2: number): void {
    const validMin = validateNumber(minTempZone2, 'minTempZone2', { min: 10, max: 30 });
    const validMax = validateNumber(maxTempZone2, 'maxTempZone2', { min: 10, max: 30 });

    if (validMax <= validMin) {
      throw new Error(`Invalid Zone2 temperature range: max(${maxTempZone2}) must be greater than min(${minTempZone2})`);
    }

    const validStep = validateNumber(tempStepZone2 || 0.5, 'tempStepZone2', { min: 0.1, max: 2 });

    // Use ConstraintManager to set constraints
    this.constraintManager.setZone2Constraints(enableZone2, validMin, validMax, validStep);

    this.logger.log(`Zone2 constraints updated - Enabled: ${enableZone2}, Min: ${validMin}°C, Max: ${validMax}°C, Step: ${validStep}°C`);
  }

  /**
   * Set home/away occupancy state
   * @param occupied True for home (occupied), false for away
   */
  setOccupied(occupied: boolean): void {
    const wasOccupied = this.occupied;
    this.occupied = occupied;

    if (this.homey) {
      if (this.settingsAccessor) {
        this.settingsAccessor.set('occupied', occupied);
      } else {
        this.homey.settings.set('occupied', occupied);
      }
    }

    this.logger.log(`Home / Away state changed: ${wasOccupied ? 'Home' : 'Away'} → ${occupied ? 'Home (Occupied)' : 'Away'} `);
  }

  /**
   * Refresh occupancy state from settings (called when settings change)
   */
  refreshOccupancyFromSettings(): void {
    if (!this.homey) return;

    const newOccupied = this.settingsAccessor?.getBoolean('occupied', true);

    if (typeof newOccupied === 'boolean' && newOccupied !== this.occupied) {
      this.occupied = newOccupied;
      this.logger.log(`Home / Away state refreshed from settings: ${this.occupied ? 'Home (Occupied)' : 'Away'} `);
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
    const homey = this.homey;
    if (!homey) {
      // Fallback to default constraints if no homey instance
      return { minTemp: this.getZone1Constraints().minTemp, maxTemp: this.getZone1Constraints().maxTemp };
    }

    const getNumberSetting = (key: string, defaultValue: number): number => {
      if (this.settingsAccessor) {
        return this.settingsAccessor.getNumber(key, defaultValue);
      }
      const numeric = Number(homey.settings.get(key));
      return Number.isFinite(numeric) ? numeric : defaultValue;
    };

    if (this.occupied) {
      // Use occupied (home) comfort band - defaults match settings page HTML
      const comfortLowerOccupied = getNumberSetting('comfort_lower_occupied', 20.0);
      const comfortUpperOccupied = getNumberSetting('comfort_upper_occupied', 21.0);
      return {
        minTemp: Math.max(comfortLowerOccupied, 16),
        maxTemp: Math.min(comfortUpperOccupied, 26)
      };
    } else {
      // Use away comfort band - defaults match settings page HTML
      const comfortLowerAway = getNumberSetting('comfort_lower_away', 19.0);
      const comfortUpperAway = getNumberSetting('comfort_upper_away', 20.5);
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
    const validatedMin = validateNumber(minTankTemp, 'minTankTemp', { min: 30, max: 70 });
    const validatedMax = validateNumber(maxTankTemp, 'maxTankTemp', { min: 30, max: 70 });

    if (validatedMax <= validatedMin) {
      throw new Error(`Invalid tank temperature range: max(${maxTankTemp}) must be greater than min(${minTankTemp})`);
    }

    const validatedStep = validateNumber(tankTempStep || 1, 'tankTempStep', { min: 0.5, max: 5 });

    this.constraintManager.setTankConstraints(enableTankControl, validatedMin, validatedMax, validatedStep);

    this.logger.log(`Tank constraints updated - Enabled: ${enableTankControl}, Min: ${validatedMin}°C, Max: ${validatedMax}°C, Step: ${validatedStep}°C`);
  }

  /**
   * Expose current thermal model configuration
   */
  public getThermalModel(): ThermalModel {
    return this.thermalController.getThermalModel();
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
  private copRange: {
    minObserved: number;
    maxObserved: number;
    updateCount: number;
    history: number[];
  } = {
      minObserved: 1,
      maxObserved: 5,
      updateCount: 0,
      history: []
    };

  /**
   * Update COP range based on observed values with outlier filtering
   * @param cop Observed COP value
   */
  private updateCOPRange(cop: number): void {
    // Guard: reject non-finite, out-of-bounds values
    if (!Number.isFinite(cop) || cop < 0.5 || cop > 6.0) {
      this.logger.warn(`COP outlier rejected: ${cop} (valid range: 0.5 - 6.0)`);
      return;
    }

    // Add to rolling history (max 100 entries)
    this.copRange.history.push(cop);
    if (this.copRange.history.length > 100) {
      this.copRange.history.shift();
    }
    this.copRange.updateCount++;

    // Recompute min/max using 5th and 95th percentile
    if (this.copRange.history.length >= 5) {
      const sorted = [...this.copRange.history].sort((a, b) => a - b);
      const p5Index = Math.floor(sorted.length * 0.05);
      const p95Index = Math.floor(sorted.length * 0.95);
      this.copRange.minObserved = sorted[p5Index];
      this.copRange.maxObserved = sorted[p95Index];
    }

    // Persist to settings
    if (this.homey) {
      this.homey.settings.set('cop_guards_v1', {
        minObserved: this.copRange.minObserved,
        maxObserved: this.copRange.maxObserved,
        updateCount: this.copRange.updateCount,
        history: this.copRange.history
      });
    }

    // Log range updates periodically
    if (this.copRange.updateCount % 50 === 0) {
      this.logger.log(`COP range updated after ${this.copRange.updateCount} observations: ${this.copRange.minObserved.toFixed(2)} - ${this.copRange.maxObserved.toFixed(2)} (${this.copRange.history.length} samples)`);
    }
  }

  /**
   * Normalize COP value using adaptive range with clamping
   * @param cop COP value to normalize
   * @returns Normalized COP (0-1)
   */
  private normalizeCOP(cop: number): number {
    const range = this.copRange.maxObserved - this.copRange.minObserved;
    if (range <= 0) return 0.5; // Default if no range established

    // Clamp input COP to learned range, then normalize to 0-1
    const clampedCOP = Math.min(Math.max(cop, this.copRange.minObserved), this.copRange.maxObserved);
    return Math.min(Math.max(
      (clampedCOP - this.copRange.minObserved) / range, 0
    ), 1);
  }

  /**
   * Set price threshold settings
   * @param preheatCheapPercentile Percentile threshold for considering prices "cheap" (0.05-0.5)
   * @throws Error if validation fails
   */
  setPriceThresholds(preheatCheapPercentile: number): void {
    // Validate input
    const validated = validateNumber(preheatCheapPercentile, 'preheatCheapPercentile', { min: 0.05, max: 0.5 });

    this.priceAnalyzer.setThresholds(validated);

    // Save to Homey settings if available
    if (this.homey) {
      try {
        this.homey.settings.set('preheat_cheap_percentile', validated);
      } catch (error) {
        this.logger.error('Failed to save price threshold settings to Homey settings:', error);
      }
    }

    this.logger.log(`Price threshold settings updated - Cheap Percentile: ${validated} (${(validated * 100).toFixed(1)}th percentile)`);
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
      const service = this.getHotWaterService();
      if (!service) {
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
      this.logger.warn('Failed to refresh hot water usage pattern', { error });
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

    this.logger.log(`COP settings updated - Weight: ${this.copWeight}, Auto Seasonal: ${this.autoSeasonalMode}, Summer Mode: ${this.summerMode} `);
  }



  /**
   * Get real energy data from MELCloud API and calculate optimization metrics
   * Uses enhanced COP data with real-time calculations and predictions
   * @returns Promise resolving to optimization metrics
   */
  private async getRealEnergyMetrics(): Promise<OptimizationMetrics | null> {
    try {
      // Use enhanced COP data for more accurate optimization
      const enhancedCOPData: EnhancedCOPData = await this.melCloud.getEnhancedCOPData(this.deviceId, this.buildingId);

      // Extract enhanced COP values with sensible fallbacks when the live value is missing
      const derivedHeatingCOP = getCOPValue(
        enhancedCOPData.daily,
        'heating',
        enhancedCOPData.historical.heating || 0
      );
      const derivedHotWaterCOP = getCOPValue(
        enhancedCOPData.daily,
        'hotWater',
        enhancedCOPData.historical.hotWater || 0
      );

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
        CoP: Array.isArray(energyData.CoP)
          ? energyData.CoP
            .map((value): number | null => {
              // Plain number - use as-is
              if (typeof value === 'number') {
                return value;
              }
              // Object with value property - extract it
              if (value && typeof value === 'object' && 'value' in value) {
                const copValue = (value as { value: unknown }).value;
                return typeof copValue === 'number' ? copValue : null;
              }
              // Invalid format - skip
              return null;
            })
            .filter((value): value is number => value !== null && Number.isFinite(value))
          : [],
        // Prefer explicit COP fields when present in the daily report
        heatingCOP: derivedHeatingCOP,
        hotWaterCOP: derivedHotWaterCOP,
        averageCOP: energyData.averageCOP ?? null,
        AverageHeatingCOP: enhancedCOPData.historical.heating,
        AverageHotWaterCOP: enhancedCOPData.historical.hotWater
      };

      this.lastEnergyData = safeEnergyData;
      this.refreshHotWaterUsagePattern();

      // Calculate daily energy consumption (kWh/day averaged over the period)
      const sampledDays = Math.max(1, Number(energyData.SampledDays ?? 1) || 1);
      const dailyEnergyConsumption = (heatingConsumed + hotWaterConsumed) / sampledDays;

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

      this.logger.log(`Enhanced energy metrics calculated: `, {
        heatingCOP: heatingCOPDisplay,
        hotWaterCOP: hotWaterCOPDisplay,
        heatingEfficiency: heatingEfficiencyDisplay,
        hotWaterEfficiency: hotWaterEfficiencyDisplay,
        dailyConsumption: dailyEnergyConsumption.toFixed(1) + ' kWh/day',
        seasonalMode,
        optimizationFocus,
        heatingTrend: trends.heatingTrend,
        hotWaterTrend: trends.hotWaterTrend,
        copRange: `${this.copRange.minObserved.toFixed(1)} -${this.copRange.maxObserved.toFixed(1)} (${this.copRange.updateCount} obs)`
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
        const realHeatingCOP = Number(energyData.heatingCOP ?? energyData.averageCOP ?? energyData.AverageHeatingCOP ?? 0) || 0;
        const realHotWaterCOP = Number(energyData.hotWaterCOP ?? energyData.averageCOP ?? energyData.AverageHotWaterCOP ?? 0) || 0;
        const fallbackSampledDays = Math.max(1, Number(energyData.SampledDays ?? 1) || 1);

        this.logger.log('Using fallback energy metrics calculation');

        return {
          realHeatingCOP,
          realHotWaterCOP,
          dailyEnergyConsumption: (heatingConsumed + hotWaterConsumed) / fallbackSampledDays,
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
   * @param precomputedMetrics Optional precomputed optimization metrics
   * @returns Optimal target temperature with reasoning
   */
  private async calculateOptimalTemperatureWithRealData(
    currentPrice: number,
    avgPrice: number,
    minPrice: number,
    maxPrice: number,
    currentTemp: number,
    outdoorTemp: number,
    precomputedMetrics?: OptimizationMetrics | null
  ): Promise<{ targetTemp: number; reason: string; metrics?: OptimizationMetrics }> {
    // Get real energy metrics
    const metrics = precomputedMetrics ?? await this.getRealEnergyMetrics();

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
      reason = `Summer mode: Hot water COP ${metrics.realHotWaterCOP.toFixed(2)} (${(hotWaterEfficiency * 100).toFixed(0)}% efficiency), price ${normalizedPrice > 0.6 ? 'high' : normalizedPrice < 0.4 ? 'low' : 'moderate'} `;

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
      reason = `Winter mode: Heating COP ${metrics.realHeatingCOP.toFixed(2)} (${(heatingEfficiency * 100).toFixed(0)}% efficiency), outdoor ${outdoorTemp}°C, price ${normalizedPrice > 0.6 ? 'high' : normalizedPrice < 0.4 ? 'low' : 'moderate'} `;

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

    return { targetTemp, reason, metrics };
  }

  /**
        };
      }
    } else if (hotWaterEfficiency > 0.5) {
      // Good hot water COP: Moderate optimization
      if (currentPercentile <= 0.3) { // Only during cheapest 30%
        return {
          action: 'heat_now',
          reason: `Good hot water COP(${ hotWaterCOP.toFixed(2) }, ${(hotWaterEfficiency * 100).toFixed(0)}th percentile) + cheap electricity(${(currentPercentile * 100).toFixed(0)}th percentile)`
        };
      }
    } else if (hotWaterEfficiency > 0.2) {
      // Poor hot water COP: Conservative approach
      if (currentPercentile <= 0.15) { // Only during cheapest 15%
        return {
          action: 'heat_now',
          reason: `Poor hot water COP(${ hotWaterCOP.toFixed(2) }, ${(hotWaterEfficiency * 100).toFixed(0)}th percentile) - only during cheapest electricity(${(currentPercentile * 100).toFixed(0)}th percentile)`
        };
      } else {
        const nextCheapHour = cheapestHours[0];
        return {
          action: 'delay',
          reason: `Poor COP - wait for cheapest electricity at ${ nextCheapHour.time } `,
          scheduledTime: nextCheapHour.time
        };
      }
    } else if (hotWaterCOP > 0) {
      // Very poor hot water COP: Emergency heating only
      if (currentPercentile <= 0.1) { // Only during cheapest 10%
        return {
          action: 'heat_now',
          reason: `Very poor hot water COP(${ hotWaterCOP.toFixed(2) }) - emergency heating during absolute cheapest electricity`
        };
      } else {
        const nextCheapHour = cheapestHours[0];
        return {
          action: 'delay',
          reason: `Very poor COP - critical: wait for absolute cheapest electricity at ${ nextCheapHour.time } `,
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
        throw new Error(`API error: ${error.message} `);
      }
    } else {
      this.logger.error('Unknown API error:', String(error));
      throw new Error(`Unknown API error: ${String(error)} `);
    }
  }



  /**
   * Enhanced optimization using real energy data - complements the existing optimization
   * @returns Promise resolving to enhanced optimization result
   */
  async runOptimization(): Promise<EnhancedOptimizationResult> {
    await this.ensureInitialized();

    const correlationId = randomUUID();
    const logger = this.createDecisionLogger(correlationId);
    logger('optimizer.run.start', {
      note: 'Starting enhanced optimization with real energy data analysis'
    });

    try {
      const inputs = await this.collectOptimizationInputs(logger);
      const zone1Result = await this.optimizeZone1(inputs, logger);
      const zone2Result = await this.optimizeZone2(inputs, zone1Result, logger);
      const tankResult = await this.optimizeTank(inputs, logger);
      const applied = await this.applySetpointChanges(zone1Result, zone2Result, tankResult, logger);
      const savings = await this.calculateCombinedSavings(zone1Result, zone2Result, tankResult, inputs, applied);
      this.updateThermalResponseAfterOptimization(inputs, zone1Result, logger);
      return this.buildOptimizationResult(inputs, zone1Result, zone2Result, tankResult, savings, applied);
    } catch (error) {
      this.logger.error('Optimization run failed', error);
      return this.handleOptimizationError(error, logger);
    }
  }

  private createDecisionLogger(correlationId: string): DecisionLogger {
    return (event: string, payload: Record<string, unknown>) => {
      if (typeof this.logger.optimization === 'function') {
        this.logger.optimization(event, { correlationId, ...payload });
      } else if (typeof this.logger.log === 'function') {
        this.logger.log(`${event}: ${JSON.stringify({ correlationId, ...payload })} `);
      }
    };
  }

  private async collectOptimizationInputs(logger: DecisionLogger): Promise<OptimizationInputs> {
    const deviceState = await this.melCloud.getDeviceState(this.deviceId, this.buildingId);
    const currentTemp = deviceState.RoomTemperature || deviceState.RoomTemperatureZone1;
    const currentTarget = deviceState.SetTemperature || deviceState.SetTemperatureZone1;
    const outdoorTemp = deviceState.OutdoorTemperature || 0;

    if (currentTemp === undefined && deviceState.RoomTemperature === undefined && deviceState.RoomTemperatureZone1 === undefined) {
      throw new Error('No temperature data available from device');
    }

    if (!this.priceAnalyzer.hasPriceProvider()) {
      throw new Error('Price provider not initialized');
    }

    let priceData: TibberPriceInfo;
    try {
      priceData = await this.priceAnalyzer.getPriceData();
    } catch (error) {
      logger('inputs.prices.error', {
        message: error instanceof Error ? error.message : String(error)
      });
      const holdTemp = currentTarget ?? currentTemp ?? 20;
      throw new OptimizationAbort({
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
      });
    }

    logger('inputs.prices', {
      priceCount: Array.isArray(priceData.prices) ? priceData.prices.length : 0,
      currency: priceData.currencyCode,
      currentPrice: priceData.current?.price
    });

    if (!priceData?.prices?.length || priceData.current?.price == null) {
      const holdTemp = currentTarget ?? currentTemp ?? 20;
      throw new OptimizationAbort({
        success: true,
        action: 'no_change',
        fromTemp: holdTemp,
        toTemp: holdTemp,
        reason: 'Missing price data; holding last setpoint',
        priceData: {
          current: 0,
          average: 0,
          min: 0,
          max: 0
        }
      });
    }

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
    const priceClassification = this.priceAnalyzer.analyzePrice(currentPrice, {
      prices: percentileBase,
      priceLevel: priceData.priceLevel
    });
    const pricePercentile = priceClassification.percentile;
    const priceLevel: string = priceClassification.label;

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
    const priceForecast = priceData.forecast ?? null;
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

    try {
      const t = priceData.current?.time ? new Date(priceData.current.time).getTime() : NaN;
      const ageMin = Number.isFinite(t) ? (Date.now() - t) / 60000 : Infinity;
      if (!(ageMin >= 0 && ageMin <= 65)) {
        this.logger.warn('Price data appears stale or in the future', { ageMinutes: ageMin });
        throw new OptimizationAbort({
          success: true,
          action: 'no_change',
          fromTemp: currentTarget ?? currentTemp ?? 20,
          toTemp: currentTarget ?? currentTemp ?? 20,
          reason: 'Stale price data; safe hold',
          priceData: { current: currentPrice, average: avgPrice, min: minPrice, max: maxPrice }
        });
      }
    } catch (e) {
      if (e instanceof OptimizationAbort) {
        throw e;
      }
      this.logger.warn('Failed to validate price freshness; proceeding cautiously');
    }

    this.logger.log('Enhanced optimization state:', {
      currentTemp: currentTemp?.toFixed(1),
      currentTarget: currentTarget?.toFixed(1),
      outdoorTemp: outdoorTemp.toFixed(1),
      currentPrice: currentPrice.toFixed(3),
      avgPrice: avgPrice.toFixed(3)
    });

    const constraintsBand = this.getCurrentComfortBand();
    const safeCurrentTarget = Number.isFinite(currentTarget as number)
      ? (currentTarget as number)
      : Number.isFinite(currentTemp as number)
        ? (currentTemp as number)
        : constraintsBand.minTemp;

    return {
      deviceState,
      currentTemp,
      currentTarget,
      outdoorTemp,
      priceData,
      priceStats: {
        currentPrice,
        avgPrice,
        minPrice,
        maxPrice,
        pricePercentile,
        priceLevel,
        nextHourPrice
      },
      priceClassification,
      priceForecast,
      planningReferenceTime,
      planningReferenceTimeMs,
      thermalResponse,
      previousIndoorTemp,
      previousIndoorTempTs,
      constraintsBand,
      safeCurrentTarget
    };
  }

  private async optimizeZone1(inputs: OptimizationInputs, logger: DecisionLogger): Promise<Zone1OptimizationResult> {
    const {
      deviceState,
      currentTemp,
      currentTarget,
      outdoorTemp,
      priceData,
      priceStats,
      planningReferenceTime,
      planningReferenceTimeMs,
      thermalResponse,
      constraintsBand,
      safeCurrentTarget
    } = inputs;

    if (this.useThermalLearning && this.thermalModelService) {
      try {
        const dataPoint = {
          timestamp: new Date().toISOString(),
          indoorTemperature: currentTemp ?? 20,
          outdoorTemperature: outdoorTemp,
          targetTemperature: currentTarget ?? 20,
          heatingActive: !deviceState.IdleZone1,
          weatherConditions: {
            windSpeed: 0,
            humidity: 0,
            cloudCover: 0,
            precipitation: 0
          }
        };
        this.thermalModelService.collectDataPoint(dataPoint);
        this.logger.log('Thermal data point collected', {
          indoorTemp: dataPoint.indoorTemperature,
          outdoorTemp: dataPoint.outdoorTemperature,
          targetTemp: dataPoint.targetTemperature,
          heatingActive: dataPoint.heatingActive
        });
      } catch (error) {
        this.logger.error('Error collecting thermal data point:', error);
      }
    }

    const cachedMetrics = await this.getRealEnergyMetrics();
    const optimizationResult = await this.calculateOptimalTemperatureWithRealData(
      priceStats.currentPrice,
      priceStats.avgPrice,
      priceStats.minPrice,
      priceStats.maxPrice,
      currentTemp || 20,
      outdoorTemp,
      cachedMetrics ?? undefined
    );

    const metrics = optimizationResult.metrics ?? undefined;
    let targetTemp = optimizationResult.targetTemp;
    let adjustmentReason = optimizationResult.reason;

    let weatherInfo: WeatherInfo | null = null;
    let weatherAdjustment: WeatherAdjustmentInfo | null = null;
    let weatherTrend: WeatherTrendInfo | null = null;
    if (this.weatherApi?.getForecast && this.weatherApi.calculateWeatherBasedAdjustment) {
      try {
        const forecast = await this.weatherApi.getForecast();
        weatherAdjustment = this.weatherApi.calculateWeatherBasedAdjustment(
          forecast,
          currentTemp ?? null,
          currentTarget ?? null,
          priceStats.currentPrice ?? null,
          priceStats.avgPrice ?? null
        );
        weatherTrend = this.weatherApi.getWeatherTrend
          ? (this.weatherApi.getWeatherTrend(forecast) as WeatherTrendInfo)
          : null;

        if (weatherAdjustment && typeof weatherAdjustment.adjustment === 'number' && Math.abs(weatherAdjustment.adjustment) >= 0.1) {
          targetTemp += weatherAdjustment.adjustment;
          adjustmentReason += ` + Weather: ${weatherAdjustment.reason} (${weatherAdjustment.adjustment > 0 ? '+' : ''}${weatherAdjustment.adjustment.toFixed(1)}°C)`;
        }

        weatherInfo = {
          current: (forecast as { current?: Partial<WeatherData> })?.current,
          adjustment: weatherAdjustment || undefined,
          trend: weatherTrend || undefined,
          tempAdjustment: weatherAdjustment?.adjustment,
          condition: weatherAdjustment?.reason
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
    logger('optimizer.planning.bias', {
      rawBiasC: planningBiasResult.biasC,
      thermalResponse,
      scaledBiasC: scaledPlanningBias,
      windowHours: planningBiasResult.windowHours,
      hasCheap: planningBiasResult.hasCheap,
      hasExpensive: planningBiasResult.hasExpensive
    });

    const zone1ConstraintsInitial = applySetpointConstraints({
      proposedC: targetTemp,
      currentTargetC: safeCurrentTarget,
      minC: constraintsBand.minTemp,
      maxC: constraintsBand.maxTemp,
      stepC: this.getZone1Constraints().tempStep,
      deadbandC: this.getZone1Constraints().deadband,
      minChangeMinutes: this.minSetpointChangeMinutes,
      lastChangeMs: this.getZone1State().timestamp
    });
    adjustmentReason += zone1ConstraintsInitial.reason !== 'within constraints'
      ? ` | ${zone1ConstraintsInitial.reason} `
      : '';
    logger('constraints.zone1.initial', {
      proposed: targetTemp,
      currentTarget: safeCurrentTarget,
      result: zone1ConstraintsInitial
    });
    targetTemp = zone1ConstraintsInitial.constrainedC;

    let tempDifference = Math.abs(zone1ConstraintsInitial.deltaC);
    let lockoutActive = zone1ConstraintsInitial.lockoutActive;
    let isSignificantChange = zone1ConstraintsInitial.changed && !lockoutActive;

    const priceRange = Math.max(priceStats.maxPrice - priceStats.minPrice, 0.0001);
    const priceNormalizedValue = Math.min(Math.max((priceStats.currentPrice - priceStats.minPrice) / priceRange, 0), 1);
    let duplicateTarget = this.getZone1State().setpoint !== null &&
      Math.abs((this.getZone1State().setpoint as number) - targetTemp) < 1e-4;

    const logData: any = {
      targetTemp: targetTemp.toFixed(1),
      tempDifference: tempDifference.toFixed(2),
      isSignificantChange,
      lockoutActive,
      duplicateTarget,
      adjustmentReason,
      priceNormalized: priceNormalizedValue.toFixed(2),
      pricePercentile: `${priceStats.pricePercentile.toFixed(0)}% `
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

    let hotWaterAction = null;
    let thermalStrategy = null;

    if (optimizationResult.metrics?.optimizationFocus === 'hotwater' ||
      optimizationResult.metrics?.optimizationFocus === 'both') {
      const thermalMassModel = this.thermalController.getThermalMassModel();
      if (thermalMassModel && priceData.prices && priceData.prices.length >= 24) {
        const targetBeforeStrategy = targetTemp;
        thermalStrategy = this.thermalController.calculateThermalMassStrategy(
          currentTemp || 20,
          targetTemp,
          priceStats.currentPrice,
          priceData.prices,
          {
            heating: optimizationResult.metrics.realHeatingCOP,
            hotWater: optimizationResult.metrics.realHotWaterCOP,
            outdoor: outdoorTemp
          },
          this.priceAnalyzer,
          this.priceAnalyzer.getCheapPercentile(),
          planningReferenceTimeMs
        );

        if (thermalStrategy.action !== 'maintain') {
          targetTemp = thermalStrategy.targetTemp;
          adjustmentReason += ` + Thermal mass ${thermalStrategy.action}: ${thermalStrategy.reasoning} `;

          this.logger.log('Thermal mass strategy applied:', {
            action: thermalStrategy.action,
            fromTemp: targetBeforeStrategy,
            toTemp: thermalStrategy.targetTemp,
            reasoning: thermalStrategy.reasoning,
            estimatedSavings: thermalStrategy.estimatedSavings,
            confidence: thermalStrategy.confidenceLevel
          });
        }

        if (this.hotWaterUsagePattern && this.hotWaterUsagePattern.dataPoints >= 14) {
          const currentHour = this.timeZoneHelper.getLocalTime().hour;
          const estimatedDailyHotWaterKwh = this.hotWaterUsagePattern.hourlyDemand
            .reduce((sum, val) => sum + Math.max(val, 0), 0);
          const hotWaterSchedule = this.hotWaterOptimizer.optimizeHotWaterSchedulingByPattern(
            currentHour,
            priceData.prices,
            optimizationResult.metrics.realHotWaterCOP,
            this.hotWaterUsagePattern,
            undefined,
            {
              currencyCode: priceData.currencyCode || this.getCurrency(),
              gridFeePerKwh: this.getGridFee(),
              estimatedDailyHotWaterKwh
            }
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
          const hotWaterOpt = await this.hotWaterOptimizer.optimizeHotWaterScheduling(
            priceStats.currentPrice,
            priceData,
            optimizationResult.metrics ?? cachedMetrics ?? null,
            this.lastEnergyData
          );
          hotWaterAction = hotWaterOpt;
        }
      } else {
        const hotWaterOpt = await this.hotWaterOptimizer.optimizeHotWaterScheduling(
          priceStats.currentPrice,
          priceData,
          optimizationResult.metrics ?? cachedMetrics ?? null,
          this.lastEnergyData
        );
        hotWaterAction = hotWaterOpt;
      }

      this.logger.log('Hot water optimization:', {
        action: hotWaterAction.action,
        reason: hotWaterAction.reason,
        scheduledTime: hotWaterAction.scheduledTime
      });
    }

    let expectedDelta = 0;
    const finalConstraintsBand = this.getCurrentComfortBand();
    const zone1FinalConstraints = applySetpointConstraints({
      proposedC: targetTemp,
      currentTargetC: safeCurrentTarget,
      minC: finalConstraintsBand.minTemp,
      maxC: finalConstraintsBand.maxTemp,
      stepC: this.getZone1Constraints().tempStep,
      deadbandC: this.getZone1Constraints().deadband,
      minChangeMinutes: this.minSetpointChangeMinutes,
      lastChangeMs: this.getZone1State().timestamp
    });
    logger('constraints.zone1.final', {
      proposed: targetTemp,
      currentTarget: safeCurrentTarget,
      result: zone1FinalConstraints,
      thermalStrategyApplied: Boolean(thermalStrategy && thermalStrategy.action !== 'maintain')
    });
    if (
      zone1FinalConstraints.reason !== 'within constraints' &&
      !adjustmentReason.includes(zone1FinalConstraints.reason)
    ) {
      adjustmentReason += ` | ${zone1FinalConstraints.reason} `;
    }
    targetTemp = zone1FinalConstraints.constrainedC;
    const rawExpectedDelta = zone1FinalConstraints.changed ? zone1FinalConstraints.deltaC : 0;
    const clampLimit = 2;
    expectedDelta = Math.max(-clampLimit, Math.min(clampLimit, rawExpectedDelta));
    tempDifference = Math.abs(zone1FinalConstraints.deltaC);
    lockoutActive = zone1FinalConstraints.lockoutActive;
    isSignificantChange = zone1FinalConstraints.changed && !lockoutActive;

    logData.targetTemp = targetTemp.toFixed(1);
    logData.tempDifference = tempDifference.toFixed(2);
    logData.isSignificantChange = isSignificantChange;
    logData.lockoutActive = lockoutActive;
    duplicateTarget = this.getZone1State().setpoint !== null &&
      Math.abs((this.getZone1State().setpoint as number) - targetTemp) < 1e-4;
    logData.duplicateTarget = duplicateTarget;
    logData.planningBias = scaledPlanningBias.toFixed(2);
    logData.thermalResponse = thermalResponse.toFixed(2);

    logger('optimizer.run.summary', logData);
    this.logger.log(
      `[ThermalModel] Adaptive interpretation: priceNormalized = ${priceNormalizedValue.toFixed(2)}, percentile = ${priceStats.pricePercentile.toFixed(1)}% → '${priceStats.priceLevel}'(thermal inertia thresholds).`,
      { thresholds: inputs.priceClassification.thresholds }
    );
    this.logger.log('Enhanced optimization result:', logData);

    return {
      targetTemp,
      reason: adjustmentReason,
      metrics,
      thermalStrategy,
      hotWaterAction,
      constraints: zone1FinalConstraints,
      expectedDelta,
      tempDifference,
      duplicateTarget,
      lockoutActive,
      changed: zone1FinalConstraints.changed,
      needsApply: zone1FinalConstraints.changed && !zone1FinalConstraints.lockoutActive && !duplicateTarget,
      priceNormalized: priceNormalizedValue,
      weatherInfo,
      planningBias: scaledPlanningBias,
      safeCurrentTarget,
      indoorTemp: currentTemp,
      outdoorTemp
    };
  }

  /**
   * Apply Zone 2 fallback with proper constraint checking and error handling
   * Prevents API spam by applying deadband, lockout, and duplicate detection
   */
  private async applyZone2Fallback(
    currentTarget: number,
    currentTemp: number,
    zone1Target: number,
    reason: string,
    logger: DecisionLogger
  ): Promise<SecondaryZoneResult | null> {
    const constraints = this.getZone2Constraints();

    // Calculate proposed target based on Zone 1
    const clampedTarget = Math.max(
      constraints.minTemp,
      Math.min(constraints.maxTemp, zone1Target)
    );

    // Apply full setpoint constraints (deadband, lockout, step rounding, etc.)
    const constraintResult = applySetpointConstraints({
      proposedC: clampedTarget,
      currentTargetC: currentTarget,
      minC: constraints.minTemp,
      maxC: constraints.maxTemp,
      stepC: constraints.tempStep,
      deadbandC: this.getZone1Constraints().deadband,
      minChangeMinutes: this.minSetpointChangeMinutes,
      lastChangeMs: this.getZone2State().timestamp || 0
    });

    const fallbackTarget = constraintResult.constrainedC;
    const shouldApply = constraintResult.changed && !constraintResult.lockoutActive;

    // Check for duplicate target
    const isDuplicate = this.getZone2State().setpoint !== null &&
      Math.abs((this.getZone2State().setpoint as number) - fallbackTarget) < 1e-4;

    logger('zone2.fallback', {
      proposed: clampedTarget,
      constrained: fallbackTarget,
      changed: constraintResult.changed,
      lockout: constraintResult.lockoutActive,
      duplicate: isDuplicate,
      reason: constraintResult.reason
    });

    if (shouldApply && !isDuplicate) {
      try {
        await this.melCloud.setZoneTemperature(
          this.deviceId,
          this.buildingId,
          fallbackTarget,
          2
        );

        this.stateManager.recordZone2Change(fallbackTarget);
        if (this.homey) {
          this.stateManager.saveToSettings(this.homey);
        }

        this.logger.log(
          `Zone2 fallback: ${currentTarget.toFixed(1)}°C → ${fallbackTarget.toFixed(1)}°C (${reason})`
        );

        return {
          fromTemp: currentTarget,
          toTemp: fallbackTarget,
          targetTemp: fallbackTarget,
          targetOriginal: currentTarget,
          indoorTemp: currentTemp,
          reason,
          success: true,
          changed: true,
          action: 'changed'
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.logger.error('Zone2 fallback temperature change failed', error);
        logger('zone2.fallback.error', { error: errorMsg });

        // Return error result but don't abort optimization
        return {
          fromTemp: currentTarget,
          toTemp: currentTarget,
          targetTemp: fallbackTarget,
          targetOriginal: currentTarget,
          indoorTemp: currentTemp,
          reason: `${reason} | Error: ${errorMsg}`,
          success: false,
          changed: false,
          action: 'hold'
        };
      }
    } else {
      const holdReason = isDuplicate
        ? 'duplicate target'
        : constraintResult.lockoutActive
          ? `lockout ${this.minSetpointChangeMinutes}m`
          : constraintResult.reason;

      this.logger.log(
        `Zone2 fallback hold (${holdReason}) – keeping ${currentTarget.toFixed(1)}°C`
      );

      return {
        fromTemp: currentTarget,
        toTemp: currentTarget,
        targetTemp: fallbackTarget,
        targetOriginal: currentTarget,
        indoorTemp: currentTemp,
        reason: `${reason} | ${holdReason}`,
        success: true,
        changed: false,
        action: 'hold'
      };
    }
  }

  public async optimizeZone2(

    inputs: OptimizationInputs,
    zone1Result: Zone1OptimizationResult,
    logger: DecisionLogger
  ): Promise<SecondaryZoneResult | null> {
    const deviceSupportsZone2 = inputs.deviceState.SetTemperatureZone2 !== undefined;
    if (this.getZone2Constraints().enabled && !deviceSupportsZone2) {
      this.logger.log('WARNING: Zone2 temperature optimization enabled in settings, but device does not expose Zone2');
    }

    if (!this.getZone2Constraints().enabled) {
      return null;
    }

    const currentZone2Target = inputs.deviceState.SetTemperatureZone2;
    const currentZone2Temp = inputs.deviceState.RoomTemperatureZone2 || inputs.currentTemp;
    if (currentZone2Target === undefined) {
      return null;
    }

    // Handle missing price data gracefully with a guarded fallback
    if (!inputs.priceData.prices || inputs.priceData.prices.length === 0) {
      return await this.applyZone2Fallback(
        currentZone2Target,
        currentZone2Temp,
        zone1Result.targetTemp,
        'Zone2 fallback applied (no price data)',
        logger
      );
    }

    try {
      const zone2Opt = await this.zoneOptimizer.optimizeZone2(
        this.deviceId,
        this.buildingId,
        currentZone2Temp,
        currentZone2Target,
        zone1Result.targetTemp,
        zone1Result.weatherInfo ? {
          adjustment: zone1Result.weatherInfo.tempAdjustment ?? 0,
          reason: zone1Result.weatherInfo.condition || 'weather condition'
        } : null,
        inputs.priceStats.priceLevel,
        zone1Result.thermalStrategy || null,
        zone1Result.metrics || null,
        {
          minTemp: this.getZone2Constraints().minTemp,
          maxTemp: this.getZone2Constraints().maxTemp,
          tempStep: this.getZone2Constraints().tempStep,
          deadband: this.getZone1Constraints().deadband,
          minChangeMinutes: this.minSetpointChangeMinutes,
          lastChangeMs: this.getZone2State().timestamp || 0
        }
      );

      if (!zone2Opt) {
        return await this.applyZone2Fallback(
          currentZone2Target,
          currentZone2Temp,
          zone1Result.targetTemp,
          'Zone2 fallback applied (optimizer returned null)',
          logger
        );
      }

      if (zone2Opt.changed) {
        this.stateManager.recordZone2Change(zone2Opt.toTemp);
        if (this.homey) {
          this.stateManager.saveToSettings(this.homey);
        }
      }

      logger('zone2.optimized', {
        changed: zone2Opt.changed,
        fromTemp: zone2Opt.fromTemp,
        toTemp: zone2Opt.toTemp,
        reason: zone2Opt.reason
      });

      return {
        success: zone2Opt.success,
        action: zone2Opt.changed ? 'changed' : 'hold',
        targetTemp: zone2Opt.toTemp,
        fromTemp: zone2Opt.fromTemp,
        toTemp: zone2Opt.toTemp,
        reason: zone2Opt.reason
      };
    } catch (error) {
      logger('zone2.error', { message: error instanceof Error ? error.message : String(error) });
      this.logger.error('Zone 2 optimization failed', error);
      return null;
    }
  }

  private async optimizeTank(inputs: OptimizationInputs, logger: DecisionLogger): Promise<TankOptimizationPlan | null> {
    const currentTankTarget = inputs.deviceState.SetTankWaterTemperature;
    if (!this.getTankConstraints().enabled || currentTankTarget === undefined) {
      return null;
    }

    try {
      let tankTarget = currentTankTarget;
      let tankReason = 'Maintaining current tank temperature';

      const hotWaterService = this.getHotWaterService();
      if (hotWaterService) {
        try {
          tankTarget = hotWaterService.getOptimalTankTemperature(
            this.getTankConstraints().minTemp,
            this.getTankConstraints().maxTemp,
            inputs.priceStats.currentPrice,
            inputs.priceStats.priceLevel
          );
          tankReason = `Optimized using learned hot water usage patterns with Tibber price level ${inputs.priceStats.priceLevel} `;
        } catch (hwErr) {
          this.logger.error('Hot water service optimization failed, falling back to price heuristics', hwErr as Error);
        }
      }

      if (tankTarget === currentTankTarget) {
        if (inputs.priceStats.priceLevel === 'VERY_CHEAP' || inputs.priceStats.priceLevel === 'CHEAP') {
          tankTarget = this.getTankConstraints().maxTemp;
          tankReason = `Tibber price level ${inputs.priceStats.priceLevel}, pre - heating tank`;
        } else if (inputs.priceStats.priceLevel === 'EXPENSIVE' || inputs.priceStats.priceLevel === 'VERY_EXPENSIVE') {
          tankTarget = this.getTankConstraints().minTemp;
          tankReason = `Tibber price level ${inputs.priceStats.priceLevel}, conserving energy`;
        } else {
          tankTarget = (this.getTankConstraints().minTemp + this.getTankConstraints().maxTemp) / 2;
          tankReason = `Tibber price level ${inputs.priceStats.priceLevel}, maintaining mid - range tank temperature`;
        }
      }

      this.logger.log(
        `[HotWaterModel] Adaptive interpretation: percentile = ${inputs.priceStats.pricePercentile.toFixed(1)}% → '${inputs.priceStats.priceLevel}'(learned hot water sensitivity thresholds).`,
        { thresholds: inputs.priceClassification.thresholds }
      );

      const tankDeadband = Math.max(0.5, this.getTankConstraints().tempStep);
      const tankConstraints = applySetpointConstraints({
        proposedC: tankTarget,
        currentTargetC: currentTankTarget,
        minC: this.getTankConstraints().minTemp,
        maxC: this.getTankConstraints().maxTemp,
        stepC: this.getTankConstraints().tempStep,
        deadbandC: tankDeadband,
        minChangeMinutes: this.minSetpointChangeMinutes,
        lastChangeMs: this.getTankState().timestamp
      });
      logger('constraints.tank.final', {
        proposed: tankTarget,
        currentTarget: currentTankTarget,
        result: tankConstraints
      });

      tankTarget = tankConstraints.constrainedC;
      const tankChange = Math.abs(tankConstraints.deltaC);
      const tankLockout = tankConstraints.lockoutActive;

      if (
        tankConstraints.reason !== 'within constraints' &&
        !tankReason.includes(tankConstraints.reason)
      ) {
        tankReason += ` | ${tankConstraints.reason} `;
      }

      const tankDuplicate = this.getTankState().setpoint !== null &&
        Math.abs((this.getTankState().setpoint as number) - tankTarget) < 1e-4;
      const changeApplied = tankConstraints.changed && !tankLockout && !tankDuplicate;
      const tankHoldReason = tankDuplicate
        ? 'duplicate target'
        : tankLockout
          ? `lockout ${this.minSetpointChangeMinutes} m`
          : `change ${tankChange.toFixed(2)}°C below deadband ${tankDeadband.toFixed(2)}°C`;

      logger('tank.optimized', {
        changed: tankConstraints.changed,
        fromTemp: currentTankTarget,
        toTemp: tankTarget,
        lockout: tankLockout,
        duplicate: tankDuplicate,
        holdReason: changeApplied ? undefined : tankHoldReason
      });

      return {
        fromTemp: currentTankTarget,
        toTemp: tankTarget,
        reason: tankReason,
        success: true,
        changed: tankConstraints.changed,
        needsApply: changeApplied,
        lockoutActive: tankLockout,
        duplicateTarget: tankDuplicate,
        evaluatedAtMs: tankConstraints.evaluatedAtMs,
        holdReason: changeApplied ? undefined : tankHoldReason
      };
    } catch (error) {
      logger('tank.error', { message: error instanceof Error ? error.message : String(error) });
      this.logger.error('Tank optimization failed', error as Error);
      return null;
    }
  }

  private async applySetpointChanges(
    zone1Result: Zone1OptimizationResult,
    _zone2Result: SecondaryZoneResult | null,
    tankResult: TankOptimizationPlan | null,
    logger: DecisionLogger
  ): Promise<AppliedChanges> {
    const changes: AppliedChanges = {
      zone1Applied: false,
      zone2Applied: false,
      tankApplied: false
    };

    let lockoutActive = zone1Result.lockoutActive;
    try {
      const last = (this.homey && Number(this.homey.settings.get('last_setpoint_change_ms'))) || this.getZone1State().timestamp || 0;
      const sinceMin = last > 0 ? (Date.now() - last) / 60000 : Infinity;
      lockoutActive = lockoutActive || sinceMin < this.minSetpointChangeMinutes;
      if (lockoutActive && sinceMin < this.minSetpointChangeMinutes) {
        this.logger.log(`Setpoint change lockout active(${sinceMin.toFixed(1)}m since last < ${this.minSetpointChangeMinutes}m)`);
      }
    } catch { }
    changes.lockoutActive = lockoutActive;
    changes.duplicateTarget = zone1Result.duplicateTarget;

    if (zone1Result.needsApply && !lockoutActive) {
      const apiStart = Date.now();
      try {
        await this.melCloud.setDeviceTemperature(this.deviceId, this.buildingId, zone1Result.targetTemp);
        changes.zone1Applied = true;

        this.stateManager.recordZone1Change(zone1Result.targetTemp);

        if (this.homey) {
          this.stateManager.saveToSettings(this.homey);
        }

        const latencyMs = Date.now() - apiStart;
        logger('zone1.applied', {
          targetTemp: zone1Result.targetTemp,
          latencyMs
        });
        logger('optimizer.setpoint.applied', {
          targetTemp: zone1Result.targetTemp,
          from: zone1Result.safeCurrentTarget,
          delta: zone1Result.targetTemp - zone1Result.safeCurrentTarget,
          latencyMs
        });
      } catch (error) {
        changes.zone1Error = error instanceof Error ? error.message : String(error);
        logger('zone1.apply_error', { error: changes.zone1Error });
        logger('optimizer.setpoint.error', {
          error: changes.zone1Error,
          latencyMs: Date.now() - apiStart
        });
        this.logger.error('Failed to apply Zone 1 temperature', error);
      }
    } else {
      logger('zone1.skipped', {
        changed: zone1Result.changed,
        lockout: lockoutActive,
        duplicate: zone1Result.duplicateTarget
      });
    }

    if (!changes.zone1Applied) {
      changes.zone1HoldReason = changes.zone1Error
        ? `Temperature change requested but MELCloud rejected: ${changes.zone1Error} `
        : lockoutActive
          ? `Setpoint change lockout(${this.minSetpointChangeMinutes}m) to prevent cycling`
          : zone1Result.duplicateTarget
            ? 'Duplicate target – already applied recently'
            : `Temperature difference ${zone1Result.tempDifference.toFixed(1)}°C below deadband ${this.getZone1Constraints().deadband}°C`;
    }

    if (!changes.zone1Applied && changes.zone1HoldReason) {
      this.logger.log(`No enhanced temperature adjustment applied: ${changes.zone1HoldReason} `);
      logger('optimizer.setpoint.hold', { reason: changes.zone1HoldReason });
    }

    if (tankResult?.needsApply) {
      try {
        await this.melCloud.setTankTemperature(this.deviceId, this.buildingId, tankResult.toTemp);
        changes.tankApplied = true;

        this.stateManager.recordTankChange(tankResult.toTemp, tankResult.evaluatedAtMs ?? Date.now());

        logger('tank.applied', {
          fromTemp: tankResult.fromTemp,
          toTemp: tankResult.toTemp
        });
      } catch (error) {
        changes.tankError = error instanceof Error ? error.message : String(error);
        logger('tank.apply_error', { error: changes.tankError });
        this.logger.error('Failed to apply tank temperature', error);
      }
    }
    if (tankResult && !tankResult.needsApply && tankResult.holdReason && !changes.tankApplied) {
      changes.tankError = tankResult.holdReason;
    }

    return changes;
  }

  private async calculateCombinedSavings(
    zone1Result: Zone1OptimizationResult,
    zone2Result: SecondaryZoneResult | null,
    tankResult: TankOptimizationPlan | null,
    inputs: OptimizationInputs,
    applied: AppliedChanges
  ): Promise<CombinedSavings> {
    const savings: CombinedSavings = {
      zone1: 0,
      zone2: 0,
      tank: 0,
      total: 0
    };

    if (applied.zone1Applied) {
      savings.zone1 = await this.calculateRealHourlySavings(
        zone1Result.safeCurrentTarget,
        zone1Result.targetTemp,
        inputs.priceStats.currentPrice,
        zone1Result.metrics,
        'zone1'
      );
      try {
        if (zone2Result && typeof zone2Result.fromTemp === 'number' && typeof zone2Result.toTemp === 'number') {
          savings.zone2 = await this.calculateRealHourlySavings(
            zone2Result.fromTemp,
            zone2Result.toTemp,
            inputs.priceStats.currentPrice,
            zone1Result.metrics,
            'zone2'
          );
        }
        if (tankResult && typeof tankResult.fromTemp === 'number' && typeof tankResult.toTemp === 'number') {
          savings.tank = await this.calculateRealHourlySavings(
            tankResult.fromTemp,
            tankResult.toTemp,
            inputs.priceStats.currentPrice,
            zone1Result.metrics,
            'tank'
          );
        }
      } catch (savingsErr) {
        this.logger.warn('Failed to calculate secondary savings contributions', { error: savingsErr });
      }
      savings.total = savings.zone1 + savings.zone2 + savings.tank;

      const comfortViolations = 0;
      const currentCOP = zone1Result.metrics?.realHeatingCOP || zone1Result.metrics?.realHotWaterCOP;
      this.learnFromOptimizationOutcome(savings.total, comfortViolations, currentCOP);
      this.logger.log(`Enhanced temperature adjusted from ${zone1Result.safeCurrentTarget.toFixed(1)}°C to ${zone1Result.targetTemp.toFixed(1)}°C`, {
        reason: zone1Result.reason,
        savingsEstimated: this.estimateCostSavings(
          zone1Result.targetTemp,
          zone1Result.safeCurrentTarget,
          inputs.priceStats.currentPrice,
          inputs.priceStats.avgPrice,
          zone1Result.metrics
        ),
        savingsNumeric: savings.total
      });
      return savings;
    }

    try {
      const baselineSetpoint = inputs.constraintsBand.maxTemp;
      if (baselineSetpoint > zone1Result.safeCurrentTarget + 0.1) {
        savings.zone1 += await this.calculateRealHourlySavings(
          baselineSetpoint,
          zone1Result.safeCurrentTarget,
          inputs.priceStats.currentPrice,
          zone1Result.metrics,
          'zone1'
        );
      }
    } catch (baselineErr) {
      this.logger.warn('Failed to estimate baseline savings during hold', { error: baselineErr });
    }

    try {
      if (zone2Result && this.getZone2Constraints().enabled) {
        const zone2BaselineTarget = this.getZone2Constraints().maxTemp;
        if (zone2BaselineTarget > zone2Result.toTemp + 0.1) {
          savings.zone2 += await this.calculateRealHourlySavings(
            zone2BaselineTarget,
            zone2Result.toTemp,
            inputs.priceStats.currentPrice,
            zone1Result.metrics,
            'zone2'
          );
        }
      }
      if (tankResult && this.getTankConstraints().enabled) {
        const tankBaselineTarget = this.getTankConstraints().maxTemp;
        if (tankBaselineTarget > tankResult.toTemp + 0.5) {
          savings.tank += await this.calculateRealHourlySavings(
            tankBaselineTarget,
            tankResult.toTemp,
            inputs.priceStats.currentPrice,
            zone1Result.metrics,
            'tank'
          );
        }
      }
    } catch (savingsErr) {
      this.logger.warn('Failed to calculate secondary savings contributions (no change path)', { error: savingsErr });
    }

    savings.total = savings.zone1 + savings.zone2 + savings.tank;

    if (
      Number.isFinite(savings.total) &&
      savings.total >= MIN_SAVINGS_FOR_LEARNING &&
      !applied.lockoutActive
    ) {
      const currentCOP = zone1Result.metrics?.realHeatingCOP ?? zone1Result.metrics?.realHotWaterCOP ?? null;
      this.learnFromOptimizationOutcome(savings.total, 0, currentCOP ?? undefined);
      this.logger.log(`Learned from hold: savings = ${savings.total.toFixed(3)}, COP = ${currentCOP?.toFixed(2) ?? 'N/A'} `);
    }

    return savings;
  }

  private buildOptimizationResult(
    inputs: OptimizationInputs,
    zone1Result: Zone1OptimizationResult,
    zone2Result: SecondaryZoneResult | null,
    tankResult: TankOptimizationPlan | null,
    savings: CombinedSavings,
    applied: AppliedChanges
  ): EnhancedOptimizationResult {
    const action = applied.zone1Applied ? 'temperature_adjusted' : 'no_change';
    const reason = applied.zone1Applied
      ? zone1Result.reason
      : (applied.zone1HoldReason ?? zone1Result.reason);

    return {
      success: true,
      action,
      fromTemp: zone1Result.safeCurrentTarget,
      toTemp: applied.zone1Applied ? zone1Result.targetTemp : zone1Result.safeCurrentTarget,
      reason,
      indoorTemp: inputs.currentTemp ?? null,
      outdoorTemp: inputs.outdoorTemp,
      priceData: {
        current: inputs.priceStats.currentPrice,
        average: inputs.priceStats.avgPrice,
        min: inputs.priceStats.minPrice,
        max: inputs.priceStats.maxPrice,
        level: inputs.priceStats.priceLevel,
        percentile: inputs.priceStats.pricePercentile,
        nextHour: inputs.priceStats.nextHourPrice
      },
      savings: savings.total,
      energyMetrics: zone1Result.metrics ?? undefined,
      weather: zone1Result.weatherInfo || undefined,
      hotWaterAction: zone1Result.hotWaterAction || undefined,
      priceForecast: inputs.priceForecast ? {
        position: inputs.priceForecast.currentPosition,
        recommendation: inputs.priceForecast.recommendation,
        upcomingChanges: inputs.priceForecast.upcomingChanges,
        bestTimes: inputs.priceForecast.bestTimes,
        worstTimes: inputs.priceForecast.worstTimes
      } : undefined,
      zone2Data: zone2Result || undefined,
      tankData: tankResult || undefined,
      melCloudStatus: {
        setpointApplied: applied.zone1Applied,
        error: applied.zone1Error
      },
      tankStatus: tankResult ? {
        setpointApplied: applied.tankApplied,
        error: applied.tankError
      } : undefined
    };
  }

  private updateThermalResponseAfterOptimization(
    inputs: OptimizationInputs,
    zone1Result: Zone1OptimizationResult,
    logger: DecisionLogger
  ): void {
    const nowMs = Date.now();
    const indoorTemp = typeof inputs.currentTemp === 'number' && Number.isFinite(inputs.currentTemp) ? inputs.currentTemp : null;
    if (indoorTemp === null) return;

    if (this.homey) {
      try {
        this.homey.settings.set('optimizer_last_indoor_temp', indoorTemp);
        this.homey.settings.set('optimizer_last_indoor_temp_ts', nowMs);
      } catch { }
    }

    if (
      inputs.previousIndoorTemp !== null &&
      inputs.previousIndoorTempTs !== null &&
      nowMs - inputs.previousIndoorTempTs >= 20 * 60 * 1000 &&
      Math.abs(indoorTemp - inputs.previousIndoorTemp) < 5
    ) {
      const observedDelta = indoorTemp - inputs.previousIndoorTemp;
      const updatedThermalResponse = updateThermalResponse(inputs.thermalResponse, observedDelta, zone1Result.expectedDelta, {
        alpha: 0.1,
        min: 0.5,
        max: 1.5
      });
      if (Math.abs(updatedThermalResponse - inputs.thermalResponse) > 1e-6) {
        if (this.homey) {
          try {
            this.homey.settings.set('thermal_response', updatedThermalResponse);
          } catch { }
        }
        logger('optimizer.thermal.update', {
          previous: inputs.thermalResponse,
          observedDelta,
          expectedDelta: zone1Result.expectedDelta,
          updated: updatedThermalResponse
        });
      }
    }
  }

  private handleOptimizationError(error: unknown, logger: DecisionLogger): EnhancedOptimizationResult {
    if (error instanceof OptimizationAbort) {
      return error.result;
    }

    const err = (error instanceof Error) ? error : new Error(String(error));
    this.logger.error('Enhanced optimization failed', err);
    const fallbackBand = this.getCurrentComfortBand();
    return {
      success: false,
      action: 'no_change',
      fromTemp: fallbackBand.minTemp,
      toTemp: fallbackBand.minTemp,
      reason: `Enhanced optimization failed: ${err.message} `,
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

    const currencyCode = this.getCurrency();
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
      const gridFee = this.getGridFee();
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
    success?: boolean;
  }> {
    this.logger.log('Starting weekly calibration');

    const clampK = (value: number): number => Math.min(10, Math.max(0.1, value));
    const clampS = (value: number): number => Math.min(1, Math.max(0.01, value));
    const DEFAULT_S = 0.7;

    // Get current thermal model
    const thermalModel = this.thermalController.getThermalModel();
    if (!thermalModel) {
      return {
        oldK: 0,
        newK: 0,
        newS: 0,
        timestamp: new Date().toISOString(),
        success: false,
        analysis: 'No thermal model available'
      };
    }

    try {
      const oldK = thermalModel.K;
      const oldS = thermalModel.S || 0;

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
          const baseK = oldK;
          const rawK = confidence > 0.3
            ? (characteristics.heatingRate / 0.5) * baseK
            : baseK;
          const newK = clampK(rawK);

          const thermalMass = characteristics.thermalMass;
          const rawS = (typeof thermalMass === 'number' && Number.isFinite(thermalMass))
            ? thermalMass
            : (typeof oldS === 'number' ? oldS : (typeof thermalModel.S === 'number' ? thermalModel.S : DEFAULT_S));
          const newS = clampS(rawS);

          // Update thermal model
          this.thermalController.setThermalModel(newK, newS);

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
            oldK: oldK,
            newK,
            oldS: oldS,
            newS,
            timestamp: new Date().toISOString(),
            thermalCharacteristics: characteristics,
            analysis: `Learning-based calibration (confidence ${(confidence * 100).toFixed(0)}%)`,
            success: true
          };
        } catch (modelError) {
          this.logger.error('Error updating thermal model from learning data:', modelError);
          // Fall back to basic calibration
        }
      }

      // Basic calibration (used as fallback or when thermal learning is disabled)
      const baseK = oldK;
      const newK = clampK(baseK * (0.9 + Math.random() * 0.2));
      const rawS = typeof oldS === 'number'
        ? oldS
        : (typeof thermalModel.S === 'number' ? thermalModel.S : DEFAULT_S);
      const newS = clampS(rawS);

      // Update thermal model
      this.thermalController.setThermalModel(newK, newS);
      this.logger.log(`Weekly calibration updated K-factor: ${oldK.toFixed(2)} -> ${newK.toFixed(2)}`);

      // Return result
      return {
        oldK: oldK,
        newK,
        oldS: oldS,
        newS,
        timestamp: new Date().toISOString(),
        method: 'basic',
        analysis: 'Basic calibration applied (learning data unavailable)',
        success: true
      };
    } catch (error) {
      this.logger.error('Error in weekly calibration', error);
      this.handleApiError(error);
      return {
        oldK: thermalModel.K,
        newK: thermalModel.K,
        oldS: thermalModel.S || 0,
        newS: thermalModel.S || 0,
        timestamp: new Date().toISOString(),
        success: false,
        analysis: `Calibration failed: ${(error as Error).message}`
      };
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
   * @param futurePriceFactors Optional array of future price factors relative to current price
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
      if (!this.priceAnalyzer.hasPriceProvider()) {
        throw new Error('Price provider not initialized');
      }
      const pd = await this.priceAnalyzer.getPriceData();
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

      if (this.priceAnalyzer.hasPriceProvider()) {
        const pd = await this.priceAnalyzer.getPriceData();
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
