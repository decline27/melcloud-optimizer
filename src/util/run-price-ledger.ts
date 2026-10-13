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
 * It is deliberately conservative: energy saved by coasting (a lower average room temperature)
 * does not appear, only the retiming of the energy that was used. It can be negative, and is
 * reported as such.
 *
 * Storage is bounded: only the last LEDGER_RETENTION_HOURS hour buckets are kept.
 */

export const RUN_PRICE_LEDGER_SETTING = 'run_price_ledger';
export const LEDGER_RETENTION_HOURS = 48;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

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
  /** Run-weighted mean price: what this pump actually paid. */
  paidPrice: number;
  /** Energy attributed to the hours used, kWh. */
  energyKWh: number;
  /** energyKWh × averagePrice. */
  baselineCost: number;
  /** energyKWh × paidPrice. */
  actualCost: number;
  /** baselineCost − actualCost. Negative when the pump ran in dearer-than-average hours. */
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

/** Record one device poll. */
export function recordRunSample(settings: SettingsLike, nowMs: number, running: boolean): void {
  const ledger = readLedger(settings);
  const key = String(hourStartMs(nowMs));
  const hour = ledger.hours[key] ?? { run: 0, total: 0 };
  ledger.hours[key] = { ...hour, run: hour.run + (running ? 1 : 0), total: hour.total + 1 };
  writeLedger(settings, ledger, nowMs);
}

/** Record the spot price for the hour containing `nowMs`. */
export function recordHourPrice(settings: SettingsLike, nowMs: number, price: number): void {
  if (!Number.isFinite(price)) return;
  const ledger = readLedger(settings);
  const key = String(hourStartMs(nowMs));
  const hour = ledger.hours[key] ?? { run: 0, total: 0 };
  ledger.hours[key] = { ...hour, price };
  writeLedger(settings, ledger, nowMs);
}

/**
 * Savings for hours in [fromMs, toMs). `dailyEnergyKWh` is a full day's consumption; the share
 * attributed to the window is proportional to the hours actually covered, so a half-elapsed day
 * is not credited with a whole day's energy.
 *
 * Returns null when no hour in the window has both a price and a poll.
 */
export function computeRunPriceSavings(
  ledger: RunPriceLedger,
  fromMs: number,
  toMs: number,
  dailyEnergyKWh: number
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

  const energyKWh = Number.isFinite(dailyEnergyKWh) && dailyEnergyKWh > 0
    ? dailyEnergyKWh * (usable.length / 24)
    : 0;

  const baselineCost = energyKWh * averagePrice;
  const actualCost = energyKWh * paidPrice;

  return {
    hoursUsed: usable.length,
    averagePrice,
    paidPrice,
    energyKWh,
    baselineCost,
    actualCost,
    savings: baselineCost - actualCost
  };
}

export function readRunPriceLedger(settings: SettingsLike): RunPriceLedger {
  return readLedger(settings);
}
