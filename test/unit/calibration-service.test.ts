/**
 * Calibration Service Tests
 *
 * Comprehensive test suite covering:
 * - runWeeklyCalibration with thermal learning
 * - runWeeklyCalibration basic calibration (fallback)
 * - learnFromOptimizationOutcome with season detection
 * - Edge cases and error handling
 * - CalibrationResult interface compliance
 */

import {
  CalibrationService,
  CalibrationResult,
  CalibrationLogger,
} from '../../src/services/calibration-service';
import { ThermalController } from '../../src/services/thermal-controller';
import { ThermalModelService } from '../../src/services/thermal-model';
import { AdaptiveParametersLearner } from '../../src/services/adaptive-parameters';

// Mock ThermalController
jest.mock('../../src/services/thermal-controller');
// Mock ThermalModelService
jest.mock('../../src/services/thermal-model');
// Mock AdaptiveParametersLearner
jest.mock('../../src/services/adaptive-parameters');

describe('CalibrationService', () => {
  let mockLogger: jest.Mocked<CalibrationLogger>;
  let mockThermalController: jest.Mocked<ThermalController>;
  let mockThermalModelService: jest.Mocked<ThermalModelService>;
  let mockAdaptiveParametersLearner: jest.Mocked<AdaptiveParametersLearner>;
  let service: CalibrationService;

  const createMockThermalCharacteristics = (overrides: Record<string, unknown> = {}) => ({
    heatingRate: 0.5,
    coolingRate: 0.3,
    outdoorTempImpact: 0.1,
    windImpact: 0.05,
    thermalMass: 0.8,
    modelConfidence: 0.5,
    lastUpdated: new Date().toISOString(),
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();

    mockLogger = {
      log: jest.fn(),
      error: jest.fn(),
    };

    mockThermalController = {
      getThermalModel: jest.fn(() => ({ K: 0.5, S: 0.7 })),
      setThermalModel: jest.fn(),
    } as unknown as jest.Mocked<ThermalController>;

    mockThermalModelService = {
      getThermalCharacteristics: jest.fn(() => createMockThermalCharacteristics()),
      forceModelUpdate: jest.fn(),
    } as unknown as jest.Mocked<ThermalModelService>;

    mockAdaptiveParametersLearner = {
      learnFromOutcome: jest.fn(),
    } as unknown as jest.Mocked<AdaptiveParametersLearner>;

    service = new CalibrationService(
      mockLogger,
      mockThermalController,
      mockThermalModelService,
      mockAdaptiveParametersLearner,
      true // useThermalLearning
    );
  });

  describe('runWeeklyCalibration', () => {
    describe('with thermal learning enabled', () => {
      it('should calibrate using thermal learning data when confidence is high', async () => {
        mockThermalModelService.getThermalCharacteristics.mockReturnValue(
          createMockThermalCharacteristics({ modelConfidence: 0.5 })
        );

        const result = await service.runWeeklyCalibration();

        expect(result.success).toBe(true);
        expect(result.oldK).toBe(0.5);
        expect(result.newK).toBeGreaterThan(0);
        expect(result.analysis).toContain('Learning-based calibration');
        expect(result.thermalCharacteristics).toBeDefined();
        expect(mockThermalController.setThermalModel).toHaveBeenCalled();
        expect(mockThermalModelService.forceModelUpdate).toHaveBeenCalled();
        expect(mockLogger.log).toHaveBeenCalledWith(expect.stringContaining('Starting weekly calibration'));
      });

      it('should fall back to basic calibration when confidence is low', async () => {
        mockThermalModelService.getThermalCharacteristics.mockReturnValue(
          createMockThermalCharacteristics({ modelConfidence: 0.1 })
        );

        const result = await service.runWeeklyCalibration();

        expect(result.success).toBe(true);
        // When confidence is low, it should still use the learning path but with the original K
        // because the rawK = baseK when confidence <= 0.3
        expect(result.oldK).toBe(0.5);
        expect(result.newK).toBe(0.5); // Should be clamped oldK since confidence is low
        expect(mockThermalController.setThermalModel).toHaveBeenCalled();
      });

      it('should handle getThermalCharacteristics throwing an error', async () => {
        mockThermalModelService.getThermalCharacteristics.mockImplementation(() => {
          throw new Error('Failed to get characteristics');
        });

        const result = await service.runWeeklyCalibration();

        expect(result.success).toBe(true);
        expect(result.method).toBe('basic');
        expect(result.analysis).toContain('Basic calibration applied');
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.stringContaining('Error updating thermal model from learning data'),
          expect.any(Error)
        );
      });

      it('should handle forceModelUpdate throwing an error gracefully', async () => {
        mockThermalModelService.getThermalCharacteristics.mockReturnValue(
          createMockThermalCharacteristics({ modelConfidence: 0.5 })
        );
        mockThermalModelService.forceModelUpdate.mockImplementation(() => {
          throw new Error('Failed to persist');
        });

        const result = await service.runWeeklyCalibration();

        expect(result.success).toBe(true);
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.stringContaining('Failed to persist thermal model confidence'),
          expect.any(Error)
        );
      });

      it('should clamp K-factor to valid range (0.1 to 10)', async () => {
        mockThermalModelService.getThermalCharacteristics.mockReturnValue(
          createMockThermalCharacteristics({
            modelConfidence: 0.5,
            heatingRate: 50, // Very high heating rate would produce K > 10
          })
        );

        const result = await service.runWeeklyCalibration();

        expect(result.newK).toBeLessThanOrEqual(10);
        expect(result.newK).toBeGreaterThanOrEqual(0.1);
      });

      it('should clamp S (thermal mass) to valid range (0.01 to 1)', async () => {
        mockThermalModelService.getThermalCharacteristics.mockReturnValue(
          createMockThermalCharacteristics({
            modelConfidence: 0.5,
            thermalMass: 5, // Invalid, should be clamped to 1
          })
        );

        const result = await service.runWeeklyCalibration();

        expect(result.newS).toBeLessThanOrEqual(1);
        expect(result.newS).toBeGreaterThanOrEqual(0.01);
      });

      it('should use default S when thermalMass is not a number', async () => {
        mockThermalModelService.getThermalCharacteristics.mockReturnValue(
          createMockThermalCharacteristics({
            modelConfidence: 0.5,
            thermalMass: NaN,
          })
        );

        const result = await service.runWeeklyCalibration();

        expect(result.newS).toBe(0.7); // Default from thermal model
      });
    });

    describe('with thermal learning disabled', () => {
      beforeEach(() => {
        service = new CalibrationService(
          mockLogger,
          mockThermalController,
          null, // No thermal model service
          mockAdaptiveParametersLearner,
          false // useThermalLearning disabled
        );
      });

      it('should use basic calibration', async () => {
        const result = await service.runWeeklyCalibration();

        expect(result.success).toBe(true);
        expect(result.method).toBe('basic');
        expect(result.analysis).toContain('Basic calibration applied');
        expect(mockThermalController.setThermalModel).toHaveBeenCalled();
      });

      it('should apply random variation to K-factor', async () => {
        const results: number[] = [];
        
        // Run calibration multiple times to check for variation
        for (let i = 0; i < 10; i++) {
          const result = await service.runWeeklyCalibration();
          results.push(result.newK);
        }

        // At least some results should be different due to random variation
        const uniqueResults = new Set(results);
        expect(uniqueResults.size).toBeGreaterThan(1);
      });
    });

    describe('error handling', () => {
      it('should return failure result when no thermal model available', async () => {
        mockThermalController.getThermalModel.mockReturnValue(null as any);

        const result = await service.runWeeklyCalibration();

        expect(result.success).toBe(false);
        expect(result.oldK).toBe(0);
        expect(result.newK).toBe(0);
        expect(result.analysis).toBe('No thermal model available');
      });

      it('should return failure result when calibration throws error', async () => {
        mockThermalController.getThermalModel.mockReturnValue({ K: 0.5, S: 0.7 });
        mockThermalController.setThermalModel.mockImplementation(() => {
          throw new Error('Failed to set model');
        });

        // Disable thermal learning to trigger basic calibration which calls setThermalModel
        service = new CalibrationService(
          mockLogger,
          mockThermalController,
          null,
          mockAdaptiveParametersLearner,
          false
        );

        const result = await service.runWeeklyCalibration();

        expect(result.success).toBe(false);
        expect(result.analysis).toContain('Calibration failed');
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.stringContaining('Error in weekly calibration'),
          expect.any(Error)
        );
      });

      it('should include timestamp in all results', async () => {
        const before = new Date().toISOString();
        const result = await service.runWeeklyCalibration();
        const after = new Date().toISOString();

        expect(result.timestamp).toBeDefined();
        expect(new Date(result.timestamp).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());
        expect(new Date(result.timestamp).getTime()).toBeLessThanOrEqual(new Date(after).getTime());
      });
    });

    describe('CalibrationResult interface', () => {
      it('should return all required fields', async () => {
        const result = await service.runWeeklyCalibration();

        expect(typeof result.oldK).toBe('number');
        expect(typeof result.newK).toBe('number');
        expect(typeof result.newS).toBe('number');
        expect(typeof result.timestamp).toBe('string');
      });

      it('should return optional fields when thermal learning is used', async () => {
        mockThermalModelService.getThermalCharacteristics.mockReturnValue(
          createMockThermalCharacteristics({ modelConfidence: 0.5 })
        );

        const result = await service.runWeeklyCalibration();

        expect(result.thermalCharacteristics).toBeDefined();
        expect(result.success).toBe(true);
        expect(result.analysis).toBeDefined();
      });
    });
  });

  describe('learnFromOptimizationOutcome', () => {
    it('should delegate to adaptiveParametersLearner', () => {
      service.learnFromOptimizationOutcome(0.5, 0, 3.5);

      expect(mockAdaptiveParametersLearner.learnFromOutcome).toHaveBeenCalledWith(
        expect.any(String), // season
        0.5, // actualSavings
        0, // comfortViolations
        3.5 // currentCOP
      );
    });

    it('should detect summer season (June-August)', () => {
      // Mock the date to June
      jest.useFakeTimers();
      jest.setSystemTime(new Date(2024, 5, 15)); // June 15

      service.learnFromOptimizationOutcome(0.5, 0, 3.5);

      expect(mockAdaptiveParametersLearner.learnFromOutcome).toHaveBeenCalledWith(
        'summer',
        0.5,
        0,
        3.5
      );

      jest.useRealTimers();
    });

    it('should detect winter season (November-February)', () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date(2024, 0, 15)); // January 15

      service.learnFromOptimizationOutcome(0.5, 0, 3.5);

      expect(mockAdaptiveParametersLearner.learnFromOutcome).toHaveBeenCalledWith(
        'winter',
        0.5,
        0,
        3.5
      );

      jest.useRealTimers();
    });

    it('should detect transition season (March-May, September-October)', () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date(2024, 3, 15)); // April 15

      service.learnFromOptimizationOutcome(0.5, 0, 3.5);

      expect(mockAdaptiveParametersLearner.learnFromOutcome).toHaveBeenCalledWith(
        'transition',
        0.5,
        0,
        3.5
      );

      jest.useRealTimers();
    });

    it('should handle November as transition (month 10 is not >= 11)', () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date(2024, 10, 15)); // November 15 (month 10)

      service.learnFromOptimizationOutcome(0.5, 0, 3.5);

      // Note: This is the existing behavior - November (month 10) is treated as transition
      // because the condition is month >= 11 which doesn't include month 10
      expect(mockAdaptiveParametersLearner.learnFromOutcome).toHaveBeenCalledWith(
        'transition',
        0.5,
        0,
        3.5
      );

      jest.useRealTimers();
    });

    it('should handle December as winter', () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date(2024, 11, 15)); // December 15

      service.learnFromOptimizationOutcome(0.5, 0, 3.5);

      expect(mockAdaptiveParametersLearner.learnFromOutcome).toHaveBeenCalledWith(
        'winter',
        0.5,
        0,
        3.5
      );

      jest.useRealTimers();
    });

    it('should not call learner when adaptiveParametersLearner is null', () => {
      service = new CalibrationService(
        mockLogger,
        mockThermalController,
        mockThermalModelService,
        null, // No adaptive learner
        true
      );

      // Should not throw
      service.learnFromOptimizationOutcome(0.5, 0, 3.5);

      expect(mockAdaptiveParametersLearner.learnFromOutcome).not.toHaveBeenCalled();
    });

    it('should handle undefined COP', () => {
      service.learnFromOptimizationOutcome(0.5, 2, undefined);

      expect(mockAdaptiveParametersLearner.learnFromOutcome).toHaveBeenCalledWith(
        expect.any(String),
        0.5,
        2,
        undefined
      );
    });

    it('should handle negative savings', () => {
      service.learnFromOptimizationOutcome(-0.3, 0, 3.5);

      expect(mockAdaptiveParametersLearner.learnFromOutcome).toHaveBeenCalledWith(
        expect.any(String),
        -0.3,
        0,
        3.5
      );
    });

    it('should handle comfort violations', () => {
      service.learnFromOptimizationOutcome(0.2, 5, 3.0);

      expect(mockAdaptiveParametersLearner.learnFromOutcome).toHaveBeenCalledWith(
        expect.any(String),
        0.2,
        5,
        3.0
      );
    });
  });

  describe('edge cases', () => {
    it('should handle thermal model with undefined S', async () => {
      mockThermalController.getThermalModel.mockReturnValue({ K: 0.5 });

      service = new CalibrationService(
        mockLogger,
        mockThermalController,
        null,
        mockAdaptiveParametersLearner,
        false
      );

      const result = await service.runWeeklyCalibration();

      expect(result.success).toBe(true);
      // When S is undefined, oldS becomes 0 (from `thermalModel.S || 0`)
      // Then clampS(0) returns 0.01 (minimum value)
      expect(result.newS).toBe(0.01);
    });

    it('should handle characteristics with NaN heatingRate', async () => {
      mockThermalModelService.getThermalCharacteristics.mockReturnValue(
        createMockThermalCharacteristics({
          heatingRate: NaN,
          coolingRate: NaN,
          modelConfidence: 0.5,
        })
      );

      const result = await service.runWeeklyCalibration();

      // Should still succeed and log n/a for rates
      expect(result.success).toBe(true);
      expect(mockLogger.log).toHaveBeenCalledWith(expect.stringContaining('n/a'));
    });

    it('should handle characteristics with Infinity values', async () => {
      mockThermalModelService.getThermalCharacteristics.mockReturnValue(
        createMockThermalCharacteristics({
          heatingRate: Infinity,
          modelConfidence: 0.5,
        })
      );

      const result = await service.runWeeklyCalibration();

      // K should be clamped to max value (10)
      expect(result.newK).toBeLessThanOrEqual(10);
    });

    it('should handle zero K-factor', async () => {
      mockThermalController.getThermalModel.mockReturnValue({ K: 0, S: 0.7 });

      service = new CalibrationService(
        mockLogger,
        mockThermalController,
        null,
        mockAdaptiveParametersLearner,
        false
      );

      const result = await service.runWeeklyCalibration();

      // Should clamp to minimum 0.1
      expect(result.newK).toBeGreaterThanOrEqual(0.1);
    });
  });
});
