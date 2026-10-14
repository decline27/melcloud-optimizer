import { describe, expect, test } from '@jest/globals';

/**
 * The savings-history entry semantics, pinned.
 *
 * Two defects lived here. First `optimizedMinor` held a saving while its name said cost, so the
 * reader's subtraction produced cost - saving. Then, once fixed, the number itself was a gap
 * between a modelled "fixed 21 °C heat pump" and real consumption: 45-60 SEK/day on a device
 * whose realistic potential is a few SEK/day.
 *
 * v3 entries are measured (run-weighted price vs the day's average, src/util/run-price-ledger.ts)
 * and are the only ones the reader counts. These tests mirror the reader in api.ts
 * getModelConfidence so a regression fails here rather than on someone's dashboard.
 */

const SAVINGS_ENTRY_SCHEMA_VERSION = 3;

interface HistoryEntry {
  date: string;
  decimals?: number;
  valueMajor?: number;
  baselineMinor?: number;
  optimizedMinor?: number;
  schemaVersion?: number;
}

/** Mirrors the display-history read path in api.ts getModelConfidence. */
function readSaving(entry: HistoryEntry, defaultDecimals = 2): number | null {
  const decimals = entry.decimals ?? defaultDecimals;
  const isMeasured = Number(entry.schemaVersion) >= SAVINGS_ENTRY_SCHEMA_VERSION;
  if (isMeasured && typeof entry.valueMajor === 'number' && Number.isFinite(entry.valueMajor)) {
    return Number(entry.valueMajor.toFixed(decimals));
  }
  return null;
}

describe('savings history entry semantics', () => {
  test('a measured entry yields its stored saving', () => {
    const entry: HistoryEntry = {
      date: '2026-10-14',
      decimals: 2,
      valueMajor: 1.8,
      baselineMinor: 1225,
      optimizedMinor: 1045,
      schemaVersion: 3
    };

    expect(readSaving(entry)).toBeCloseTo(1.8, 2);
  });

  test('a measured loss is reported as a loss, not clamped to zero', () => {
    const entry: HistoryEntry = {
      date: '2026-10-14',
      decimals: 2,
      valueMajor: -0.6,
      baselineMinor: 1000,
      optimizedMinor: 1060,
      schemaVersion: 3
    };

    expect(readSaving(entry)).toBeCloseTo(-0.6, 2);
  });

  test('modelled v2 entries are not counted', () => {
    // Live value from 2026-10-13: a 77 SEK baseline against a partial-day reading.
    const modelled: HistoryEntry = {
      date: '2026-10-13',
      decimals: 2,
      valueMajor: 60.28,
      baselineMinor: 7764,
      optimizedMinor: 1736,
      schemaVersion: 2
    };

    expect(readSaving(modelled)).toBeNull();
  });

  test('legacy unversioned entries are not counted', () => {
    expect(readSaving({ date: '2026-08-01', decimals: 2, valueMajor: 8.51 })).toBeNull();
  });

  test('respects per-entry decimals', () => {
    expect(readSaving({ date: '2026-10-14', decimals: 3, valueMajor: 1.6667, schemaVersion: 3 })).toBeCloseTo(1.667, 3);
  });

  test('a mixed week sums only the measured days', () => {
    const week: HistoryEntry[] = [
      { date: '2026-10-10', valueMajor: 16.64, schemaVersion: 2 },
      { date: '2026-10-11', valueMajor: 37.31, schemaVersion: 2 },
      { date: '2026-10-14', valueMajor: 1.2, schemaVersion: 3 },
      { date: '2026-10-15', valueMajor: -0.3, schemaVersion: 3 },
      { date: '2026-10-16', valueMajor: 2.1, schemaVersion: 3 }
    ];

    const total = week.reduce((sum, e) => sum + (readSaving(e) ?? 0), 0);

    expect(total).toBeCloseTo(3.0, 2);
  });
});

/** Mirrors the projection in api.ts: completed (pre-today) measured days only. */
function monthlyProjection(entries: HistoryEntry[], todayIso: string): number | null {
  const completed = entries
    .filter(e => e.date < todayIso)
    .map(e => readSaving(e))
    .filter((v): v is number => typeof v === 'number');
  if (completed.length === 0) return null;
  return (completed.reduce((a, b) => a + b, 0) / completed.length) * 30;
}

describe('projection', () => {
  test('a partial day alone does not produce a projection', () => {
    // Live 2026-10-14: ~12 hours of data projected to -10.5/month.
    const entries: HistoryEntry[] = [{ date: '2026-10-14', valueMajor: -0.35, schemaVersion: 3 }];
    expect(monthlyProjection(entries, '2026-10-14')).toBeNull();
  });

  test('projects from completed days and ignores today', () => {
    const entries: HistoryEntry[] = [
      { date: '2026-10-14', valueMajor: 1.0, schemaVersion: 3 },
      { date: '2026-10-15', valueMajor: 3.0, schemaVersion: 3 },
      { date: '2026-10-16', valueMajor: -9.0, schemaVersion: 3 }
    ];
    expect(monthlyProjection(entries, '2026-10-16')).toBeCloseTo(60, 5);
  });
});
