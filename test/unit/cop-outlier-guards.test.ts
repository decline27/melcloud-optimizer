/**
 * Unit tests for COP outlier guards in optimizer
 * 
 * These tests verify that the optimizer correctly uses CopNormalizer
 * for adaptive COP normalization with outlier rejection.
 */

import { Optimizer } from '../../src/services/optimizer';
import { MelCloudApi } from '../../src/services/melcloud-api';
import { HomeyLogger } from '../../src/util/logger';

// Mock dependencies
jest.mock('../../src/services/melcloud-api');

describe('COP Outlier Guards', () => {
  let optimizer: Optimizer;
  let mockHomey: any;
  let mockLogger: HomeyLogger;
  let settingsStore: Map<string, any>;

  beforeEach(() => {
    // Create settings store
    settingsStore = new Map();

    // Mock Homey
    mockHomey = {
      settings: {
        get: jest.fn((key: string) => settingsStore.get(key)),
        set: jest.fn((key: string, value: any) => settingsStore.set(key, value))
      }
    };

    // Mock logger
    mockLogger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      debug: jest.fn()
    } as any;

    // Create optimizer with mocks
    const mockMelCloud = new MelCloudApi(mockLogger) as jest.Mocked<MelCloudApi>;
    optimizer = new Optimizer(
      mockMelCloud,
      null, // price provider
      'device-123',
      1,
      mockLogger,
      undefined,
      mockHomey
    );
  });

  // Helper to access CopNormalizer via optimizer
  const getCopNormalizer = (opt: Optimizer) => (opt as any).copNormalizer;
  // Use CopNormalizer directly instead of deprecated wrapper methods
  const updateCOPRange = (opt: Optimizer, cop: number) => getCopNormalizer(opt).updateRange(cop);
  const normalizeCOP = (opt: Optimizer, cop: number) => getCopNormalizer(opt).normalize(cop);

  it('should reject non-finite COP values', () => {
    const copNormalizer = getCopNormalizer(optimizer);

    const initialCount = copNormalizer.getUpdateCount();

    updateCOPRange(optimizer, NaN);
    updateCOPRange(optimizer, Infinity);
    updateCOPRange(optimizer, -Infinity);

    expect(copNormalizer.getUpdateCount()).toBe(initialCount);
    expect(mockLogger.warn).toHaveBeenCalledTimes(3);
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('COP outlier rejected'));
  });

  it('should reject COP values below 0.5', () => {
    const copNormalizer = getCopNormalizer(optimizer);

    const initialCount = copNormalizer.getUpdateCount();

    updateCOPRange(optimizer, 0.1);
    updateCOPRange(optimizer, 0.2);
    updateCOPRange(optimizer, 0.49);

    expect(copNormalizer.getUpdateCount()).toBe(initialCount);
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('0.1'));
  });

  it('should reject COP values above 6.0', () => {
    const copNormalizer = getCopNormalizer(optimizer);

    const initialCount = copNormalizer.getUpdateCount();

    updateCOPRange(optimizer, 6.1);
    updateCOPRange(optimizer, 8.0);
    updateCOPRange(optimizer, 10.0);

    expect(copNormalizer.getUpdateCount()).toBe(initialCount);
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('outlier rejected'));
  });

  it('should accept valid COP values and maintain rolling history', () => {
    const copNormalizer = getCopNormalizer(optimizer);

    updateCOPRange(optimizer, 2.0);
    updateCOPRange(optimizer, 2.5);
    updateCOPRange(optimizer, 3.0);
    updateCOPRange(optimizer, 3.5);

    expect(copNormalizer.getUpdateCount()).toBe(4);
    const state = copNormalizer.getState();
    expect(state.history).toContain(2.0);
    expect(state.history).toContain(3.5);
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('should limit history to 100 entries', () => {
    const copNormalizer = getCopNormalizer(optimizer);

    // Add 150 valid values
    for (let i = 0; i < 150; i++) {
      updateCOPRange(optimizer, 2.0 + (i % 3) * 0.5); // Values between 2.0 and 3.5
    }

    expect(copNormalizer.getSampleCount()).toBe(100);
    expect(copNormalizer.getUpdateCount()).toBe(150);
  });

  it('should compute percentile-based min/max after 5+ samples', () => {
    const copNormalizer = getCopNormalizer(optimizer);

    // Add a range of values with one outlier on each end
    const values = [0.8, 1.5, 2.0, 2.2, 2.5, 2.8, 3.0, 3.2, 3.5, 5.5];
    values.forEach(v => updateCOPRange(optimizer, v));

    const range = copNormalizer.getRange();
    // 5th percentile should filter out 0.8, 95th percentile handles top values
    expect(range.min).toBeGreaterThanOrEqual(0.8);
    expect(range.min).toBeLessThanOrEqual(1.5);
    expect(range.max).toBeLessThanOrEqual(5.5);
    expect(range.max).toBeGreaterThanOrEqual(3.5);
  });

  it('should normalize COP within learned range', () => {
    // Establish a range: 2.0 to 4.0
    [2.0, 2.5, 3.0, 3.5, 4.0].forEach(v => updateCOPRange(optimizer, v));

    const normalized = normalizeCOP(optimizer, 3.0);
    expect(normalized).toBeGreaterThan(0.2);
    expect(normalized).toBeLessThan(0.8);
  });

  it('should clamp extreme values when normalizing', () => {
    // Establish a range: 2.0 to 4.0
    [2.0, 2.5, 3.0, 3.5, 4.0].forEach(v => updateCOPRange(optimizer, v));

    // Values outside learned range should be clamped
    const belowMin = normalizeCOP(optimizer, 1.0);
    const aboveMax = normalizeCOP(optimizer, 5.0);

    expect(belowMin).toBe(0); // Clamped to min
    expect(aboveMax).toBe(1); // Clamped to max
  });

  it('should persist COP guards to settings', () => {
    updateCOPRange(optimizer, 2.5);
    updateCOPRange(optimizer, 3.0);
    updateCOPRange(optimizer, 3.5);

    expect(mockHomey.settings.set).toHaveBeenCalledWith(
      'cop_guards_v1',
      expect.objectContaining({
        minObserved: expect.any(Number),
        maxObserved: expect.any(Number),
        updateCount: expect.any(Number),
        history: expect.any(Array)
      })
    );
  });

  it('should restore COP guards from settings on init', () => {
    // Set up pre-existing settings
    settingsStore.set('cop_guards_v1', {
      minObserved: 2.0,
      maxObserved: 4.0,
      updateCount: 20,
      history: [2.5, 3.0, 3.5]
    });

    // Create new optimizer instance
    const mockMelCloud = new MelCloudApi(mockLogger) as jest.Mocked<MelCloudApi>;
    const newOptimizer = new Optimizer(
      mockMelCloud,
      null,
      'device-123',
      1,
      mockLogger,
      undefined,
      mockHomey
    );

    const copNormalizer = getCopNormalizer(newOptimizer);
    const state = copNormalizer.getState();

    expect(state.minObserved).toBe(2.0);
    expect(state.maxObserved).toBe(4.0);
    expect(state.updateCount).toBe(20);
    expect(state.history).toEqual([2.5, 3.0, 3.5]);
    expect(mockLogger.log).toHaveBeenCalledWith(expect.stringContaining('COP guards restored'));
  });

  it('should ignore outliers and normalize within learned range (acceptance test)', () => {
    updateCOPRange(optimizer, 0.2); // ignored
    updateCOPRange(optimizer, 2.5); // ok
    updateCOPRange(optimizer, 8.0); // ignored
    updateCOPRange(optimizer, 2.8); // ok
    updateCOPRange(optimizer, 3.0); // ok

    const n = normalizeCOP(optimizer, 2.8);
    expect(n).toBeGreaterThan(0.2);
    expect(n).toBeLessThan(0.8);
    expect(mockLogger.warn).toHaveBeenCalledTimes(2); // Two rejections
  });
});
