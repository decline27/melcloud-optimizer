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
      this.app.error('Error clearing hot water data:', error instanceof Error ? error : new Error(String(error)));
      return {
        success: false,
        message: `Error clearing hot water data: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Get enhanced daily savings with baseline comparison
   * @param options Configuration options for baseline calculation
   */
  async getEnhancedSavingsWithBaseline(options: {
    currentHourSavings?: number;
    actualConsumptionKWh?: number;
    actualCost?: number;
    enableBaseline?: boolean;
  } = {}) {
    this.app.log('API method getEnhancedSavingsWithBaseline called', options);

    try {
      // Get the optimizer instance
      const api = require('../api.js');
      if (!api.optimizer) {
        return {
          success: false,
          message: 'Optimizer not available'
        };
      }

      const {
        currentHourSavings = 0,
        actualConsumptionKWh = 1.0,
        actualCost = 0,
        enableBaseline = true
      } = options;

      // Get historical optimization data from today
      const today = new Date().toISOString().split('T')[0];
      const optimizationHistory = this.app.homey.settings.get('optimization_history') || [];
      const todayOptimizations = optimizationHistory.filter((opt: any) => 
        opt.timestamp && opt.timestamp.startsWith(today)
      );

      const result = await api.optimizer.getSavingsService().calculateEnhancedDailySavingsWithBaseline(
        currentHourSavings,
        todayOptimizations,
        actualConsumptionKWh,
        actualCost,
        enableBaseline
      );

      return {
        success: true,
        data: result,
        message: 'Enhanced savings with baseline calculated successfully'
      };
    } catch (error: unknown) {
      this.app.error('Error calculating enhanced savings with baseline:', error as Error);
      return {
        success: false,
        message: `Error calculating enhanced savings: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Get baseline calculation capabilities and configuration
   */
  async getBaselineInfo() {
    this.app.log('API method getBaselineInfo called');

    try {
      // Get the optimizer instance
      const api = require('../api.js');
      if (!api.optimizer) {
        return {
          success: false,
          message: 'Optimizer not available'
        };
      }

      const enhancedCalculator = api.optimizer.getSavingsService().getEnhancedSavingsCalculator();
      const hasCapability = enhancedCalculator?.hasBaselineCapability() || false;
      const intelligentConfig = hasCapability 
        ? enhancedCalculator.getDefaultBaselineConfig()
        : null;

      return {
        success: true,
        data: {
          hasCapability,
          intelligentConfig,
          description: {
            heatingSetpoint: 'Standard EU comfort temperature for baseline comparison',
            hotWaterSetpoint: 'Legionella-safe temperature (regulatory requirement)',
            operatingProfile: 'Automatically determined based on usage patterns',
            copValues: 'Based on learned performance or conservative industry standards'
          },
          services: {
            thermalModel: !!api.optimizer.thermalModelService,
            copHelper: !!api.optimizer.copHelper,
            hotWaterService: !!this.app.hotWaterService
          },
          enableBaselineComparison: this.app.homey.settings.get('enable_baseline_comparison') !== false
        },
        message: 'Baseline information retrieved successfully'
      };
    } catch (error: unknown) {
      this.app.error('Error getting baseline info:', error as Error);
      return {
        success: false,
        message: `Error getting baseline info: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Toggle baseline comparison on/off
   */
  async toggleBaselineComparison(enabled: boolean) {
    this.app.log(`API method toggleBaselineComparison called: ${enabled}`);

    try {
      this.app.homey.settings.set('enable_baseline_comparison', enabled);
      
      return {
        success: true,
        data: { enabled },
        message: `Baseline comparison ${enabled ? 'enabled' : 'disabled'} successfully`
      };
    } catch (error: unknown) {
      this.app.error('Error toggling baseline comparison:', error as Error);
      return {
        success: false,
        message: `Error toggling baseline comparison: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
}
