import HeatOptimizerApp from './app';
import { captureProcessMemory } from './util/memory';

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

      const {
        stats: processMemory,
        source: processMemorySource,
        fallbackReason: processMemoryFallbackReason
      } = captureProcessMemory(this.app);

      // Get thermal model memory usage if available
      let thermalModelMemory = null;
      if (api.optimizer && api.optimizer.thermalModelService) {
        thermalModelMemory = api.optimizer.thermalModelService.getMemoryUsage();
      }

      return {
        success: true,
        processMemory,
        processMemorySource,
        processMemoryFallbackReason,
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

      const result = await api.optimizer.calculateEnhancedDailySavingsWithBaseline(
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

      const enhancedCalculator = api.optimizer.getEnhancedSavingsCalculator();
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

  /**
   * Get all stored data for debugging and analysis
   */
  async getAllStoredData() {
    this.app.log('API method getAllStoredData called');

    try {
      const data: any = {
        metadata: {
          timestamp: new Date().toISOString(),
          appVersion: this.app.manifest?.version || 'unknown'
        },
        configuration: {},
        thermalModelData: {},
        hotWaterData: {},
        copData: {},
        adaptiveParameters: {},
        optimizationHistory: {},
        memoryUsage: {},
        errors: []
      };

      // Collect configuration settings
      try {
        const configKeys = [
          'melcloud_user', 'building_id', 'device_id', 'time_zone_name', 'time_zone_offset', 'use_dst',
          'comfort_lower_home', 'comfort_upper_home', 'comfort_lower_away', 'comfort_upper_away',
          'occupied', 'holiday_mode', 'price_data_source', 'tibber_api_token', 'entsoe_area_eic',
          'preheat_cheap_percentile', 'currency_code', 'enable_consumer_markup', 'consumer_markup_config',
          'cop_weight', 'auto_seasonal_mode', 'summer_mode', 'initial_k', 'enable_baseline_comparison'
        ];

        for (const key of configKeys) {
          const value = this.app.homey.settings.get(key);
          if (value !== null && value !== undefined) {
            // Mask sensitive data
            if (key === 'melcloud_pass' || key === 'tibber_api_token') {
              data.configuration[key] = value ? '[MASKED]' : null;
            } else {
              data.configuration[key] = value;
            }
          }
        }
      } catch (error) {
        data.errors.push(`Configuration collection error: ${error instanceof Error ? error.message : String(error)}`);
      }

      // Collect thermal model data
      try {
        const thermalModelData = this.app.homey.settings.get('thermal_model_data');
        const thermalModelAggregatedData = this.app.homey.settings.get('thermal_model_aggregated_data');
        const thermalCharacteristics = this.app.homey.settings.get('thermal_characteristics');

        data.thermalModelData = {
          rawData: thermalModelData || null,
          aggregatedData: thermalModelAggregatedData || null,
          characteristics: thermalCharacteristics || null,
          dataPointCount: thermalModelData?.length || 0,
          aggregatedDataPointCount: thermalModelAggregatedData?.length || 0
        };
      } catch (error) {
        data.errors.push(`Thermal model data collection error: ${error instanceof Error ? error.message : String(error)}`);
      }

      // Collect hot water data
      try {
        const hotWaterUsageData = this.app.homey.settings.get('hot_water_usage_data');
        const hotWaterAggregatedData = this.app.homey.settings.get('hot_water_usage_aggregated_data');
        const hotWaterPatterns = this.app.homey.settings.get('hot_water_usage_patterns');

        data.hotWaterData = {
          usageData: hotWaterUsageData || null,
          aggregatedData: hotWaterAggregatedData || null,
          patterns: hotWaterPatterns || null,
          usageDataPointCount: hotWaterUsageData?.length || 0,
          aggregatedDataPointCount: hotWaterAggregatedData?.length || 0
        };
      } catch (error) {
        data.errors.push(`Hot water data collection error: ${error instanceof Error ? error.message : String(error)}`);
      }

      // Collect COP data
      try {
        const copDaily = this.app.homey.settings.get('cop_snapshots_daily');
        const copWeekly = this.app.homey.settings.get('cop_snapshots_weekly');
        const copMonthly = this.app.homey.settings.get('cop_snapshots_monthly');

        data.copData = {
          daily: copDaily || [],
          weekly: copWeekly || [],
          monthly: copMonthly || [],
          dailyCount: (copDaily || []).length,
          weeklyCount: (copWeekly || []).length,
          monthlyCount: (copMonthly || []).length
        };
      } catch (error) {
        data.errors.push(`COP data collection error: ${error instanceof Error ? error.message : String(error)}`);
      }

      // Collect adaptive parameters
      try {
        const adaptiveParams = this.app.homey.settings.get('adaptive_business_parameters');
        
        data.adaptiveParameters = {
          parameters: adaptiveParams || null,
          hasData: !!adaptiveParams
        };
      } catch (error) {
        data.errors.push(`Adaptive parameters collection error: ${error instanceof Error ? error.message : String(error)}`);
      }

      // Collect optimization history
      try {
        const optimizationHistory = this.app.homey.settings.get('optimization_history');
        const orchestratorMetrics = this.app.homey.settings.get('orchestrator_metrics');

        data.optimizationHistory = {
          history: optimizationHistory || [],
          metrics: orchestratorMetrics || null,
          historyCount: (optimizationHistory || []).length
        };
      } catch (error) {
        data.errors.push(`Optimization history collection error: ${error instanceof Error ? error.message : String(error)}`);
      }

      // Collect memory usage
      try {
        const memoryResult = await this.getMemoryUsage();
        data.memoryUsage = memoryResult.success ? {
          processMemory: memoryResult.processMemory,
          thermalModelMemory: memoryResult.thermalModelMemory,
          timestamp: memoryResult.timestamp
        } : { error: memoryResult.message };
      } catch (error) {
        data.errors.push(`Memory usage collection error: ${error instanceof Error ? error.message : String(error)}`);
      }

      // Add data size estimation
      try {
        const dataString = JSON.stringify(data);
        data.metadata.dataSizeBytes = dataString.length;
        data.metadata.dataSizeKB = Math.round(dataString.length / 1024 * 100) / 100;
      } catch (error) {
        data.errors.push(`Data size calculation error: ${error instanceof Error ? error.message : String(error)}`);
      }

      return {
        success: true,
        data,
        message: 'Data dump collected successfully'
      };
    } catch (error: unknown) {
      this.app.error('Error collecting stored data:', error as Error);
      return {
        success: false,
        message: `Error collecting stored data: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
}
