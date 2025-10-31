import { classifyPriceUnified, PriceClassificationOptions } from '../../src/services/price-classifier';

const makePoints = (values: number[]) =>
  values.map((price, index) => ({
    time: new Date(Date.now() + index * 3600_000).toISOString(),
    price
  }));

describe('classifyPriceUnified', () => {
  test('defaults to NORMAL when near average', () => {
    const prices = makePoints([0.1, 0.5, 1.0, 1.5, 2.0]);
    const result = classifyPriceUnified(prices, 1.1);

    expect(result.label).toBe('NORMAL');
    expect(result.percentile).toBeGreaterThan(40);
    expect(result.percentile).toBeLessThan(80);
    expect(result.normalized).toBeGreaterThan(0.4);
    expect(result.normalized).toBeLessThan(0.7);
  });

  test('labels VERY_CHEAP using multiplier-adjusted threshold', () => {
    const prices = makePoints([0.01, 0.05, 0.1, 0.2, 0.5, 0.9, 1.2, 1.4, 1.6, 2.0]);
    const options: PriceClassificationOptions = {
      cheapPercentile: 0.25,
      veryCheapMultiplier: 0.5
    };
    const result = classifyPriceUnified(prices, 0.01, options);

    expect(result.label).toBe('VERY_CHEAP');
    expect(result.percentile).toBeLessThanOrEqual(result.thresholds.veryCheap);
  });

  test('supports inputs with value property via selector fallback', () => {
    const prices = [0.2, 0.3, 0.4].map((value, index) => ({
      time: new Date(Date.now() + index * 3600_000).toISOString(),
      value
    }));

    const result = classifyPriceUnified(prices, 0.35);

    expect(result.label).toBe('NORMAL');
    expect(result.percentile).toBeGreaterThan(50);
  });

  test('accepts percentile options in 0-100 and 0-1 ranges', () => {
    const prices = makePoints([1, 2, 3, 4, 5]);
    const resultA = classifyPriceUnified(prices, 5, { cheapPercentile: 30 });
    const resultB = classifyPriceUnified(prices, 5, { cheapPercentile: 0.3 });

    expect(resultA.thresholds.cheap).toBeCloseTo(30, 5);
    expect(resultB.thresholds.cheap).toBeCloseTo(30, 5);
    expect(resultA.label).toBe('VERY_EXPENSIVE');
    expect(resultB.label).toBe('VERY_EXPENSIVE');
  });

  test('handles empty inputs gracefully', () => {
    const result = classifyPriceUnified(undefined, 1.0);

    expect(result.label).toBe('NORMAL');
    expect(result.min).toBe(1);
    expect(result.max).toBe(1);
    expect(result.avg).toBe(1);
    expect(result.normalized).toBe(0.5);
  });
});
