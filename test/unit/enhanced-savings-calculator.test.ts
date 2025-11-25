import { EnhancedSavingsCalculator, OptimizationData } from '../../src/util/enhanced-savings-calculator';

function makeLogger() {
  return {
    debug: jest.fn(),
    error: jest.fn()
  } as any;
}

describe('EnhancedSavingsCalculator', () => {
  it('returns sensible result when no optimizations exist (simple projection)', () => {
    const logger = makeLogger();
    const calc = new EnhancedSavingsCalculator(logger);

    const result = calc.calculateEnhancedDailySavings(0.1, [], 12);

    expect(result).toHaveProperty('dailySavings');
    expect(result.method).toBe('simple_projection');
    expect(result.compoundedSavings).toBeCloseTo(0.1 * 24);
  });

  it('handles a single optimization and uses weighted_projection', () => {
    const logger = makeLogger();
    const calc = new EnhancedSavingsCalculator(logger);

    // Use fixed times to ensure reliable test behavior
    const currentHour = 10; // Fixed at 10 AM
    const optimizationHour = 8; // Optimization was at 8 AM (2 hours ago)

    // Create optimization timestamp for today at 8 AM
    const today = new Date();
    today.setHours(optimizationHour, 0, 0, 0);

    const opt: OptimizationData = {
      timestamp: today.toISOString(),
      savings: 0.2,
      targetTemp: 20,
      targetOriginal: 21,
      priceNow: 1,
      priceAvg: 1.1
    };

    const result = calc.calculateEnhancedDailySavings(0.1, [opt], currentHour);

    expect(result.method).toBe('weighted_projection');
    expect(result.dailySavings).toBeGreaterThanOrEqual(0.1);
    expect(result.confidence).toBeGreaterThanOrEqual(0.1);
  });

  it('handles multiple optimizations and uses enhanced_with_compounding', () => {
    const logger = makeLogger();
    const calc = new EnhancedSavingsCalculator(logger);

    // Use fixed times to ensure reliable test behavior
    const currentHour = 12; // Fixed at 12 PM (noon)
    const today = new Date();

    const ops: OptimizationData[] = [];
    // Create 3 optimizations at hours 8, 9, and 10 (all earlier than current hour 12)
    const optimizationHours = [8, 9, 10];

    for (let i = 0; i < optimizationHours.length; i++) {
      const optimizationTime = new Date(today);
      optimizationTime.setHours(optimizationHours[i], 0, 0, 0);

      ops.push({
        timestamp: optimizationTime.toISOString(),
        savings: 0.05 * (i + 1),
        targetTemp: 20 - i * 0.1,
        targetOriginal: 21,
        priceNow: 1,
        priceAvg: 1
      });
    }

    const result = calc.calculateEnhancedDailySavings(0.1, ops, currentHour);

    expect(result.method).toBe('enhanced_with_compounding');
    expect(result.compoundedSavings).toBeGreaterThan(0);
    expect(result.projectedSavings).toBeGreaterThanOrEqual(0);
  });

  it('falls back when logger.debug throws an error', () => {
    const logger = {
      debug: () => { throw new Error('boom'); },
      error: jest.fn()
    } as any;

    const calc = new EnhancedSavingsCalculator(logger);
    const now = new Date();

    const result = calc.calculateEnhancedDailySavings(0.2, [], now.getHours());

    // fallback method is returned on error
    expect(result.method).toBe('fallback');
    expect(result.dailySavings).toBeCloseTo(0.2 * 24);
    expect(logger.error).toHaveBeenCalled();
  });

  describe('Early Hour Conservative Projection', () => {
    it('uses 6-hour window for hours 0-2 with no history', () => {
      const logger = makeLogger();
      const calc = new EnhancedSavingsCalculator(logger);

      // Hour 1, no history, 0.5 SEK current savings
      const result = calc.calculateEnhancedDailySavings(0.5, [], 1);

      // Should use 6-hour window, not 24×
      // Expected: 0.5 * 6 = 3 SEK, NOT 0.5 * 24 = 12 SEK
      expect(result.compoundedSavings).toBeCloseTo(3.0, 1);
      expect(result.compoundedSavings).toBeLessThan(12.0);
    });

    it('uses 12-hour window for hours 3-5 with no history', () => {
      const logger = makeLogger();
      const calc = new EnhancedSavingsCalculator(logger);

      // Hour 4, no history, 0.5 SEK current savings
      const result = calc.calculateEnhancedDailySavings(0.5, [], 4);

      // Should use 12-hour window
      // Expected: 0.5 * 12 = 6 SEK
      expect(result.compoundedSavings).toBeCloseTo(6.0, 1);
      expect(result.compoundedSavings).toBeLessThan(12.0);
    });

    it('uses full 24-hour projection for hour 6+ with no history', () => {
      const logger = makeLogger();
      const calc = new EnhancedSavingsCalculator(logger);

      // Hour 10, no history, 0.5 SEK current savings
      const result = calc.calculateEnhancedDailySavings(0.5, [], 10);

      // Should use full 24-hour projection
      // Expected: 0.5 * 24 = 12 SEK
      expect(result.compoundedSavings).toBeCloseTo(12.0, 1);
    });

    it('uses actual history when available instead of forced baseline', () => {
      const logger = makeLogger();
      const calc = new EnhancedSavingsCalculator(logger);

      const today = new Date();
      const ops: OptimizationData[] = [
        {
          timestamp: new Date(today.setHours(8, 0, 0, 0)).toISOString(),
          savings: 0.1,
          targetTemp: 20,
          targetOriginal: 21,
          priceNow: 1,
          priceAvg: 1
        },
        {
          timestamp: new Date(today.setHours(9, 0, 0, 0)).toISOString(),
          savings: 0.1,
          targetTemp: 20,
          targetOriginal: 21,
          priceNow: 1,
          priceAvg: 1
        }
      ];

      // Current hour has high savings (0.8 SEK), but history is low (0.1 each)
      const result = calc.calculateEnhancedDailySavings(0.8, ops, 10);

      // Should NOT force to 0.8 * 24 = 19.2 SEK
      // Should be based on actual history + current: ~0.2 + 0.8 = 1.0 base + projection
      expect(result.compoundedSavings).toBeLessThan(19.0);
      expect(result.dailySavings).toBeLessThan(19.0);
    });
  });
});
