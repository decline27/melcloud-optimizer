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
   * Run test logging
   */
  async testLogging() {
    this.app.log('API method testLogging called');
    this.app.testLogging();
    return { success: true, message: 'Test logging completed' };
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
}
