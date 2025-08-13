import { Api } from '../../src/api';
import HeatOptimizerApp from '../../src/app';

// Mock the HeatOptimizerApp
jest.mock('../../src/app');

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
    mockApp.runHourlyOptimizer = jest.fn().mockResolvedValue({ success: true });
    mockApp.runWeeklyCalibration = jest.fn().mockResolvedValue({ success: true });

    // Create API instance with mock app
    api = new Api(mockApp);
  });

  describe('runHourlyOptimizer', () => {
    it('should call app.runHourlyOptimizer and return success', async () => {
      const result = await api.runHourlyOptimizer();

      expect((mockApp as any).log).toHaveBeenCalledWith('API method runHourlyOptimizer called');
      expect(mockApp.runHourlyOptimizer).toHaveBeenCalled();
      expect(result).toEqual({ success: true, message: 'Hourly optimization completed' });
    });

    it('should handle errors from app.runHourlyOptimizer', async () => {
      // Make runHourlyOptimizer fail
      mockApp.runHourlyOptimizer.mockRejectedValue(new Error('Optimization error'));

      try {
        await api.runHourlyOptimizer();
        fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).toBe('Optimization error');
      }

      expect((mockApp as any).log).toHaveBeenCalledWith('API method runHourlyOptimizer called');
      expect(mockApp.runHourlyOptimizer).toHaveBeenCalled();
    });
  });

  describe('runWeeklyCalibration', () => {
    it('should call app.runWeeklyCalibration and return success', async () => {
      const result = await api.runWeeklyCalibration();

      expect((mockApp as any).log).toHaveBeenCalledWith('API method runWeeklyCalibration called');
      expect(mockApp.runWeeklyCalibration).toHaveBeenCalled();
      expect(result).toEqual({ success: true, message: 'Weekly calibration completed' });
    });

    it('should handle errors from app.runWeeklyCalibration', async () => {
      // Make runWeeklyCalibration fail
      mockApp.runWeeklyCalibration.mockRejectedValue(new Error('Calibration error'));

      try {
        await api.runWeeklyCalibration();
        fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).toBe('Calibration error');
      }

      expect((mockApp as any).log).toHaveBeenCalledWith('API method runWeeklyCalibration called');
      expect(mockApp.runWeeklyCalibration).toHaveBeenCalled();
    });
  });
});
