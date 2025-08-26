import HeatOptimizerApp from './app';
import * as apiCore from './api-core';

/**
 * API class for the MELCloud Optimizer app
 * This class handles all API requests from the settings page
 */
export class Api {
  private app: HeatOptimizerApp;

  constructor(app: HeatOptimizerApp) {
    console.log('API constructor: Received app:', !!app);
    console.log('API constructor: App type:', typeof app);
    this.app = app;
    console.log('API constructor: API instance created');
  }

  /**
   * Run hourly optimizer
   */
  async runHourlyOptimizer() {
    this.app.log('API method runHourlyOptimizer called');
    try {
      const result = await apiCore.getRunHourlyOptimizer({ homey: this.app.homey });
      return result;
    } catch (error) {
      this.app.error('Error in runHourlyOptimizer:', error as Error);
      return {
        success: false,
        message: `Error running hourly optimizer: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Run weekly calibration
   */
  async runWeeklyCalibration() {
    this.app.log('API method runWeeklyCalibration called');
    try {
      const result = await apiCore.getRunWeeklyCalibration({ homey: this.app.homey });
      return result;
    } catch (error) {
      this.app.error('Error in runWeeklyCalibration:', error as Error);
      return {
        success: false,
        message: `Error running weekly calibration: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Get device list from MELCloud
   */
  getDeviceList() {
    console.log('API method getDeviceList called');
    console.log('API method: this.app exists:', !!this.app);
    console.log('API method: this.app.homey exists:', !!this.app?.homey);
    
    // Simple synchronous test 
    return {
      success: true,
      message: 'API method getDeviceList is working',
      data: {
        test: true,
        debugInfo: {
          hasApp: !!this.app,
          hasHomey: !!this.app?.homey
        }
      }
    };
  }

  /**
   * Get thermal model data
   */
  async getThermalModelData() {
    this.app.log('API method getThermalModelData called');
    try {
      const result = await apiCore.getThermalModelData({ homey: this.app.homey });
      return result;
    } catch (error) {
      this.app.error('Error in getThermalModelData:', error as Error);
      return {
        success: false,
        message: `Error getting thermal model data: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Start cron jobs
   */
  async getStartCronJobs() {
    this.app.log('API method getStartCronJobs called');
    try {
      const result = await apiCore.getStartCronJobs({ homey: this.app.homey });
      return result;
    } catch (error) {
      this.app.error('Error in getStartCronJobs:', error as Error);
      return {
        success: false,
        message: `Error starting cron jobs: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Check cron job status
   */
  async getCheckCronStatus() {
    this.app.log('API method getCheckCronStatus called');
    try {
      const result = await apiCore.getCheckCronStatus({ homey: this.app.homey });
      return result;
    } catch (error) {
      this.app.error('Error in getCheckCronStatus:', error as Error);
      return {
        success: false,
        message: `Error checking cron status: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Get memory usage statistics
   */
  async getMemoryUsage() {
    this.app.log('API method getMemoryUsage called');

    try {
      // Get memory usage using TypeScript API
      const result = await apiCore.getMemoryUsage(this.app.homey);
      return result;
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
      // Run thermal data cleanup using TypeScript API
      const result = await apiCore.runThermalDataCleanup(this.app.homey);
      return result;
    } catch (error) {
      this.app.error('Error running thermal data cleanup:', error as Error);
      return {
        success: false,
        message: `Error running thermal data cleanup: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Hot water endpoints
   */
  async 'hot-water/reset-patterns'() {
    return this.resetHotWaterPatterns();
  }

  async 'hot-water/clear-data'(params: { clearAggregated?: boolean } = {}) {
    return this.clearHotWaterData(params);
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
