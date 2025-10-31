export type PriceLevel =
  | 'VERY_CHEAP'
  | 'CHEAP'
  | 'NORMAL'
  | 'EXPENSIVE'
  | 'VERY_EXPENSIVE';

export interface PricePointLike {
  time?: string;
  price?: number;
  value?: number;
}

export interface PriceClassificationOptions {
  /**
   * Cheap percentile threshold. Accepts 0–100 or 0–1 ranges. Defaults to 25%.
   */
  cheapPercentile?: number;
  /**
   * Multiplier applied to cheap percentile to derive very-cheap threshold.
   * Defaults to 0.4 (e.g. 25% * 0.4 = 10%).
   */
  veryCheapMultiplier?: number;
  /**
   * Expensive percentile. Defaults to symmetrical mirror of cheap percentile (100 - cheap).
   */
  expensivePercentile?: number;
  /**
   * Very expensive percentile. Defaults to mirror of very cheap (100 - veryCheap).
   */
  veryExpensivePercentile?: number;
  /**
   * Optional selector for extracting numeric value from a price point.
   */
  valueSelector?: (point: PricePointLike) => number;
}

export interface PriceThresholds {
  veryCheap: number;
  cheap: number;
  expensive: number;
  veryExpensive: number;
}

export interface PriceClassificationStats {
  label: PriceLevel;
  percentile: number;
  normalized: number;
  min: number;
  max: number;
  avg: number;
  thresholds: PriceThresholds;
}

const DEFAULT_CHEAP_PERCENTILE = 25;
const DEFAULT_VERY_CHEAP_MULTIPLIER = 0.4;

function normalizePercentileInput(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  if (value <= 1 && value >= 0) {
    return Math.min(Math.max(value * 100, 0), 100);
  }
  return Math.min(Math.max(value, 0), 100);
}

export function normalizeMultiplier(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(Math.max(value, 0), 1);
}

function getNumericValue(point: PricePointLike, selector?: (point: PricePointLike) => number): number {
  if (typeof selector === 'function') {
    return selector(point);
  }

  const price = point?.price;
  if (typeof price === 'number' && Number.isFinite(price)) {
    return price;
  }

  const value = point?.value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  return NaN;
}

export function resolvePriceThresholds(options?: PriceClassificationOptions): PriceThresholds {
  const cheapPercentile = normalizePercentileInput(options?.cheapPercentile, DEFAULT_CHEAP_PERCENTILE);
  const veryCheapMultiplier = normalizeMultiplier(options?.veryCheapMultiplier, DEFAULT_VERY_CHEAP_MULTIPLIER);
  const veryCheapThreshold = normalizePercentileInput(
    options?.veryCheapMultiplier != null ? cheapPercentile * veryCheapMultiplier : undefined,
    cheapPercentile * veryCheapMultiplier
  );
  const expensiveThreshold = normalizePercentileInput(
    options?.expensivePercentile,
    100 - cheapPercentile
  );
  const veryExpensiveThreshold = normalizePercentileInput(
    options?.veryExpensivePercentile,
    100 - veryCheapThreshold
  );

  return {
    veryCheap: veryCheapThreshold,
    cheap: cheapPercentile,
    expensive: expensiveThreshold,
    veryExpensive: veryExpensiveThreshold
  };
}

export function classifyPriceUnified(
  prices: PricePointLike[] | undefined,
  currentPriceInput: number,
  options?: PriceClassificationOptions
): PriceClassificationStats {
  const safeCurrent = Number.isFinite(currentPriceInput) ? currentPriceInput : 0;

  const numericValues = Array.isArray(prices)
    ? prices
        .map(point => getNumericValue(point, options?.valueSelector))
        .filter((value): value is number => Number.isFinite(value))
    : [];

  if (numericValues.length === 0) {
    const defaultMinMax = Number.isFinite(safeCurrent) ? safeCurrent : 0;
    return {
      label: 'NORMAL',
      percentile: 50,
      normalized: 0.5,
      min: defaultMinMax,
      max: defaultMinMax,
      avg: defaultMinMax,
      thresholds: {
        veryCheap: 10,
        cheap: DEFAULT_CHEAP_PERCENTILE,
        expensive: 100 - DEFAULT_CHEAP_PERCENTILE,
        veryExpensive: 90
      }
    };
  }

  const sortedValues = [...numericValues].sort((a, b) => a - b);
  const min = sortedValues[0];
  const max = sortedValues[sortedValues.length - 1];
  const avg = sortedValues.reduce((sum, value) => sum + value, 0) / sortedValues.length;

  const thresholds = resolvePriceThresholds(options);

  const lessOrEqualCount = sortedValues.filter(value => value <= safeCurrent).length;
  const percentile = (lessOrEqualCount / sortedValues.length) * 100;

  const range = max - min;
  const normalized = range <= 1e-9
    ? 0.5
    : Math.min(Math.max((safeCurrent - min) / range, 0), 1);

  let label: PriceLevel = 'NORMAL';
  if (percentile <= thresholds.veryCheap) {
    label = 'VERY_CHEAP';
  } else if (percentile <= thresholds.cheap) {
    label = 'CHEAP';
  } else if (percentile >= thresholds.veryExpensive) {
    label = 'VERY_EXPENSIVE';
  } else if (percentile >= thresholds.expensive) {
    label = 'EXPENSIVE';
  }

  return {
    label,
    percentile,
    normalized,
    min,
    max,
    avg,
    thresholds
  };
}
