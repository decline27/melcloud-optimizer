export interface HorizonPricePoint {
  time?: string;
  price: number;
}

export interface PlanningBiasOptions {
  windowHours?: number;
  lookaheadHours?: number;
  cheapPercentile?: number;
  expensivePercentile?: number;
  cheapBiasC?: number;
  expensiveBiasC?: number;
  maxAbsBiasC?: number;
}

export interface PlanningBiasResult {
  biasC: number;
  hasCheap: boolean;
  hasExpensive: boolean;
  windowHours: number;
}

const DEFAULT_WINDOW_HOURS = 6;
const DEFAULT_LOOKAHEAD_HOURS = 12;
const DEFAULT_CHEAP_PERCENTILE = 25;
const DEFAULT_EXPENSIVE_PERCENTILE = 75;
const DEFAULT_CHEAP_BIAS = 0.5;
const DEFAULT_EXPENSIVE_BIAS = 0.3;
const DEFAULT_MAX_ABS_BIAS = 0.7;

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) {
    return NaN;
  }
  if (sorted.length === 1) {
    return sorted[0];
  }
  const idx = clamp(Math.round(fraction * (sorted.length - 1)), 0, sorted.length - 1);
  return sorted[idx];
}

export function computePlanningBias(
  prices: HorizonPricePoint[] | undefined,
  now: Date,
  options: PlanningBiasOptions = {}
): PlanningBiasResult {
  const windowHours = options.windowHours ?? DEFAULT_WINDOW_HOURS;
  const lookaheadHours = options.lookaheadHours ?? DEFAULT_LOOKAHEAD_HOURS;
  const cheapPercentile = options.cheapPercentile ?? DEFAULT_CHEAP_PERCENTILE;
  const expensivePercentile = options.expensivePercentile ?? DEFAULT_EXPENSIVE_PERCENTILE;
  const cheapBias = options.cheapBiasC ?? DEFAULT_CHEAP_BIAS;
  const expensiveBias = options.expensiveBiasC ?? DEFAULT_EXPENSIVE_BIAS;
  const maxAbsBias = options.maxAbsBiasC ?? DEFAULT_MAX_ABS_BIAS;

  if (!Array.isArray(prices) || prices.length === 0) {
    return { biasC: 0, hasCheap: false, hasExpensive: false, windowHours };
  }

  const future = prices
    .map((entry) => {
      const price = typeof entry.price === 'number' ? entry.price : Number(entry.price);
      const ts = entry.time ? new Date(entry.time) : null;
      const tsMs = ts && Number.isFinite(ts.getTime()) ? ts.getTime() : NaN;
      return { price, tsMs };
    })
    .filter((entry) => Number.isFinite(entry.price) && Number.isFinite(entry.tsMs) && (entry.tsMs as number) > now.getTime())
    .sort((a, b) => (a.tsMs as number) - (b.tsMs as number));

  if (future.length === 0) {
    return { biasC: 0, hasCheap: false, hasExpensive: false, windowHours };
  }

  const windowSlice = future.slice(0, windowHours);
  const lookaheadSlice = future.slice(0, lookaheadHours);

  if (windowSlice.length === 0 || lookaheadSlice.length === 0) {
    return { biasC: 0, hasCheap: false, hasExpensive: false, windowHours };
  }

  const sortedPrices = lookaheadSlice
    .map((entry) => entry.price)
    .sort((a, b) => a - b);

  if (sortedPrices.length === 0) {
    return { biasC: 0, hasCheap: false, hasExpensive: false, windowHours };
  }

  const cheapCut = percentile(sortedPrices, cheapPercentile / 100);
  const expensiveCut = percentile(sortedPrices, expensivePercentile / 100);

  if (!Number.isFinite(cheapCut) || !Number.isFinite(expensiveCut)) {
    return { biasC: 0, hasCheap: false, hasExpensive: false, windowHours };
  }

  const hasCheap = windowSlice.some((entry) => entry.price < cheapCut);
  const hasExpensive = windowSlice.some((entry) => entry.price > expensiveCut);

  let bias = 0;
  if (hasCheap) bias += cheapBias;
  if (hasExpensive) bias -= expensiveBias;
  bias = clamp(bias, -maxAbsBias, maxAbsBias);

  return {
    biasC: bias,
    hasCheap,
    hasExpensive,
    windowHours
  };
}

export interface ThermalResponseOptions {
  alpha?: number;
  min?: number;
  max?: number;
}

export function updateThermalResponse(
  previous: number,
  observedDelta: number,
  expectedDelta: number,
  options: ThermalResponseOptions = {}
): number {
  const alpha = options.alpha ?? 0.1;
  const min = options.min ?? 0.5;
  const max = options.max ?? 1.5;

  const adjustment = alpha * (observedDelta - expectedDelta);
  const updated = previous + adjustment;
  return clamp(updated, min, max);
}
