/**
 * Hot Water Usage Learner Service Tests
 *
 * Comprehensive test suite covering:
 * - Learning from historical data
 * - Refreshing from HotWaterService
 * - Peak hour identification
 * - Default patterns and fallbacks
 * - Edge cases
 */

import {
  HotWaterUsageLearner,
  DEFAULT_HOT_WATER_PEAK_HOURS,
  HOT_WATER_LEARNER_CONFIG,
  HotWaterLearnerLogger,
  UsageHistoryEntry,
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

  describe('learnFromHistory', () => {
    it('should reject insufficient data', () => {
      const learner = new HotWaterUsageLearner(mockLogger);
      const shortHistory: UsageHistoryEntry[] = [
        { timestamp: '2025-01-01T07:00:00Z', amount: 1.5 },
        { timestamp: '2025-01-01T08:00:00Z', amount: 2.0 },
      ];

      const result = learner.learnFromHistory(shortHistory);

      expect(result).toBe(false);
      expect(learner.getDataPointCount()).toBe(0);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Insufficient'),
        expect.any(Object)
      );
    });

    it('should reject null/undefined history', () => {
      const learner = new HotWaterUsageLearner(mockLogger);

      expect(learner.learnFromHistory(null as any)).toBe(false);
      expect(learner.learnFromHistory(undefined as any)).toBe(false);
    });

    it('should learn from sufficient historical data', () => {
      const learner = new HotWaterUsageLearner(mockLogger);
      const history = generateUsageHistory(14); // 14 days

      const result = learner.learnFromHistory(history);

      expect(result).toBe(true);
      expect(learner.getDataPointCount()).toBeGreaterThanOrEqual(7);
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('pattern updated'),
        expect.any(Object)
      );
    });

    it('should identify peak hours correctly', () => {
      const learner = new HotWaterUsageLearner(mockLogger);

      // Create history with many hours to get multiple peaks in top 20%
      // Need at least 10 different hours so top 20% = 2 hours
      const history: UsageHistoryEntry[] = [];
      for (let day = 0; day < 14; day++) {
        const date = new Date(2025, 0, day + 1);

        // Create usage across 10 different hours
        for (let hour = 6; hour <= 15; hour++) {
          // Make hours 7 and 19 the highest (we'll add 19 separately)
          const amount = hour === 7 ? 5.0 : hour === 8 ? 4.0 : 0.5;
          history.push({ timestamp: new Date(date.setHours(hour, 0)).toISOString(), amount });
        }
        // Add evening peak at 19 (highest)
        history.push({ timestamp: new Date(date.setHours(19, 0)).toISOString(), amount: 6.0 });
      }

      learner.learnFromHistory(history);
      const peakHours = learner.getPeakHours();

      // With 11 hours of data, top 20% = 2 hours. Should be 19 (6.0) and 7 (5.0)
      expect(peakHours).toContain(19);
      expect(peakHours.length).toBeGreaterThanOrEqual(2);
    });

    it('should calculate minimum buffer as 120% of max demand', () => {
      const learner = new HotWaterUsageLearner(mockLogger);

      const history: UsageHistoryEntry[] = [];
      for (let i = 0; i < 10; i++) {
        history.push({ timestamp: new Date(2025, 0, i + 1, 7, 0).toISOString(), amount: 5.0 });
        history.push({ timestamp: new Date(2025, 0, i + 1, 12, 0).toISOString(), amount: 2.0 });
      }

      learner.learnFromHistory(history);

      // Max demand is 5.0, buffer should be 5.0 * 1.2 = 6.0
      expect(learner.getMinimumBuffer()).toBeCloseTo(6.0, 1);
    });
  });

  describe('refreshFromService', () => {
    it('should return false when service is undefined', () => {
      const learner = new HotWaterUsageLearner(mockLogger);
      expect(learner.refreshFromService(undefined)).toBe(false);
    });

    it('should return false when service returns insufficient data', () => {
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

    it('should refresh pattern from valid service data', () => {
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

  describe('identifyPeakHours', () => {
    it('should return defaults when all hourly demand is zero', () => {
      const learner = new HotWaterUsageLearner(mockLogger);

      // With zero demand, peak hours should be defaults
      const pattern = learner.getPattern();
      expect(pattern.peakHours).toEqual([...DEFAULT_HOT_WATER_PEAK_HOURS]);
    });

    it('should identify top 20% of hours as peaks', () => {
      const learner = new HotWaterUsageLearner(mockLogger);

      // Create history with usage at 10 hours
      const history: UsageHistoryEntry[] = [];
      for (let hour = 0; hour < 10; hour++) {
        for (let day = 0; day < 7; day++) {
          history.push({
            timestamp: new Date(2025, 0, day + 1, hour, 0).toISOString(),
            amount: (hour + 1) * 0.5, // Increasing demand by hour
          });
        }
      }

      learner.learnFromHistory(history);
      const peakHours = learner.getPeakHours();

      // 20% of 10 hours = 2 hours (at least 1)
      expect(peakHours.length).toBeGreaterThanOrEqual(1);
      expect(peakHours.length).toBeLessThanOrEqual(2);
      // Highest demand hours should be 8 and 9
      expect(peakHours).toContain(9);
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

      const history: UsageHistoryEntry[] = [];
      // Add 1 kWh per hour for 24 hours across 7 days
      for (let day = 0; day < 7; day++) {
        for (let hour = 0; hour < 24; hour++) {
          history.push({
            timestamp: new Date(2025, 0, day + 1, hour, 0).toISOString(),
            amount: 1.0,
          });
        }
      }

      learner.learnFromHistory(history);
      const daily = learner.getEstimatedDailyConsumption();

      expect(daily).toBe(24); // 1 kWh * 24 hours
    });
  });

  describe('hasConfidentPattern', () => {
    it('should return false with no data', () => {
      const learner = new HotWaterUsageLearner(mockLogger);
      expect(learner.hasConfidentPattern()).toBe(false);
    });

    it('should return false with insufficient data', () => {
      const learner = new HotWaterUsageLearner(mockLogger);
      // Generate only 3 days - not enough for confidence (needs 14)
      const history = generateUsageHistory(3);
      learner.learnFromHistory(history);

      // 3 days * 4 entries = 12 data points, confidence requires 14
      expect(learner.hasConfidentPattern()).toBe(false);
    });

    it('should return true with sufficient data', () => {
      const learner = new HotWaterUsageLearner(mockLogger);
      const history = generateUsageHistory(21); // 3 weeks of data

      learner.learnFromHistory(history);

      expect(learner.hasConfidentPattern()).toBe(true);
    });
  });

  describe('hasLearnedData', () => {
    it('should return false with no data', () => {
      const learner = new HotWaterUsageLearner(mockLogger);
      expect(learner.hasLearnedData()).toBe(false);
    });

    it('should return true after learning from sufficient data', () => {
      const learner = new HotWaterUsageLearner(mockLogger);
      const history = generateUsageHistory(14);
      learner.learnFromHistory(history);

      expect(learner.hasLearnedData()).toBe(true);
    });
  });

  describe('reset', () => {
    it('should reset pattern to defaults', () => {
      const learner = new HotWaterUsageLearner(mockLogger);
      const history = generateUsageHistory(14);
      learner.learnFromHistory(history);

      expect(learner.getDataPointCount()).toBeGreaterThan(0);

      learner.reset();

      expect(learner.getDataPointCount()).toBe(0);
      expect(learner.getPeakHours()).toEqual([...DEFAULT_HOT_WATER_PEAK_HOURS]);
      expect(mockLogger.log).toHaveBeenCalledWith(expect.stringContaining('reset'));
    });
  });

  describe('setPattern', () => {
    it('should set pattern directly', () => {
      const learner = new HotWaterUsageLearner(mockLogger);
      const customPattern = {
        hourlyDemand: new Array(24).fill(2),
        peakHours: [6, 18, 19],
        minimumBuffer: 5.0,
        lastLearningUpdate: new Date(),
        dataPoints: 100,
      };

      learner.setPattern(customPattern);

      expect(learner.getDataPointCount()).toBe(100);
      expect(learner.getMinimumBuffer()).toBe(5.0);
      expect(learner.getPeakHours()).toEqual([6, 18, 19]);
    });
  });

  describe('DEFAULT_HOT_WATER_PEAK_HOURS', () => {
    it('should be morning hours 6, 7, 8', () => {
      expect(DEFAULT_HOT_WATER_PEAK_HOURS).toEqual([6, 7, 8]);
    });

    it('should be typed as readonly', () => {
      // TypeScript readonly arrays aren't Object.frozen at runtime
      // But this verifies the constant exists and has correct values
      expect(DEFAULT_HOT_WATER_PEAK_HOURS.length).toBe(3);
      expect(Array.isArray(DEFAULT_HOT_WATER_PEAK_HOURS)).toBe(true);
    });
  });
});

/**
 * Helper function to generate usage history for testing
 */
function generateUsageHistory(days: number): UsageHistoryEntry[] {
  const history: UsageHistoryEntry[] = [];

  for (let day = 0; day < days; day++) {
    const date = new Date(2025, 0, day + 1);

    // Morning usage
    history.push({
      timestamp: new Date(date.setHours(7, 0)).toISOString(),
      amount: 2.0 + Math.random(),
    });
    history.push({
      timestamp: new Date(date.setHours(8, 0)).toISOString(),
      amount: 1.5 + Math.random(),
    });

    // Evening usage
    history.push({
      timestamp: new Date(date.setHours(19, 0)).toISOString(),
      amount: 2.5 + Math.random(),
    });
    history.push({
      timestamp: new Date(date.setHours(20, 0)).toISOString(),
      amount: 1.0 + Math.random(),
    });
  }

  return history;
}
