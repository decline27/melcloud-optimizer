import * as https from 'https';
import type { CronJob } from 'cron';
import { TimelineEventType, TimelineHelperWrapper } from './timeline-helper-wrapper';
import { MelCloudApi as MelCloudService } from './src/services/melcloud-api';
import { TibberApi as TibberService } from './src/services/tibber-api';
import type { Optimizer } from './src/services/optimizer';
import { DeviceInfo, TibberPriceInfo } from './src/types';
import type { ServiceState, HistoricalData } from './src/orchestration/service-manager';
import {
  applyServiceOverrides,
  getServiceState,
  getServiceStateSnapshot,
  initializeServices as ensureServicesInitialized,
  resetServiceState,
  setHistoricalData as setOrchestratorHistoricalData,
  updateOptimizerSettings as orchestratorUpdateSettings,
  saveHistoricalData
} from './src/orchestration/service-manager';

type JsonValue = Record<string, unknown> | unknown[] | string | number | boolean | null;

type SystemHealthCheckResult = {
  healthy: boolean;
  issues?: string[];
  recovered?: boolean;
  [key: string]: unknown;
};

interface HomeySettingsLike {
  get(key: string): any;
  set(key: string, value: any): Promise<void> | void;
  unset?(key: string): Promise<void> | void;
}

interface HomeyLoggerLike {
  log(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
  debug?(message: string, ...args: any[]): void;
  warn?(message: string, ...args: any[]): void;
  logger?: {
    info(message: string, meta?: Record<string, unknown>): void;
  };
  flow?: {
    runFlowCardAction(options: { uri: string; args: Record<string, unknown> }): Promise<void> | void;
  };
  runSystemHealthCheck?: () => Promise<SystemHealthCheckResult>;
  hourlyJob?: CronJob | null;
  weeklyJob?: CronJob | null;
  homey?: { settings?: HomeySettingsLike };
}

interface HomeyLike {
  app: HomeyLoggerLike;
  settings: HomeySettingsLike;
  timeline?: {
    createEntry(options: { title: string; body: string; icon?: string; type?: string }): Promise<void> | void;
  };
  notifications?: {
    createNotification(options: { excerpt: string }): Promise<void> | void;
  };
  flow?: {
    runFlowCardAction(options: { uri: string; args: Record<string, unknown> }): Promise<void> | void;
  };
  i18n?: {
    getCurrency(): string | undefined;
  };
}

interface LoggerLike {
  log(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
  warn?(message: string, ...args: any[]): void;
  debug?(message: string, ...args: any[]): void;
  homey?: { settings?: HomeySettingsLike };
}

type RetryableError = NodeJS.ErrnoException & { message: string };

type ApiLogger = LoggerLike & { homey?: { settings?: HomeySettingsLike } };

interface ApiHandlerContext {
  homey: HomeyLike;
  body?: unknown;
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
}

type ApiSuccess<T extends object = Record<string, unknown>> = { success: true } & T;

interface ApiError {
  success: false;
  error?: string;
  message?: string;
  needsConfiguration?: boolean;
  [key: string]: unknown;
}

type ApiResult<T extends object = Record<string, unknown>> = ApiSuccess<T> | ApiError;

interface SavingsDebugDump {
  timestamp: string;
  settings: {
    grid_fee_per_kwh: number;
    baseline_hourly_consumption_kwh: number;
    currency: string;
    time_zone_offset: unknown;
    use_dst: unknown;
    log_level: unknown;
  };
  savings_history: {
    length: number;
    head: unknown[];
    tail: unknown[];
  };
  optimizations_memory: {
    length: number;
    head: unknown[];
    tail: unknown[];
  };
  tibber: Record<string, unknown> | null;
  priceFactorsCount: number;
  sampleProjectionFromLastHour: unknown;
}

type SavingsSummarySeriesEntry = {
  date: string;
  total: number;
};

interface SavingsHistoryEntry {
  date: string;
  total?: number;
  totalMinor?: number;
  decimals?: number;
  currency?: string;
  [key: string]: unknown;
}

interface SavingsSummaryStats {
  today: number;
  yesterday: number;
  weekToDate: number;
  last7Days: number;
  monthToDate: number;
  last30Days: number;
  allTime?: number;
}

interface SavingsSummaryResponseData {
  summary: SavingsSummaryStats;
  todayDate: string;
  historyDays: number;
  currencyCode: string;
  timestamp: string;
  series: {
    last30: SavingsSummarySeriesEntry[];
  };
}

interface DeviceDropdownItem {
  id: string;
  name: string;
  buildingId: number;
  type: string;
  hasZone1: boolean;
  hasZone2: boolean;
  hasTank: boolean;
  SetTankWaterTemperature?: number | null;
  TankWaterTemperature?: number | null;
  currentTemperatureZone1?: number | null;
  currentTemperatureZone2?: number | null;
  currentSetTemperatureZone1?: number | null;
  currentSetTemperatureZone2?: number | null;
}

interface BuildingDropdownItem {
  id: number;
  name: string;
  devices: string[];
}

type EnhancedOptimizationResult = Awaited<ReturnType<Optimizer['runEnhancedOptimization']>>;

type WeeklyCalibrationResult = Awaited<ReturnType<Optimizer['runWeeklyCalibration']>>;

type AugmentedOptimizationResult = EnhancedOptimizationResult & {
  timestamp?: string;
  targetTemp?: number;
  targetOriginal?: number;
  indoorTemp?: number;
  outdoorTemp?: number;
  priceNow?: number;
  comfort?: number;
  zone2Temperature?: {
    fromTemp?: number;
    toTemp?: number;
    targetTemp?: number;
    targetOriginal?: number;
  };
  tankTemperature?: {
    fromTemp?: number;
    toTemp?: number;
    targetTemp?: number;
    targetOriginal?: number;
  };
};

async function syncDevicesWithOptimizationResult(homey: any, result: AugmentedOptimizationResult): Promise<void> {
  try {
    if (!result) return;

    const driver = (homey.drivers && typeof homey.drivers.getDriver === 'function')
      ? homey.drivers.getDriver('boiler')
      : null;

    if (!driver || typeof driver.getDevices !== 'function') {
      return;
    }

    const devices = driver.getDevices();
    if (!Array.isArray(devices) || devices.length === 0) {
      return;
    }

    const zone1Target = typeof result.toTemp === 'number' ? result.toTemp : undefined;
    const zone2Target = result.zone2Data && typeof result.zone2Data.toTemp === 'number' ? result.zone2Data.toTemp : undefined;
    const tankTarget = result.tankData && typeof result.tankData.toTemp === 'number' ? result.tankData.toTemp : undefined;

    await Promise.allSettled(devices.map(async (device: any) => {
      try {
        if (zone1Target !== undefined && device?.hasCapability?.('target_temperature')) {
          const current = device.getCapabilityValue?.('target_temperature');
          if (current !== zone1Target) {
            await device.setCapabilityValue('target_temperature', zone1Target);
          }
        }

        if (zone2Target !== undefined && device?.hasCapability?.('target_temperature.zone2')) {
          const currentZone2 = device.getCapabilityValue?.('target_temperature.zone2');
          if (currentZone2 !== zone2Target) {
            await device.setCapabilityValue('target_temperature.zone2', zone2Target);
          }
        }

        if (tankTarget !== undefined && device?.hasCapability?.('target_temperature.tank')) {
          const currentTank = device.getCapabilityValue?.('target_temperature.tank');
          if (currentTank !== tankTarget) {
            await device.setCapabilityValue('target_temperature.tank', tankTarget);
          }
        }
      } catch (deviceErr: any) {
        homey.app.error('Failed to synchronize device capability after optimization:', deviceErr?.message ?? String(deviceErr));
      }
    }));
  } catch (err: any) {
    homey.app.error('Error syncing device capabilities after optimization:', err?.message ?? String(err));
  }
}

type HourlyOptimizationData = {
  action: EnhancedOptimizationResult['action'];
  fromTemp: number;
  toTemp: number;
  reason: string;
  priceData: EnhancedOptimizationResult['priceData'];
  priceNow?: number;
  savings: number;
  hourlyBaselineKWh: number | null;
  timestamp: string;
};

interface ThermalModelDataPoint {
  timestamp: string;
  targetTemp: number | null | undefined;
  indoorTemp: number | null | undefined;
  outdoorTemp: number | null | undefined;
  priceNow: number | null | undefined;
}

interface ThermalModelResponseData {
  optimizationCount: number;
  lastOptimization: Record<string, unknown> | null;
  lastCalibration: Record<string, unknown> | null;
  kFactor: number | null;
  dataPoints: ThermalModelDataPoint[];
}

type GetSavingsDebugStateResponse = ApiResult<{ dump: SavingsDebugDump }>;
type GetSavingsSummaryResponse = ApiResult<SavingsSummaryResponseData>;
type GetLogSavingsSummaryClickedResponse = ApiResult<{ timestamp: string }>;
type UpdateOptimizerSettingsResponse = ApiResult<{ message: string }>;
type GetDeviceListResponse = ApiResult<{ devices: DeviceDropdownItem[]; buildings: BuildingDropdownItem[] }>;
type GetRunHourlyOptimizerResponse = ApiResult<{ message: string; data: HourlyOptimizationData; result: EnhancedOptimizationResult }>;
type GetThermalModelDataResponse = ApiResult<{ data: ThermalModelResponseData }>;
type GetRunWeeklyCalibrationResponse = ApiResult<{ message?: string; result?: WeeklyCalibrationResult; historicalDataCount?: number }>;

type CronJobSnapshot = {
  running: boolean;
  nextRun?: string;
  cronTime?: string;
  error?: string;
};

interface CronStatusSnapshot {
  hourlyJob: CronJobSnapshot;
  weeklyJob: CronJobSnapshot;
  lastHourlyRun: string;
  lastWeeklyRun: string;
  lastUpdated?: string;
}

type GetStartCronJobsResponse = ApiResult<{ message: string; hourlyJobRunning: boolean; weeklyJobRunning: boolean }>;
type GetUpdateCronStatusResponse = ApiResult<{ message: string; cronStatus: CronStatusSnapshot }>;
type GetCheckCronStatusResponse = ApiResult<{
  currentTime: string;
  hourlyJob: CronJobSnapshot;
  weeklyJob: CronJobSnapshot;
  lastHourlyRun: string;
  lastWeeklyRun: string;
}>;

type GetCopDataResponse = ApiResult<{
  melcloud: unknown;
  helper: unknown;
  settings: {
    copWeight: number;
    autoSeasonalMode: boolean;
    summerMode: boolean;
  };
}>;

type GetWeeklyAverageCopResponse = ApiResult<{
  melcloud: unknown;
  helper: {
    heating: unknown;
    hotWater: unknown;
  };
}>;

interface ConnectionStatusResponse {
  connected: boolean;
  error?: string;
  needsConfiguration?: boolean;
  devices?: number;
  reconnected?: boolean;
  pricePoints?: number;
}

type GetMemoryUsageResponse = ApiResult<{
  processMemory: Record<string, number | string>;
  thermalModelMemory: unknown;
  timestamp: string;
}>;

type RunThermalDataCleanupResponse = ApiResult<Record<string, unknown>>;

type InternalCleanupResponse = ApiResult<{ message: string }>;

interface HotWaterServiceLike {
  resetPatterns(): void;
  clearData(clearAggregated: boolean): Promise<void>;
}

type HotWaterResponse = ApiResult<{ message: string }>;

interface HotWaterClearRequest {
  clearAggregated?: boolean;
}

interface HotWaterHandlers {
  'reset-patterns'(context: ApiHandlerContext): Promise<HotWaterResponse>;
  'clear-data'(context: ApiHandlerContext): Promise<HotWaterResponse>;
}

interface ApiHandlers {
  updateOptimizerSettings(context: ApiHandlerContext): Promise<UpdateOptimizerSettingsResponse>;
  getSavingsDebugState(context: ApiHandlerContext): Promise<GetSavingsDebugStateResponse>;
  getSavingsSummary(context: ApiHandlerContext): Promise<GetSavingsSummaryResponse>;
  getLogSavingsSummaryClicked(context: ApiHandlerContext): Promise<GetLogSavingsSummaryClickedResponse>;
  getDeviceList(context: ApiHandlerContext): Promise<GetDeviceListResponse>;
  getRunHourlyOptimizer(context: ApiHandlerContext): Promise<GetRunHourlyOptimizerResponse>;
  getThermalModelData(context: ApiHandlerContext): Promise<GetThermalModelDataResponse>;
  getRunWeeklyCalibration(context: ApiHandlerContext): Promise<GetRunWeeklyCalibrationResponse>;
  getStartCronJobs(context: ApiHandlerContext): Promise<GetStartCronJobsResponse>;
  getUpdateCronStatus(context: ApiHandlerContext): Promise<GetUpdateCronStatusResponse>;
  getCheckCronStatus(context: ApiHandlerContext): Promise<GetCheckCronStatusResponse>;
  getCOPData(context: ApiHandlerContext): Promise<GetCopDataResponse>;
  getWeeklyAverageCOP(context: ApiHandlerContext): Promise<GetWeeklyAverageCopResponse>;
  getMelCloudStatus(context: ApiHandlerContext): Promise<ConnectionStatusResponse>;
  getTibberStatus(context: ApiHandlerContext): Promise<ConnectionStatusResponse>;
  runSystemHealthCheck(context: ApiHandlerContext): Promise<SystemHealthCheckResult>;
  getMemoryUsage(context: ApiHandlerContext): Promise<GetMemoryUsageResponse>;
  runThermalDataCleanup(context: ApiHandlerContext): Promise<RunThermalDataCleanupResponse>;
  internalCleanup(context: ApiHandlerContext): Promise<InternalCleanupResponse>;
  'hot-water': HotWaterHandlers;
}

declare global {
  // Legacy globals used by the runtime layer (kept as any during migration)
  // eslint-disable-next-line no-var
  var hourlyJob: CronJob | null | undefined;
  // eslint-disable-next-line no-var
  var weeklyJob: CronJob | null | undefined;
}

/**
 * Helper function to pretty-print JSON data
 * @param {Object} data - The data to format
 * @param {string} [label] - Optional label for the output
 * @param {Object} [logger] - Logger object with log level
 * @param {number} [minLogLevel=0] - Minimum log level to print (0=DEBUG, 1=INFO, 2=WARN, 3=ERROR)
 * @returns {string} - Formatted string
 */
function prettyPrintJson(
  data: JsonValue,
  label = '',
  logger: LoggerLike | null = null,
  minLogLevel = 0
): string {
  try {
    // Check if we should print based on log level
    // Only print detailed JSON if we're in development mode or debug log level
    const logLevel = logger?.homey?.settings?.get('log_level') || 1; // Default to INFO level
    const isDevelopment = process.env.HOMEY_APP_MODE === 'development' || process.env.NODE_ENV === 'development';

    // Skip detailed output if we're in production and log level is higher than minLogLevel
    if (!isDevelopment && logLevel > minLogLevel) {
      return `[${label}] (Output suppressed in production mode with log level ${logLevel})`;
    }

    // Create a header with the label
    const header = label ? `\n===== ${label} =====\n` : '\n';

    // Format the JSON with indentation
    const formatted = JSON.stringify(data, null, 2);

    // Add some visual separation
    const footer = '\n' + '='.repeat(40) + '\n';

    return header + formatted + footer;
  } catch (error: any) {
    return `Error formatting JSON: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// Helper function for making HTTP requests with retry capability
async function httpRequest(
  options: https.RequestOptions,
  data: JsonValue = null,
  maxRetries = 3,
  retryDelay = 1000,
  logger: LoggerLike | null = null
): Promise<any> {
  let lastError: RetryableError | null = null;
  const logLevel = logger?.homey?.settings?.get('log_level') || 1; // Default to INFO level
  const isDevelopment = process.env.HOMEY_APP_MODE === 'development' || process.env.NODE_ENV === 'development';

  // Helper function to log based on level
  const log = (message: string, level = 1) => {
    // Always log in development mode or if log level is appropriate
    if (isDevelopment || logLevel <= level) {
      if (logger && logger.log) {
        logger.log(message);
      } else {
        console.log(message);
      }
    }
  };

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      // If this is a retry, log it
      if (attempt > 1) {
        log(`Retry attempt ${attempt - 1}/${maxRetries} for ${options.method} request to ${options.hostname}${options.path}`, 1);
      } else {
        log(`Making ${options.method} request to ${options.hostname}${options.path}`, 1);
      }

      // Create a new promise for this attempt
      const result = await new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
          let responseData = '';

          // Log response status
          const statusCode = res.statusCode ?? 0;
          const statusMessage = res.statusMessage ?? '';
          log(`Response status: ${statusCode} ${statusMessage}`, 1);

          res.on('data', (chunk: Buffer | string) => {
            responseData += chunk;
          });

          res.on('end', () => {
            // Check if we got a redirect
            if (statusCode >= 300 && statusCode < 400) {
              const location = res.headers.location;
              log(`Received redirect to: ${location}`, 1);
              reject(new Error(`Received redirect to: ${location}`));
              return;
            }

            // Check if we got an error
            if (statusCode >= 400) {
              log(`Error response: ${responseData.substring(0, 200)}...`, 1);
              reject(new Error(`HTTP error ${statusCode}: ${statusMessage}`));
              return;
            }

            // Try to parse as JSON
            try {
              // Only log response details in development mode or debug level
              if (isDevelopment || logLevel <= 0) {
                log(`Response data (first 100 chars): ${responseData.substring(0, 100)}...`, 0);
              }

              const parsedData = JSON.parse(responseData);

              // We'll let the calling function handle the pretty printing of the full response
              // since it has more context about what the data represents

              resolve(parsedData);
            } catch (error: any) {
              log(`Failed to parse response as JSON. First 200 chars: ${responseData.substring(0, 200)}...`, 1);
              reject(new Error(`Failed to parse response: ${error instanceof Error ? error.message : String(error)}`));
            }
          });
        });

        req.on('error', (error: RetryableError) => {
          log(`Request error: ${error.message}`, 1);
          reject(error);
        });

        // Set a timeout to prevent hanging requests
        req.setTimeout(30000, () => {
          req.destroy();
          reject(new Error('Request timeout after 30 seconds'));
        });

        if (data !== null && data !== undefined) {
          const dataStr = JSON.stringify(data);
          // Only log request data in development mode or debug level
          if (isDevelopment || logLevel <= 0) {
            log(`Request data: ${dataStr.substring(0, 100)}...`, 0);
          }
          req.write(dataStr);
        }

        req.end();
      });

      // If we get here, the request was successful
      return result;

    } catch (error: any) {
      lastError = error as RetryableError;

      // Determine if we should retry based on the error
      const err = lastError;
      const isRetryable = (
        // Network errors are retryable
        err?.code === 'ECONNRESET' ||
        err?.code === 'ETIMEDOUT' ||
        err?.code === 'ECONNREFUSED' ||
        err?.code === 'ENETUNREACH' ||
        // Timeout errors are retryable
        err?.message.includes('timeout') ||
        // Some HTTP errors are retryable (e.g., 500, 502, 503, 504)
        (err?.message.includes('HTTP error') &&
         (err.message.includes('500') ||
          err.message.includes('502') ||
          err.message.includes('503') ||
          err.message.includes('504')))
      );

      // If this error is not retryable, or we've used all our retries, throw the error
      if (!isRetryable || attempt > maxRetries) {
        log(`Request failed after ${attempt} attempt(s): ${err?.message ?? 'Unknown error'}`, 1);
        throw err;
      }

      // Wait before retrying
      log(`Waiting ${retryDelay}ms before retry...`, 1);
      await new Promise(resolve => setTimeout(resolve, retryDelay));

      // Increase the delay for the next retry (exponential backoff)
      retryDelay *= 2;
    }
  }

  // This should never happen, but just in case
  throw lastError || new Error('Request failed for unknown reason');
}

// Optimizer Service
// Create instances of services
const serviceState = getServiceState();
let melCloud = serviceState.melCloud;
let tibber = serviceState.tibber;
let weather = serviceState.weather;
let optimizer = serviceState.optimizer;

// Store historical data for weekly calibration
let historicalData = serviceState.historicalData;

function persistHistoricalData(homey: HomeyLike): void {
  setOrchestratorHistoricalData(historicalData);
  saveHistoricalData(homey);
  historicalData = getServiceState().historicalData;
}

function recordOptimizationEntry(
  homey: HomeyLike,
  optimizationResult: AugmentedOptimizationResult,
  savingsValue: number
): void {
  if (!historicalData || !Array.isArray(historicalData.optimizations)) {
    historicalData = { optimizations: [], lastCalibration: null };
  }

  try {
    const timestamp = typeof optimizationResult.timestamp === 'string'
      ? optimizationResult.timestamp
      : new Date().toISOString();
    const targetTemp = typeof optimizationResult.toTemp === 'number'
      ? optimizationResult.toTemp
      : (typeof optimizationResult.targetTemp === 'number' ? optimizationResult.targetTemp : null);
    const targetOriginal = typeof optimizationResult.fromTemp === 'number'
      ? optimizationResult.fromTemp
      : (typeof optimizationResult.targetOriginal === 'number' ? optimizationResult.targetOriginal : null);
    const priceNow = typeof optimizationResult.priceData?.current === 'number'
      ? optimizationResult.priceData.current
      : (typeof optimizationResult.priceNow === 'number' ? optimizationResult.priceNow : null);
    const comfort = typeof (optimizationResult as { comfort?: number }).comfort === 'number'
      ? (optimizationResult as { comfort?: number }).comfort
      : null;

    const entry = {
      timestamp,
      action: optimizationResult?.action ?? 'unknown',
      reason: optimizationResult?.reason ?? '',
      targetTemp,
      targetOriginal,
      indoorTemp: null,
      outdoorTemp: null,
      priceNow,
      savings: Number.isFinite(savingsValue) ? Number(savingsValue.toFixed(4)) : (optimizationResult?.savings ?? 0),
      comfort,
      priceData: optimizationResult?.priceData ?? null,
      weather: optimizationResult?.weather ?? null,
      zone2Data: optimizationResult?.zone2Data ?? null,
      tankData: optimizationResult?.tankData ?? null
    };

    historicalData.optimizations.push(entry);
    if (historicalData.optimizations.length > 168) {
      historicalData.optimizations.shift();
    }

    persistHistoricalData(homey);
  } catch (error) {
    homey?.app?.error?.('Failed to record optimization entry', error as any);
  }
}

function requireMelCloud(): MelCloudService {
  if (!melCloud) {
    throw new Error('MELCloud service not initialized');
  }
  return melCloud;
}

function requireTibber(): TibberService {
  if (!tibber) {
    throw new Error('Tibber service not initialized');
  }
  return tibber;
}

function requireOptimizer(): Optimizer {
  if (!optimizer) {
    throw new Error('Optimizer service not initialized');
  }
  return optimizer;
}

function getHotWaterService(homey: HomeyLike): HotWaterServiceLike | null {
  const appWithService = homey.app as HomeyLoggerLike & { hotWaterService?: HotWaterServiceLike | null };
  const service = appWithService.hotWaterService ?? null;
  if (!service) return null;
  if (typeof service.resetPatterns !== 'function' || typeof service.clearData !== 'function') {
    return null;
  }
  return service;
}

// NOTE: test helper attachment moved to after module.exports to avoid being
// overwritten by the public export object.

// Initialize services
async function initializeServices(homey: HomeyLike): Promise<void> {
  const state = await ensureServicesInitialized(homey);
  melCloud = state.melCloud;
  tibber = state.tibber;
  optimizer = state.optimizer;
  weather = state.weather;
  historicalData = state.historicalData;
}

// Function to update optimizer settings from Homey settings
// This is exported so it can be called from the app.ts file
async function refreshOptimizerSettings(homey: HomeyLike): Promise<void> {
  await orchestratorUpdateSettings(homey);
  const state = getServiceState();
  optimizer = state.optimizer;
  historicalData = state.historicalData;
}

const apiHandlers: ApiHandlers = {
  /**
   * Dump savings-related in-memory state and settings for debugging.
   * Logs a pretty-printed snapshot to the terminal and returns a compact JSON.
   */
  getSavingsDebugState: async ({ homey }: ApiHandlerContext) => {
    try {
      const settingsSnapshot = {
        grid_fee_per_kwh: homey.settings.get('grid_fee_per_kwh') || 0,
        baseline_hourly_consumption_kwh: homey.settings.get('baseline_hourly_consumption_kwh') || 0,
        currency: homey.settings.get('currency') || homey.settings.get('currency_code') || '',
        time_zone_offset: homey.settings.get('time_zone_offset'),
        use_dst: homey.settings.get('use_dst'),
        log_level: homey.settings.get('log_level')
      };

      const hist = homey.settings.get('savings_history') || [];
      const histLen = Array.isArray(hist) ? hist.length : 0;
      const histHead = Array.isArray(hist) ? hist.slice(0, 3) : [];
      const histTail = Array.isArray(hist) ? hist.slice(-3) : [];

      // Optimization history from API memory (use module-scope variable, not global)
      const optData = (typeof historicalData !== 'undefined' && historicalData)
        ? historicalData
        : { optimizations: [], lastCalibration: null };
      const optLen = Array.isArray(optData.optimizations) ? optData.optimizations.length : 0;
      const optHead = Array.isArray(optData.optimizations) ? optData.optimizations.slice(0, 3) : [];
      const optTail = Array.isArray(optData.optimizations) ? optData.optimizations.slice(-3) : [];

      // Current Tibber prices and effective price factors for projection
      let priceSnapshot = null;
      let factors = [];
      try {
        const gridFee = Number(settingsSnapshot.grid_fee_per_kwh) || 0;
        const tibberService = requireTibber();
        const pd = await tibberService.getPrices();
        const now = new Date();
        const currEff = (Number(pd.current?.price) || 0) + gridFee;
        const up = Array.isArray(pd.prices) ? pd.prices.filter(p => new Date(p.time) > now).slice(0, 24) : [];
        factors = currEff > 0 ? up.map(p => (((Number(p.price) || 0) + gridFee) / currEff)) : [];
        priceSnapshot = {
          current: pd.current,
          upcomingCount: up.length,
          currentEffective: currEff,
          firstUpcoming: up[0] || null,
          lastUpcoming: up[up.length - 1] || null
        };
      } catch (e: any) {
        priceSnapshot = { error: e && e.message ? e.message : String(e) };
      }

      // Try a quick projection using the current optimizer hourlySavings=last opt.savings
      let quickProjection = null;
      try {
        const lastOpt = optTail && optTail.length > 0 ? optTail[optTail.length - 1] : null;
        const s = lastOpt && typeof lastOpt.savings === 'number' ? lastOpt.savings : 0;
        const activeOptimizer = optimizer;
        if (s && activeOptimizer && typeof activeOptimizer.calculateDailySavings === 'function') {
          quickProjection = await activeOptimizer.calculateDailySavings(s, historicalData?.optimizations || []);
        }
      } catch (_: any) {}

      const dump = {
        timestamp: new Date().toISOString(),
        settings: settingsSnapshot,
        savings_history: { length: histLen, head: histHead, tail: histTail },
        optimizations_memory: { length: optLen, head: optHead, tail: optTail },
        tibber: priceSnapshot,
        priceFactorsCount: factors.length,
        sampleProjectionFromLastHour: quickProjection
      };

      // Pretty print to terminal using our helper (respects log level)
      const pretty = prettyPrintJson(dump, 'SavingsDebugState', homey.app, 1);
      homey.app.log(pretty);

      return { success: true, dump };
    } catch (err: any) {
      homey.app.error('Error in getSavingsDebugState:', err);
      return { success: false, error: err && err.message ? err.message : String(err) };
    }
  },
  
  /**
   * Return a savings summary using persisted savings history in Homey settings.
   * Computes today, last 7 days (incl. today), and last 30 days (rolling).
   */
  getSavingsSummary: async ({ homey }: ApiHandlerContext) => {
    try {
      // Log like other endpoints (both console and app logger)
      console.log('API method getSavingsSummary called');
      homey.app.log('API method getSavingsSummary called');

      // Helper to get local date string YYYY-MM-DD using Homey time zone settings
      const getLocalDateString = () => {
        try {
          const tzOffset = parseInt(homey.settings.get('time_zone_offset'));
          const useDST = !!homey.settings.get('use_dst');
          const now = new Date();
          const local = new Date(now.getTime());
          if (!isNaN(tzOffset)) local.setUTCHours(now.getUTCHours() + tzOffset);
          // Simple EU DST approximation (same approach used elsewhere in this codebase)
          if (useDST) {
            const m = now.getUTCMonth();
            if (m > 2 && m < 10) {
              local.setUTCHours(local.getUTCHours() + 1);
            }
          }
          // Use local getters after applying offset math above to match app.ts behavior
          const y = local.getFullYear();
          const mo = String(local.getMonth() + 1).padStart(2, '0');
          const d = String(local.getDate()).padStart(2, '0');
          return `${y}-${mo}-${d}`;
        } catch (e: any) {
          // Fallback to system date if anything goes wrong
          const d = new Date();
          const y = d.getFullYear();
          const mo = String(d.getMonth() + 1).padStart(2, '0');
          const dd = String(d.getDate()).padStart(2, '0');
          return `${y}-${mo}-${dd}`;
        }
      };

      const historyRaw = homey.settings.get('savings_history') as unknown;
      const rawHistory = Array.isArray(historyRaw) ? historyRaw : [];
      const normalized: SavingsHistoryEntry[] = Array.isArray(historyRaw)
        ? historyRaw.filter((h): h is SavingsHistoryEntry => !!h && typeof h.date === 'string')
        : [];
      // Determine reference "today" date. Prefer the newest history date to avoid TZ drift.
      const latestHistoryDate = normalized.length > 0
        ? normalized
          .map(h => h.date)
          .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
          .pop()
        : undefined;

      const todayStr = latestHistoryDate ?? getLocalDateString();

      const todayDate = new Date(`${todayStr}T00:00:00`);
      const last7Cutoff = new Date(todayDate);
      last7Cutoff.setDate(todayDate.getDate() - 6);
      const last30Cutoff = new Date(todayDate);
      last30Cutoff.setDate(todayDate.getDate() - 29);
      // Week-to-date (ISO week, Monday start)
      const jsDay = todayDate.getDay(); // 0=Sun..6=Sat
      const offsetToMonday = (jsDay + 6) % 7; // days since Monday
      const startOfWeek = new Date(todayDate);
      startOfWeek.setDate(todayDate.getDate() - offsetToMonday);
      // Month-to-date: first day of current month
      const startOfMonth = new Date(todayDate.getFullYear(), todayDate.getMonth(), 1);

      // Helper for currency decimals
      const defaultDecimalsForCurrency = (code: string | undefined): number => {
        const decimalsMap: Record<string, number> = { JPY: 0, KWD: 3 };
        const key = String(code || '').toUpperCase();
        return decimalsMap[key] ?? 2;
      };
      // Convert an entry to major units, supporting legacy and new formats, clamped to >= 0
      const getEntryTotalMajor = (entry: SavingsHistoryEntry | undefined): number => {
        const h = entry;
        if (!h) return 0;
        let v;
        if (h.total !== undefined) {
          v = Number(h.total);
        } else if (h.totalMinor !== undefined) {
          const minor = Number(h.totalMinor);
          const decimals = Number.isFinite(Number(h.decimals)) ? Number(h.decimals) : defaultDecimalsForCurrency(h.currency);
          v = Number.isFinite(minor) ? minor / Math.pow(10, decimals) : 0;
        } else {
          v = 0;
        }
        v = Number.isFinite(v) ? v : 0;
        return v < 0 ? 0 : v; // positive-only for summaries
      };

      const sumInWindow = (cutoff: Date): number => normalized
        .filter(h => {
          const d = new Date(`${h.date}T00:00:00`);
          return d >= cutoff && d <= todayDate;
        })
        .reduce((sum, h) => sum + getEntryTotalMajor(h), 0);

      const todayEntry = normalized.find(h => h.date === todayStr);
      const today = Number(getEntryTotalMajor(todayEntry).toFixed(4));
      // Yesterday
      const yDate = new Date(todayDate); yDate.setDate(todayDate.getDate() - 1);
      const yStr = `${yDate.getFullYear()}-${String(yDate.getMonth() + 1).padStart(2, '0')}-${String(yDate.getDate()).padStart(2, '0')}`;
      const yesterday = Number(getEntryTotalMajor(normalized.find(h => h.date === yStr)).toFixed(4));
      const last7Days = Number(sumInWindow(last7Cutoff).toFixed(4));
      const last30Days = Number(sumInWindow(last30Cutoff).toFixed(4));
      const weekToDate = Number(sumInWindow(startOfWeek).toFixed(4));
      const monthToDate = Number(sumInWindow(startOfMonth).toFixed(4));

      // Determine if history extends beyond 30 days
      let allTime;
      if (normalized.length > 0) {
        const earliest = normalized
          .map(h => h.date)
          .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))[0];
        if (earliest) {
          const earliestDate = new Date(`${earliest}T00:00:00`);
          if (earliestDate < last30Cutoff) {
            const at = normalized.reduce((sum, h) => sum + getEntryTotalMajor(h), 0);
            allTime = Number(at.toFixed(4));
          }
        }
      }

      // Build contiguous 30-day series for charting (fill missing as 0)
      const seriesLast30 = [];
      for (let i = 0; i < 30; i++) {
        const d = new Date(last30Cutoff);
        d.setDate(last30Cutoff.getDate() + i);
        const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const entry = normalized.find(h => h.date === ds);
        seriesLast30.push({ date: ds, total: Number(getEntryTotalMajor(entry) || 0) });
      }

      const currencyCode = homey.settings.get('currency') || homey.settings.get('currency_code') || '';

      // Log brief summary for visibility
      try {
        homey.app.log(`Savings summary: today=${today.toFixed(2)}, last7=${last7Days.toFixed(2)}, mtd=${monthToDate.toFixed(2)}, last30=${last30Days.toFixed(2)}${allTime !== undefined ? ", allTime=" + allTime.toFixed(2) : ''}`);
      } catch (_: any) {}

      // Detailed debug info to help diagnose zeros
      try {
        const seriesSum = seriesLast30.reduce((s, n) => s + Number(n.total || 0), 0);
        const debugInfo = {
          settings: {
            time_zone_offset: homey.settings.get('time_zone_offset'),
            use_dst: homey.settings.get('use_dst'),
            currency: currencyCode
          },
          history: {
            rawLength: rawHistory.length,
            normalizedLength: normalized.length,
            sampleFirst: normalized.slice(0, 3),
            sampleLast: normalized.slice(-3)
          },
          dates: {
            todayStr,
            last7Cutoff: `${last7Cutoff.getFullYear()}-${String(last7Cutoff.getMonth()+1).padStart(2,'0')}-${String(last7Cutoff.getDate()).padStart(2,'0')}`,
            last30Cutoff: `${last30Cutoff.getFullYear()}-${String(last30Cutoff.getMonth()+1).padStart(2,'0')}-${String(last30Cutoff.getDate()).padStart(2,'0')}`,
            startOfWeek: `${startOfWeek.getFullYear()}-${String(startOfWeek.getMonth()+1).padStart(2,'0')}-${String(startOfWeek.getDate()).padStart(2,'0')}`,
            startOfMonth: `${startOfMonth.getFullYear()}-${String(startOfMonth.getMonth()+1).padStart(2,'0')}-${String(startOfMonth.getDate()).padStart(2,'0')}`
          },
          computed: {
            today,
            yesterday,
            weekToDate,
            last7Days,
            monthToDate,
            last30Days,
            allTime: allTime !== undefined ? allTime : null
          },
          series: {
            last30Count: seriesLast30.length,
            last30Sum: seriesSum,
            head: seriesLast30.slice(0, 3),
            tail: seriesLast30.slice(-3)
          }
        };

        const dump = prettyPrintJson(debugInfo, 'SavingsSummary Debug', homey.app, 1);
        homey.app.log(dump);
      } catch (e: any) {
        homey.app.log('SavingsSummary debug logging failed:', e && e.message ? e.message : String(e));
      }

      return {
        success: true,
        summary: {
          today,
          yesterday,
          weekToDate,
          last7Days,
          monthToDate,
          last30Days,
          ...(allTime !== undefined ? { allTime } : {}),
        },
        todayDate: todayStr,
        historyDays: normalized.length,
        currencyCode,
        timestamp: new Date().toISOString(),
        series: {
          last30: seriesLast30,
        }
      };
    } catch (err: any) {
      homey.app.error('Error in getSavingsSummary:', err);
      return { success: false, error: err.message };
    }
  },

  /**
   * Log that the Settings "View Savings Summary" button was clicked.
   */
  getLogSavingsSummaryClicked: async ({ homey }: ApiHandlerContext) => {
    try {
      const ts = new Date().toISOString();
      // Prefer centralized HomeyLogger if available
      if (homey.app && homey.app.logger && typeof homey.app.logger.info === 'function') {
        try {
          homey.app.logger.info('SettingsEvent', { event: 'view_savings_summary', timestamp: ts });
        } catch (e: any) {
          homey.app.log(`[SETTINGS] View Savings Summary clicked at ${ts}`);
        }
      } else {
        homey.app.log(`[SETTINGS] View Savings Summary clicked at ${ts}`);
      }
      return { success: true, timestamp: ts };
    } catch (err: any) {
      homey.app.error('Error in getLogSavingsSummaryClicked:', err);
      return { success: false };
    }
  },

  // API endpoint for updating optimizer settings; invoked from app.ts during runtime refresh
  updateOptimizerSettings: async ({ homey }: ApiHandlerContext) => {
    try {
      console.log('API method updateOptimizerSettings called');
      homey.app.log('API method updateOptimizerSettings called');

      // Initialize services if needed
      try {
        await initializeServices(homey);
      } catch (initErr: any) {
        return {
          success: false,
          error: `Failed to initialize services: ${initErr.message}`,
          needsConfiguration: true
        };
      }

      // Update optimizer with the latest settings
      await refreshOptimizerSettings(homey);

      return {
        success: true,
        message: 'Optimizer settings updated successfully'
      };
    } catch (err: any) {
      console.error('Error in updateOptimizerSettings API endpoint:', err);
      return { success: false, error: err.message };
    }
  },
  getDeviceList: async ({ homey }: ApiHandlerContext) => {
    try {
      console.log('API method getDeviceList called');
      homey.app.log('API method getDeviceList called');

      // Initialize services if needed
      try {
        await initializeServices(homey);
      } catch (initErr: any) {
        return {
          success: false,
          error: `Failed to initialize services: ${initErr.message}`,
          needsConfiguration: true
        };
      }

      // Get the list of devices
      try {
        // Refresh the device list to ensure we have the latest data
        const melCloudService = requireMelCloud();
        const devices = await melCloudService.getDevices();
        homey.app.log(`Found ${devices.length} devices in MELCloud account`);

        // Format the devices for the dropdown
        const formattedDevices = devices.map(device => ({
          id: device.id,
          name: device.name,
          buildingId: device.buildingId,
          type: device.type,
          // Include information about zones if available
          hasZone1: device.data && device.data.SetTemperatureZone1 !== undefined,
          hasZone2: device.data && device.data.SetTemperatureZone2 !== undefined,
          // Include information about tank if available
          hasTank: device.data && (device.data.SetTankWaterTemperature !== undefined || device.data.TankWaterTemperature !== undefined),
          SetTankWaterTemperature: device.data && device.data.SetTankWaterTemperature,
          TankWaterTemperature: device.data && device.data.TankWaterTemperature,
          // Include current temperatures if available
          currentTemperatureZone1: device.data && device.data.RoomTemperatureZone1,
          currentTemperatureZone2: device.data && device.data.RoomTemperatureZone2,
          currentSetTemperatureZone1: device.data && device.data.SetTemperatureZone1,
          currentSetTemperatureZone2: device.data && device.data.SetTemperatureZone2
        }));

        // Group devices by building
        const buildings: Record<number, BuildingDropdownItem> = {};
        devices.forEach(device => {
          if (!buildings[device.buildingId]) {
            buildings[device.buildingId] = {
              id: device.buildingId,
              name: `Building ${device.buildingId}`,
              devices: []
            };
          }
          buildings[device.buildingId].devices.push(device.id);
        });

        // Format buildings for the dropdown
        const formattedBuildings = Object.values(buildings);

        return {
          success: true,
          devices: formattedDevices,
          buildings: formattedBuildings
        };
      } catch (deviceErr: any) {
        homey.app.error('Error getting device list:', deviceErr);
        return {
          success: false,
          error: `Failed to get device list: ${deviceErr.message}`
        };
      }
    } catch (err: any) {
      console.error('Error in getDeviceList:', err);
      return { success: false, error: err.message };
    }
  },

  getRunHourlyOptimizer: async ({ homey }: ApiHandlerContext) => {
    try {
      console.log('API method getRunHourlyOptimizer called');
      homey.app.log('API method getRunHourlyOptimizer called');

      // Initialize services if needed
      try {
        await initializeServices(homey);

        // Update optimizer with the latest settings
        await refreshOptimizerSettings(homey);
      } catch (initErr: any) {
        // Check if this is a configuration error
        const needsConfig = initErr.needsConfiguration || 
                           initErr.message.includes('required') ||
                           initErr.message.includes('configure') ||
                           initErr.message.includes('settings') ||
                           initErr.message.includes('credentials');
        
        homey.app.log(`⚠️ Service initialization failed: ${initErr.message}`);
        
        return {
          success: false,
          error: `Failed to initialize services: ${initErr.message}`,
          needsConfiguration: needsConfig
        };
      }

      // Run hourly optimization
      const activeOptimizer = requireOptimizer();
      const melCloudService = requireMelCloud();
      homey.app.log('Starting hourly optimization');
      homey.app.log('===== HOURLY OPTIMIZATION STARTED =====');

      try {
        // Run the enhanced optimization with real API data
        const result = await activeOptimizer.runEnhancedOptimization() as AugmentedOptimizationResult;

        // Quick-win DHW scheduling: toggle forced hot-water when cheap
        try {
          const enableTank = homey.settings.get('enable_tank_control') === true;
          if (enableTank && result && result.hotWaterAction && result.hotWaterAction.action) {
            const action = result.hotWaterAction.action;
            const deviceId = homey.settings.get('device_id');
            const buildingIdSetting = homey.settings.get('building_id');
            const parsedBuildingId = Number.parseInt(String(buildingIdSetting ?? ''), 10);
            const buildingId = Number.isFinite(parsedBuildingId) ? parsedBuildingId : 0;
            
            if (deviceId && buildingId) {
              if (action === 'heat_now') {
                await melCloudService.setHotWaterMode(deviceId, buildingId, true);
                homey.app.log('DHW action: Forced hot water mode (cheap price window)');
              } else if (action === 'delay') {
                await melCloudService.setHotWaterMode(deviceId, buildingId, false);
                homey.app.log('DHW action: Auto mode (delaying in expensive window)');
              }
            } else {
              homey.app.log('DHW action skipped: Device ID or Building ID not configured');
            }
          }
        } catch (dhwErr: any) {
          homey.app.error('DHW scheduling toggle failed:', dhwErr && dhwErr.message ? dhwErr.message : String(dhwErr));
        }

        // Log the enhanced optimization result
        homey.app.log('Enhanced optimization result:', JSON.stringify(result, null, 2));

        // Log to timeline (using app.log for now)
        if (result.action === 'temperature_adjusted') {
          homey.app.log(`🔄 TIMELINE: Enhanced optimization adjusted Zone1 temperature from ${result.fromTemp}°C to ${result.toTemp}°C`);
        } else {
          homey.app.log(`🔄 TIMELINE: Enhanced optimization - no temperature change needed (${result.reason})`);
        }

        // Log energy data if available
        if (result.energyMetrics) {
          const metrics = result.energyMetrics;
          const heatingCop = Number.isFinite(metrics.realHeatingCOP) ? metrics.realHeatingCOP.toFixed(2) : 'n/a';
          const hotWaterCop = Number.isFinite(metrics.realHotWaterCOP) ? metrics.realHotWaterCOP.toFixed(2) : 'n/a';
          const consumption = Number.isFinite(metrics.dailyEnergyConsumption) ? metrics.dailyEnergyConsumption.toFixed(2) : 'n/a';
          homey.app.log(`📊 Energy Metrics: daily=${consumption}kWh, heatingCOP=${heatingCop}, hotWaterCOP=${hotWaterCop}`);
        }

        // Log price data
        if (result.priceData) {
          const hasNext = (typeof result.priceData.nextHour === 'number' && Number.isFinite(result.priceData.nextHour));
          const nextHourText = hasNext ? `${result.priceData.nextHour}kr/kWh` : 'n/a';
          homey.app.log(`💰 Price Data: Current: ${result.priceData.current}kr/kWh, Next Hour: ${nextHourText}`);
        }

        // Send to timeline using our standardized TimelineHelperWrapper
        try {
          // Create a timeline helper wrapper instance
          const timelineHelper = new TimelineHelperWrapper(homey as any);

          // Prepare additional data for the optimization timeline entry
          const additionalData: Record<string, unknown> = {
            fromTemp: result.fromTemp,
            toTemp: result.toTemp,
            targetTemp: result.toTemp,           // For timeline compatibility
            targetOriginal: result.fromTemp,     // For timeline compatibility
            action: result.action
          };

          // Add hot water tank data if available in the optimization result
          if (result.tankData) {
            // Use the rounded API value for timeline display (whole degrees only)
            additionalData.tankTemp = result.tankData.toTemp;
            additionalData.tankOriginal = result.tankData.fromTemp;
          }

          // Add Zone2 data if available in the optimization result
          if (result.zone2Data) {
            additionalData.zone2Temp = result.zone2Data.toTemp;
            additionalData.zone2Original = result.zone2Data.fromTemp;
          }

          // Prepare details for the timeline entry
          const details: Record<string, unknown> = {};

          // Add reason if available
          if (result.reason) {
            // Extract first part of reason (before any parentheses or periods)
            details.reason = result.reason.split(/[(.]/)[0].trim();
          }

          // Add price context from optimization price data
          const currentPrice = result.priceData?.current;
          const avgPrice = result.priceData?.average;
          if (currentPrice && avgPrice) {
            const priceRatio = currentPrice / avgPrice;
            let priceContext = '';
            if (priceRatio > 1.5) priceContext = 'Very high';
            else if (priceRatio > 1.2) priceContext = 'High';
            else if (priceRatio < 0.8) priceContext = 'Low';
            else if (priceRatio < 0.5) priceContext = 'Very low';
            else priceContext = 'Average';

            details.price = priceContext;
            additionalData.priceData = {
              current: currentPrice,
              average: avgPrice,
              min: result.priceData.min,
              max: result.priceData.max
            };
          }

          // Add weather data if available
          if (result.weather) {
            if (result.weather.current) {
              const currentWeather = result.weather.current;
              const temperature = currentWeather.temperature !== undefined ? `${currentWeather.temperature}°C` : 'n/a';
              const symbol = (currentWeather as Record<string, unknown>).symbol ?? '';
              details.weather = `${temperature}, ${symbol}`;
            }
            additionalData.weather = result.weather;
          }

          // Add Zone2 optimization info if data exists
          const zone2Payload = result.zone2Data;
          if (zone2Payload && typeof zone2Payload === 'object') {
            const zone2Target = (zone2Payload as any).toTemp ?? (zone2Payload as any).targetTemp;
            const zone2Original = (zone2Payload as any).fromTemp ?? (zone2Payload as any).targetOriginal;
            if (zone2Target !== undefined && zone2Original !== undefined) {
              additionalData.zone2Temp = zone2Target;
              additionalData.zone2Original = zone2Original;
            }
          }

          // Add tank optimization info if data exists
          const tankPayload = result.tankData;
          if (tankPayload && typeof tankPayload === 'object') {
            const tankTarget = (tankPayload as any).toTemp ?? (tankPayload as any).targetTemp;
            const tankOriginal = (tankPayload as any).fromTemp ?? (tankPayload as any).targetOriginal;
            if (tankTarget !== undefined && tankOriginal !== undefined) {
              additionalData.tankTemp = tankTarget;
              additionalData.tankOriginal = tankOriginal;
            }
          }

          // Calculate and include projected daily savings for timeline (always include, even if small)
          try {
            const hourlySavings = Number(result.savings || 0);
            let projectedDailySavings = hourlySavings * 24;
            if (typeof activeOptimizer.calculateDailySavings === 'function') {
              try {
                const val = await activeOptimizer.calculateDailySavings(hourlySavings, historicalData?.optimizations || []);
                if (Number.isFinite(val)) projectedDailySavings = val;
              } catch (_: any) {}
            }
            additionalData.dailySavings = projectedDailySavings;
            try {
              const currencyCode = homey.settings.get('currency') || homey.settings.get('currency_code') || 'NOK';
              homey.app.log(`Hourly optimization projected daily savings: ${projectedDailySavings.toFixed(2)} ${currencyCode}/day`);
            } catch (_: any) {
              homey.app.log(`Hourly optimization projected daily savings: ${projectedDailySavings.toFixed(2)} /day`);
            }
          } catch (calcErr: any) {
            homey.app.error('Error calculating projected daily savings (timeline):', calcErr);
          }

          // Create the timeline entry using our standardized helper
          await timelineHelper.addTimelineEntry(
            TimelineEventType.HOURLY_OPTIMIZATION_RESULT,
            details,
            false, // Don't create notification by default
            additionalData
          );

          homey.app.log('Timeline entry created using TimelineHelperWrapper');
        } catch (timelineErr: any) {
          homey.app.log('Timeline logging failed:', timelineErr.message);
        }

        await syncDevicesWithOptimizationResult(homey, result);

        homey.app.log('===== HOURLY OPTIMIZATION COMPLETED SUCCESSFULLY =====');

        // Persist savings history for settings summary (mirror app.ts addSavings)
        let computedSavings = (typeof result.savings === 'number' && !Number.isNaN(result.savings))
          ? result.savings
          : 0;

        try {
          if (!(typeof result.savings === 'number' && !Number.isNaN(result.savings))) {
            try {
              const p = result.priceData?.current || 0;
              const metrics = result.energyMetrics;
              if (result.fromTemp !== undefined && result.toTemp !== undefined) {
                if (typeof activeOptimizer.calculateRealHourlySavings === 'function') {
                  computedSavings += await activeOptimizer.calculateRealHourlySavings(result.fromTemp, result.toTemp, p, metrics, 'zone1');
                } else {
                  computedSavings += activeOptimizer.calculateSavings(result.fromTemp, result.toTemp, p, 'zone1');
                }
              }
              if (result.zone2Data && result.zone2Data.fromTemp !== undefined && result.zone2Data.toTemp !== undefined) {
                if (typeof activeOptimizer.calculateRealHourlySavings === 'function') {
                  computedSavings += await activeOptimizer.calculateRealHourlySavings(result.zone2Data.fromTemp, result.zone2Data.toTemp, p, metrics, 'zone2');
                } else {
                  computedSavings += activeOptimizer.calculateSavings(result.zone2Data.fromTemp, result.zone2Data.toTemp, p, 'zone2');
                }
              }
              if (result.tankData && result.tankData.fromTemp !== undefined && result.tankData.toTemp !== undefined) {
                if (typeof activeOptimizer.calculateRealHourlySavings === 'function') {
                  computedSavings += await activeOptimizer.calculateRealHourlySavings(result.tankData.fromTemp, result.tankData.toTemp, p, metrics, 'tank');
                } else {
                  computedSavings += activeOptimizer.calculateSavings(result.tankData.fromTemp, result.tankData.toTemp, p, 'tank');
                }
              }
            } catch (_: any) {}
          }
          if (typeof computedSavings === 'number' && !Number.isNaN(computedSavings)) {
            // Clamp to positive-only for history persistence
            computedSavings = Number((computedSavings || 0).toFixed(4));
            const toPersist = computedSavings > 0 ? computedSavings : 0;
            const tzOffset = parseInt(homey.settings.get('time_zone_offset'));
            const useDST = !!homey.settings.get('use_dst');
            const now = new Date();
            const local = new Date(now.getTime());
            if (!Number.isNaN(tzOffset)) local.setUTCHours(now.getUTCHours() + tzOffset);
            if (useDST) {
              const m = now.getUTCMonth();
              if (m > 2 && m < 10) local.setUTCHours(local.getUTCHours() + 1);
            }
            const y = local.getFullYear();
            const mo = String(local.getMonth() + 1).padStart(2, '0');
            const d = String(local.getDate()).padStart(2, '0');
            const todayStr = `${y}-${mo}-${d}`;

            const hist = homey.settings.get('savings_history') || [];
            const arr = Array.isArray(hist) ? hist.slice() : [];
            let todayEntry = arr.find(h => h && h.date === todayStr);

            // Determine currency/decimals for minor units
            const currencyCode = homey.settings.get('currency_code') || homey.settings.get('currency') || '';
            const decimalsMap: Record<string, number> = { JPY: 0, KWD: 3 };
            const decimals = decimalsMap[String(currencyCode).toUpperCase()] ?? 2;
            const toMinor = (amt: number): number => Math.round((Number(amt) || 0) * Math.pow(10, decimals));

            if (!todayEntry) {
              // Create entry in minor-units format
              todayEntry = { date: todayStr, totalMinor: 0, currency: currencyCode, decimals };
              arr.push(todayEntry);
            }

            // If entry already using minor units, keep using that; otherwise fall back to legacy 'total'
            if (todayEntry.totalMinor !== undefined) {
              todayEntry.currency = todayEntry.currency || currencyCode;
              if (todayEntry.decimals === undefined) todayEntry.decimals = decimals;
              const nextMinor = Number(todayEntry.totalMinor || 0) + toMinor(toPersist);
              // Ensure we never store a negative daily total
              todayEntry.totalMinor = Math.max(0, nextMinor);
            } else {
              const nextTotal = Number(((Number(todayEntry.total || 0)) + toPersist).toFixed(4));
              todayEntry.total = nextTotal < 0 ? 0 : nextTotal;
            }
            // Keep last 30 days only
            arr.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
            const trimmed = arr.slice(Math.max(0, arr.length - 30));
            homey.settings.set('savings_history', trimmed);
            try {
              const todayMajor = todayEntry.totalMinor !== undefined
                ? (todayEntry.totalMinor / Math.pow(10, todayEntry.decimals ?? decimals)).toFixed(4)
                : Number(todayEntry.total || 0).toFixed(4);
              homey.app.log(`Updated savings_history: +${toPersist.toFixed(4)} -> today ${todayMajor} (${todayStr}), size=${trimmed.length}`);
            } catch (_: any) {}
          } else {
            homey.app.log('No numeric savings value to persist for this optimization run.');
          }
        } catch (persistErr: any) {
          homey.app.error('Failed to persist savings_history:', persistErr && persistErr.message ? persistErr.message : String(persistErr));
        }

        // Prepare additional helper fields for the app layer (priceNow, savings, hourly baseline)
        let hourlyBaselineKWh: number | null = null;
        const dailyConsumption = result.energyMetrics?.dailyEnergyConsumption;
        if (typeof dailyConsumption === 'number' && Number.isFinite(dailyConsumption) && dailyConsumption > 0) {
          hourlyBaselineKWh = dailyConsumption / 24;
        }

        recordOptimizationEntry(homey, result, computedSavings);

        return {
          success: true,
          message: 'Hourly optimization completed',
          data: {
            // Use the enhanced optimization result structure
            action: result.action,
            fromTemp: result.fromTemp,
            toTemp: result.toTemp,
            reason: result.reason,
            priceData: result.priceData,
            // Added for compatibility with app.ts accounting logic
            priceNow: result && result.priceData ? result.priceData.current : undefined,
            savings: (typeof computedSavings === 'number' && !Number.isNaN(computedSavings)) ? computedSavings : (result.savings || 0),
            hourlyBaselineKWh: hourlyBaselineKWh,
            timestamp: new Date().toISOString()
          },
          result
        };
      } catch (optimizeErr: any) {
        homey.app.error('Hourly optimization error', optimizeErr);

        // Log notification
        homey.app.error(`NOTIFICATION: HourlyOptimizer error: ${optimizeErr.message}`);

        // Try to send notification if the method exists
        try {
          if (typeof homey.notifications === 'object' && typeof homey.notifications.createNotification === 'function') {
            const notify = homey.notifications.createNotification.bind(homey.notifications);
            await notify({ excerpt: `HourlyOptimizer error: ${optimizeErr.message}` });
          }
        } catch (notifyErr: any) {
          homey.app.error('Notification system not available:', notifyErr.message);
        }

        homey.app.error('===== HOURLY OPTIMIZATION FAILED =====');
        throw optimizeErr; // Re-throw to be caught by the outer try-catch
      }
    } catch (err: any) {
      console.error('Error in getRunHourlyOptimizer:', err);
      return { success: false, error: err.message };
    }
  },

  getThermalModelData: async ({ homey }: ApiHandlerContext) => {
    try {
      console.log('API method getThermalModelData called');
      homey.app.log('API method getThermalModelData called');

      // Initialize services if needed
      try {
        await initializeServices(homey);
      } catch (initErr: any) {
        homey.app.error('Failed to initialize services:', initErr);
        return {
          success: false,
          error: `Failed to initialize services: ${initErr.message}`,
          needsConfiguration: true
        };
      }

      // Log thermal model data to terminal
      homey.app.log('===== THERMAL MODEL DATA =====');
      homey.app.log(`Optimization Count: ${historicalData.optimizations.length} data points`);

      if (optimizer) {
        const thermalModel = typeof optimizer?.getThermalModel === 'function'
          ? optimizer.getThermalModel()
          : null;
        if (thermalModel && typeof thermalModel.K === 'number') {
          homey.app.log(`Current K-Factor: ${thermalModel.K.toFixed(2)}`);
        }
      } else {
        homey.app.log('Current K-Factor: Not available (optimizer not initialized)');
      }

      if (historicalData.lastCalibration) {
        const calibDate = new Date(historicalData.lastCalibration.timestamp).toLocaleString();
        homey.app.log(`Last Calibration: ${calibDate}`);
        homey.app.log(`K-Factor Change: ${historicalData.lastCalibration.oldK.toFixed(2)} → ${historicalData.lastCalibration.newK.toFixed(2)}`);
        homey.app.log(`Analysis: ${historicalData.lastCalibration.analysis}`);
      } else {
        homey.app.log('Last Calibration: Never performed');
      }

      if (historicalData.optimizations.length > 0) {
        const lastOpt = historicalData.optimizations[historicalData.optimizations.length - 1];
        const optDate = new Date(lastOpt.timestamp).toLocaleString();
        homey.app.log(`Last Optimization: ${optDate}`);
        homey.app.log(`Target Temperature: ${lastOpt.targetTemp !== undefined ? lastOpt.targetTemp : 'N/A'}°C (was ${lastOpt.targetOriginal !== undefined ? lastOpt.targetOriginal : 'N/A'}°C)`);
        homey.app.log(`Indoor Temperature: ${lastOpt.indoorTemp !== undefined ? lastOpt.indoorTemp : 'N/A'}°C`);
        homey.app.log(`Outdoor Temperature: ${lastOpt.outdoorTemp !== undefined ? lastOpt.outdoorTemp : 'N/A'}°C`);
        homey.app.log(`Current Price: ${lastOpt.priceNow !== undefined ? lastOpt.priceNow.toFixed(4) : 'N/A'}`);
      } else {
        homey.app.log('No optimization data available yet');
      }

      homey.app.log('Recent data points:');
      // Log the last 5 data points (or fewer if not available)
      const recentPoints = historicalData.optimizations.slice(-5);
      recentPoints.forEach((point, index) => {
        const date = new Date(point.timestamp).toLocaleString();
        const indoorTemp = point.indoorTemp !== undefined ? point.indoorTemp : 'N/A';
        const outdoorTemp = point.outdoorTemp !== undefined ? point.outdoorTemp : 'N/A';
        const targetTemp = point.targetTemp !== undefined ? point.targetTemp : 'N/A';
        const price = point.priceNow !== undefined ? point.priceNow.toFixed(4) : 'N/A';
        homey.app.log(`[${index + 1}] ${date}: Indoor ${indoorTemp}°C, Outdoor ${outdoorTemp}°C, Target ${targetTemp}°C, Price ${price}`);
      });

      homey.app.log('=============================');

      // Return the thermal model data
      return {
        success: true,
        data: {
          optimizationCount: historicalData.optimizations.length,
          lastOptimization: historicalData.optimizations.length > 0 ?
            historicalData.optimizations[historicalData.optimizations.length - 1] : null,
          lastCalibration: historicalData.lastCalibration,
          kFactor: optimizer && typeof optimizer.getThermalModel === 'function'
            ? optimizer.getThermalModel().K
            : null,
          dataPoints: historicalData.optimizations.map(opt => ({
            timestamp: opt.timestamp,
            targetTemp: opt.targetTemp,
            indoorTemp: opt.indoorTemp,
            outdoorTemp: opt.outdoorTemp,
            priceNow: opt.priceNow
          }))
        }
      };
    } catch (err: any) {
      console.error('Error in getThermalModelData:', err);
      homey.app.error('Error in getThermalModelData:', err);
      return { success: false, error: err.message };
    }
  },

  getRunWeeklyCalibration: async ({ homey }: ApiHandlerContext) => {
    try {
      console.log('API method getRunWeeklyCalibration called');
      homey.app.log('API method getRunWeeklyCalibration called');

      // Initialize services if needed
      try {
        await initializeServices(homey);

        // Update optimizer with the latest settings
        await refreshOptimizerSettings(homey);
      } catch (initErr: any) {
        return {
          success: false,
          error: `Failed to initialize services: ${initErr.message}`,
          needsConfiguration: true
        };
      }

      const activeOptimizer = requireOptimizer();

      // Run weekly calibration
      homey.app.log('Starting weekly calibration');
      homey.app.log('===== WEEKLY CALIBRATION STARTED =====');

      try {
        // Check if we have historical data
        if (historicalData.optimizations.length < 24) {
          const message = `Not enough historical data for calibration. Have ${historicalData.optimizations.length} data points, need at least 24.`;
          homey.app.log(message);

          return {
            success: false,
            message: message,
            historicalDataCount: historicalData.optimizations.length
          };
        }

        // Run the actual calibration
        const result = await activeOptimizer.runWeeklyCalibration();

        // Log the result
        homey.app.log('Calibration result:', JSON.stringify(result, null, 2));

        // Log to timeline (using app.log for now)
        homey.app.log(`📊 TIMELINE: Calibrated thermal model: K=${result.newK.toFixed(2)}`);

        // Send to timeline using our standardized TimelineHelperWrapper
        try {
          // Create a timeline helper wrapper instance
          const timelineHelper = new TimelineHelperWrapper(homey as any);

          // Prepare additional data for the timeline entry
          const additionalData: Record<string, unknown> = {
            oldK: result.oldK,
            newK: result.newK,
            method: result.method ?? 'Advanced Thermal Learning'
          };

          // Prepare details for the timeline entry
          const details: Record<string, unknown> = {};

          // Add S value if available
          if (typeof result.newS === 'number') {
            details.s = result.newS.toFixed(2);
          }

          // Add thermal characteristics if available
          if (result.thermalCharacteristics) {
            const characteristics = result.thermalCharacteristics as Record<string, unknown>;
            const heatingRate = characteristics.heatingRate;
            const coolingRate = characteristics.coolingRate;
            if (typeof heatingRate === 'number' && Number.isFinite(heatingRate)) {
              details.heatingRate = heatingRate.toFixed(3);
            }
            if (typeof coolingRate === 'number' && Number.isFinite(coolingRate)) {
              details.coolingRate = coolingRate.toFixed(3);
            }
          }

          // Create the main calibration timeline entry
          await timelineHelper.addTimelineEntry(
            TimelineEventType.WEEKLY_CALIBRATION_RESULT,
            details,
            false, // Don't create notification by default
            additionalData
          );

          homey.app.log('Timeline entries created using TimelineHelperWrapper');
        } catch (timelineErr: any) {
          homey.app.log('Timeline logging failed:', timelineErr.message);
        }

        // Update settings
        homey.settings.set('initial_k', result.newK);

        homey.app.log('===== WEEKLY CALIBRATION COMPLETED SUCCESSFULLY =====');

        historicalData.lastCalibration = {
          ...result,
          timestamp: result.timestamp || new Date().toISOString()
        };
        persistHistoricalData(homey);

        return {
          success: true,
          message: 'Weekly calibration completed',
          result
        };
      } catch (calibrateErr: any) {
        homey.app.error('Weekly calibration error', calibrateErr);

        // Log notification
        homey.app.error(`NOTIFICATION: WeeklyCalibration error: ${calibrateErr.message}`);

        // Try to send notification if the method exists
        try {
          if (typeof homey.notifications === 'object' && typeof homey.notifications.createNotification === 'function') {
            const notify = homey.notifications.createNotification.bind(homey.notifications);
            await notify({ excerpt: `WeeklyCalibration error: ${calibrateErr.message}` });
          }
        } catch (notifyErr: any) {
          homey.app.error('Notification system not available:', notifyErr.message);
        }

        homey.app.error('===== WEEKLY CALIBRATION FAILED =====');
        throw calibrateErr; // Re-throw to be caught by the outer try-catch
      }
    } catch (err: any) {
      console.error('Error in getRunWeeklyCalibration:', err);
      return { success: false, error: err.message };
    }
  },

  getStartCronJobs: async ({ homey }: ApiHandlerContext) => {
    try {
      console.log('API method getStartCronJobs called');
      homey.app.log('API method getStartCronJobs called');

      // Try to initialize the cron jobs directly in the API
      try {
        homey.app.log('Initializing cron jobs directly in the API');

        // Import the cron library
        const { CronJob } = require('cron');

        // Create hourly job - runs at minute 5 of every hour
        homey.app.log('Creating hourly cron job with pattern: 0 5 * * * *');
        const hourlyJob = new CronJob('0 5 * * * *', async () => {
          // Log the trigger
          const currentTime = new Date().toISOString();
          homey.app.log('===== AUTOMATIC HOURLY CRON JOB TRIGGERED =====');
          homey.app.log(`Current time: ${currentTime}`);

          // Store the last run time in settings
          homey.settings.set('last_hourly_run', currentTime);

          // Intentionally skip timeline post for cron trigger (noisy/duplicative)

          // Call the hourly optimizer
          try {
            await apiHandlers.getRunHourlyOptimizer({ homey });
          } catch (err: any) {
            homey.app.error('Error in hourly cron job', err);
          }
        });

        // Create weekly job - runs at 2:05 AM on Sundays
        homey.app.log('Creating weekly cron job with pattern: 0 5 2 * * 0');
        const weeklyJob = new CronJob('0 5 2 * * 0', async () => {
          // Log the trigger
          const currentTime = new Date().toISOString();
          homey.app.log('===== AUTOMATIC WEEKLY CRON JOB TRIGGERED =====');
          homey.app.log(`Current time: ${currentTime}`);

          // Store the last run time in settings
          homey.settings.set('last_weekly_run', currentTime);

          // Intentionally skip timeline post for cron trigger (noisy/duplicative)

          // Call the weekly calibration
          try {
            await apiHandlers.getRunWeeklyCalibration({ homey });
          } catch (err: any) {
            homey.app.error('Error in weekly cron job', err);
          }
        });

        // Start the cron jobs
        homey.app.log('Starting hourly cron job...');
        hourlyJob.start();
        homey.app.log('Hourly cron job started');

        homey.app.log('Starting weekly cron job...');
        weeklyJob.start();
        homey.app.log('Weekly cron job started');

        // Store the jobs in settings for future reference
        homey.settings.set('cron_status', {
          hourlyJob: {
            running: hourlyJob.running,
            nextRun: hourlyJob.nextDate().toString(),
            cronTime: String(hourlyJob.cronTime?.source ?? '')
          },
          weeklyJob: {
            running: weeklyJob.running,
            nextRun: weeklyJob.nextDate().toString(),
            cronTime: String(weeklyJob.cronTime?.source ?? '')
          },
          lastHourlyRun: homey.settings.get('last_hourly_run') || 'Never',
          lastWeeklyRun: homey.settings.get('last_weekly_run') || 'Never',
          lastUpdated: new Date().toISOString()
        });

        // Store the jobs in global variables for future access
        global.hourlyJob = hourlyJob;
        global.weeklyJob = weeklyJob;

        // Skip timeline post for cron initialization (not needed)

        // Update the cron status in settings
        await apiHandlers.getUpdateCronStatus({ homey });

        return {
          success: true,
          message: 'Cron jobs initialized directly in the API',
          hourlyJobRunning: hourlyJob.running,
          weeklyJobRunning: weeklyJob.running
        };
      } catch (err: any) {
        homey.app.error('Error initializing cron jobs directly in the API:', err);
        return {
          success: false,
          error: err.message || 'Unknown error'
        };
      }
    } catch (err: any) {
      console.error('Error in getStartCronJobs:', err);
      return { success: false, error: err.message };
    }
  },

  getUpdateCronStatus: async ({ homey }: ApiHandlerContext) => {
    try {
      console.log('API method getUpdateCronStatus called');
      homey.app.log('API method getUpdateCronStatus called');

      // Manually update the cron status in settings
      try {
        // Get the hourly and weekly jobs from the app instance if possible
        let hourlyJob = null;
        let weeklyJob = null;

        try {
          // First try to access the global cron jobs
          if (global.hourlyJob && global.weeklyJob) {
            hourlyJob = global.hourlyJob;
            weeklyJob = global.weeklyJob;
            homey.app.log('Successfully accessed cron jobs from global variables');
          }
          // If not found in global, try to access from app instance
          else if (homey.app && typeof homey.app === 'object') {
            hourlyJob = homey.app.hourlyJob;
            weeklyJob = homey.app.weeklyJob;

            if (hourlyJob && weeklyJob) {
              homey.app.log('Successfully accessed cron jobs from app instance');
            } else {
              homey.app.log('Cron jobs not found in app instance');
              homey.app.log('hourlyJob:', hourlyJob ? 'found' : 'not found');
              homey.app.log('weeklyJob:', weeklyJob ? 'found' : 'not found');
            }
          } else {
            console.log('homey.app is not accessible or not an object');
          }
        } catch (err: any) {
          console.log('Could not access cron jobs from app instance:', err && err.message ? err.message : err);
        }

        // Create a status object with the available information
        const status = {
          hourlyJob: hourlyJob ? {
            running: hourlyJob.running,
            nextRun: hourlyJob.nextDate().toString(),
            cronTime: String(hourlyJob.cronTime?.source ?? '')
          } : { running: false, error: 'Could not access hourly job' },

          weeklyJob: weeklyJob ? {
            running: weeklyJob.running,
            nextRun: weeklyJob.nextDate().toString(),
            cronTime: String(weeklyJob.cronTime?.source ?? '')
          } : { running: false, error: 'Could not access weekly job' },

          lastHourlyRun: homey.settings.get('last_hourly_run') || 'Never',
          lastWeeklyRun: homey.settings.get('last_weekly_run') || 'Never',
          lastUpdated: new Date().toISOString()
        };

        // Save the status to settings
        homey.settings.set('cron_status', status);
        homey.app.log('Manually updated cron status in settings');

        return {
          success: true,
          message: 'Cron status updated successfully',
          cronStatus: status
        };
      } catch (err: any) {
        homey.app.error('Error updating cron status:', err);
        return {
          success: false,
          error: err.message || 'Unknown error'
        };
      }
    } catch (err: any) {
      console.error('Error in getUpdateCronStatus:', err);
      return { success: false, error: err.message };
    }
  },

  getCheckCronStatus: async ({ homey }: ApiHandlerContext) => {
    try {
      console.log('API method getCheckCronStatus called');
      homey.app.log('API method getCheckCronStatus called');

      // Check if the global cron jobs exist
      if (!global.hourlyJob || !global.weeklyJob) {
        homey.app.log('Global cron jobs not found, attempting to start them');

        // Try to start the cron jobs
        try {
          const startResult = await apiHandlers.getStartCronJobs({ homey });
          if (startResult.success) {
            homey.app.log('Successfully started cron jobs via API');
          } else {
            homey.app.log('Failed to start cron jobs via API:', startResult.error);
          }
        } catch (err: any) {
          homey.app.error('Error calling getStartCronJobs:', err);
        }
      }

      // Try to get the latest cron status by calling the update endpoint
      try {
        // Call the update endpoint to get the latest status
        const updateResult = await apiHandlers.getUpdateCronStatus({ homey });
        if (updateResult.success) {
          homey.app.log('Successfully updated cron status via API');
        } else {
          homey.app.log('Failed to update cron status via API:', updateResult.error);
        }
      } catch (err: any) {
        homey.app.error('Error calling getUpdateCronStatus:', err);
      }

      // Get information about the cron jobs from settings
      const cronStatus = homey.settings.get('cron_status') || {
        hourlyJob: { running: false, error: 'Cron status not available in settings' },
        weeklyJob: { running: false, error: 'Cron status not available in settings' },
        lastHourlyRun: homey.settings.get('last_hourly_run') || 'Never',
        lastWeeklyRun: homey.settings.get('last_weekly_run') || 'Never',
        lastUpdated: new Date().toISOString()
      };

      // Add last run times if not present in cronStatus
      if (!cronStatus.lastHourlyRun) {
        cronStatus.lastHourlyRun = homey.settings.get('last_hourly_run') || 'Never';
      }

      if (!cronStatus.lastWeeklyRun) {
        cronStatus.lastWeeklyRun = homey.settings.get('last_weekly_run') || 'Never';
      }

      // Get the current time for reference
      const currentTime = new Date().toISOString();

      // Log the cron status for debugging
      homey.app.log('Cron status:', JSON.stringify(cronStatus, null, 2));

      // Create a timeline entry to show the cron status
      try {
        homey.app.log('Creating timeline entry for cron status check');

        // First try the direct timeline API if available
        if (typeof homey.timeline === 'object' && typeof homey.timeline.createEntry === 'function') {
          await homey.timeline.createEntry({
            title: 'MELCloud Optimizer',
            body: '⏱️ Cron job status checked',
            icon: 'flow:device_changed'
          });
          homey.app.log('Timeline entry created using timeline API');
        }
        // Then try the notifications API as the main fallback
        else if (typeof homey.notifications === 'object' && typeof homey.notifications.createNotification === 'function') {
          const notify = homey.notifications.createNotification.bind(homey.notifications);
          await notify({
            excerpt: 'MELCloud Optimizer: ⏱️ Cron job status checked',
          });
          homey.app.log('Timeline entry created using notifications API');
        }
        // Finally try homey.app.flow if available
        else if (homey.app && homey.app.flow && typeof homey.app.flow.runFlowCardAction === 'function') {
          await homey.app.flow.runFlowCardAction({
            uri: 'homey:flowcardaction:homey:manager:timeline:log',
            args: { text: '⏱️ Cron job status checked' }
          });
          homey.app.log('Timeline entry created using app flow API');
        }
        else {
          homey.app.log('Timeline API not available, using log only');
        }
      } catch (err: any) {
        homey.app.error('Failed to create timeline entry for cron status check', err);
      }

      return {
        success: true,
        currentTime,
        hourlyJob: cronStatus.hourlyJob,
        weeklyJob: cronStatus.weeklyJob,
        lastHourlyRun: cronStatus.lastHourlyRun,
        lastWeeklyRun: cronStatus.lastWeeklyRun
      };
    } catch (err: any) {
      console.error('Error in getCheckCronStatus:', err);
      return { success: false, error: err.message };
    }
  },

  getCOPData: async ({ homey }: ApiHandlerContext) => {
    try {
      console.log('API method getCOPData called');
      homey.app.log('API method getCOPData called');

      // Initialize services if needed
      try {
        await initializeServices(homey);
      } catch (initErr: any) {
        return {
          success: false,
          error: `Failed to initialize services: ${initErr.message}`,
          needsConfiguration: true
        };
      }

      // Get the device ID and building ID from settings
      const deviceId = homey.settings.get('device_id');
      const buildingId = parseInt(homey.settings.get('building_id') || '0');

      if (!deviceId || !buildingId) {
        return {
          success: false,
          error: 'Device ID or Building ID not set in settings'
        };
      }

      try {
        // Get COP data from MELCloud
        const melCloudService = requireMelCloud();
        const copData = await melCloudService.getEnhancedCOPData(deviceId, buildingId);

        // Check if we have a COP helper instance
        if (!global.copHelper) {
          homey.app.log('COP Helper not initialized, creating instance');

          // Import the COPHelper class
          const { COPHelper } = require('./services/cop-helper');

          // Create a new instance
          global.copHelper = new COPHelper(homey, homey.app);
          homey.app.log('COP Helper initialized');
        }

        // Get COP data from the helper
        const copHelperInstance = global.copHelper!;
        const helperData = await copHelperInstance.getCOPData();

        // Combine the data
        const result = {
          success: true,
          melcloud: copData,
          helper: helperData,
          settings: {
            copWeight: homey.settings.get('cop_weight') || 0.3,
            autoSeasonalMode: homey.settings.get('auto_seasonal_mode') !== false,
            summerMode: homey.settings.get('summer_mode') === true
          }
        };

        return result;
      } catch (error: any) {
        homey.app.error('Error getting COP data:', error);
        return {
          success: false,
          error: error.message
        };
      }
    } catch (err: any) {
      console.error('Error in getCOPData:', err);
      return { success: false, error: err.message };
    }
  },

  getWeeklyAverageCOP: async ({ homey }: ApiHandlerContext) => {
    try {
      console.log('API method getWeeklyAverageCOP called');
      homey.app.log('API method getWeeklyAverageCOP called');

      // Initialize services if needed
      try {
        await initializeServices(homey);
      } catch (initErr: any) {
        return {
          success: false,
          error: `Failed to initialize services: ${initErr.message}`,
          needsConfiguration: true
        };
      }

      // Get the device ID and building ID from settings
      const deviceId = homey.settings.get('device_id');
      const buildingId = parseInt(homey.settings.get('building_id') || '0');

      if (!deviceId || !buildingId) {
        return {
          success: false,
          error: 'Device ID or Building ID not set in settings'
        };
      }

      try {
        // Get weekly COP data from MELCloud
        const melCloudService = requireMelCloud();
        const weeklyData = await melCloudService.getWeeklyAverageCOP(deviceId, buildingId);

        // Check if we have a COP helper instance
        if (!global.copHelper) {
          homey.app.log('COP Helper not initialized, creating instance');

          // Import the COPHelper class
          const { COPHelper } = require('./services/cop-helper');

          // Create a new instance
          global.copHelper = new COPHelper(homey, homey.app);
          homey.app.log('COP Helper initialized');
        }

        // Get weekly average COP from the helper
        const copHelperInstance = global.copHelper!;
        const heatingCOP = await copHelperInstance.getAverageCOP('weekly', 'heat');
        const hotWaterCOP = await copHelperInstance.getAverageCOP('weekly', 'water');

        return {
          success: true,
          melcloud: weeklyData,
          helper: {
            heating: heatingCOP,
            hotWater: hotWaterCOP
          }
        };
      } catch (error: any) {
        homey.app.error('Error getting weekly average COP:', error);
        return {
          success: false,
          error: error.message
        };
      }
    } catch (err: any) {
      console.error('Error in getWeeklyAverageCOP:', err);
      return { success: false, error: err.message };
    }
  },

  getMelCloudStatus: async ({ homey }: ApiHandlerContext) => {
    try {
      console.log('API method getMelCloudStatus called');
      homey.app.log('API method getMelCloudStatus called');

      // Initialize services if needed
      try {
        await initializeServices(homey);
      } catch (initErr: any) {
        return {
          connected: false,
          error: `Failed to initialize services: ${initErr.message}`,
          needsConfiguration: true
        };
      }

      try {
        const activeMelCloud = melCloud;

        // Check if MELCloud is initialized
        if (!activeMelCloud) {
          homey.app.log('MELCloud API not initialized');
          return {
            connected: false,
            error: 'MELCloud API not initialized'
          };
        }

        const melCloudInternal = activeMelCloud as unknown as { contextKey?: string | null };

        // Check if we have a context key (logged in)
        if (!melCloudInternal.contextKey) {
          homey.app.log('MELCloud API not logged in');

          // Try to login
          try {
            const melcloudUser = homey.settings.get('melcloud_user');
            const melcloudPass = homey.settings.get('melcloud_pass');

            if (!melcloudUser || !melcloudPass) {
              return {
                connected: false,
                error: 'MELCloud credentials not available'
              };
            }

            const loginSuccess = await activeMelCloud.login(melcloudUser, melcloudPass);

            if (loginSuccess) {
              homey.app.log('Successfully reconnected to MELCloud');
              return {
                connected: true,
                reconnected: true
              };
            } else {
              return {
                connected: false,
                error: 'Failed to reconnect to MELCloud'
              };
            }
          } catch (loginError: any) {
            homey.app.error('Error reconnecting to MELCloud:', loginError);
            return {
              connected: false,
              error: `Failed to reconnect: ${loginError.message}`
            };
          }
        }

        // Try to get devices as a connection test
        try {
          const devices = await activeMelCloud.getDevices();
          return {
            connected: true,
            devices: devices.length
          };
        } catch (deviceError: any) {
          homey.app.error('Error getting MELCloud devices:', deviceError);
          return {
            connected: false,
            error: `Failed to get devices: ${deviceError.message}`
          };
        }
      } catch (error: any) {
        homey.app.error('Error checking MELCloud status:', error);
        return {
          connected: false,
          error: error.message
        };
      }
    } catch (err: any) {
      console.error('Error in getMelCloudStatus:', err);
      return { connected: false, error: err.message };
    }
  },

  getTibberStatus: async ({ homey }: ApiHandlerContext) => {
    try {
      console.log('API method getTibberStatus called');
      homey.app.log('API method getTibberStatus called');

      // Initialize services if needed
      try {
        await initializeServices(homey);
      } catch (initErr: any) {
        return {
          connected: false,
          error: `Failed to initialize services: ${initErr.message}`,
          needsConfiguration: true
        };
      }

      try {
        const activeTibber = tibber;
        // Check if Tibber is initialized
        if (!activeTibber) {
          homey.app.log('Tibber API not initialized');
          return {
            connected: false,
            error: 'Tibber API not initialized'
          };
        }

        // Try to get prices as a connection test
        try {
          const prices = await activeTibber.getPrices();
          return {
            connected: true,
            pricePoints: prices.prices.length
          };
        } catch (priceError: any) {
          homey.app.error('Error getting Tibber prices:', priceError);
          return {
            connected: false,
            error: `Failed to get prices: ${priceError.message}`
          };
        }
      } catch (error: any) {
        homey.app.error('Error checking Tibber status:', error);
        return {
          connected: false,
          error: error.message
        };
      }
    } catch (err: any) {
      console.error('Error in getTibberStatus:', err);
      return { connected: false, error: err.message };
    }
  },

  runSystemHealthCheck: async ({ homey }: ApiHandlerContext) => {
    try {
      console.log('API method runSystemHealthCheck called');
      homey.app.log('API method runSystemHealthCheck called');

      try {
        // Call the app's health check method if available
        if (typeof homey.app.runSystemHealthCheck === 'function') {
          return await homey.app.runSystemHealthCheck();
        }
        return {
          healthy: false,
          issues: ['Health check not available in this runtime'],
          recovered: false
        };
      } catch (error: any) {
        homey.app.error('Error running system health check:', error);
        return {
          healthy: false,
          issues: [`Error running health check: ${error.message}`],
          recovered: false
        };
      }
    } catch (err: any) {
      console.error('Error in runSystemHealthCheck:', err);
      return {
        healthy: false,
        issues: [`API error: ${err.message}`],
        recovered: false
      };
    }
  },

  getMemoryUsage: async ({ homey }: ApiHandlerContext) => {
    try {
      console.log('API method getMemoryUsage called');
      homey.app.log('API method getMemoryUsage called');

      try {
        // Initialize services if needed
        await initializeServices(homey);

        // Get memory usage from process safely
        let processMemory: Record<string, number | string> = {};
        try {
          const memUsage = process.memoryUsage();
          processMemory = {
            rss: Math.round(memUsage.rss / 1024 / 1024 * 100) / 100,
            heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024 * 100) / 100,
            heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024 * 100) / 100,
            external: Math.round(memUsage.external / 1024 / 1024 * 100) / 100,
          };
        } catch (memError: any) {
          homey.app.log('Could not get detailed memory usage, using estimated values');
          // Provide estimated values if actual memory usage is not available
          processMemory = {
            rss: 'N/A',
            heapTotal: 'N/A',
            heapUsed: 'N/A',
            external: 'N/A'
          };
        }

        // Get thermal model memory usage if available
        let thermalModelMemory: unknown = null;
        if (optimizer && typeof optimizer.getThermalModelMemoryUsage === 'function') {
          thermalModelMemory = optimizer.getThermalModelMemoryUsage();
        }

        return {
          success: true,
          processMemory,
          thermalModelMemory,
          timestamp: new Date().toISOString()
        };
      } catch (error: any) {
        homey.app.error('Error getting memory usage:', error);
        return {
          success: false,
          message: `Error getting memory usage: ${error.message}`
        };
      }
    } catch (err: any) {
      console.error('Error in getMemoryUsage:', err);
      return { success: false, error: err.message };
    }
  },

  runThermalDataCleanup: async ({ homey }: ApiHandlerContext) => {
    try {
      console.log('API method runThermalDataCleanup called');
      homey.app.log('API method runThermalDataCleanup called');

      try {
        // Initialize services if needed
        await initializeServices(homey);

        // Run thermal data cleanup if available
        if (optimizer && typeof optimizer.forceThermalDataCleanup === 'function') {
          const cleanupResult = optimizer.forceThermalDataCleanup();
          if (cleanupResult && typeof (cleanupResult as { success?: unknown }).success === 'boolean') {
            return cleanupResult as RunThermalDataCleanupResponse;
          }
          return {
            success: true,
            ...(cleanupResult as Record<string, unknown>)
          } as RunThermalDataCleanupResponse;
        } else {
          return {
            success: false,
            message: 'Thermal model service not available'
          };
        }
      } catch (error: any) {
        homey.app.error('Error running thermal data cleanup:', error);
        return {
          success: false,
          message: `Error running thermal data cleanup: ${error.message}`
        };
      }
    } catch (err: any) {
      console.error('Error in runThermalDataCleanup:', err);
      return { success: false, error: err.message };
    }
  },

  /**
   * Cleanup all API resources to prevent memory leaks
   * Should be called when the app is shutting down
   */
  // Private cleanup (not exposed as HTTP endpoint)
  internalCleanup: async ({ homey }: ApiHandlerContext) => {
    try {
      homey.app.log('Starting API resources cleanup...');

      // Clean up optimizer (which includes thermal model service)
      if (global.optimizer && typeof global.optimizer.cleanup === 'function') {
        try {
          global.optimizer.cleanup();
          homey.app.log('Optimizer resources cleaned up');
        } catch (optimizerError: any) {
          homey.app.error('Error cleaning up optimizer:', optimizerError);
        }
      }

      // Clean up MELCloud API
      if (global.melCloud && typeof global.melCloud.cleanup === 'function') {
        try {
          global.melCloud.cleanup();
          homey.app.log('MELCloud API resources cleaned up');
        } catch (melCloudError: any) {
          homey.app.error('Error cleaning up MELCloud API:', melCloudError);
        }
      }

      // Clean up Tibber API  
      if (global.tibber && typeof global.tibber.cleanup === 'function') {
        try {
          global.tibber.cleanup();
          homey.app.log('Tibber API resources cleaned up');
        } catch (tibberError: any) {
          homey.app.error('Error cleaning up Tibber API:', tibberError);
        }
      }

      // Clean up COP Helper (best-effort – helper may not expose cleanup)
      const copHelperInstance = global.copHelper as unknown as { cleanup?: () => void } | null;
      if (copHelperInstance?.cleanup) {
        try {
          copHelperInstance.cleanup();
          homey.app.log('COP Helper resources cleaned up');
        } catch (copError: any) {
          homey.app.error('Error cleaning up COP Helper:', copError);
        }
      }

      // Clear global references
      global.optimizer = null;
      global.melCloud = null;
      global.tibber = null;
      global.copHelper = null;

      homey.app.log('All API resources cleaned up successfully');
      return {
        success: true,
        message: 'All resources cleaned up successfully'
      };

    } catch (error: any) {
      homey.app.error('Error during API cleanup:', error);
      return {
        success: false,
        error: error.message
      };
    }
  },

  'hot-water': {
    'reset-patterns': async ({ homey }: ApiHandlerContext): Promise<HotWaterResponse> => {
      homey.app.log('API method hot-water/reset-patterns called');
      const service = getHotWaterService(homey);
      if (!service) {
        return {
          success: false,
          message: 'Hot water service not available'
        };
      }

      try {
        service.resetPatterns();
        return {
          success: true,
          message: 'Hot water usage patterns have been reset to defaults.'
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        homey.app.error('Error resetting hot water patterns:', error);
        return {
          success: false,
          message: `Error resetting hot water usage patterns: ${message}`
        };
      }
    },

    'clear-data': async ({ homey, body }: ApiHandlerContext): Promise<HotWaterResponse> => {
      homey.app.log('API method hot-water/clear-data called');
      const service = getHotWaterService(homey);
      if (!service) {
        return {
          success: false,
          message: 'Hot water service not available'
        };
      }

      const payload = (body ?? {}) as HotWaterClearRequest;
      const clearAggregated = payload.clearAggregated === undefined
        ? true
        : Boolean(payload.clearAggregated);

      try {
        await service.clearData(clearAggregated);
        const suffix = clearAggregated
          ? ' including aggregated data.'
          : ' while keeping aggregated data.';
        return {
          success: true,
          message: `Hot water usage data has been cleared${suffix}`
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        homey.app.error('Error clearing hot water data:', error);
        return {
          success: false,
          message: `Error clearing hot water usage data: ${message}`
        };
      }
    }
  }
};

const exportedApi = apiHandlers as typeof apiHandlers & { __test?: Record<string, unknown> };

module.exports = exportedApi;

// Hide internalCleanup from ManagerApi endpoint enumeration (keep it private)
try {
  if (exportedApi && typeof exportedApi.internalCleanup === 'function') {
    const __ic = exportedApi.internalCleanup;
    delete (exportedApi as unknown as Record<string, unknown>).internalCleanup;
    Object.defineProperty(exportedApi, 'internalCleanup', {
      value: __ic,
      enumerable: false,
      writable: false,
      configurable: false
    });
  }
} catch (_: any) {}

// Test helpers - only exposed when running in test environment
if (process.env.NODE_ENV === 'test') {
  exportedApi.__test = {
    // Inject internal service instances (mocks) for deterministic unit tests
    setServices({ melCloud: m, tibber: t, optimizer: o, weather: w }: Partial<ServiceState>) {
      applyServiceOverrides({ melCloud: m ?? undefined, tibber: t ?? undefined, optimizer: o ?? undefined, weather: w ?? undefined });
      const state = getServiceState();
      melCloud = state.melCloud;
      tibber = state.tibber;
      optimizer = state.optimizer;
      weather = state.weather;
      historicalData = state.historicalData;
    },
    // Replace historical data map
    setHistoricalData(data: HistoricalData) {
      setOrchestratorHistoricalData(data);
      historicalData = getServiceState().historicalData;
    },
    // Reset to defaults
    resetAll() {
      resetServiceState();
      const state = getServiceState();
      melCloud = state.melCloud;
      tibber = state.tibber;
      optimizer = state.optimizer;
      weather = state.weather;
      historicalData = state.historicalData;
    },
    // Expose internal state for assertions
    getState() {
      return getServiceStateSnapshot();
    }
  };
}
