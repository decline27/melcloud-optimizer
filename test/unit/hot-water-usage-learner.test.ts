/**
 * Hot Water Usage Learner Service Tests
 *
 * Comprehensive test suite covering:
 * - Adapter functionality (refreshFromService)
 * - Peak hour identification (via adapter)
 * - Default patterns and fallbacks
 * - Edge cases
 */

import {
  HotWaterUsageLearner,
  DEFAULT_HOT_WATER_PEAK_HOURS,
  HOT_WATER_LEARNER_CONFIG,
  HotWaterLearnerLogger,
} from '../../src/services/hot-water-usage-learner';

describe('HotWaterUsageLearner', () => {
  let mockLogger: jest.Mocked<HotWaterLearnerLogger>;

  beforeEach(() => {
    mockLogger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
  });

  describe('constructor', () => {
    it('should initialize with default pattern when no initial pattern provided', () => {
      const learner = new HotWaterUsageLearner(mockLogger);
      const pattern = learner.getPattern();

      expect(pattern.hourlyDemand).toHaveLength(24);
      expect(pattern.hourlyDemand.every(d => d === 0)).toBe(true);
      expect(pattern.peakHours).toEqual([...DEFAULT_HOT_WATER_PEAK_HOURS]);
      expect(pattern.minimumBuffer).toBe(HOT_WATER_LEARNER_CONFIG.DEFAULT_MINIMUM_BUFFER);
      expect(pattern.dataPoints).toBe(0);
    });

    it('should use provided initial pattern', () => {
      const initialPattern = {
        hourlyDemand: new Array(24).fill(1),
        peakHours: [7, 8, 19],
        minimumBuffer: 2.5,
        lastLearningUpdate: new Date(),
        dataPoints: 50,
      };

      const learner = new HotWaterUsageLearner(mockLogger, initialPattern);
      const pattern = learner.getPattern();

      expect(pattern.peakHours).toEqual([7, 8, 19]);
      expect(pattern.minimumBuffer).toBe(2.5);
      expect(pattern.dataPoints).toBe(50);
    });

    it('should work without logger', () => {
      const learner = new HotWaterUsageLearner();
      expect(learner.getDataPointCount()).toBe(0);
    });
  });

  describe('learnFromHistory (Deprecated)', () => {
    it('should return false and warn', () => {
      const learner = new HotWaterUsageLearner(mockLogger);
      const history = [{ timestamp: '2025-01-01T07:00:00Z', amount: 1.5 }];

      const result = learner.learnFromHistory(history);

      expect(result).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('deprecated')
      );
    });
  });

  describe('refreshFromService', () => {
    it('should return false when service is undefined', () => {
      const learner = new HotWaterUsageLearner(mockLogger);
      expect(learner.refreshFromService(undefined)).toBe(false);
    });

    it('should return false when service returns insufficient data (legacy format)', () => {
      const learner = new HotWaterUsageLearner(mockLogger);
      const mockService = {
        getUsageStatistics: jest.fn().mockReturnValue({
          statistics: {
            usageByHourOfDay: new Array(24).fill(0),
            dataPointCount: 3,
          },
        }),
      };

      expect(learner.refreshFromService(mockService as any)).toBe(false);
    });

    it('should refresh pattern from valid service data (legacy format)', () => {
      const learner = new HotWaterUsageLearner(mockLogger);

      const usageByHour = new Array(24).fill(0.5);
      usageByHour[7] = 3.0;
      usageByHour[8] = 2.5;
      usageByHour[19] = 4.0;

      const mockService = {
        getUsageStatistics: jest.fn().mockReturnValue({
          statistics: {
            usageByHourOfDay: usageByHour,
            dataPointCount: 50,
          },
        }),
      };

      const result = learner.refreshFromService(mockService as any);

      expect(result).toBe(true);
      expect(learner.getDataPointCount()).toBe(50);
      expect(learner.getPeakHours()).toContain(19);
      // Buffer check: max demand 4.0 * 1.2 = 4.8
      expect(learner.getMinimumBuffer()).toBeCloseTo(4.8, 1);
    });

    it('should refresh pattern from valid service data (new patterns format)', () => {
      const learner = new HotWaterUsageLearner(mockLogger);

      const hourlyUsagePattern = new Array(24).fill(0.5);
      hourlyUsagePattern[7] = 3.0;
      hourlyUsagePattern[19] = 4.0;

      const mockService = {
        getUsageStatistics: jest.fn().mockReturnValue({
          patterns: {
            hourlyUsagePattern: hourlyUsagePattern,
            lastUpdated: new Date().toISOString(),
            confidence: 100,
          },
        }),
      };

      const result = learner.refreshFromService(mockService as any);

      expect(result).toBe(true);
      // Confidence 100 * 1.68 = 168 data points
      expect(learner.getDataPointCount()).toBe(168);
      expect(learner.getPeakHours()).toContain(19);
    });

    it('should handle service errors gracefully', () => {
      const learner = new HotWaterUsageLearner(mockLogger);
      const mockService = {
        getUsageStatistics: jest.fn().mockImplementation(() => {
          throw new Error('Service error');
        }),
      };

      const result = learner.refreshFromService(mockService as any);

      expect(result).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });

  describe('getters', () => {
    it('getPeakHours should return copy of peak hours', () => {
      const learner = new HotWaterUsageLearner(mockLogger);
      const peaks1 = learner.getPeakHours();
      const peaks2 = learner.getPeakHours();

      expect(peaks1).not.toBe(peaks2);
      expect(peaks1).toEqual(peaks2);
    });

    it('getPattern should return copy of pattern', () => {
      const learner = new HotWaterUsageLearner(mockLogger);
      const pattern1 = learner.getPattern();
      const pattern2 = learner.getPattern();

      expect(pattern1).not.toBe(pattern2);
    });

    it('getEstimatedDailyConsumption should sum hourly demand', () => {
      const learner = new HotWaterUsageLearner(mockLogger);
      
      // Setup via refreshFromService
      const hourlyUsagePattern = new Array(24).fill(1.0);
      const mockService = {
        getUsageStatistics: jest.fn().mockReturnValue({
          patterns: {
            hourlyUsagePattern: hourlyUsagePattern,
            lastUpdated: new Date().toISOString(),
            confidence: 100,
          },
        }),
      };
      learner.refreshFromService(mockService as any);

      const daily = learner.getEstimatedDailyConsumption();
      expect(daily).toBe(24); // 1 kWh * 24 hours
    });
  });

  describe('hasConfidentPattern', () => {
    it('should return false with no data', () => {
      const learner = new HotWaterUsageLearner(mockLogger);
      expect(learner.hasConfidentPattern()).toBe(false);
    });

    it('should return true with sufficient data (via service)', () => {
      const learner = new HotWaterUsageLearner(mockLogger);
      const mockService = {
        getUsageStatistics: jest.fn().mockReturnValue({
          patterns: {
            hourlyUsagePattern: new Array(24).fill(1),
            lastUpdated: new Date().toISOString(),
            confidence: 100, // High confidence
          },
        }),
      };

      learner.refreshFromService(mockService as any);
      expect(learner.hasConfidentPattern()).toBe(true);
    });
  });

  describe('reset', () => {
    it('should reset pattern to defaults', () => {
      const learner = new HotWaterUsageLearner(mockLogger);
      
      // Set some data first
      const mockService = {
        getUsageStatistics: jest.fn().mockReturnValue({
          patterns: {
            hourlyUsagePattern: new Array(24).fill(1),
            lastUpdated: new Date().toISOString(),
            confidence: 100,
          },
        }),
      };
      learner.refreshFromService(mockService as any);
      expect(learner.getDataPointCount()).toBeGreaterThan(0);

      learner.reset();
      
      expect(learner.getDataPointCount()).toBe(0);
      expect(learner.getPeakHours()).toEqual(DEFAULT_HOT_WATER_PEAK_HOURS);
    });
  });
});
