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

    const now = new Date();
    const opt: OptimizationData = {
      timestamp: new Date(now.getTime() - 60 * 60 * 1000).toISOString(),
      savings: 0.2,
      targetTemp: 20,
      targetOriginal: 21,
      priceNow: 1,
      priceAvg: 1.1
    };

    const result = calc.calculateEnhancedDailySavings(0.1, [opt], now.getHours());

    expect(result.method).toBe('weighted_projection');
    expect(result.dailySavings).toBeGreaterThanOrEqual(0.1);
    expect(result.confidence).toBeGreaterThanOrEqual(0.1);
  });

  it('handles multiple optimizations and uses enhanced_with_compounding', () => {
    const logger = makeLogger();
    const calc = new EnhancedSavingsCalculator(logger);

    const now = new Date();
    const baseHour = now.getHours();

    const ops: OptimizationData[] = [];
    for (let i = 3; i > 0; i--) {
      ops.push({
        timestamp: new Date(now.getTime() - i * 60 * 60 * 1000).toISOString(),
        savings: 0.05 * i,
        targetTemp: 20 - i * 0.1,
        targetOriginal: 21,
        priceNow: 1,
        priceAvg: 1
      });
    }

    const result = calc.calculateEnhancedDailySavings(0.1, ops, baseHour);

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
});
