/**
 * A cumulative energy meter (kWh that only ever goes up) built from MELCloud's per-day
 * counters, which restart at midnight. Homey Energy derives usage from the increase of
 * `meter_power`, so the meter must never decrease.
 *
 * - Same day: the counter's increase is added. A lower reading (MELCloud revising the day)
 *   adds nothing, and only growth beyond the highest reading counts later.
 * - New day: yesterday's final total (from the energy report) tops up what was missed after
 *   the last reading before midnight; then today's counter so far is added.
 */
export interface EnergyMeterState {
  /** Local date (YYYY-MM-DD) of `lastToday` */
  date: string;
  /** Highest per-day counter value seen on `date`, kWh */
  lastToday: number;
  /** Cumulative kWh */
  totalKWh: number;
}

const DAY_MS = 24 * 3600 * 1000;

function previousDate(date: string): string {
  const ms = Date.parse(`${date}T12:00:00Z`) - DAY_MS;
  return new Date(ms).toISOString().slice(0, 10);
}

export function advanceEnergyMeter(
  state: EnergyMeterState | null,
  date: string,
  todayKWh: number,
  yesterdayFinalKWh?: number | null
): EnergyMeterState {
  const today = Number.isFinite(todayKWh) && todayKWh > 0 ? todayKWh : 0;
  if (!state) {
    return { date, lastToday: today, totalKWh: today };
  }
  if (state.date === date) {
    const gained = Math.max(0, today - state.lastToday);
    return { date, lastToday: Math.max(state.lastToday, today), totalKWh: state.totalKWh + gained };
  }
  let total = state.totalKWh;
  if (state.date === previousDate(date) && Number.isFinite(yesterdayFinalKWh as number)) {
    total += Math.max(0, (yesterdayFinalKWh as number) - state.lastToday);
  }
  return { date, lastToday: today, totalKWh: total + today };
}

/** The date before `date`, for asking the energy report for yesterday's final total. */
export { previousDate as dayBefore };
