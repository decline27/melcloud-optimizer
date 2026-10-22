import * as fs from 'fs';
import * as path from 'path';
import {
  CompressorCycleState,
  initCompressorCycles,
  recordCycleSample,
  summarizeCycles
} from '../../src/util/compressor-cycles';
import { COMPRESSOR_CYCLE_CONSTANTS } from '../../src/constants';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const T0 = Date.parse('2026-10-21T06:00:00Z');

/** Feed a run/stop pattern, one sample every `stepMin` minutes starting at `startMs`. */
function feed(state: CompressorCycleState, startMs: number, pattern: number[], stepMin = 5): CompressorCycleState {
  pattern.forEach((hz, i) => {
    state = recordCycleSample(state, startMs + i * stepMin * MIN, hz);
  });
  return state;
}

describe('compressor cycle tracker', () => {
  test('counts off → on transitions as starts and runs to the sample midpoints', () => {
    // off, on, off, on, off, off: two one-poll runs, each 5 min long between midpoints
    const s = feed(initCompressorCycles(null), T0, [0, 30, 0, 30, 0, 0]);
    const now = T0 + 25 * MIN;
    const sum = summarizeCycles(s, now);

    expect(sum.starts).toBe(2);
    expect(sum.completedRuns).toBe(2);
    expect(sum.avgRunMinutes).toBeCloseTo(5, 6);
    expect(sum.coverageHours).toBeCloseTo(25 / 60, 6);
    // run time: four half-intervals of 2.5 min = 10 min of 25 min sampled
    expect(sum.runSharePct).toBeCloseTo(40, 6);
    expect(sum.startsPerHour).toBeCloseTo(2 / (25 / 60), 6);
  });

  test('reproduces the live pattern of 2026-10-21: short runs, about 3 starts an hour', () => {
    // Per 35-min block: on, off, on, off, off, off, off — two runs, 25 min idle.
    const block = [20, 0, 20, 0, 0, 0, 0];
    let s = recordCycleSample(initCompressorCycles(null), T0 - 5 * MIN, 0); // idle before the first block
    for (let b = 0; b < 12; b++) s = feed(s, T0 + b * 35 * MIN, block);
    const now = T0 + 12 * 35 * MIN - 5 * MIN; // the last sample
    const sum = summarizeCycles(s, now);

    expect(sum.starts).toBe(24);
    expect(sum.completedRuns).toBe(24);
    expect(sum.avgRunMinutes).toBeCloseTo(5, 6);
    expect(sum.startsPerHour).toBeGreaterThan(3);
    expect(sum.runSharePct).toBeGreaterThan(25);
    expect(sum.runSharePct).toBeLessThan(35);
  });

  test('a long continuous run is one start with its full length', () => {
    const pattern = [0, ...Array(12).fill(25), 0];
    const s = feed(initCompressorCycles(null), T0, pattern);
    const sum = summarizeCycles(s, T0 + 13 * 5 * MIN);

    expect(sum.starts).toBe(1);
    expect(sum.completedRuns).toBe(1);
    // starts at 2.5 min, stops at 62.5 min
    expect(sum.avgRunMinutes).toBeCloseTo(60, 6);
  });

  test('a run already going at the first sample is not a start and has no known length', () => {
    const s = feed(initCompressorCycles(null), T0, [30, 30, 0, 0]);
    const sum = summarizeCycles(s, T0 + 15 * MIN);

    expect(sum.starts).toBe(0);
    expect(sum.completedRuns).toBe(0);
    expect(sum.avgRunMinutes).toBeNull();
    expect(sum.runSharePct).toBeGreaterThan(0);
  });

  test('a run still going at the end counts as a start but not as a completed run', () => {
    const s = feed(initCompressorCycles(null), T0, [0, 0, 30, 30]);
    const sum = summarizeCycles(s, T0 + 15 * MIN);

    expect(sum.starts).toBe(1);
    expect(sum.completedRuns).toBe(0);
    expect(sum.avgRunMinutes).toBeNull();
  });

  test('a gap longer than the limit breaks continuity: no transition, no sampled time', () => {
    const gap = (COMPRESSOR_CYCLE_CONSTANTS.MAX_SAMPLE_GAP_MINUTES + 5) * MIN;
    let s = recordCycleSample(initCompressorCycles(null), T0, 0);
    s = recordCycleSample(s, T0 + gap, 30); // off → on across the gap: unknown
    s = recordCycleSample(s, T0 + gap + 5 * MIN, 0); // on → off, but the run's start is unknown
    const sum = summarizeCycles(s, T0 + gap + 5 * MIN);

    expect(sum.starts).toBe(0);
    expect(sum.completedRuns).toBe(0);
    expect(sum.coverageHours).toBeCloseTo(5 / 60, 6);
  });

  test('a gap exactly at the limit is still continuous', () => {
    const limit = COMPRESSOR_CYCLE_CONSTANTS.MAX_SAMPLE_GAP_MINUTES * MIN;
    let s = recordCycleSample(initCompressorCycles(null), T0, 0);
    s = recordCycleSample(s, T0 + limit, 30);
    expect(summarizeCycles(s, T0 + limit).starts).toBe(1);
  });

  test('only samples inside the window are summarised', () => {
    let s = feed(initCompressorCycles(null), T0, [0, 30, 0]);
    const later = T0 + 30 * HOUR;
    s = feed(s, later, [0, 30, 0, 30, 0]);
    const sum = summarizeCycles(s, later + 20 * MIN);

    expect(sum.starts).toBe(2);
  });

  test('a custom window narrows the summary', () => {
    const s = feed(initCompressorCycles(null), T0, [0, 30, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 30, 0]);
    const now = T0 + 14 * 5 * MIN;
    expect(summarizeCycles(s, now).starts).toBe(2);
    expect(summarizeCycles(s, now, 0.5).starts).toBe(1);
  });

  test('frequency 0, negative or NaN counts as stopped', () => {
    const s = feed(initCompressorCycles(null), T0, [0, -1, Number.NaN, 0]);
    expect(s.samples.map(([, on]) => on)).toEqual([0, 0, 0, 0]);
    expect(summarizeCycles(s, T0 + 15 * MIN).runSharePct).toBe(0);
  });

  test('samples not later than the last one are ignored', () => {
    let s = recordCycleSample(initCompressorCycles(null), T0, 0);
    s = recordCycleSample(s, T0, 30);
    s = recordCycleSample(s, T0 - MIN, 30);
    s = recordCycleSample(s, Number.NaN, 30);
    expect(s.samples).toEqual([[T0, 0]]);
  });

  test('samples older than the retention are dropped', () => {
    let s = recordCycleSample(initCompressorCycles(null), T0, 0);
    s = recordCycleSample(s, T0 + COMPRESSOR_CYCLE_CONSTANTS.RETENTION_HOURS * HOUR + MIN, 0);
    expect(s.samples).toHaveLength(1);
  });

  test('stored samples are capped', () => {
    let s = initCompressorCycles(null);
    const n = COMPRESSOR_CYCLE_CONSTANTS.MAX_SAMPLES + 50;
    for (let i = 0; i < n; i++) s = recordCycleSample(s, T0 + i * 1000, i % 2);
    expect(s.samples).toHaveLength(COMPRESSOR_CYCLE_CONSTANTS.MAX_SAMPLES);
    expect(s.samples[s.samples.length - 1][0]).toBe(T0 + (n - 1) * 1000);
  });

  test('nothing sampled gives zeros, not NaN', () => {
    const sum = summarizeCycles(initCompressorCycles(null), T0);
    expect(sum).toEqual({
      coverageHours: 0,
      starts: 0,
      startsPerHour: 0,
      completedRuns: 0,
      avgRunMinutes: null,
      runSharePct: 0
    });
  });

  test('restores only a valid stored state, dropping malformed samples and sorting', () => {
    expect(initCompressorCycles(undefined).samples).toEqual([]);
    expect(initCompressorCycles({ version: 2, samples: [[T0, 1]] }).samples).toEqual([]);
    expect(initCompressorCycles({ version: 1, samples: 'x' }).samples).toEqual([]);

    const restored = initCompressorCycles({
      version: 1,
      samples: [[T0 + MIN, 1], ['bad', 1], [T0, 0], [T0 + 2 * MIN, 2], [Number.NaN, 0]]
    });
    expect(restored).toEqual({ version: 1, samples: [[T0, 0], [T0 + MIN, 1]] });
  });

  test('state survives a JSON round trip through the device store', () => {
    const s = feed(initCompressorCycles(null), T0, [0, 30, 0]);
    const restored = initCompressorCycles(JSON.parse(JSON.stringify(s)));
    expect(restored).toEqual(s);
    expect(summarizeCycles(restored, T0 + 10 * MIN)).toEqual(summarizeCycles(s, T0 + 10 * MIN));
  });
});

describe('compressor cycle capabilities are declared everywhere Homey reads them', () => {
  const root = path.resolve(__dirname, '../..');
  const read = (p: string) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
  const caps = ['compressor_starts', 'compressor_avg_run', 'compressor_run_share'];

  test.each(caps)('%s is defined in compose, driver and the built app.json', (cap) => {
    const compose = read(`.homeycompose/capabilities/${cap}.json`);
    expect(compose.type).toBe('number');
    expect(compose.insights).toBe(true);
    expect(compose.setable).toBe(false);

    expect(read('drivers/boiler/driver.compose.json').capabilities).toContain(cap);

    const app = read('app.json');
    expect(app.capabilities[cap]).toEqual(compose);
    expect(app.drivers.find((d: { id: string }) => d.id === 'boiler').capabilities).toContain(cap);
  });
});
