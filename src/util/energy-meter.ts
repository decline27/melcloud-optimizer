import { ENERGY_METER_CONSTANTS } from '../constants';

/**
 * Heat pump energy meter for Homey Energy (`meter_power`, kWh, never decreases).
 *
 * For most units MELCloud publishes energy only as a total per finished day (and no live
 * power). Through the day the meter therefore follows the compressor: the frequency
 * (`HeatPumpFrequency`, 0 when off) is integrated into Hz-hours and turned into kWh with a rate
 * learned from earlier days (day total ÷ that day's Hz-hours). When MELCloud publishes a day's
 * total, that measured value replaces the day's estimate. The meter never goes down: if an
 * estimate ran ahead of the measured total, the meter holds until the next estimates catch up,
 * so totals over days and weeks are MELCloud's measurement.
 *
 * Verified live 2026-10-17: MELCloud's mode said "heating zones" all day while the compressor
 * ran only in cycles; the frequency went 0 → 30 → 16 Hz over a run and back to 0.
 */

/** A day whose measured total is not known yet. */
export interface OpenDay {
  date: string;
  hzHours: number;
  sampledHours: number;
}

/** A finished day with its measured total, for learning the rate. */
export interface CalibrationDay {
  date: string;
  kWh: number;
  hzHours: number;
}

export interface EnergyMeterState {
  version: 2;
  /** Sum of the measured (or finally estimated) day totals already counted, kWh */
  measuredKWh: number;
  /** Latest day already counted in `measuredKWh` */
  lastMeasuredDate: string | null;
  open: OpenDay[];
  calibration: CalibrationDay[];
  /** Highest value written to the meter, kWh */
  meterKWh: number;
  lastSampleMs: number | null;
  lastHz: number | null;
}

const DAY_MS = 24 * 3600 * 1000;

export function dayBefore(date: string): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / DAY_MS);
}

/**
 * Start (or migrate) the state. A version-1 meter (one running total) keeps its value as the
 * measured total up to `lastMeasuredDate`, so the meter never jumps back.
 */
export function initEnergyMeter(stored: unknown, lastMeasuredDate: string | null): EnergyMeterState {
  const s = stored as Partial<EnergyMeterState> & { totalKWh?: number } | null;
  if (s && s.version === 2) return s as EnergyMeterState;
  const carried = s && Number.isFinite(s.totalKWh) ? (s.totalKWh as number) : 0;
  return {
    version: 2,
    measuredKWh: carried,
    lastMeasuredDate: carried > 0 ? lastMeasuredDate : null,
    open: [],
    calibration: [],
    meterKWh: carried,
    lastSampleMs: null,
    lastHz: null
  };
}

/** Integrate one compressor sample (Hz) taken at `nowMs`, belonging to local day `date`. */
export function recordCompressorSample(state: EnergyMeterState, nowMs: number, date: string, hz: number): EnergyMeterState {
  const value = Number.isFinite(hz) && hz > 0 ? hz : 0;
  let day = state.open.find(d => d.date === date);
  const open = day ? state.open : [...state.open, (day = { date, hzHours: 0, sampledHours: 0 })];
  if (state.lastSampleMs !== null && state.lastHz !== null) {
    const gapHours = (nowMs - state.lastSampleMs) / 3600000;
    if (gapHours > 0 && gapHours * 60 <= ENERGY_METER_CONSTANTS.MAX_SAMPLE_GAP_MINUTES) {
      // Trapezoid: the compressor ramps between samples.
      day.hzHours += ((state.lastHz + value) / 2) * gapHours;
      day.sampledHours += gapHours;
    }
  }
  return { ...state, open, lastSampleMs: nowMs, lastHz: value };
}

/** Learned kWh per compressor Hz-hour, or null before any full measured day. */
export function kWhPerHzHour(state: EnergyMeterState): number | null {
  const days = state.calibration.filter(d => d.hzHours > 0);
  const hz = days.reduce((sum, d) => sum + d.hzHours, 0);
  const kWh = days.reduce((sum, d) => sum + d.kWh, 0);
  return hz > 0 && kWh > 0 ? kWh / hz : null;
}

/**
 * Estimated kWh of a day not yet measured. Before a rate is learned, the recent average day
 * (MELCloud's 7-day report) is spread over the sampled hours.
 */
export function estimateOpenDay(day: OpenDay, rate: number | null, averageDailyKWh: number | null): number {
  if (rate !== null) return rate * day.hzHours;
  if (averageDailyKWh !== null && averageDailyKWh > 0) return averageDailyKWh * Math.min(day.sampledHours, 24) / 24;
  return 0;
}

/** Count MELCloud's measured total for a finished day; its estimate is dropped. */
export function applyMeasuredDay(state: EnergyMeterState, date: string, kWh: number): EnergyMeterState {
  if (state.lastMeasuredDate !== null && date <= state.lastMeasuredDate) return state;
  const day = state.open.find(d => d.date === date);
  const calibration = day && day.sampledHours >= ENERGY_METER_CONSTANTS.MIN_SAMPLED_HOURS_FOR_CALIBRATION
    ? [...state.calibration, { date, kWh, hzHours: day.hzHours }].slice(-ENERGY_METER_CONSTANTS.CALIBRATION_DAYS)
    : state.calibration;
  return {
    ...state,
    measuredKWh: state.measuredKWh + Math.max(0, kWh),
    lastMeasuredDate: date,
    open: state.open.filter(d => d.date !== date),
    calibration
  };
}

/** Days that waited too long for MELCloud's total keep their estimate as final. */
export function expireOpenDays(state: EnergyMeterState, today: string, averageDailyKWh: number | null): EnergyMeterState {
  const rate = kWhPerHzHour(state);
  let next = state;
  for (const day of [...state.open].sort((a, b) => a.date.localeCompare(b.date))) {
    if (daysBetween(day.date, today) > ENERGY_METER_CONSTANTS.MAX_DAYS_WAITING_FOR_TOTAL) {
      next = applyMeasuredDay(next, day.date, estimateOpenDay(day, rate, averageDailyKWh));
    }
  }
  return next;
}

/** Days before `today` still waiting for MELCloud's total, oldest first. */
export function daysAwaitingTotal(state: EnergyMeterState, today: string): string[] {
  return state.open.map(d => d.date).filter(d => d < today).sort();
}

/** The meter value: measured totals plus estimates of open days, never lower than before. */
export function meterReading(state: EnergyMeterState, averageDailyKWh: number | null): EnergyMeterState {
  const rate = kWhPerHzHour(state);
  const estimated = state.open.reduce((sum, d) => sum + estimateOpenDay(d, rate, averageDailyKWh), 0);
  return { ...state, meterKWh: Math.max(state.meterKWh, state.measuredKWh + estimated) };
}

/** Current power estimate in W from the compressor frequency, or null before a rate is learned. */
export function estimatedPowerW(state: EnergyMeterState, hz: number): number | null {
  const rate = kWhPerHzHour(state);
  if (rate === null) return null;
  return Math.round(rate * Math.max(0, hz) * 1000);
}
