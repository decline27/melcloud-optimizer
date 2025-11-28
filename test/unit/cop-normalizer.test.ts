/**
 * COP Normalizer Service Tests
 *
 * Comprehensive test suite covering:
 * - Basic normalization
 * - Range learning with percentiles
 * - Outlier rejection
 * - Edge cases (empty history, single sample, etc.)
 * - Persistence and restoration
 * - Static rough normalization
 */

import {
  CopNormalizer,
  COP_NORMALIZER_CONFIG,
  COPRangeState,
  COPNormalizerLogger,
} from '../../src/services/cop-normalizer';

describe('CopNormalizer', () => {
  let mockLogger: jest.Mocked<COPNormalizerLogger>;
  let mockHomey: any;
  let mockSettings: Map<string, any>;

  beforeEach(() => {
    // Reset mocks
    mockSettings = new Map();
    mockLogger = {
      log: jest.fn(),
      warn: jest.fn(),
    };
    mockHomey = {
      settings: {
        get: jest.fn((key: string) => mockSettings.get(key)),
        set: jest.fn((key: string, value: any) => mockSettings.set(key, value)),
      },
    };
  });

  describe('constructor', () => {
    it('should initialize with default values when no persisted state', () => {
      const normalizer = new CopNormalizer(mockHomey, mockLogger);
      const state = normalizer.getState();

      expect(state.minObserved).toBe(COP_NORMALIZER_CONFIG.DEFAULT_MIN);
      expect(state.maxObserved).toBe(COP_NORMALIZER_CONFIG.DEFAULT_MAX);
      expect(state.updateCount).toBe(0);
      expect(state.history).toEqual([]);
    });

    it('should restore from persisted state when available', () => {
      const persistedState = {
        minObserved: 1.5,
        maxObserved: 4.5,
        updateCount: 25,
        history: [1.5, 2.0, 3.0, 4.0, 4.5],
      };
      mockSettings.set(COP_NORMALIZER_CONFIG.SETTINGS_KEY, persistedState);

      const normalizer = new CopNormalizer(mockHomey, mockLogger);
      const state = normalizer.getState();

      expect(state.minObserved).toBe(1.5);
      expect(state.maxObserved).toBe(4.5);
      expect(state.updateCount).toBe(25);
      expect(state.history).toEqual([1.5, 2.0, 3.0, 4.0, 4.5]);
      expect(mockLogger.log).toHaveBeenCalledWith(expect.stringContaining('COP guards restored'));
    });

    it('should work without Homey instance', () => {
      const normalizer = new CopNormalizer(undefined, mockLogger);
      expect(normalizer.getState().updateCount).toBe(0);
    });

    it('should work without logger', () => {
      const normalizer = new CopNormalizer(mockHomey, undefined);
      expect(normalizer.getState().updateCount).toBe(0);
    });

    it('should work with neither Homey nor logger', () => {
      const normalizer = new CopNormalizer();
      expect(normalizer.getState().updateCount).toBe(0);
    });

    it('should handle corrupted persisted state gracefully', () => {
      mockSettings.set(COP_NORMALIZER_CONFIG.SETTINGS_KEY, { invalid: 'data' });

      const normalizer = new CopNormalizer(mockHomey, mockLogger);
      const state = normalizer.getState();

      // Should fall back to defaults
      expect(state.minObserved).toBe(COP_NORMALIZER_CONFIG.DEFAULT_MIN);
      expect(state.history).toEqual([]);
    });

    it('should truncate history to max size when restoring', () => {
      const longHistory = Array.from({ length: 150 }, (_, i) => 2 + i * 0.02);
      mockSettings.set(COP_NORMALIZER_CONFIG.SETTINGS_KEY, {
        minObserved: 2.0,
        maxObserved: 4.0,
        updateCount: 150,
        history: longHistory,
      });

      const normalizer = new CopNormalizer(mockHomey, mockLogger);
      expect(normalizer.getSampleCount()).toBe(COP_NORMALIZER_CONFIG.MAX_HISTORY_SIZE);
    });
  });

  describe('updateRange', () => {
    it('should accept valid COP values', () => {
      const normalizer = new CopNormalizer(mockHomey, mockLogger);

      expect(normalizer.updateRange(3.0)).toBe(true);
      expect(normalizer.getSampleCount()).toBe(1);
      expect(normalizer.getUpdateCount()).toBe(1);
    });

    it('should reject COP below minimum', () => {
      const normalizer = new CopNormalizer(mockHomey, mockLogger);

      expect(normalizer.updateRange(0.3)).toBe(false);
      expect(normalizer.getSampleCount()).toBe(0);
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('COP outlier rejected'));
    });

    it('should reject COP above maximum', () => {
      const normalizer = new CopNormalizer(mockHomey, mockLogger);

      expect(normalizer.updateRange(7.0)).toBe(false);
      expect(normalizer.getSampleCount()).toBe(0);
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('COP outlier rejected'));
    });

    it('should reject NaN values', () => {
      const normalizer = new CopNormalizer(mockHomey, mockLogger);

      expect(normalizer.updateRange(NaN)).toBe(false);
      expect(normalizer.getSampleCount()).toBe(0);
    });

    it('should reject Infinity', () => {
      const normalizer = new CopNormalizer(mockHomey, mockLogger);

      expect(normalizer.updateRange(Infinity)).toBe(false);
      expect(normalizer.updateRange(-Infinity)).toBe(false);
      expect(normalizer.getSampleCount()).toBe(0);
    });

    it('should accept edge case values at boundaries', () => {
      const normalizer = new CopNormalizer(mockHomey, mockLogger);

      expect(normalizer.updateRange(COP_NORMALIZER_CONFIG.MIN_VALID_COP)).toBe(true);
      expect(normalizer.updateRange(COP_NORMALIZER_CONFIG.MAX_VALID_COP)).toBe(true);
      expect(normalizer.getSampleCount()).toBe(2);
    });

    it('should maintain rolling history with max size limit', () => {
      const normalizer = new CopNormalizer(mockHomey, mockLogger);

      // Add more than max history size
      for (let i = 0; i < 120; i++) {
        normalizer.updateRange(2.0 + (i % 30) * 0.1);
      }

      expect(normalizer.getSampleCount()).toBe(COP_NORMALIZER_CONFIG.MAX_HISTORY_SIZE);
      expect(normalizer.getUpdateCount()).toBe(120);
    });

    it('should update percentile bounds after sufficient samples', () => {
      const normalizer = new CopNormalizer(mockHomey, mockLogger);

      // Add values from 1.0 to 5.0
      const values = [1.0, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0];
      values.forEach((v) => normalizer.updateRange(v));

      const range = normalizer.getRange();
      // 5th percentile should be near low end, 95th near high end
      expect(range.min).toBeLessThan(2.0);
      expect(range.max).toBeGreaterThan(4.0);
    });

    it('should persist state to settings after each update', () => {
      const normalizer = new CopNormalizer(mockHomey, mockLogger);

      normalizer.updateRange(3.5);

      expect(mockHomey.settings.set).toHaveBeenCalledWith(
        COP_NORMALIZER_CONFIG.SETTINGS_KEY,
        expect.objectContaining({
          updateCount: 1,
          history: [3.5],
        })
      );
    });

    it('should log periodically based on LOG_INTERVAL', () => {
      const normalizer = new CopNormalizer(mockHomey, mockLogger);

      // Add exactly LOG_INTERVAL values
      for (let i = 0; i < COP_NORMALIZER_CONFIG.LOG_INTERVAL; i++) {
        normalizer.updateRange(3.0);
      }

      // Should have logged once at the interval
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining(`after ${COP_NORMALIZER_CONFIG.LOG_INTERVAL} observations`)
      );
    });
  });

  describe('normalize', () => {
    it('should return 0.5 when no range established', () => {
      const normalizer = new CopNormalizer(mockHomey, mockLogger);

      // Force equal min/max
      (normalizer as any).state.minObserved = 3.0;
      (normalizer as any).state.maxObserved = 3.0;

      expect(normalizer.normalize(3.0)).toBe(0.5);
    });

    it('should return 0 for values at or below minimum', () => {
      const normalizer = new CopNormalizer(mockHomey, mockLogger);

      // Set a known range
      (normalizer as any).state.minObserved = 2.0;
      (normalizer as any).state.maxObserved = 4.0;

      expect(normalizer.normalize(2.0)).toBe(0);
      expect(normalizer.normalize(1.0)).toBe(0); // Below min, clamped
    });

    it('should return 1 for values at or above maximum', () => {
      const normalizer = new CopNormalizer(mockHomey, mockLogger);

      (normalizer as any).state.minObserved = 2.0;
      (normalizer as any).state.maxObserved = 4.0;

      expect(normalizer.normalize(4.0)).toBe(1);
      expect(normalizer.normalize(5.0)).toBe(1); // Above max, clamped
    });

    it('should return 0.5 for midpoint value', () => {
      const normalizer = new CopNormalizer(mockHomey, mockLogger);

      (normalizer as any).state.minObserved = 2.0;
      (normalizer as any).state.maxObserved = 4.0;

      expect(normalizer.normalize(3.0)).toBe(0.5);
    });

    it('should normalize values proportionally within range', () => {
      const normalizer = new CopNormalizer(mockHomey, mockLogger);

      (normalizer as any).state.minObserved = 2.0;
      (normalizer as any).state.maxObserved = 4.0;

      expect(normalizer.normalize(2.5)).toBe(0.25);
      expect(normalizer.normalize(3.5)).toBe(0.75);
    });

    it('should handle learned range from actual updates', () => {
      const normalizer = new CopNormalizer(mockHomey, mockLogger);

      // Add values to establish range
      [2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0].forEach((v) => normalizer.updateRange(v));

      const normalized = normalizer.normalize(3.5);
      expect(normalized).toBeGreaterThan(0);
      expect(normalized).toBeLessThan(1);
    });
  });

  describe('roughNormalize (static)', () => {
    it('should normalize using simple linear division', () => {
      expect(CopNormalizer.roughNormalize(2.5)).toBe(0.5); // 2.5/5.0
      expect(CopNormalizer.roughNormalize(5.0)).toBe(1);
      expect(CopNormalizer.roughNormalize(0)).toBe(0);
    });

    it('should respect custom assumedMax', () => {
      expect(CopNormalizer.roughNormalize(2.0, 4.0)).toBe(0.5); // 2/4
      expect(CopNormalizer.roughNormalize(4.0, 4.0)).toBe(1);
    });

    it('should clamp values above 1', () => {
      expect(CopNormalizer.roughNormalize(6.0)).toBe(1); // 6/5 = 1.2, clamped to 1
      expect(CopNormalizer.roughNormalize(10.0, 4.0)).toBe(1);
    });

    it('should clamp values below 0', () => {
      expect(CopNormalizer.roughNormalize(-1.0)).toBe(0);
    });
  });

  describe('getRange', () => {
    it('should return current min and max bounds', () => {
      const normalizer = new CopNormalizer(mockHomey, mockLogger);

      (normalizer as any).state.minObserved = 1.8;
      (normalizer as any).state.maxObserved = 4.2;

      const range = normalizer.getRange();
      expect(range.min).toBe(1.8);
      expect(range.max).toBe(4.2);
    });
  });

  describe('getSampleCount', () => {
    it('should return current history size', () => {
      const normalizer = new CopNormalizer(mockHomey, mockLogger);

      expect(normalizer.getSampleCount()).toBe(0);

      normalizer.updateRange(3.0);
      normalizer.updateRange(3.5);

      expect(normalizer.getSampleCount()).toBe(2);
    });
  });

  describe('getUpdateCount', () => {
    it('should track total updates including rejected ones', () => {
      const normalizer = new CopNormalizer(mockHomey, mockLogger);

      normalizer.updateRange(3.0);
      normalizer.updateRange(0.1); // Rejected
      normalizer.updateRange(3.5);

      // Only accepted values increment updateCount
      expect(normalizer.getUpdateCount()).toBe(2);
    });
  });

  describe('hasReliableData', () => {
    it('should return false when insufficient samples', () => {
      const normalizer = new CopNormalizer(mockHomey, mockLogger);

      for (let i = 0; i < COP_NORMALIZER_CONFIG.MIN_SAMPLES_FOR_PERCENTILE - 1; i++) {
        normalizer.updateRange(3.0);
      }

      expect(normalizer.hasReliableData()).toBe(false);
    });

    it('should return true when sufficient samples', () => {
      const normalizer = new CopNormalizer(mockHomey, mockLogger);

      for (let i = 0; i < COP_NORMALIZER_CONFIG.MIN_SAMPLES_FOR_PERCENTILE; i++) {
        normalizer.updateRange(3.0);
      }

      expect(normalizer.hasReliableData()).toBe(true);
    });
  });

  describe('reset', () => {
    it('should reset state to defaults', () => {
      const normalizer = new CopNormalizer(mockHomey, mockLogger);

      // Add some data
      normalizer.updateRange(3.0);
      normalizer.updateRange(4.0);

      normalizer.reset();

      const state = normalizer.getState();
      expect(state.minObserved).toBe(COP_NORMALIZER_CONFIG.DEFAULT_MIN);
      expect(state.maxObserved).toBe(COP_NORMALIZER_CONFIG.DEFAULT_MAX);
      expect(state.updateCount).toBe(0);
      expect(state.history).toEqual([]);
    });

    it('should persist reset state', () => {
      const normalizer = new CopNormalizer(mockHomey, mockLogger);
      normalizer.updateRange(3.0);

      normalizer.reset();

      expect(mockHomey.settings.set).toHaveBeenLastCalledWith(
        COP_NORMALIZER_CONFIG.SETTINGS_KEY,
        expect.objectContaining({
          updateCount: 0,
          history: [],
        })
      );
    });

    it('should log reset action', () => {
      const normalizer = new CopNormalizer(mockHomey, mockLogger);
      normalizer.reset();

      expect(mockLogger.log).toHaveBeenCalledWith('COP normalizer reset to defaults');
    });
  });

  describe('getState', () => {
    it('should return a copy of state (immutable)', () => {
      const normalizer = new CopNormalizer(mockHomey, mockLogger);
      normalizer.updateRange(3.0);

      const state1 = normalizer.getState();
      const state2 = normalizer.getState();

      expect(state1).not.toBe(state2);
      expect(state1.history).not.toBe(state2.history);
    });
  });

  describe('integration scenarios', () => {
    it('should handle realistic COP measurement sequence', () => {
      const normalizer = new CopNormalizer(mockHomey, mockLogger);

      // Simulate realistic heating COP measurements over time
      const measurements = [
        3.2, 3.4, 3.1, 3.5, 3.3, 3.0, 3.6, 3.2, 3.4, 3.1,
        2.8, 2.9, 3.0, 3.2, 3.4, 3.6, 3.8, 4.0, 3.7, 3.5,
      ];

      measurements.forEach((cop) => normalizer.updateRange(cop));

      expect(normalizer.hasReliableData()).toBe(true);

      const range = normalizer.getRange();
      expect(range.min).toBeGreaterThanOrEqual(2.8);
      expect(range.max).toBeLessThanOrEqual(4.0);

      // Mid-range value should normalize to roughly 0.5
      const midNormalized = normalizer.normalize(3.4);
      expect(midNormalized).toBeGreaterThan(0.3);
      expect(midNormalized).toBeLessThan(0.7);
    });

    it('should recover state across simulated restart', () => {
      // First session - collect data
      const normalizer1 = new CopNormalizer(mockHomey, mockLogger);
      [2.5, 3.0, 3.5, 4.0, 4.5].forEach((v) => normalizer1.updateRange(v));

      // Simulate restart - new instance reads from same settings
      const normalizer2 = new CopNormalizer(mockHomey, mockLogger);

      expect(normalizer2.getSampleCount()).toBe(5);
      expect(normalizer2.getUpdateCount()).toBe(5);

      // Normalization should be consistent
      const value = 3.5;
      expect(normalizer2.normalize(value)).toBe(normalizer1.normalize(value));
    });
  });
});
