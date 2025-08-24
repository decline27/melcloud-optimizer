import HeatOptimizerApp from './app';

/**
 * API class for the MELCloud Optimizer app
 * This class handles all API requests from the settings page
 */
export class Api {
  private app: HeatOptimizerApp;

  constructor(app: HeatOptimizerApp) {
    this.app = app;
  }

  /**
   * Return a formatted device list using the available MELCloud service.
   * This is a minimal TypeScript port of the legacy `getDeviceList` endpoint.
   * It will attempt to use an injected MelCloud service on the app or global
   * scope. If unavailable it returns a helpful error object so a developer can
   * continue porting.
   */
  async getDeviceList({ homey }: { homey?: any } = {}) {
    try {
  // Prefer an app-scoped melCloud service (explicit injection). Use the
  // internal test-state fallback for compatibility rather than reading
  // from global.* directly.
  const melCloud = (this.app as any).melCloud ?? (__test && __test.getState && __test.getState().melCloud);
      if (!melCloud || typeof melCloud.getDevices !== 'function') {
        throw new Error('MelCloud service not available. Inject melCloud on the app (preferred) or set legacy global for compatibility.');
      }

      const devices = await melCloud.getDevices();

      const formattedDevices = devices.map((device: any) => ({
        id: device.id,
        name: device.name,
        buildingId: device.buildingId,
        type: device.type,
        hasZone1: device.data && device.data.SetTemperatureZone1 !== undefined,
        hasZone2: device.data && device.data.SetTemperatureZone2 !== undefined,
        currentTemperatureZone1: device.data && device.data.RoomTemperatureZone1,
        currentTemperatureZone2: device.data && device.data.RoomTemperatureZone2,
        currentSetTemperatureZone1: device.data && device.data.SetTemperatureZone1,
        currentSetTemperatureZone2: device.data && device.data.SetTemperatureZone2,
      }));

      // Group by building
      const buildings: Record<string, any> = {};
      devices.forEach((d: any) => {
        if (!buildings[d.buildingId]) {
          buildings[d.buildingId] = { id: d.buildingId, name: `Building ${d.buildingId}`, devices: [] };
        }
        buildings[d.buildingId].devices.push(d.id);
      });

      return { success: true, devices: formattedDevices, buildings: Object.values(buildings) };
    } catch (err: any) {
      try { this.app.log && this.app.log('Error in getDeviceList:', err); } catch (e) {}
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Run the hourly optimizer using an injected optimizer service.
   * Minimal behavior: calls optimizer.runEnhancedOptimization and returns its result.
   */
  async getRunHourlyOptimizer({ homey }: { homey?: any } = {}) {
    try {
  const _state = (__test && __test.getState && (__test.getState() as any)) || {};
  const optimizer = (this.app as any).optimizer || _state.optimizer;
      if (!optimizer || typeof optimizer.runEnhancedOptimization !== 'function') {
        throw new Error('Optimizer service not available. Inject optimizer via app or global to use getRunHourlyOptimizer.');
      }
      const result = await optimizer.runEnhancedOptimization();
      return { success: true, result };
    } catch (err: any) {
      try { this.app.error && this.app.error('Error in getRunHourlyOptimizer:', err); } catch (e) {}
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Run weekly calibration. If historical data is insufficient returns not-enough-data.
   * Uses injected historical data via app or global if available; otherwise relies on
   * the optimizer service to perform the calibration when enough data exists.
   */
  async getRunWeeklyCalibration({ homey }: { homey?: any } = {}) {
    try {
  const optimizer = (this.app as any).optimizer || (__test && __test.getState && __test.getState().optimizer);
  const historical = (this.app as any).historicalData || (__test && __test.getState && __test.getState().historicalData) || { optimizations: [] };

      const count = historical.optimizations ? historical.optimizations.length : 0;
      if (count < 20) {
        return { success: false, historicalDataCount: count };
      }

      if (!optimizer || typeof optimizer.runWeeklyCalibration !== 'function') {
        throw new Error('Optimizer service not available. Inject optimizer via app or global to use getRunWeeklyCalibration.');
      }

      const res = await optimizer.runWeeklyCalibration();
      return { success: true, result: res };
    } catch (err: any) {
      try { this.app.error && this.app.error('Error in getRunWeeklyCalibration:', err); } catch (e) {}
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Run hourly optimizer
   */
  async runHourlyOptimizer() {
    this.app.log('API method runHourlyOptimizer called');
    await this.app.runHourlyOptimizer();
    return { success: true, message: 'Hourly optimization completed' };
  }

  /**
   * Run weekly calibration
   */
  async runWeeklyCalibration() {
    this.app.log('API method runWeeklyCalibration called');
    await this.app.runWeeklyCalibration();
    return { success: true, message: 'Weekly calibration completed' };
  }

  /**
   * Get memory usage statistics
   */
  async getMemoryUsage() {
    this.app.log('API method getMemoryUsage called');

    try {
      // Get the optimizer instance from the API
      const api = require('../api.js');

      // Get memory usage from process
      const processMemory = process.memoryUsage();

      // Get thermal model memory usage if available
      let thermalModelMemory = null;
      if (api.optimizer && api.optimizer.thermalModelService) {
        thermalModelMemory = api.optimizer.thermalModelService.getMemoryUsage();
      }

      return {
        success: true,
        processMemory: {
          rss: Math.round(processMemory.rss / 1024 / 1024 * 100) / 100,
          heapTotal: Math.round(processMemory.heapTotal / 1024 / 1024 * 100) / 100,
          heapUsed: Math.round(processMemory.heapUsed / 1024 / 1024 * 100) / 100,
          external: Math.round(processMemory.external / 1024 / 1024 * 100) / 100,
        },
        thermalModelMemory,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      this.app.error('Error getting memory usage:', error as Error);
      return {
        success: false,
        message: `Error getting memory usage: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Get MELCloud connection status
   */
  async getMelCloudStatus({ homey }: { homey?: any } = {}) {
    try {
  const _state = (__test && __test.getState && (__test.getState() as any)) || {};
  const melCloud = (this.app as any).melCloud || _state.melCloud;
      if (!melCloud) return { success: true, connected: false, message: 'MelCloud service not available' };

      // Prefer a status method if available
      if (typeof melCloud.getStatus === 'function') {
        const status = await melCloud.getStatus();
        return { success: true, connected: !!status.connected, status };
      }

      // Fallback: try to determine connectivity via simple ping/login check if supported
      if (typeof melCloud.login === 'function') {
        try {
          await melCloud.login();
          return { success: true, connected: true };
        } catch (err) {
          return { success: true, connected: false, message: (err as Error).message };
        }
      }

      return { success: true, connected: true };
    } catch (err: any) {
      try { this.app.error && this.app.error('Error in getMelCloudStatus:', err); } catch (e) {}
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Get Tibber connection/status
   */
  async getTibberStatus({ homey }: { homey?: any } = {}) {
    try {
  const tibber = (this.app as any).tibber || (__test && __test.getState && __test.getState().tibber);
      if (!tibber) return { success: true, connected: false, message: 'Tibber service not available' };

      if (typeof tibber.getStatus === 'function') {
        const status = await tibber.getStatus();
        return { success: true, connected: !!status.connected, status };
      }

      // Fallback: attempt to fetch prices as a health check
      if (typeof tibber.getPrices === 'function') {
        try {
          await tibber.getPrices();
          return { success: true, connected: true };
        } catch (err) {
          return { success: true, connected: false, message: (err as Error).message };
        }
      }

      return { success: true, connected: true };
    } catch (err: any) {
      try { this.app.error && this.app.error('Error in getTibberStatus:', err); } catch (e) {}
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Run the app's system health check and return the result
   */
  async runSystemHealthCheck({ homey }: { homey?: any } = {}) {
    try {
      if (this.app && typeof (this.app as any).runSystemHealthCheck === 'function') {
        const res = await (this.app as any).runSystemHealthCheck();
        return res;
      }
      return { healthy: false, issues: ['App does not expose runSystemHealthCheck'], recovered: false };
    } catch (err: any) {
      try { this.app.error && this.app.error('Error in runSystemHealthCheck:', err); } catch (e) {}
      return { healthy: false, issues: [err instanceof Error ? err.message : String(err)], recovered: false };
    }
  }

  /**
   * Get COP data (delegates to COPHelper or melCloud service)
   */
  async getCOPData({ homey }: { homey?: any } = {}) {
    try {
  const _state = (__test && __test.getState && (__test.getState() as any)) || {};
  const copHelper = (this.app as any).copHelper || _state.copHelper;
      if (copHelper && typeof copHelper.getCOPData === 'function') {
        const data = await copHelper.getCOPData();
        return { success: true, data };
      }

      // Fallback to melCloud API if it provides COP data
  const melCloud = (this.app as any).melCloud || (__test && __test.getState && __test.getState().melCloud);
      if (melCloud && typeof melCloud.getCOPData === 'function') {
        const data = await melCloud.getCOPData();
        return { success: true, data };
      }

      return { success: false, message: 'COP data provider not available' };
    } catch (err: any) {
      try { this.app.error && this.app.error('Error in getCOPData:', err); } catch (e) {}
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Wrapper to compute weekly average COP for a device
   */
  async getWeeklyAverageCOP({ deviceId, buildingId }: { deviceId?: string; buildingId?: number } = {}) {
    try {
      const melCloud = (this.app as any).melCloud || (__test && __test.getState && __test.getState().melCloud);
      if (!melCloud || typeof melCloud.getWeeklyAverageCOP !== 'function') {
        return { success: false, message: 'MelCloud service does not support weekly COP calculation' };
      }
      const result = await melCloud.getWeeklyAverageCOP(deviceId || (this.app as any).deviceId, buildingId || (this.app as any).buildingId);
      return { success: true, data: result };
    } catch (err: any) {
      try { this.app.error && this.app.error('Error in getWeeklyAverageCOP:', err); } catch (e) {}
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Update optimizer settings from Homey settings (delegates to optimizer/COP helper)
   */
  async updateOptimizerSettings(homey: any) {
    try {
  const optimizer = (this.app as any).optimizer || (__test && __test.getState && __test.getState().optimizer);
      const copHelper = (this.app as any).copHelper || (__test && __test.getState && __test.getState().copHelper);

      // Let optimizer update its settings if method exists
      if (optimizer && typeof optimizer.applySettings === 'function') {
        await optimizer.applySettings(homey || this.app.homey);
      }

      // COP helper may also need to refresh
      if (copHelper && typeof copHelper.refreshSettings === 'function') {
        await copHelper.refreshSettings(homey || this.app.homey);
      }

      return { success: true };
    } catch (err: any) {
      try { this.app.error && this.app.error('Error in updateOptimizerSettings:', err); } catch (e) {}
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Return cron job status from the app
   */
  async getCheckCronStatus() {
    try {
      if (typeof (this.app as any).getCronStatus === 'function') {
        const status = (this.app as any).getCronStatus();
        return { success: true, status };
      }
      return { success: false, message: 'App does not expose cron status' };
    } catch (err: any) {
      try { this.app.error && this.app.error('Error in getCheckCronStatus:', err); } catch (e) {}
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Force update cron status in settings
   */
  async getUpdateCronStatus() {
    try {
      if (typeof (this.app as any).updateCronStatusInSettings === 'function') {
        await (this.app as any).updateCronStatusInSettings();
        return { success: true };
      }
      return { success: false, message: 'App does not support updating cron status' };
    } catch (err: any) {
      try { this.app.error && this.app.error('Error in getUpdateCronStatus:', err); } catch (e) {}
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Start cron jobs (initialize)
   */
  async getStartCronJobs() {
    try {
      if (typeof (this.app as any).initializeCronJobs === 'function') {
        (this.app as any).initializeCronJobs();
        return { success: true };
      }
      return { success: false, message: 'App does not support starting cron jobs' };
    } catch (err: any) {
      try { this.app.error && this.app.error('Error in getStartCronJobs:', err); } catch (e) {}
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Return thermal model data (delegates to optimizer.thermalModelService)
   */
  async getThermalModelData() {
    try {
  const optimizer = (this.app as any).optimizer || (__test && __test.getState && __test.getState().optimizer);
      if (!optimizer) return { success: false, message: 'Optimizer service not available' };

      if (optimizer.thermalModelService) {
        const svc = optimizer.thermalModelService;
        const characteristics = typeof svc.getThermalCharacteristics === 'function' ? svc.getThermalCharacteristics() : null;
        const memoryUsage = typeof svc.getMemoryUsage === 'function' ? svc.getMemoryUsage() : null;
        return { success: true, characteristics, memoryUsage };
      }

      return { success: false, message: 'Thermal model service not available' };
    } catch (err: any) {
      try { this.app.error && this.app.error('Error in getThermalModelData:', err); } catch (e) {}
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Run thermal data cleanup
   */
  async runThermalDataCleanup() {
    this.app.log('API method runThermalDataCleanup called');

    try {
      // Get the optimizer instance from the API
      const api = require('../api.js');

      // Run thermal data cleanup if available
      if (api.optimizer && api.optimizer.thermalModelService) {
        const result = api.optimizer.thermalModelService.forceDataCleanup();
        return {
          success: true,
          ...result
        };
      } else {
        return {
          success: false,
          message: 'Thermal model service not available'
        };
      }
    } catch (error) {
      this.app.error('Error running thermal data cleanup:', error as Error);
      return {
        success: false,
        message: `Error running thermal data cleanup: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Reset hot water usage patterns to defaults
   */
  async resetHotWaterPatterns() {
    this.app.log('API method resetHotWaterPatterns called');

    try {
      if (this.app.hotWaterService) {
        this.app.hotWaterService.resetPatterns();
        return {
          success: true,
          message: 'Hot water usage patterns have been reset to defaults'
        };
      } else {
        return {
          success: false,
          message: 'Hot water service not available'
        };
      }
    } catch (error) {
      this.app.error('Error resetting hot water patterns:', error as Error);
      return {
        success: false,
        message: `Error resetting hot water patterns: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Clear all hot water usage data and reset patterns
   * @param clearAggregated Whether to clear aggregated data as well (default: true)
   */
  async clearHotWaterData({ clearAggregated = true } = {}) {
    this.app.log(`API method clearHotWaterData called (clearAggregated: ${clearAggregated})`);

    try {
      if (this.app.hotWaterService) {
        await this.app.hotWaterService.clearData(clearAggregated);
        return {
          success: true,
          message: `Hot water usage data has been cleared${clearAggregated ? ' including aggregated data' : ' (kept aggregated data)'}`
        };
      } else {
        return {
          success: false,
          message: 'Hot water service not available'
        };
      }
    } catch (error: unknown) {
      this.app.error('Error clearing hot water data:', error instanceof Error ? error : String(error));
      return {
        success: false,
        message: `Error clearing hot water data: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
}

/**
 * Compatibility helper: allow external code (e.g. the compatibility shim) to
 * inject runtime services into the environment where the TypeScript API runs.
 * This mirrors the injected services to the global scope so legacy consumers
 * can still find them (the long-term goal is to use app-scoped services).
 */
export async function initializeServices(services?: any) {
  try {
    if (!services || typeof services !== 'object') return;
    // Do not mirror injected services into the global object here.
    // Instead keep the injected services in the implementation's test
    // helpers (if present) so we can remove global reliance incrementally.

    // If the implementation maintains its own __test helpers, delegate to it
    // (safe no-op if not present). The helper will update its internal
    // state rather than writing to globals.
    try {
      const impl: any = (module && module.exports) || {};
      if (impl.__test && typeof impl.__test.setServices === 'function') {
        impl.__test.setServices(services);
      }
    } catch (e) {
      // ignore
    }
  } catch (err) {
    // Nothing fatal here; just log if global logger available
  try { const s = (__test && __test.getState && (__test.getState() as any)); s && s.logger && s.logger.error && s.logger.error('initializeServices failed', err); } catch (e) {}
  }
}

/**
 * Top-level helper to match legacy module.exports.updateOptimizerSettings
 * This mirrors the behavior of the Api.updateOptimizerSettings endpoint
 * and is used by `src/app.ts` which requires the runtime API module.
 */
export async function updateOptimizerSettings(homey: any) {
    try {
      // Initialize any injected services into our compatibility helper
      try { await initializeServices(homey); } catch (e) { /* ignore */ }

      const api = new Api((homey && homey.app) as any);
      return await api.updateOptimizerSettings(homey);
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
}

// Top-level compatibility wrappers for legacy module.exports API functions.
// These allow callers that `require('../api.js')` to call functions directly.
export async function getDeviceList({ homey }: { homey?: any } = {}) {
  try {
    const api = new Api((homey && homey.app) as any);
    return await api.getDeviceList({ homey });
  } catch (err: any) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function getRunHourlyOptimizer({ homey }: { homey?: any } = {}) {
  try {
    const api = new Api((homey && homey.app) as any);
    return await api.getRunHourlyOptimizer({ homey });
  } catch (err: any) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function getRunWeeklyCalibration({ homey }: { homey?: any } = {}) {
  try {
    const api = new Api((homey && homey.app) as any);
    return await api.getRunWeeklyCalibration({ homey });
  } catch (err: any) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function runHourlyOptimizer({ }: any = {}) {
  try {
    // run via global app if available
  const app = (((__test && __test.getState && (__test.getState() as any)) || {}).app) || undefined;
    if (app) {
      const api = new Api(app as any);
      return await api.runHourlyOptimizer();
    }
    // Fallback: create Api using global.app placeholder
    return { success: false, message: 'App instance not available' };
  } catch (err: any) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function runWeeklyCalibration({ }: any = {}) {
  try {
  const app = (((__test && __test.getState && (__test.getState() as any)) || {}).app) || undefined;
    if (app) {
      const api = new Api(app as any);
      return await api.runWeeklyCalibration();
    }
    return { success: false, message: 'App instance not available' };
  } catch (err: any) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function getMemoryUsage({ homey }: { homey?: any } = {}) {
  try {
    const api = new Api((homey && homey.app) as any);
    return await api.getMemoryUsage();
  } catch (err: any) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function getMelCloudStatus({ homey }: { homey?: any } = {}) {
  try {
    const api = new Api((homey && homey.app) as any);
    return await api.getMelCloudStatus({ homey });
  } catch (err: any) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function getTibberStatus({ homey }: { homey?: any } = {}) {
  try {
    const api = new Api((homey && homey.app) as any);
    return await api.getTibberStatus({ homey });
  } catch (err: any) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function getCOPData({ homey }: { homey?: any } = {}) {
  try {
    const api = new Api((homey && homey.app) as any);
    return await api.getCOPData({ homey });
  } catch (err: any) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function getWeeklyAverageCOP({ homey }: { homey?: any } = {}) {
  try {
    const api = new Api((homey && homey.app) as any);
    return await api.getWeeklyAverageCOP({});
  } catch (err: any) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function getCheckCronStatus({ homey }: { homey?: any } = {}) {
  try {
    const api = new Api((homey && homey.app) as any);
    return await api.getCheckCronStatus();
  } catch (err: any) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function getUpdateCronStatus({ homey }: { homey?: any } = {}) {
  try {
    const api = new Api((homey && homey.app) as any);
    return await api.getUpdateCronStatus();
  } catch (err: any) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function getStartCronJobs({ homey }: { homey?: any } = {}) {
  try {
    const api = new Api((homey && homey.app) as any);
    return await api.getStartCronJobs();
  } catch (err: any) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function getThermalModelData({ homey }: { homey?: any } = {}) {
  try {
    const api = new Api((homey && homey.app) as any);
    return await api.getThermalModelData();
  } catch (err: any) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function runThermalDataCleanup({ homey }: { homey?: any } = {}) {
  try {
    const api = new Api((homey && homey.app) as any);
    return await api.runThermalDataCleanup();
  } catch (err: any) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function resetHotWaterPatterns({ homey }: { homey?: any } = {}) {
  try {
    const api = new Api((homey && homey.app) as any);
    return await api.resetHotWaterPatterns();
  } catch (err: any) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function clearHotWaterData({ clearAggregated = true }: { clearAggregated?: boolean } = {}) {
  try {
    // No homey param needed; use global app if present
  const app = (((__test && __test.getState && (__test.getState() as any)) || {}).app) || undefined;
    const api = new Api(app as any);
    return await api.clearHotWaterData({ clearAggregated });
  } catch (err: any) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function runSystemHealthCheck({ homey }: { homey?: any } = {}) {
  try {
    const api = new Api((homey && homey.app) as any);
    return await api.runSystemHealthCheck({ homey });
  } catch (err: any) {
    return { healthy: false, issues: [err instanceof Error ? err.message : String(err)], recovered: false };
  }
}

// Export simple __test helpers to aid the compatibility shim and unit tests.
// These mirror the legacy API test helpers used by the existing test-suite.
const __test = (() => {
  const _state: any = { services: {}, historicalData: null };

  return {
    // Expose the internal state so the legacy runtime shim can read it
    _state,

    setServices(services: any) {
      try {
        if (!services || typeof services !== 'object') return;
        _state.services = services || {};
        // Mirror into globals for backward compatibility with existing
        // tests and legacy consumers that still read from global.*.
        // We also keep the internal _state so new code can migrate away
        // from global reliance.
        try {
          // Mirror into legacy globals for transitional test compatibility, but keep
          // the internal _state as the primary source of truth.
          if ((services as any).melCloud !== undefined) try { (global as any).melCloud = (services as any).melCloud; } catch (e) {}
          if ((services as any).tibber !== undefined) try { (global as any).tibber = (services as any).tibber; } catch (e) {}
          if ((services as any).optimizer !== undefined) try { (global as any).optimizer = (services as any).optimizer; } catch (e) {}
        } catch (e) {
          // ignore if globals are not writable in some environments
        }

        if (services.historicalData) {
          _state.historicalData = services.historicalData;
          try { (global as any).historicalData = services.historicalData; } catch (e) {}
        }
      } catch (e) {
        // ignore
      }
    },
    setHistoricalData(data: any) {
      _state.historicalData = data;
  try { (global as any).historicalData = data; } catch (e) {}
    },
    resetAll() {
      _state.services = {};
      _state.historicalData = { optimizations: [], lastCalibration: null };
      // Clear legacy globals for services but keep historicalData defined
      // so tests that expect historicalData to exist still pass.
      try {
  try { delete (global as any).melCloud; } catch (e) {}
  try { delete (global as any).tibber; } catch (e) {}
  try { delete (global as any).optimizer; } catch (e) {}
  try { (global as any).historicalData = _state.historicalData; } catch (e) {}
      } catch (e) {
        // ignore
      }
    },
    getState() {
      // Return a legacy-shaped object for compatibility. Do NOT write to
      // globals; instead return the expected shape using our internal state.
      return {
        melCloud: _state.services?.melCloud,
        tibber: _state.services?.tibber,
  optimizer: _state.services?.optimizer,
  copHelper: _state.services?.copHelper,
        historicalData: _state.historicalData,
        _state
      };
    }
  };
})();

// Attach to module.exports for CommonJS compatibility used by some tests/shim
try {
  if (typeof module !== 'undefined' && module.exports) {
    (module.exports as any).__test = __test;
  }
} catch (e) {
  // ignore in environments where module is not writable
}
