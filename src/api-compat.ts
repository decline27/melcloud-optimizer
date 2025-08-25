import {
  updateOptimizerSettings,
  updateOptimizerSettingsApi,
  getDeviceList,
  getRunHourlyOptimizer,
  getThermalModelData,
  getRunWeeklyCalibration,
  getStartCronJobs,
  getUpdateCronStatus,
  getCheckCronStatus,
  getCOPData,
  getWeeklyAverageCOP,
  getMelCloudStatus,
  getTibberStatus,
  runSystemHealthCheck,
  getMemoryUsage,
  runThermalDataCleanup,
  testHelpers,
  TestHelpers
} from './api-core';

// This interface matches the exact structure of what api.js exports
export interface ApiCompatibilityInterface {
  // Function reference (for backward compatibility)
  updateOptimizerSettingsFunction: typeof updateOptimizerSettings;
  
  // API Methods (these match the original api.js exports exactly)
  updateOptimizerSettings(params: { homey: any }): Promise<any>;
  getDeviceList(params: { homey: any }): Promise<any>;
  getRunHourlyOptimizer(params: { homey: any }): Promise<any>;
  getThermalModelData(params: { homey: any }): Promise<any>;
  getRunWeeklyCalibration(params: { homey: any }): Promise<any>;
  getStartCronJobs(params: { homey: any }): Promise<any>;
  getUpdateCronStatus(params: { homey: any }): Promise<any>;
  getCheckCronStatus(params: { homey: any }): Promise<any>;
  getCOPData(params: { homey: any }): Promise<any>;
  getWeeklyAverageCOP(params: { homey: any }): Promise<any>;
  getMelCloudStatus(params: { homey: any }): Promise<any>;
  getTibberStatus(params: { homey: any }): Promise<any>;
  runSystemHealthCheck(params: { homey: any }): Promise<any>;
  getMemoryUsage(params: { homey: any }): Promise<any>;
  runThermalDataCleanup(params: { homey: any }): Promise<any>;
  
  // Test helpers (conditional, only in test environment)
  __test?: TestHelpers;
}

// Create the compatibility API object that matches the original api.js module.exports structure
export const api: ApiCompatibilityInterface = {
  // Function reference (for places that call updateOptimizerSettings directly)
  updateOptimizerSettingsFunction: updateOptimizerSettings,

  // API endpoint methods (for places that call these as API endpoints)
  updateOptimizerSettings: updateOptimizerSettingsApi,
  getDeviceList,
  getRunHourlyOptimizer,
  getThermalModelData,
  getRunWeeklyCalibration,
  getStartCronJobs,
  getUpdateCronStatus,
  getCheckCronStatus,
  getCOPData,
  getWeeklyAverageCOP,
  getMelCloudStatus,
  getTibberStatus,
  runSystemHealthCheck,
  getMemoryUsage,
  runThermalDataCleanup
};

// Add test helpers only in test environment (matches original api.js behavior)
if (process.env.NODE_ENV === 'test') {
  api.__test = testHelpers;
}

// Export as default for CommonJS compatibility
export default api;