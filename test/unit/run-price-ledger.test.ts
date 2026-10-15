import {
  computeRunPriceSavings,
  hourStartMs,
  isRunningOperationMode,
  LEDGER_RETENTION_HOURS,
  localDateString,
  localDayStartMs,
  readRunPriceLedger,
  recordHourPrice,
  recordRunSample,
  RUN_PRICE_LEDGER_SETTING
} from '../../src/util/run-price-ledger';

const HOUR = 3600000;

function makeSettings() {
  const store: Record<string, any> = {};
  return {
    get: (key: string) => store[key],
    set: (key: string, value: any) => { store[key] = value; },
    store
  };
}

// 2026-10-13 00:00 UTC
const DAY0 = Date.UTC(2026, 9, 13);

describe('run-price ledger', () => {
  test('running modes match the driver heating set', () => {
    expect([1, 2, 4, 6, 7, 11].every(isRunningOperationMode)).toBe(true);
    expect([0, 3, 5, undefined, null, '2'].some(isRunningOperationMode)).toBe(false);
  });

  test('samples and prices land in the same hour bucket', () => {
    const settings = makeSettings();
    recordHourPrice(settings, DAY0 + 10 * HOUR + 5000, 2.5);
    recordRunSample(settings, DAY0 + 10 * HOUR + 5 * 60000, true);
    recordRunSample(settings, DAY0 + 10 * HOUR + 10 * 60000, false);

    const hour = readRunPriceLedger(settings).hours[String(DAY0 + 10 * HOUR)];
    expect(hour).toEqual({ run: 1, total: 2, price: 2.5 });
  });

  test('storage is pruned to the retention window', () => {
    const settings = makeSettings();
    for (let h = 0; h < LEDGER_RETENTION_HOURS + 10; h++) {
      recordRunSample(settings, DAY0 + h * HOUR, true);
    }
    expect(Object.keys(settings.store[RUN_PRICE_LEDGER_SETTING].hours)).toHaveLength(LEDGER_RETENTION_HOURS);
  });

  test('an evenly running pump pays the average and saves nothing', () => {
    const ledger = { hours: {
      [DAY0]: { run: 6, total: 12, price: 1 },
      [DAY0 + HOUR]: { run: 6, total: 12, price: 3 }
    } };
    const result = computeRunPriceSavings(ledger, DAY0, DAY0 + 2 * HOUR, 24)!;
    expect(result.paidPrice).toBeCloseTo(2);
    expect(result.savings).toBeCloseTo(0);
  });

  test('running in the cheap hour is a saving, in the dear hour a loss', () => {
    const cheapRun = { hours: {
      [DAY0]: { run: 12, total: 12, price: 1 },
      [DAY0 + HOUR]: { run: 0, total: 12, price: 3 }
    } };
    const dearRun = { hours: {
      [DAY0]: { run: 0, total: 12, price: 1 },
      [DAY0 + HOUR]: { run: 12, total: 12, price: 3 }
    } };

    // 24 kWh/day over 2 of 24 hours = 2 kWh attributed; average price 2.
    const saved = computeRunPriceSavings(cheapRun, DAY0, DAY0 + 2 * HOUR, 24)!;
    expect(saved.energyKWh).toBeCloseTo(2);
    expect(saved.savings).toBeCloseTo(2 * (2 - 1));

    const lost = computeRunPriceSavings(dearRun, DAY0, DAY0 + 2 * HOUR, 24)!;
    expect(lost.savings).toBeCloseTo(2 * (2 - 3));
  });

  test('hours without a price or without polls are ignored', () => {
    const ledger = { hours: {
      [DAY0]: { run: 12, total: 12 },
      [DAY0 + HOUR]: { run: 0, total: 0, price: 9 },
      [DAY0 + 2 * HOUR]: { run: 12, total: 12, price: 2 }
    } };
    const result = computeRunPriceSavings(ledger, DAY0, DAY0 + 3 * HOUR, 24)!;
    expect(result.hoursUsed).toBe(1);
    expect(result.averagePrice).toBe(2);
  });

  test('no usable hours returns null rather than a guess', () => {
    expect(computeRunPriceSavings({ hours: {} }, DAY0, DAY0 + HOUR, 10)).toBeNull();
  });

  test('a pump that never ran saves nothing', () => {
    const ledger = { hours: { [DAY0]: { run: 0, total: 12, price: 1 }, [DAY0 + HOUR]: { run: 0, total: 12, price: 3 } } };
    expect(computeRunPriceSavings(ledger, DAY0, DAY0 + 2 * HOUR, 24)!.savings).toBeCloseTo(0);
  });

  describe('energy part vs a normal pump at the comfort-band midpoint', () => {
    // Two hours, pump running evenly, outdoor 2 °C, baseline 22 °C.
    function hours(indoorC: number, extra: Partial<Record<string, number>> = {}) {
      return { hours: {
        [DAY0]: { run: 6, total: 12, price: 2, baselineC: 22, indoorSum: indoorC * 12, outdoorSum: 2 * 12, tempSamples: 12, ...extra },
        [DAY0 + HOUR]: { run: 6, total: 12, price: 2, baselineC: 22, indoorSum: indoorC * 12, outdoorSum: 2 * 12, tempSamples: 12, ...extra }
      } };
    }

    test('coasting below the midpoint is an energy saving', () => {
      // Room 21 vs baseline 22 with outdoor 2: normal pump loses 20 K, ours 19 K -> ratio 20/19.
      const r = computeRunPriceSavings(hours(21), DAY0, DAY0 + 2 * HOUR, 24, 12)!;
      const heatingKWh = 12 * (2 / 24);
      expect(r.energyRatio).toBeCloseTo(20 / 19);
      expect(r.baselineEnergyKWh).toBeCloseTo(2 - heatingKWh + heatingKWh * (20 / 19));
      expect(r.energySavings).toBeCloseTo(heatingKWh * (20 / 19 - 1) * 2);
      expect(r.timingSavings).toBeCloseTo(0);
      expect(r.savings).toBeCloseTo(r.timingSavings + r.energySavings);
    });

    test('holding the room above the midpoint costs energy', () => {
      const r = computeRunPriceSavings(hours(23), DAY0, DAY0 + 2 * HOUR, 24, 12)!;
      expect(r.energyRatio).toBeLessThan(1);
      expect(r.energySavings).toBeLessThan(0);
    });

    test('hot-water energy is not scaled by the room temperature', () => {
      // No heating share given: the whole energy is treated as non-room energy.
      const r = computeRunPriceSavings(hours(21), DAY0, DAY0 + 2 * HOUR, 24)!;
      expect(r.energyRatio).toBe(1);
      expect(r.energySavings).toBeCloseTo(0);
    });

    test('a mild day with too small a gradient skips the energy part', () => {
      // Indoor 21, outdoor 19: 2 K mean gradient is below the threshold.
      const mild = hours(21, { outdoorSum: 19 * 12 });
      expect(computeRunPriceSavings(mild, DAY0, DAY0 + 2 * HOUR, 24, 12)!.energyRatio).toBe(1);
    });

    test('a nonsense reading cannot produce a runaway ratio', () => {
      // Indoor 5 °C (a broken sensor) against a 22 °C baseline.
      const r = computeRunPriceSavings(hours(5.5), DAY0, DAY0 + 2 * HOUR, 24, 12)!;
      expect(r.energyRatio).toBeLessThanOrEqual(1.3);
    });

    test('sun warming an idle house above the midpoint is not an energy cost', () => {
      // Pump idle (0 runs), room 23.5 from sun, outdoor 13: a normal pump would be idle too.
      const sunny = { hours: {
        [DAY0]: { run: 0, total: 12, price: 1, baselineC: 22, indoorSum: 23.5 * 12, outdoorSum: 13 * 12, tempSamples: 12 },
        [DAY0 + HOUR]: { run: 0, total: 12, price: 1, baselineC: 22, indoorSum: 23.5 * 12, outdoorSum: 13 * 12, tempSamples: 12 }
      } };
      const r = computeRunPriceSavings(sunny, DAY0, DAY0 + 2 * HOUR, 24, 12)!;
      expect(r.energyRatio).toBeCloseTo(1);
      expect(r.energySavings).toBeCloseTo(0);
    });

    test('a normal pump pays the demand-weighted price, not the flat average', () => {
      // Cold expensive morning (outdoor 2, price 3) and a mild cheap midday (outdoor 18, price 1).
      // Demand weights 20 and 4: the normal pump mostly heats in the morning.
      const day = { hours: {
        [DAY0]: { run: 12, total: 12, price: 3, baselineC: 22, indoorSum: 22 * 12, outdoorSum: 2 * 12, tempSamples: 12 },
        [DAY0 + HOUR]: { run: 2, total: 12, price: 1, baselineC: 22, indoorSum: 22 * 12, outdoorSum: 18 * 12, tempSamples: 12 }
      } };
      const r = computeRunPriceSavings(day, DAY0, DAY0 + 2 * HOUR, 24, 24)!;
      expect(r.averagePrice).toBeCloseTo(2);
      expect(r.normalPumpHeatingPrice).toBeCloseTo((20 * 3 + 4 * 1) / 24);
      // Running mostly in the cold hour is what a normal pump does too, so it is not a timing loss
      // against the normal pump the way it would be against the flat average.
      const flatTiming = r.energyKWh * (r.averagePrice - r.paidPrice);
      expect(r.timingSavings).toBeGreaterThan(flatTiming);
    });

    test('timing and energy parts always add up to the total', () => {
      const day = { hours: {
        [DAY0]: { run: 9, total: 12, price: 2.3, baselineC: 22, indoorSum: 21.5 * 12, outdoorSum: 11 * 12, tempSamples: 12 },
        [DAY0 + HOUR]: { run: 3, total: 12, price: 0.9, baselineC: 22, indoorSum: 22.8 * 12, outdoorSum: 13 * 12, tempSamples: 12 }
      } };
      const r = computeRunPriceSavings(day, DAY0, DAY0 + 2 * HOUR, 6, 4.4)!;
      expect(r.timingSavings + r.energySavings).toBeCloseTo(r.savings);
      expect(r.baselineCost - r.actualCost).toBeCloseTo(r.savings);
    });

    test('poll temperatures and the hourly baseline are recorded', () => {
      const settings = makeSettings();
      recordRunSample(settings, DAY0 + 60000, true, 21.5, 4);
      recordRunSample(settings, DAY0 + 120000, false, null, 4);
      recordHourPrice(settings, DAY0 + 1000, 1.5, 22);
      expect(readRunPriceLedger(settings).hours[String(DAY0)]).toEqual({
        run: 1, total: 2, price: 1.5, baselineC: 22, indoorSum: 21.5, outdoorSum: 4, tempSamples: 1
      });
    });
  });

  test('local day start follows the same offset and DST rule as the hourly run', () => {
    // 13 Oct 00:30 local CEST (UTC+1 with use_dst) is 12 Oct 22:30 UTC.
    const now = Date.UTC(2026, 9, 12, 22, 30);
    expect(localDayStartMs(now, 1, true)).toBe(Date.UTC(2026, 9, 12, 22, 0));
    // Without DST the same instant is still 12 Oct locally (23:30), starting at 23:00 UTC on 11 Oct.
    expect(localDayStartMs(now, 1, false)).toBe(Date.UTC(2026, 9, 11, 23, 0));
    expect(hourStartMs(now)).toBe(Date.UTC(2026, 9, 12, 22, 0));
  });
});

describe('local date', () => {
  test('is the local day, not the UTC day, in the first local hours', () => {
    // 14 Oct 00:30 CEST is still 13 Oct in UTC.
    const now = Date.UTC(2026, 9, 13, 22, 30);
    expect(localDateString(now, 1, true)).toBe('2026-10-14');
    expect(localDateString(Date.UTC(2026, 9, 14, 12, 0), 1, true)).toBe('2026-10-14');
  });
});

describe('per-kWh adder (grid fee)', () => {
  const day = (indoorC: number) => ({ hours: {
    [DAY0]: { run: 12, total: 12, price: 1, baselineC: 22, indoorSum: indoorC * 12, outdoorSum: 2 * 12, tempSamples: 12 },
    [DAY0 + HOUR]: { run: 0, total: 12, price: 3, baselineC: 22, indoorSum: indoorC * 12, outdoorSum: 2 * 12, tempSamples: 12 }
  } });

  test('cancels in the timing part', () => {
    const without = computeRunPriceSavings(day(22), DAY0, DAY0 + 2 * HOUR, 24, 24)!;
    const withFee = computeRunPriceSavings(day(22), DAY0, DAY0 + 2 * HOUR, 24, 24, 1.04)!;
    expect(withFee.timingSavings).toBeCloseTo(without.timingSavings);
    expect(withFee.savings).toBeCloseTo(without.savings);
  });

  test('counts in full for kWh not bought', () => {
    // Coasting at 21 vs the 22 baseline: fewer kWh than a normal pump.
    const without = computeRunPriceSavings(day(21), DAY0, DAY0 + 2 * HOUR, 24, 24)!;
    const withFee = computeRunPriceSavings(day(21), DAY0, DAY0 + 2 * HOUR, 24, 24, 1.04)!;
    const kWhNotBought = withFee.baselineEnergyKWh - withFee.energyKWh;
    expect(kWhNotBought).toBeGreaterThan(0);
    expect(withFee.energySavings - without.energySavings).toBeCloseTo(kWhNotBought * 1.04);
    expect(withFee.timingSavings + withFee.energySavings).toBeCloseTo(withFee.savings);
  });

  test('costs are delivered costs', () => {
    const r = computeRunPriceSavings(day(22), DAY0, DAY0 + 2 * HOUR, 24, 24, 1.04)!;
    expect(r.actualCost).toBeCloseTo(r.energyKWh * (r.paidPrice + 1.04));
  });
});
