import { describe, expect, it, test } from '@jest/globals';
import { computePlanningBias, updateThermalResponse } from '../../src/services/planning-utils';
import type { AbsolutePriceLevel } from '../../src/types/index';

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
  describe('computePlanningBias window controls', () => {
    test('respects lookahead and window hours limits', () => {
      const now = new Date('2024-01-01T00:00:00Z');
      const prices: { time: string; price: number }[] = [];
      for (let i = 1; i <= 24; i += 1) {
        prices.push({ time: new Date(now.getTime() + i * 3600000).toISOString(), price: i });
      }
      const result = computePlanningBias(prices, now, {
        windowHours: 3,
        lookaheadHours: 4,
        cheapPercentile: 10,
        expensivePercentile: 90,
        cheapBiasC: 0.6,
        expensiveBiasC: 0.4,
        maxAbsBiasC: 0.5
      });
      expect(result.windowHours).toBe(3);
      expect(result.biasC).toBeLessThanOrEqual(0.5);
    });

    test('returns zero bias when future prices invalid', () => {
      const now = new Date('2024-01-01T00:00:00Z');
      const prices = [
        { time: 'invalid', price: 0.2 },
        { time: '2023-12-31T23:00:00Z', price: 0.2 }
      ];
      const result = computePlanningBias(prices, now);
      expect(result.biasC).toBe(0);
      expect(result.hasCheap).toBe(false);
      expect(result.hasExpensive).toBe(false);
    });
  });

  test('computes positive bias when cheap window ahead', () => {
    const prices = makePrice('2024-01-01T00:00:00Z', 24, 4, 0);
    const now = new Date('2024-01-01T00:00:00Z');
    const result = computePlanningBias(prices, now, { windowHours: 6, lookaheadHours: 12 });
    expect(result.hasCheap).toBe(true);
    expect(result.biasC).toBeGreaterThan(0);
    expect(result.biasC).toBeLessThanOrEqual(0.5);
  });

  test('computes negative bias when expensive period sustained', () => {
    const now = new Date('2024-01-01T00:00:00Z');
    // Expensive prices sustained through the window (not just a spike)
    // No cheap prices, prices stable-to-rising
    // Sorted: [1.0, 1.0, 1.5, 1.5, 1.6, 1.7] → 25th=1.0, 75th=1.6
    // 1.7 > 1.6 in immediate window → hasExpensiveImminent = true
    // First half avg: 1.4, Second half avg: 1.53 → NOT trending down
    const prices = [
      { time: '2024-01-01T01:00:00Z', price: 1.0 },
      { time: '2024-01-01T02:00:00Z', price: 1.5 },
      { time: '2024-01-01T03:00:00Z', price: 1.7 },  // Expensive in immediate window
      { time: '2024-01-01T04:00:00Z', price: 1.5 },
      { time: '2024-01-01T05:00:00Z', price: 1.6 },
      { time: '2024-01-01T06:00:00Z', price: 1.0 }
    ];
    const result = computePlanningBias(prices, now, { windowHours: 6, lookaheadHours: 6 });
    expect(result.hasExpensive).toBe(true);
    // Since expensive is imminent AND prices aren't clearly trending down (within 5%), negative bias applies
    expect(result.biasC).toBeLessThanOrEqual(0);
  });

  test('skips negative bias when expensive now but cheap prices coming', () => {
    const now = new Date('2024-01-01T00:00:00Z');
    // Expensive prices early, but prices trending DOWN (cheap coming soon)
    // Should NOT apply negative bias - better to maintain temp for cheap heating
    const prices = [
      { time: '2024-01-01T01:00:00Z', price: 1.0 },
      { time: '2024-01-01T02:00:00Z', price: 1.2 },
      { time: '2024-01-01T03:00:00Z', price: 0.5 },
      { time: '2024-01-01T04:00:00Z', price: 0.5 },
      { time: '2024-01-01T05:00:00Z', price: 0.5 },
      { time: '2024-01-01T06:00:00Z', price: 0.5 }
    ];
    const result = computePlanningBias(prices, now, { windowHours: 6, lookaheadHours: 6 });
    // Expensive is still detected (for reporting), but bias should be 0 or positive
    // because cheap prices are coming soon
    expect(result.biasC).toBeGreaterThanOrEqual(0);
  });

  test('returns zero bias without forecast data', () => {
    const now = new Date('2024-01-01T00:00:00Z');
    const result = computePlanningBias(undefined, now);
    expect(result.biasC).toBe(0);
    expect(result.hasCheap).toBe(false);
    expect(result.hasExpensive).toBe(false);
  });

  test('riskyHourCount populated when 15-min data has spikes', () => {
    const now = new Date('2025-01-01T00:00:00Z');
    const prices: { time: string; price: number; intervalMinutes?: number }[] = [];
    // Hour 1 (01:00-01:45): 4 quarter-hourly slots, one with a spike
    // All in the same UTC hour so aggregateHourlyWithRisk detects the intra-hour spike
    for (let q = 0; q < 4; q += 1) {
      prices.push({
        time: new Date('2025-01-01T01:00:00Z').getTime() + q * 15 * 60000 > 0
          ? new Date(new Date('2025-01-01T01:00:00Z').getTime() + q * 15 * 60000).toISOString()
          : '',
        price: q === 3 ? 2.0 : 1.0, // avg=1.25, max=2.0, ratio=1.6 > 1.25 threshold
        intervalMinutes: 15
      });
    }
    // Hours 2-6: stable 15-min data (no spikes)
    for (let h = 2; h <= 6; h += 1) {
      for (let q = 0; q < 4; q += 1) {
        prices.push({
          time: new Date(new Date('2025-01-01T00:00:00Z').getTime() + h * 3600000 + q * 15 * 60000).toISOString(),
          price: 1.5,
          intervalMinutes: 15
        });
      }
    }

    const result = computePlanningBias(prices, now, { windowHours: 6, lookaheadHours: 6 });
    expect(result.riskyHourCount).toBeDefined();
    expect(result.riskyHourCount).toBe(1); // Only hour 1 has a spike
  });

  test('riskyHourCount is 0 for hourly data (ENTSO-E hourly market)', () => {
    const now = new Date('2025-01-01T00:00:00Z');
    const prices = makePrice('2025-01-01T00:15:00Z', 12, 3, 0);
    // Hourly data has no intervalMinutes → treated as 60-min
    const result = computePlanningBias(prices, now, { windowHours: 6, lookaheadHours: 12 });
    expect(result.riskyHourCount).toBeDefined();
    expect(result.riskyHourCount).toBe(0);
  });

  test('riskyHourCount populated with 30-min data containing spikes (ENTSO-E quarter-hourly market)', () => {
    const now = new Date('2025-01-01T00:00:00Z');
    const prices: { time: string; price: number; intervalMinutes?: number }[] = [];
    // Hour 1 (01:00-01:30): 2 x 30-min slots in same UTC hour, one with spike
    prices.push({ time: '2025-01-01T01:00:00Z', price: 0.5, intervalMinutes: 30 });
    prices.push({ time: '2025-01-01T01:30:00Z', price: 2.0, intervalMinutes: 30 }); // spike: avg=1.25, max=2.0
    // Hours 2-6: stable 30-min data
    for (let h = 2; h <= 6; h += 1) {
      const hourStr = String(h).padStart(2, '0');
      prices.push({ time: `2025-01-01T${hourStr}:00:00Z`, price: 1.0, intervalMinutes: 30 });
      prices.push({ time: `2025-01-01T${hourStr}:30:00Z`, price: 1.0, intervalMinutes: 30 });
    }

    const result = computePlanningBias(prices, now, { windowHours: 6, lookaheadHours: 6 });
    expect(result.riskyHourCount).toBeDefined();
    expect(result.riskyHourCount).toBe(1);
  });

  test('treats sparse sub-hourly data (< 8 points) as hourly — no risk flags', () => {
    const now = new Date('2025-01-01T00:00:00Z');
    // Only 6 sub-hourly points — fewer than the minimum 8 needed for risk detection
    const prices: { time: string; price: number; intervalMinutes?: number }[] = [];
    for (let q = 0; q < 6; q += 1) {
      prices.push({
        time: new Date(new Date('2025-01-01T01:00:00Z').getTime() + q * 15 * 60000).toISOString(),
        price: q === 5 ? 10.0 : 1.0, // spike present but should be ignored due to sparse data
        intervalMinutes: 15
      });
    }

    const result = computePlanningBias(prices, now, { windowHours: 6, lookaheadHours: 6 });
    expect(result.riskyHourCount).toBe(0);
  });

  test('dampens positive bias when risky intra-hour spikes exist in quarter-hour data', () => {
    const now = new Date('2025-01-01T00:00:00Z');
    const prices: { time: string; price: number; intervalMinutes?: number }[] = [];
    const baseTime = new Date('2025-01-01T00:15:00Z').getTime();
    // Hour 1: three cheap-ish slots and one spike (risk)
    for (let i = 0; i < 4; i += 1) {
      prices.push({
        time: new Date(baseTime + i * 15 * 60000).toISOString(),
        price: i === 3 ? 8 : 5,
        intervalMinutes: 15
      });
    }
    // Hours 2-6: stable higher prices to keep cheapCut anchored on first hour
    for (let h = 1; h <= 5; h += 1) {
      const hourStart = baseTime + h * 60 * 60000;
      prices.push({ time: new Date(hourStart).toISOString(), price: 15, intervalMinutes: 15 });
    }

    const result = computePlanningBias(prices, now, { windowHours: 6, lookaheadHours: 6 });
    expect(result.hasCheap).toBe(true);
    expect(result.biasC).toBe(0);
  });

  test('thermal response ema adjusts within clamp', () => {
    const updated = updateThermalResponse(1.0, 0.3, 0.2, { alpha: 0.1, min: 0.5, max: 1.5 });
    expect(updated).toBeCloseTo(1.01, 5);
    const clamped = updateThermalResponse(1.4, -2, 0.2, { alpha: 0.5, min: 0.5, max: 1.5 });
    expect(clamped).toBeCloseTo(0.5, 5);
  });

  test('thermal response stays steady when observed delta matches expectation', () => {
    const baseline = 1.1;
    const updated = updateThermalResponse(baseline, 0.4, 0.4, { alpha: 0.3, min: 0.5, max: 1.5 });
    expect(updated).toBeCloseTo(baseline, 5);
  });

  describe('absolutePriceLevel overrides', () => {
    const makeNeutralPrices = (now: Date) => {
      const prices: { time: string; price: number }[] = [];
      for (let i = 1; i <= 12; i += 1) {
        prices.push({ time: new Date(now.getTime() + i * 3600000).toISOString(), price: 1.0 });
      }
      return prices;
    };

    it('VERY_CHEAP absolute level floors bias at cheapBiasC', () => {
      const now = new Date('2024-06-01T00:00:00Z');
      const prices = makeNeutralPrices(now);
      const result = computePlanningBias(prices, now, {
        windowHours: 6,
        lookaheadHours: 12,
        cheapBiasC: 1.5,
        expensiveBiasC: 1.5,
        maxAbsBiasC: 2.0,
        absolutePriceLevel: 'VERY_CHEAP' as AbsolutePriceLevel,
      });
      expect(result.biasC).toBeGreaterThanOrEqual(1.5);
    });

    it('VERY_EXPENSIVE absolute level caps bias at -expensiveBiasC', () => {
      const now = new Date('2024-06-01T00:00:00Z');
      const prices = makeNeutralPrices(now);
      const result = computePlanningBias(prices, now, {
        windowHours: 6,
        lookaheadHours: 12,
        cheapBiasC: 1.5,
        expensiveBiasC: 1.5,
        maxAbsBiasC: 2.0,
        absolutePriceLevel: 'VERY_EXPENSIVE' as AbsolutePriceLevel,
      });
      expect(result.biasC).toBeLessThanOrEqual(-1.5);
    });
  });
});
