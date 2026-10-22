/**
 * Compressor power measured with the house meter.
 *
 * The energy meter turns compressor Hz into power with a rate learned from MELCloud's day
 * totals. That rate carries everything MELCloud books to the unit in a day (standby, the
 * circulation pump while the compressor rests, defrost, any overstatement) as if the compressor
 * drew it, so the live power it gives while running is too high and the true compressor draw
 * stays unknown.
 *
 * The house meter sees the compressor directly: when it starts, house power steps up; when it
 * stops, it steps down. Each start or stop caught between two polls gives one step, divided by
 * the running frequency to get W per Hz. Other loads switching at the same moment spoil single
 * steps, so implausible ones are dropped and the median of the rest is used.
 *
 * Pure functions on a small, capped state; the device keeps it in its store.
 */
import { POWER_CALIBRATION_CONSTANTS as C } from '../constants';

/** One measured step: [time (ms), W per Hz]. */
export type CalibrationStep = [number, number];

/** The previous poll: [time (ms), compressor Hz, house power (W)]. */
export type PowerReading = [number, number, number];

export interface PowerCalibrationState {
  version: 1;
  last: PowerReading | null;
  steps: CalibrationStep[];
}

export interface PowerCalibrationSummary {
  /** Steps currently kept. */
  steps: number;
  /** Median compressor draw per Hz (W/Hz), null until MIN_STEPS steps are kept. */
  wPerHz: number | null;
}

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export function initPowerCalibration(stored: unknown): PowerCalibrationState {
  const empty: PowerCalibrationState = { version: 1, last: null, steps: [] };
  if (!stored || typeof stored !== 'object') return empty;
  const raw = stored as { version?: unknown; last?: unknown; steps?: unknown };
  if (raw.version !== 1) return empty;

  const steps = Array.isArray(raw.steps)
    ? (raw.steps as unknown[])
      .filter((s): s is CalibrationStep => Array.isArray(s) && s.length === 2 && isFiniteNumber(s[0]) && isFiniteNumber(s[1]))
      .map(([t, w]) => [t, w] as CalibrationStep)
      .sort((a, b) => a[0] - b[0])
      .slice(-C.MAX_STEPS)
    : [];
  const last = Array.isArray(raw.last) && raw.last.length === 3 && raw.last.every(isFiniteNumber)
    ? [raw.last[0], raw.last[1], raw.last[2]] as PowerReading
    : null;
  return { version: 1, last, steps };
}

/**
 * The W/Hz of a start or stop between two polls, or null when the pair is not a clean step:
 * no change in run state, too far apart, or a ratio outside the plausible range.
 */
export function stepWPerHz(prev: PowerReading, next: PowerReading): number | null {
  const [t0, hz0, w0] = prev;
  const [t1, hz1, w1] = next;
  const gap = t1 - t0;
  if (!(gap > 0) || gap > C.MAX_PAIR_GAP_MINUTES * 60_000) return null;

  const wasOn = hz0 > 0;
  const isOn = hz1 > 0;
  if (wasOn === isOn) return null;

  // Start: power rose by the compressor's draw at the new frequency. Stop: it fell by the draw
  // at the frequency it was running at.
  const delta = isOn ? w1 - w0 : w0 - w1;
  const hz = isOn ? hz1 : hz0;
  const ratio = delta / hz;
  return ratio >= C.MIN_W_PER_HZ && ratio <= C.MAX_W_PER_HZ ? ratio : null;
}

/**
 * Records one poll: compressor Hz and house power (W), read together. A missing or invalid
 * house reading breaks the chain, so no step is taken across it.
 */
export function recordPowerSample(
  state: PowerCalibrationState,
  nowMs: number,
  hz: number,
  houseW: number | null
): PowerCalibrationState {
  if (!isFiniteNumber(nowMs)) return state;
  if (state.last && nowMs <= state.last[0]) return state;

  const cutoff = nowMs - C.RETENTION_DAYS * 24 * 3_600_000;
  let steps = state.steps.filter(([t]) => t >= cutoff);

  if (!isFiniteNumber(hz) || hz < 0 || !isFiniteNumber(houseW) || houseW < 0) {
    return { version: 1, last: null, steps };
  }

  const reading: PowerReading = [nowMs, hz, houseW];
  if (state.last) {
    const ratio = stepWPerHz(state.last, reading);
    if (ratio !== null) steps = [...steps, [nowMs, ratio] as CalibrationStep];
  }
  if (steps.length > C.MAX_STEPS) steps = steps.slice(-C.MAX_STEPS);
  return { version: 1, last: reading, steps };
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function summarizePowerCalibration(state: PowerCalibrationState, nowMs: number): PowerCalibrationSummary {
  const cutoff = nowMs - C.RETENTION_DAYS * 24 * 3_600_000;
  const ratios = state.steps.filter(([t]) => t >= cutoff).map(([, w]) => w);
  return {
    steps: ratios.length,
    wPerHz: ratios.length >= C.MIN_STEPS ? median(ratios) : null
  };
}

/**
 * Share of the unit's energy that the compressor steps do not explain, in %: standby, the
 * circulation pump while the compressor rests, defrost and any overstatement by MELCloud.
 * `meterWPerHz` is the energy meter's rate (from MELCloud's day totals) in W/Hz. Negative when
 * the measured draw is higher than MELCloud books.
 */
export function overheadSharePct(meterWPerHz: number | null, measuredWPerHz: number | null): number | null {
  if (!isFiniteNumber(meterWPerHz) || !isFiniteNumber(measuredWPerHz) || meterWPerHz <= 0) return null;
  const share = (1 - measuredWPerHz / meterWPerHz) * 100;
  return Math.max(-100, Math.min(100, share));
}
