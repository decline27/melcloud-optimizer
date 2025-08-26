import { Api } from '../../src/api';
import HeatOptimizerApp from '../../src/app';
import * as apiCore from '../../src/api-core';

// Mock the HeatOptimizerApp
jest.mock('../../src/app');

// Mock the api-core module
jest.mock('../../src/api-core', () => ({
  getRunHourlyOptimizer: jest.fn().mockResolvedValue({ success: true, message: 'Hourly optimization completed' }),
  getRunWeeklyCalibration: jest.fn().mockResolvedValue({ success: true, message: 'Weekly calibration completed' }),
  getMemoryUsage: jest.fn().mockResolvedValue({ success: true, processMemory: { rss: 1024 }, timestamp: new Date().toISOString() }),
}));

describe('Api', () => {
  let api: Api;
  let mockApp: jest.Mocked<HeatOptimizerApp>;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Create a mock app instance
    mockApp = new HeatOptimizerApp() as jest.Mocked<HeatOptimizerApp>;

    // Mock app methods
    (mockApp as any).log = jest.fn();
    (mockApp as any).error = jest.fn();
    (mockApp as any).homey = {}; // Mock homey object
    (mockApp as any).hotWaterService = {
      resetPatterns: jest.fn(),
      clearData: jest.fn().mockResolvedValue(undefined)
    };

    // Create API instance with mock app
    api = new Api(mockApp);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('runHourlyOptimizer', () => {
    it('should call apiCore.getRunHourlyOptimizer and return success', async () => {
      const result = await api.runHourlyOptimizer();

      expect((mockApp as any).log).toHaveBeenCalledWith('API method runHourlyOptimizer called');
      expect(apiCore.getRunHourlyOptimizer).toHaveBeenCalledWith({ homey: (mockApp as any).homey });
      expect(result).toEqual({ success: true, message: 'Hourly optimization completed' });
    }, 5000); // 5 second timeout

    it('should handle errors from apiCore.getRunHourlyOptimizer', async () => {
      // Make getRunHourlyOptimizer fail
      (apiCore.getRunHourlyOptimizer as jest.Mock).mockRejectedValueOnce(new Error('Optimization error'));

      const result = await api.runHourlyOptimizer();

      expect((mockApp as any).log).toHaveBeenCalledWith('API method runHourlyOptimizer called');
      expect((mockApp as any).error).toHaveBeenCalledWith('Error in runHourlyOptimizer:', expect.any(Error));
      expect(result).toEqual({ 
        success: false, 
        message: 'Error running hourly optimizer: Optimization error' 
      });
    }, 5000); // 5 second timeout
  });

  describe('runWeeklyCalibration', () => {
    it('should call apiCore.getRunWeeklyCalibration and return success', async () => {
      const result = await api.runWeeklyCalibration();

      expect((mockApp as any).log).toHaveBeenCalledWith('API method runWeeklyCalibration called');
      expect(apiCore.getRunWeeklyCalibration).toHaveBeenCalledWith({ homey: (mockApp as any).homey });
      expect(result).toEqual({ success: true, message: 'Weekly calibration completed' });
    }, 5000); // 5 second timeout

    it('should handle errors from apiCore.getRunWeeklyCalibration', async () => {
      // Make getRunWeeklyCalibration fail
      (apiCore.getRunWeeklyCalibration as jest.Mock).mockRejectedValueOnce(new Error('Calibration error'));

      const result = await api.runWeeklyCalibration();

      expect((mockApp as any).log).toHaveBeenCalledWith('API method runWeeklyCalibration called');
      expect((mockApp as any).error).toHaveBeenCalledWith('Error in runWeeklyCalibration:', expect.any(Error));
      expect(result).toEqual({
        success: false,
        message: 'Error running weekly calibration: Calibration error'
      });
    }, 5000); // 5 second timeout
  });

  describe('getMemoryUsage', () => {
    it('should return memory usage information', async () => {
      const result = await api.getMemoryUsage();

      expect((mockApp as any).log).toHaveBeenCalledWith('API method getMemoryUsage called');
      expect(apiCore.getMemoryUsage).toHaveBeenCalledWith((mockApp as any).homey);
      expect(result.success).toBe(true);
      expect(result.processMemory).toBeDefined();
      expect(result.timestamp).toBeDefined();
    }, 3000);
  });

  describe('resetHotWaterPatterns', () => {
    it('should reset hot water patterns when service is available', async () => {
      const result = await api.resetHotWaterPatterns();

      expect((mockApp as any).log).toHaveBeenCalledWith('API method resetHotWaterPatterns called');
      expect((mockApp as any).hotWaterService.resetPatterns).toHaveBeenCalled();
      expect(result).toEqual({
        success: true,
        message: 'Hot water usage patterns have been reset to defaults'
      });
    }, 3000);

    it('should handle missing hot water service', async () => {
      (mockApp as any).hotWaterService = null;

      const result = await api.resetHotWaterPatterns();

      expect(result).toEqual({
        success: false,
        message: 'Hot water service not available'
      });
    }, 3000);
  });

  describe('clearHotWaterData', () => {
    it('should clear hot water data when service is available', async () => {
      const result = await api.clearHotWaterData();

      expect((mockApp as any).log).toHaveBeenCalledWith('API method clearHotWaterData called (clearAggregated: true)');
      expect((mockApp as any).hotWaterService.clearData).toHaveBeenCalledWith(true);
      expect(result).toEqual({
        success: true,
        message: 'Hot water usage data has been cleared including aggregated data'
      });
    }, 3000);

    it('should handle missing hot water service', async () => {
      (mockApp as any).hotWaterService = null;

      const result = await api.clearHotWaterData();

      expect(result).toEqual({
        success: false,
        message: 'Hot water service not available'
      });
    }, 3000);
  });
});
