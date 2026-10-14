/**
 * Measured savings: did the heat pump run in cheaper-than-average hours?
 *
 * The previous daily figure compared actual consumption against a modelled "fixed 21 °C heat
 * pump" baseline. That gap measured the model's error, not the optimizer: on 2026-10-13 it
 * reported 60 SEK/day (a 17 kWh baseline against a 0.58 kWh partial-day reading) on a device
 * whose savings potential is a few SEK/day.
 *
 * This ledger measures instead of modelling. Every device poll records whether the unit was
 * running; every hourly run records that hour's price. The saving is then
 *
 *     energy × (average price − price actually paid)
 *
 * where "price actually paid" weights each hour's price by the share of polls that saw the unit
 * running. A pump that runs evenly through the day pays the average and saves nothing; one that
 * runs mostly in cheap hours pays less. Per-kWh adders (grid fee, energy tax) are the same in
 * every hour and cancel in the difference, so spot prices are sufficient.
 *
 * That is the **timing** part. The **energy** part compares against a heat pump holding the
 * midpoint of the user's own comfort band all day. Heat loss scales with the indoor-outdoor
 * difference, so over the same hours a normal pump would have needed
 *
 *     heating energy × Σ(baseline − outdoor) / Σ(indoor − outdoor)
 *
 * using the measured indoor and outdoor temperature of each hour. Coasting below the midpoint
 * makes the ratio > 1 (a saving); holding the room above it makes it < 1 (a cost). This is a
 * steady-state degree-hour model: it ignores the building's heat storage within the window, which
 * mostly cancels over a day. Both parts can be negative and are reported as such.
 *
 * Two corrections keep weather from being scored as the optimizer's doing (both seen live on a
 * sunny 2026-10-14, cold morning and 14 °C midday):
 *  - A normal pump does not run evenly; it runs in proportion to heat demand. Its heating energy
 *    is priced at the demand-weighted price, Σ price × (baseline − outdoor)⁺ / Σ (baseline −
 *    outdoor)⁺, so cheap mild hours where nobody would heat do not drag its price down.
 *    Hot-water energy keeps the plain average.
 *  - A room above the midpoint counts as extra heating only in proportion to how much the pump
 *    ran that hour. Sun warming an idle house costs nothing, for either pump.
 *
 * Storage is bounded: only the last LEDGER_RETENTION_HOURS hour buckets are kept.
 */

export const RUN_PRICE_LEDGER_SETTING = 'run_price_ledger';
export const LEDGER_RETENTION_HOURS = 48;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Below this mean indoor-outdoor difference the degree-hour ratio is dominated by sensor noise
 * (mild days, summer), so the energy part is not attempted and only timing is reported.
 */
const MIN_MEAN_GRADIENT_C = 3;

/**
 * Sanity bound on the energy ratio. Moving the room around inside a comfort band changes heat
 * loss by a few percent to perhaps 20 %; a ratio outside this range means a bad reading.
 */
const ENERGY_RATIO_MIN = 0.7;
const ENERGY_RATIO_MAX = 1.3;

/**
 * MELCloud `OperationMode` values in which the compressor is producing heat: 1 hot water,
 * 2 heating, 4 hot water storage, 6 legionella, 7 heating eco, 11 heating up. Same set the
 * boiler driver maps to the "heating" operational state.
 */
const RUNNING_OPERATION_MODES = new Set([1, 2, 4, 6, 7, 11]);

export interface LedgerHour {
  /** Polls in this hour that saw the unit running. */
  run: number;
  /** All polls in this hour. */
  total: number;
  /** Spot price for this hour, recorded by the hourly optimizer run. */
  price?: number;
  /** Midpoint of the user's comfort band for this hour: what a normal heat pump would hold. */
  baselineC?: number;
  /** Sums and count of indoor/outdoor readings from the polls, for hourly means. */
  indoorSum?: number;
  outdoorSum?: number;
  tempSamples?: number;
}

export interface RunPriceLedger {
  /** Keyed by the UTC start of the hour, in milliseconds, as a string. */
  hours: Record<string, LedgerHour>;
}

export interface SettingsLike {
  get(key: string): any;
  set(key: string, value: any): void;
}

export interface RunPriceSavings {
  /** Hours that had both a price and at least one poll. */
  hoursUsed: number;
  /** Mean price over those hours: what an evenly-running pump would pay. */
  averagePrice: number;
  /**
   * Demand-weighted price: what a normal pump pays for heating, running in proportion to
   * (baseline − outdoor). Equals averagePrice when temperatures or the baseline are missing.
   */
  normalPumpHeatingPrice: number;
  /** Run-weighted mean price: what this pump actually paid. */
  paidPrice: number;
  /** Energy attributed to the hours used, kWh. */
  energyKWh: number;
  /**
   * Normal-pump heating energy ÷ actual heating energy over the same hours. 1 when the energy
   * part could not be computed (no temperatures, no baseline, or too small a gradient).
   */
  energyRatio: number;
  /** Energy a normal pump would have used over the same hours, kWh. */
  baselineEnergyKWh: number;
  /** A normal pump: heating at normalPumpHeatingPrice, hot water at averagePrice. */
  baselineCost: number;
  /** energyKWh × paidPrice. */
  actualCost: number;
  /** From running in cheaper hours than a normal pump would, for the same energy. */
  timingSavings: number;
  /** From using less heating energy than a normal pump, priced at normalPumpHeatingPrice. */
  energySavings: number;
  /** baselineCost − actualCost = timingSavings + energySavings. */
  savings: number;
}

export function isRunningOperationMode(operationMode: unknown): boolean {
  return typeof operationMode === 'number' && RUNNING_OPERATION_MODES.has(operationMode);
}

export function hourStartMs(nowMs: number): number {
  return Math.floor(nowMs / HOUR_MS) * HOUR_MS;
}

/**
 * Start of the local day containing `nowMs`, as a UTC timestamp. Mirrors the offset logic the
 * hourly run uses to name the day (`time_zone_offset` plus the `use_dst` summer hour), so the
 * ledger's "today" and the savings history's "today" are the same day.
 */
export function localDayStartMs(nowMs: number, tzOffsetHours: number, useDST: boolean): number {
  let offsetHours = Number.isFinite(tzOffsetHours) ? tzOffsetHours : 0;
  if (useDST) {
    const month = new Date(nowMs).getUTCMonth();
    if (month > 2 && month < 10) offsetHours += 1;
  }
  const offsetMs = offsetHours * HOUR_MS;
  return Math.floor((nowMs + offsetMs) / DAY_MS) * DAY_MS - offsetMs;
}

/** Local calendar date (YYYY-MM-DD) for `nowMs`, by the same offset rule as localDayStartMs. */
export function localDateString(nowMs: number, tzOffsetHours: number, useDST: boolean): string {
  const dayStart = localDayStartMs(nowMs, tzOffsetHours, useDST);
  // Midday of the local day is unambiguously inside it whatever the offset.
  const localMidday = dayStart + 12 * HOUR_MS;
  let offsetHours = Number.isFinite(tzOffsetHours) ? tzOffsetHours : 0;
  if (useDST) {
    const month = new Date(nowMs).getUTCMonth();
    if (month > 2 && month < 10) offsetHours += 1;
  }
  return new Date(localMidday + offsetHours * HOUR_MS).toISOString().slice(0, 10);
}

function readLedger(settings: SettingsLike): RunPriceLedger {
  const raw = settings.get(RUN_PRICE_LEDGER_SETTING);
  if (raw && typeof raw === 'object' && raw.hours && typeof raw.hours === 'object') {
    return { hours: { ...raw.hours } };
  }
  return { hours: {} };
}

function writeLedger(settings: SettingsLike, ledger: RunPriceLedger, nowMs: number): void {
  const cutoff = hourStartMs(nowMs) - (LEDGER_RETENTION_HOURS - 1) * HOUR_MS;
  const pruned: Record<string, LedgerHour> = {};
  for (const [key, hour] of Object.entries(ledger.hours)) {
    if (Number(key) >= cutoff) pruned[key] = hour;
  }
  settings.set(RUN_PRICE_LEDGER_SETTING, { hours: pruned });
}

/**
 * Record one device poll. Indoor and outdoor temperatures are optional; a reading is only kept
 * when both are finite, so the hourly means always pair up.
 */
export function recordRunSample(
  settings: SettingsLike,
  nowMs: number,
  running: boolean,
  indoorC?: number | null,
  outdoorC?: number | null
): void {
  const ledger = readLedger(settings);
  const key = String(hourStartMs(nowMs));
  const hour = ledger.hours[key] ?? { run: 0, total: 0 };
  const next: LedgerHour = { ...hour, run: hour.run + (running ? 1 : 0), total: hour.total + 1 };
  if (Number.isFinite(indoorC) && Number.isFinite(outdoorC)) {
    next.indoorSum = (hour.indoorSum ?? 0) + (indoorC as number);
    next.outdoorSum = (hour.outdoorSum ?? 0) + (outdoorC as number);
    next.tempSamples = (hour.tempSamples ?? 0) + 1;
  }
  ledger.hours[key] = next;
  writeLedger(settings, ledger, nowMs);
}

/**
 * Record the spot price, and the normal-pump baseline temperature, for the hour containing
 * `nowMs`. The baseline is the midpoint of the user's comfort band in force for that hour.
 */
export function recordHourPrice(
  settings: SettingsLike,
  nowMs: number,
  price: number,
  baselineC?: number | null
): void {
  if (!Number.isFinite(price)) return;
  const ledger = readLedger(settings);
  const key = String(hourStartMs(nowMs));
  const hour = ledger.hours[key] ?? { run: 0, total: 0 };
  const next: LedgerHour = { ...hour, price };
  if (Number.isFinite(baselineC)) next.baselineC = baselineC as number;
  ledger.hours[key] = next;
  writeLedger(settings, ledger, nowMs);
}

/**
 * Normal-pump heating energy ÷ actual heating energy over the given hours (steady-state
 * degree-hours). 1 when it cannot be computed reliably.
 */
function computeEnergyRatio(hours: LedgerHour[]): number {
  const withTemps = hours.filter(h =>
    (h.tempSamples ?? 0) > 0 && Number.isFinite(h.baselineC));
  if (withTemps.length === 0) return 1;

  let baselineDegreeHours = 0;
  let actualDegreeHours = 0;
  for (const h of withTemps) {
    const measuredIndoor = (h.indoorSum as number) / (h.tempSamples as number);
    const outdoor = (h.outdoorSum as number) / (h.tempSamples as number);
    const baseline = h.baselineC as number;
    // Above the midpoint, only the share the pump itself produced counts: sun on an idle
    // house would have warmed the normal pump's house just the same.
    const duty = h.total > 0 ? h.run / h.total : 0;
    const indoor = measuredIndoor > baseline
      ? baseline + (measuredIndoor - baseline) * duty
      : measuredIndoor;
    baselineDegreeHours += baseline - outdoor;
    actualDegreeHours += indoor - outdoor;
  }

  if (actualDegreeHours / withTemps.length < MIN_MEAN_GRADIENT_C || baselineDegreeHours <= 0) return 1;
  const ratio = baselineDegreeHours / actualDegreeHours;
  return Math.min(ENERGY_RATIO_MAX, Math.max(ENERGY_RATIO_MIN, ratio));
}

/**
 * Price a normal pump pays for heating: each hour weighted by its heat demand
 * (baseline − outdoor)⁺. Null when no hour has temperatures, a baseline and positive demand.
 */
function computeDemandWeightedPrice(hours: LedgerHour[]): number | null {
  let weightSum = 0;
  let weightedPrice = 0;
  for (const h of hours) {
    if (!((h.tempSamples ?? 0) > 0) || !Number.isFinite(h.baselineC) || typeof h.price !== 'number') continue;
    const outdoor = (h.outdoorSum as number) / (h.tempSamples as number);
    const demand = Math.max(0, (h.baselineC as number) - outdoor);
    weightSum += demand;
    weightedPrice += demand * h.price;
  }
  return weightSum > 0 ? weightedPrice / weightSum : null;
}

/**
 * Savings for hours in [fromMs, toMs). `dailyEnergyKWh` is a full day's consumption and
 * `dailyHeatingKWh` its space-heating share; the energy attributed to the window is proportional
 * to the hours actually covered, so a half-elapsed day is not credited with a whole day's energy.
 * Without `dailyHeatingKWh` the energy part is zero (hot-water energy does not depend on the room).
 *
 * Returns null when no hour in the window has both a price and a poll.
 */
export function computeRunPriceSavings(
  ledger: RunPriceLedger,
  fromMs: number,
  toMs: number,
  dailyEnergyKWh: number,
  dailyHeatingKWh?: number
): RunPriceSavings | null {
  const usable = Object.entries(ledger.hours)
    .map(([key, hour]) => ({ start: Number(key), hour }))
    .filter(({ start, hour }) =>
      start >= fromMs && start < toMs &&
      hour.total > 0 &&
      typeof hour.price === 'number' && Number.isFinite(hour.price));

  if (usable.length === 0) return null;

  const averagePrice = usable.reduce((sum, { hour }) => sum + (hour.price as number), 0) / usable.length;

  const dutySum = usable.reduce((sum, { hour }) => sum + hour.run / hour.total, 0);
  const paidPrice = dutySum > 0
    ? usable.reduce((sum, { hour }) => sum + (hour.run / hour.total) * (hour.price as number), 0) / dutySum
    : averagePrice;

  const windowShare = usable.length / 24;
  const energyKWh = Number.isFinite(dailyEnergyKWh) && dailyEnergyKWh > 0
    ? dailyEnergyKWh * windowShare
    : 0;
  const heatingKWh = Number.isFinite(dailyHeatingKWh) && (dailyHeatingKWh as number) > 0
    ? Math.min(energyKWh, (dailyHeatingKWh as number) * windowShare)
    : 0;

  const hours = usable.map(({ hour }) => hour);
  const energyRatio = heatingKWh > 0 ? computeEnergyRatio(hours) : 1;
  const normalPumpHeatingPrice = computeDemandWeightedPrice(hours) ?? averagePrice;
  const otherKWh = energyKWh - heatingKWh;
  const baselineEnergyKWh = otherKWh + heatingKWh * energyRatio;

  const baselineCost = heatingKWh * energyRatio * normalPumpHeatingPrice + otherKWh * averagePrice;
  const actualCost = energyKWh * paidPrice;
  const timingSavings = heatingKWh * (normalPumpHeatingPrice - paidPrice) + otherKWh * (averagePrice - paidPrice);
  const energySavings = heatingKWh * (energyRatio - 1) * normalPumpHeatingPrice;

  return {
    hoursUsed: usable.length,
    averagePrice,
    normalPumpHeatingPrice,
    paidPrice,
    energyKWh,
    energyRatio,
    baselineEnergyKWh,
    baselineCost,
    actualCost,
    timingSavings,
    energySavings,
    savings: baselineCost - actualCost
  };
}

export function readRunPriceLedger(settings: SettingsLike): RunPriceLedger {
  return readLedger(settings);
}
