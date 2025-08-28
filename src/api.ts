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
   * Run thermal data cleanup
   */
  async runThermalDataCleanup() {
    this.app.log('API method runThermalDataCleanup called');

    try {
      // Call the JavaScript API implementation
      const api = require('../api.js');
      return await api.runThermalDataCleanup({ homey: this.app.homey });
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
