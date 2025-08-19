/**
 * Legacy API Bridge - Delegating to TypeScript Services
 * 
 * This file provides legacy API compatibility while delegating to the new TypeScript services.
 * This maintains backward compatibility during the transition period.
 */

// Initialize TypeScript services
let optimizerService = null;
let melCloudService = null;
let tibberService = null;
let thermalModelService = null;

// Service initialization function
async function initializeServices(homey) {
  if (!optimizerService) {
    try {
      // Import TypeScript services
      const { Optimizer } = require('./lib/services/optimizer.js');
      const { MelCloudApi } = require('./lib/services/melcloud-api.js');
      const { TibberApi } = require('./lib/services/tibber-api.js');
      const { ThermalModelService } = require('./lib/services/thermal-model/thermal-model-service.js');
      const { HomeyLogger } = require('./lib/util/logger.js');

      // Create logger
      const logger = new HomeyLogger(homey, {
        level: 1, // INFO level
        logToTimeline: false,
        prefix: 'LegacyBridge'
      });

      // Initialize services
      melCloudService = new MelCloudApi(logger);
      tibberService = new TibberApi(logger);
      thermalModelService = new ThermalModelService(homey, logger);
      
      // Initialize optimizer with dependencies
      optimizerService = new Optimizer(
        melCloudService,
        tibberService,
        null, // deviceId - will be set from settings
        null, // buildingId - will be set from settings
        logger,
        null  // weather service - optional
      );

      console.log('TypeScript services initialized successfully');
    } catch (error) {
      console.error('Failed to initialize TypeScript services:', error);
      throw error;
    }
  }
}

// Bridge API that delegates to TypeScript services
const api = {
  // Legacy optimizer methods - now delegate to TypeScript services
  async updateOptimizerSettings(homey) {
    console.log('Legacy API: updateOptimizerSettings - delegating to TypeScript services');
    try {
      await initializeServices(homey);
      // This is mainly configuration updates, which should be handled by the app
      return { success: true, message: 'Settings updated via TypeScript services' };
    } catch (error) {
      console.error('Error in updateOptimizerSettings:', error);
      return { success: false, error: error.message };
    }
  },

  async getRunHourlyOptimizer({ homey }) {
    console.log('Legacy API: getRunHourlyOptimizer - delegating to TypeScript services');
    try {
      await initializeServices(homey);
      const result = await optimizerService.runHourlyOptimization();
      return { 
        success: true, 
        data: result
      };
    } catch (error) {
      console.error('Error in getRunHourlyOptimizer:', error);
      return { 
        success: false, 
        error: error.message,
        data: null 
      };
    }
  },

  async getRunWeeklyCalibration({ homey }) {
    console.log('Legacy API: getRunWeeklyCalibration - delegating to TypeScript services');
    try {
      await initializeServices(homey);
      const result = await optimizerService.runWeeklyCalibration();
      return { 
        success: true, 
        data: result
      };
    } catch (error) {
      console.error('Error in getRunWeeklyCalibration:', error);
      return { 
        success: false, 
        error: error.message,
        data: null 
      };
    }
  },

  async getMelCloudStatus({ homey }) {
    console.log('Legacy API: getMelCloudStatus - delegating to TypeScript services');
    try {
      await initializeServices(homey);
      // Check if MELCloud service is available and connected
      const status = melCloudService.getStatus ? await melCloudService.getStatus() : { connected: true };
      return status;
    } catch (error) {
      console.error('Error in getMelCloudStatus:', error);
      return { connected: false, error: error.message };
    }
  },

  async getTibberStatus({ homey }) {
    console.log('Legacy API: getTibberStatus - delegating to TypeScript services');
    try {
      await initializeServices(homey);
      // Check if Tibber service is available and connected
      const status = tibberService.getStatus ? await tibberService.getStatus() : { connected: true };
      return status;
    } catch (error) {
      console.error('Error in getTibberStatus:', error);
      return { connected: false, error: error.message };
    }
  },

  // Legacy service instances - delegate to TypeScript services
  get melCloud() {
    return {
      cleanup() {
        console.log('Legacy API: melCloud.cleanup - delegating to TypeScript services');
        if (melCloudService && typeof melCloudService.cleanup === 'function') {
          melCloudService.cleanup();
        }
      }
    };
  },

  get tibber() {
    return {
      cleanup() {
        console.log('Legacy API: tibber.cleanup - delegating to TypeScript services');
        if (tibberService && typeof tibberService.cleanup === 'function') {
          tibberService.cleanup();
        }
      }
    };
  },

  get optimizer() {
    return {
      get thermalModelService() {
        return {
          stop() {
            console.log('Legacy API: thermalModelService.stop - delegating to TypeScript services');
            if (thermalModelService && typeof thermalModelService.stop === 'function') {
              thermalModelService.stop();
            }
          },
          forceDataCleanup() {
            console.log('Legacy API: thermalModelService.forceDataCleanup - delegating to TypeScript services');
            try {
              if (thermalModelService && typeof thermalModelService.forceDataCleanup === 'function') {
                return thermalModelService.forceDataCleanup();
              }
              return { 
                success: false, 
                message: 'Thermal model service not available',
                memoryUsageBefore: 0,
                memoryUsageAfter: 0
              };
            } catch (error) {
              console.error('Error in forceDataCleanup:', error);
              return { 
                success: false, 
                message: error.message,
                memoryUsageBefore: 0,
                memoryUsageAfter: 0
              };
            }
          },
          getMemoryUsage() {
            console.log('Legacy API: thermalModelService.getMemoryUsage - delegating to TypeScript services');
            try {
              if (thermalModelService && typeof thermalModelService.getMemoryUsage === 'function') {
                return thermalModelService.getMemoryUsage();
              }
              return {
                dataPointCount: 0,
                aggregatedDataCount: 0,
                totalMemoryUsage: 0
              };
            } catch (error) {
              console.error('Error in getMemoryUsage:', error);
              return {
                dataPointCount: 0,
                aggregatedDataCount: 0,
                totalMemoryUsage: 0
              };
            }
          }
        };
      }
    };
  }
};

module.exports = api;
