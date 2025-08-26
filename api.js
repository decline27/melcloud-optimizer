console.log('🚀 API.JS FILE LOADED - SDK v3 - TIMESTAMP:', new Date().toISOString());

module.exports = {
  async getDeviceList({ homey, query }) {
    console.log('🎯 getDeviceList CALLED - Settings page calling SDK v3 API');
    console.log('API: homey available:', !!homey);
    console.log('API: app available:', !!homey.app);
    console.log('API: query params:', query);
    
    try {
      // Import and call the TypeScript implementation
      const apiCore = require('./src/api-core');
      const result = await apiCore.getDeviceList({ homey });
      console.log('✅ getDeviceList result:', result);
      return result;
    } catch (error) {
      console.error('❌ getDeviceList error:', error);
      return {
        success: false,
        error: error.message || 'Unknown error in getDeviceList'
      };
    }
  },
  
  async runHourlyOptimizer({ homey, query }) {
    console.log('🎯 runHourlyOptimizer CALLED - SDK v3');
    try {
      const apiCore = require('./src/api-core');
      const result = await apiCore.getRunHourlyOptimizer({ homey });
      console.log('✅ runHourlyOptimizer result:', result);
      return result;
    } catch (error) {
      console.error('❌ runHourlyOptimizer error:', error);
      return { success: false, error: error.message || 'Unknown error in runHourlyOptimizer' };
    }
  },
  
  async runWeeklyCalibration({ homey, query }) {
    console.log('🎯 runWeeklyCalibration CALLED - SDK v3');
    try {
      const apiCore = require('./src/api-core');
      const result = await apiCore.getRunWeeklyCalibration({ homey });
      console.log('✅ runWeeklyCalibration result:', result);
      return result;
    } catch (error) {
      console.error('❌ runWeeklyCalibration error:', error);
      return { success: false, error: error.message || 'Unknown error in runWeeklyCalibration' };
    }
  },
  
  async getCheckCronStatus({ homey, query }) {
    console.log('🎯 getCheckCronStatus CALLED - SDK v3');
    try {
      const apiCore = require('./src/api-core');
      const result = await apiCore.getCheckCronStatus({ homey });
      console.log('✅ getCheckCronStatus result:', result);
      return result;
    } catch (error) {
      console.error('❌ getCheckCronStatus error:', error);
      return { success: false, error: error.message || 'Unknown error in getCheckCronStatus' };
    }
  },
  
  async getUpdateCronStatus({ homey, query }) {
    console.log('🎯 getUpdateCronStatus CALLED - SDK v3');
    try {
      const apiCore = require('./src/api-core');
      const result = await apiCore.getUpdateCronStatus({ homey });
      console.log('✅ getUpdateCronStatus result:', result);
      return result;
    } catch (error) {
      console.error('❌ getUpdateCronStatus error:', error);
      return { success: false, error: error.message || 'Unknown error in getUpdateCronStatus' };
    }
  },
  
  async getStartCronJobs({ homey, query }) {
    console.log('🎯 getStartCronJobs CALLED - SDK v3');
    try {
      const apiCore = require('./src/api-core');
      const result = await apiCore.getStartCronJobs({ homey });
      console.log('✅ getStartCronJobs result:', result);
      return result;
    } catch (error) {
      console.error('❌ getStartCronJobs error:', error);
      return { success: false, error: error.message || 'Unknown error in getStartCronJobs' };
    }
  },
  
  async getThermalModelData({ homey, query }) {
    console.log('🎯 getThermalModelData CALLED - SDK v3');
    try {
      const apiCore = require('./src/api-core');
      const result = await apiCore.getThermalModelData({ homey });
      console.log('✅ getThermalModelData result:', result);
      return result;
    } catch (error) {
      console.error('❌ getThermalModelData error:', error);
      return { success: false, error: error.message || 'Unknown error in getThermalModelData' };
    }
  },
  
  async getCOPData({ homey, query }) {
    console.log('🎯 getCOPData CALLED - SDK v3');
    try {
      const apiCore = require('./src/api-core');
      const result = await apiCore.getCOPData({ homey });
      console.log('✅ getCOPData result:', result);
      return result;
    } catch (error) {
      console.error('❌ getCOPData error:', error);
      return { success: false, error: error.message || 'Unknown error in getCOPData' };
    }
  },
  
  async getWeeklyAverageCOP({ homey, query }) {
    console.log('🎯 getWeeklyAverageCOP CALLED - SDK v3');
    try {
      const apiCore = require('./src/api-core');
      const result = await apiCore.getWeeklyAverageCOP({ homey });
      console.log('✅ getWeeklyAverageCOP result:', result);
      return result;
    } catch (error) {
      console.error('❌ getWeeklyAverageCOP error:', error);
      return { success: false, error: error.message || 'Unknown error in getWeeklyAverageCOP' };
    }
  },
  
  async updateOptimizerSettings({ homey, query }) {
    console.log('🎯 updateOptimizerSettings CALLED - SDK v3');
    try {
      const apiCore = require('./src/api-core');
      const result = await apiCore.updateOptimizerSettings({ homey });
      console.log('✅ updateOptimizerSettings result:', result);
      return result;
    } catch (error) {
      console.error('❌ updateOptimizerSettings error:', error);
      return { success: false, error: error.message || 'Unknown error in updateOptimizerSettings' };
    }
  },
  
  async getMelCloudStatus({ homey, query }) {
    console.log('🎯 getMelCloudStatus CALLED - SDK v3');
    try {
      const apiCore = require('./src/api-core');
      const result = await apiCore.getMelCloudStatus({ homey });
      console.log('✅ getMelCloudStatus result:', result);
      return result;
    } catch (error) {
      console.error('❌ getMelCloudStatus error:', error);
      return { success: false, error: error.message || 'Unknown error in getMelCloudStatus' };
    }
  },
  
  async getTibberStatus({ homey, query }) {
    console.log('🎯 getTibberStatus CALLED - SDK v3');
    try {
      const apiCore = require('./src/api-core');
      const result = await apiCore.getTibberStatus({ homey });
      console.log('✅ getTibberStatus result:', result);
      return result;
    } catch (error) {
      console.error('❌ getTibberStatus error:', error);
      return { success: false, error: error.message || 'Unknown error in getTibberStatus' };
    }
  },
  
  async runSystemHealthCheck({ homey, query }) {
    console.log('🎯 runSystemHealthCheck CALLED - SDK v3');
    try {
      const apiCore = require('./src/api-core');
      const result = await apiCore.runSystemHealthCheck({ homey });
      console.log('✅ runSystemHealthCheck result:', result);
      return result;
    } catch (error) {
      console.error('❌ runSystemHealthCheck error:', error);
      return { success: false, error: error.message || 'Unknown error in runSystemHealthCheck' };
    }
  },
  
  async getMemoryUsage({ homey, query }) {
    console.log('🎯 getMemoryUsage CALLED - SDK v3');
    try {
      const apiCore = require('./src/api-core');
      const result = await apiCore.getMemoryUsage({ homey });
      console.log('✅ getMemoryUsage result:', result);
      return result;
    } catch (error) {
      console.error('❌ getMemoryUsage error:', error);
      return { success: false, error: error.message || 'Unknown error in getMemoryUsage' };
    }
  },
  
  async runThermalDataCleanup({ homey, query }) {
    console.log('🎯 runThermalDataCleanup CALLED - SDK v3');
    try {
      const apiCore = require('./src/api-core');
      const result = await apiCore.runThermalDataCleanup({ homey });
      console.log('✅ runThermalDataCleanup result:', result);
      return result;
    } catch (error) {
      console.error('❌ runThermalDataCleanup error:', error);
      return { success: false, error: error.message || 'Unknown error in runThermalDataCleanup' };
    }
  }
};