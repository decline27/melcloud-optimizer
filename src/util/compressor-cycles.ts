import { COMPRESSOR_CYCLE_CONSTANTS } from '../constants';

/**
 * Compressor cycle tracker: how often the compressor starts, how long it runs, and what share of
 * the time it runs, over a rolling window (default 24 h).
 *
 * MELCloud's operation mode stays "heating zones" while the compressor cycles on and off, so the
 * only run signal is `HeatPumpFrequency` (0 when off), sampled once per device poll — the same
 * sample the energy meter integrates.
 *
 * Why this exists: in mild weather the unit's minimum output can exceed what the house and the
 * emitters can take, and the compressor short-cycles. Seen live on 2026-10-21 at ~11 °C outdoor:
 * 17 starts in 6 hours, most runs 5–10 minutes. Short cycling costs COP and is invisible in
 * MELCloud's daily energy report, so it needs its own measurement before any control change can
 * be judged against it.
 *
 * Accuracy, given one sample per poll (default every 5 minutes):
 *  - `starts` is a lower bound: a run that begins and ends between two polls is never seen.
 *  - A run's start and end are placed at the midpoint between the two samples that bracket them,
 *    so each run length is right to within about one poll interval.
 *  - Across a gap longer than `MAX_SAMPLE_GAP_MINUTES` (restart, MELCloud outage) a start or
 *    stop is unknown, so the gap is neither counted as sampled time nor as a transition.
 */

/** One poll: timestamp (ms) and whether the compressor was running (1) or not (0). */
export type CycleSample = [number, 0 | 1];

export interface CompressorCycleState {
  version: 1;
  /** Samples in time order, oldest first. */
  samples: CycleSample[];
}

export interface CycleSummary {
  /** Sampled hours inside the window (gaps longer than the limit excluded). */
  coverageHours: number;
  /** Off → on transitions inside the window. A lower bound (see above). */
  starts: number;
  /** Starts per sampled hour; 0 when nothing was sampled. */
  startsPerHour: number;
  /** Runs that both started and ended inside the window. */
  completedRuns: number;
  /** Mean length of the completed runs, minutes; null when there were none. */
  avgRunMinutes: number | null;
  /** Share of the sampled time the compressor ran, 0–100; 0 when nothing was sampled. */
  runSharePct: number;
}

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

function emptyState(): CompressorCycleState {
  return { version: 1, samples: [] };
}

function isSample(value: unknown): value is CycleSample {
  return Array.isArray(value)
    && value.length === 2
    && typeof value[0] === 'number'
    && Number.isFinite(value[0])
    && (value[1] === 0 || value[1] === 1);
}

/**
 * Restore the state from the device store. Anything that is not a version-1 state yields an
 * empty one; malformed samples are dropped and the rest are put back in time order.
 */
export function initCompressorCycles(stored: unknown): CompressorCycleState {
  const s = stored as Partial<CompressorCycleState> | null | undefined;
  if (!s || s.version !== 1 || !Array.isArray(s.samples)) return emptyState();
  const samples = s.samples.filter(isSample).sort((a, b) => a[0] - b[0]);
  return { version: 1, samples };
}

/**
 * Add one compressor sample taken at `nowMs`. A frequency above 0 counts as running; anything
 * else (0, negative, NaN) as stopped. A sample not later than the last one is ignored. Samples
 * older than `RETENTION_HOURS` are dropped, and at most `MAX_SAMPLES` are kept.
 */
export function recordCycleSample(state: CompressorCycleState, nowMs: number, hz: number): CompressorCycleState {
  if (!Number.isFinite(nowMs)) return state;
  const last = state.samples[state.samples.length - 1];
  if (last && nowMs <= last[0]) return state;

  const running: 0 | 1 = Number.isFinite(hz) && hz > 0 ? 1 : 0;
  const cutoff = nowMs - COMPRESSOR_CYCLE_CONSTANTS.RETENTION_HOURS * HOUR_MS;
  const samples = [...state.samples.filter(([t]) => t >= cutoff), [nowMs, running] as CycleSample]
    .slice(-COMPRESSOR_CYCLE_CONSTANTS.MAX_SAMPLES);
  return { version: 1, samples };
}

/**
 * Summarise the samples in the `windowHours` before `nowMs`.
 *
 * Between two samples less than `MAX_SAMPLE_GAP_MINUTES` apart:
 *  - on → on counts the whole interval as run time, off → off none of it;
 *  - a change of state counts half the interval as run time, and places the start (off → on) or
 *    the stop (on → off) at its midpoint.
 * A run already going when the window opens, still going at `nowMs`, or broken by a long gap is
 * counted in run time but not in `completedRuns` / `avgRunMinutes`, whose length is unknown.
 */
export function summarizeCycles(
  state: CompressorCycleState,
  nowMs: number,
  windowHours: number = COMPRESSOR_CYCLE_CONSTANTS.WINDOW_HOURS
): CycleSummary {
  const from = nowMs - windowHours * HOUR_MS;
  const maxGapMs = COMPRESSOR_CYCLE_CONSTANTS.MAX_SAMPLE_GAP_MINUTES * MINUTE_MS;
  const samples = state.samples.filter(([t]) => t >= from && t <= nowMs);

  let sampledMs = 0;
  let runMs = 0;
  let starts = 0;
  let runStartMs: number | null = null;
  const runLengthsMs: number[] = [];

  for (let i = 1; i < samples.length; i++) {
    const [t0, wasOn] = samples[i - 1];
    const [t1, isOn] = samples[i];
    const gapMs = t1 - t0;
    if (gapMs <= 0) continue;
    if (gapMs > maxGapMs) {
      // Continuity lost: whatever happened in the gap is unknown.
      runStartMs = null;
      continue;
    }

    sampledMs += gapMs;
    runMs += ((wasOn + isOn) / 2) * gapMs;

    const midpointMs = t0 + gapMs / 2;
    if (!wasOn && isOn) {
      starts++;
      runStartMs = midpointMs;
    } else if (wasOn && !isOn) {
      if (runStartMs !== null) runLengthsMs.push(midpointMs - runStartMs);
      runStartMs = null;
    }
  }

  const coverageHours = sampledMs / HOUR_MS;
  const completedRuns = runLengthsMs.length;
  const avgRunMinutes = completedRuns > 0
    ? runLengthsMs.reduce((sum, ms) => sum + ms, 0) / completedRuns / MINUTE_MS
    : null;

  return {
    coverageHours,
    starts,
    startsPerHour: coverageHours > 0 ? starts / coverageHours : 0,
    completedRuns,
    avgRunMinutes,
    runSharePct: sampledMs > 0 ? (runMs / sampledMs) * 100 : 0
  };
}
