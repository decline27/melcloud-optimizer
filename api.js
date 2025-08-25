// Thin wrapper for backward compatibility
// This file now delegates to the TypeScript API implementation

// Import the compiled TypeScript compatibility layer
// Try both paths: local development (.homeybuild/src) and Homey runtime (./src)
let api;
try {
  // Try Homey runtime path first
  api = require('./src/api-compat').api;
} catch (e1) {
  try {
    // Fallback to local development path
    api = require('./.homeybuild/src/api-compat').api;
  } catch (e2) {
    console.error('Failed to load API compatibility layer from both paths:');
    console.error('Runtime path error:', e1.message);
    console.error('Development path error:', e2.message);
    throw new Error('Could not load API compatibility layer');
  }
}

// Export everything that the original api.js exported
module.exports = {
  // Export the function reference (for direct calls to updateOptimizerSettings)
  updateOptimizerSettings: api.updateOptimizerSettingsFunction,
  
  // Export all API methods
  updateOptimizerSettings: api.updateOptimizerSettings,
  getDeviceList: api.getDeviceList,
  getRunHourlyOptimizer: api.getRunHourlyOptimizer,
  getThermalModelData: api.getThermalModelData,
  getRunWeeklyCalibration: api.getRunWeeklyCalibration,
  getStartCronJobs: api.getStartCronJobs,
  getUpdateCronStatus: api.getUpdateCronStatus,
  getCheckCronStatus: api.getCheckCronStatus,
  getCOPData: api.getCOPData,
  getWeeklyAverageCOP: api.getWeeklyAverageCOP,
  getMelCloudStatus: api.getMelCloudStatus,
  getTibberStatus: api.getTibberStatus,
  runSystemHealthCheck: api.runSystemHealthCheck,
  getMemoryUsage: api.getMemoryUsage,
  runThermalDataCleanup: api.runThermalDataCleanup
};

// Add test helpers only in test environment (matches original behavior)
if (process.env.NODE_ENV === 'test' && api.__test) {
  module.exports.__test = api.__test;
}