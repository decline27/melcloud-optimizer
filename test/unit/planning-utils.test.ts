import { describe, expect, test } from '@jest/globals';
import { computePlanningBias, updateThermalResponse } from '../../src/services/planning-utils';

const makePrice = (startIso: string, hours: number, cheapCount = 0, expensiveCount = 0) => {
  const arr: { time: string; price: number }[] = [];
  const start = new Date(startIso).getTime();
  for (let i = 0; i < hours; i += 1) {
    const ts = new Date(start + i * 3600000).toISOString();
    let price = 0.5;
    if (i < cheapCount) price = 0.1;
    if (hours - i <= expensiveCount) price = 1.0;
    arr.push({ time: ts, price });
  }
  return arr;
};

describe('planning-utils', () => {
  test('computes positive bias when cheap window ahead', () => {
    const prices = makePrice('2024-01-01T00:00:00Z', 24, 4, 0);
    const now = new Date('2024-01-01T00:00:00Z');
    const result = computePlanningBias(prices, now, { windowHours: 6, lookaheadHours: 12 });
    expect(result.hasCheap).toBe(true);
    expect(result.biasC).toBeGreaterThan(0);
    expect(result.biasC).toBeLessThanOrEqual(0.5);
  });

  test('computes negative bias when expensive window ahead', () => {
    const now = new Date('2024-01-01T00:00:00Z');
    const prices = [
      { time: '2024-01-01T01:00:00Z', price: 1.0 },
      { time: '2024-01-01T02:00:00Z', price: 1.2 },
      { time: '2024-01-01T03:00:00Z', price: 0.5 },
      { time: '2024-01-01T04:00:00Z', price: 0.5 },
      { time: '2024-01-01T05:00:00Z', price: 0.5 },
      { time: '2024-01-01T06:00:00Z', price: 0.5 }
    ];
    const result = computePlanningBias(prices, now, { windowHours: 6, lookaheadHours: 6 });
    expect(result.hasExpensive).toBe(true);
    expect(result.biasC).toBeLessThan(0);
    expect(result.biasC).toBeGreaterThanOrEqual(-0.3);
  });

  test('returns zero bias without forecast data', () => {
    const now = new Date('2024-01-01T00:00:00Z');
    const result = computePlanningBias(undefined, now);
    expect(result.biasC).toBe(0);
    expect(result.hasCheap).toBe(false);
    expect(result.hasExpensive).toBe(false);
  });

  test('thermal response ema adjusts within clamp', () => {
    const updated = updateThermalResponse(1.0, 0.3, 0.2, { alpha: 0.1, min: 0.5, max: 1.5 });
    expect(updated).toBeCloseTo(1.01, 5);
    const clamped = updateThermalResponse(1.4, -2, 0.2, { alpha: 0.5, min: 0.5, max: 1.5 });
    expect(clamped).toBeCloseTo(0.5, 5);
  });
});
