export interface HorizonPricePoint {
  time?: string;
  price: number;
  intervalMinutes?: number;
}

export interface PlanningBiasOptions {
  windowHours?: number;
  lookaheadHours?: number;
  cheapPercentile?: number;
  expensivePercentile?: number;
  cheapBiasC?: number;
  expensiveBiasC?: number;
  maxAbsBiasC?: number;
  logger?: (event: string, payload: Record<string, unknown>) => void;
}

export interface PlanningBiasResult {
  biasC: number;
  hasCheap: boolean;
  hasExpensive: boolean;
  windowHours: number;
}

/**
 * Planning Bias Default Constants
 * 
 * These values control how the planning bias system anticipates future
 * price changes and adjusts temperature targets accordingly.
 * 
 * @remarks
 * - DEFAULT_WINDOW_HOURS (6): The immediate planning window. 6 hours provides
 *   enough look-ahead for typical Nordic market price cycles while remaining
 *   responsive to near-term changes. Represents ~25% of a day.
 * 
 * - DEFAULT_LOOKAHEAD_HOURS (12): Extended horizon for trend detection.
 *   12 hours captures day/night transitions and typical price pattern cycles.
 * 
 * - DEFAULT_CHEAP_PERCENTILE (25): Prices in the bottom 25% are considered
 *   cheap. This aligns with typical Nordic spot market distribution where
 *   night hours often fall in this range.
 * 
 * - DEFAULT_EXPENSIVE_PERCENTILE (75): Mirror of cheap threshold. Prices
 *   in the top 25% trigger conservation strategies.
 * 
 * - DEFAULT_CHEAP_BIAS (0.5°C): Temperature increase during cheap periods.
 *   0.5°C is perceptible for thermal storage but within comfort tolerance.
 * 
 * - DEFAULT_EXPENSIVE_BIAS (0.3°C): Temperature decrease during expensive
 *   periods. Smaller than cheap bias to prioritize comfort over savings.
 * 
 * - DEFAULT_MAX_ABS_BIAS (0.7°C): Maximum allowed temperature bias in either
 *   direction. Prevents aggressive swings that could cause discomfort.
 */
const DEFAULT_WINDOW_HOURS = 6;
const DEFAULT_LOOKAHEAD_HOURS = 12;
const DEFAULT_CHEAP_PERCENTILE = 25;
const DEFAULT_EXPENSIVE_PERCENTILE = 75;
const DEFAULT_CHEAP_BIAS = 0.5;
const DEFAULT_EXPENSIVE_BIAS = 0.3;
const DEFAULT_MAX_ABS_BIAS = 0.7;
const DEFAULT_SPIKE_RATIO = 1.25; // >25% above hour average marks intra-hour risk

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
      const intervalMinutes = typeof entry.intervalMinutes === 'number' ? entry.intervalMinutes : NaN;
      return { price, tsMs, intervalMinutes };
    })
    .filter((entry) => Number.isFinite(entry.price) && Number.isFinite(entry.tsMs) && (entry.tsMs as number) > now.getTime())
    .sort((a, b) => (a.tsMs as number) - (b.tsMs as number));

  if (future.length === 0) {
    return { biasC: 0, hasCheap: false, hasExpensive: false, windowHours };
  }

  // Detect if data is sub-hourly (e.g., 15m) to build hourly aggregates with risk flags
  const intervalFromData = future.find((entry) => Number.isFinite(entry.intervalMinutes))?.intervalMinutes;
  const detectedIntervalMinutes = intervalFromData && intervalFromData > 0 ? intervalFromData : detectIntervalMinutes(future);
  const isSubHourly = typeof detectedIntervalMinutes === 'number' && detectedIntervalMinutes > 0 && detectedIntervalMinutes < 60;

  const { hourlyPoints, riskyHours } = isSubHourly
    ? aggregateHourlyWithRisk(future, DEFAULT_SPIKE_RATIO)
    : { hourlyPoints: future.map((entry) => ({ price: entry.price, tsMs: entry.tsMs as number, risky: false })), riskyHours: [] };

  const windowSlice = hourlyPoints.slice(0, windowHours);
  const lookaheadSlice = hourlyPoints.slice(0, lookaheadHours);

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

  // Trajectory awareness: check if prices are trending down in near-term
  // If cheap prices are coming soon (first 3 hours), don't apply negative bias
  const immediateWindow = windowSlice.slice(0, Math.min(3, windowSlice.length));
  const hasCheapImminent = immediateWindow.some((entry) => entry.price < cheapCut);
  const hasExpensiveImminent = immediateWindow.some((entry) => entry.price > expensiveCut);
  
  // Check price gradient: compare first half vs second half of window
  const firstHalf = windowSlice.slice(0, Math.ceil(windowSlice.length / 2));
  const secondHalf = windowSlice.slice(Math.ceil(windowSlice.length / 2));
  const avgFirst = firstHalf.reduce((sum, e) => sum + e.price, 0) / (firstHalf.length || 1);
  const avgSecond = secondHalf.reduce((sum, e) => sum + e.price, 0) / (secondHalf.length || 1);
  const pricesTrendingDown = avgSecond < avgFirst * 0.95; // Prices dropping by >5%
  const negativeBiasAllowed = hasExpensiveImminent && !pricesTrendingDown;

  let bias = 0;
  if (hasCheap) bias += cheapBias;
  
  // Only apply negative bias if expensive prices are IMMINENT (0-3h) 
  // AND prices aren't trending down (cheap coming soon)
  if (negativeBiasAllowed) {
    bias -= expensiveBias;
  }

  const hasRiskyHour = windowSlice.some((entry) => entry.risky);
  if (hasRiskyHour && bias > 0) {
    // Damp positive bias when intra-hour volatility is risky to avoid preheating into spikes
    bias = Math.max(0, bias - cheapBias);
  }
  
  const biasBeforeClamp = bias;
  bias = clamp(bias, -maxAbsBias, maxAbsBias);

  options.logger?.('planning.bias.trend', {
    windowHours,
    lookaheadHours,
    current: windowSlice[0]?.price,
    next3h: immediateWindow.map((entry) => entry.price),
    trend: pricesTrendingDown ? 'down' : 'flat_or_up',
    cheapInWindow: hasCheap,
    cheapImminent: hasCheapImminent,
    expensiveImmediate: hasExpensiveImminent,
    negativeBiasAllowed,
    riskyHours,
    hasRiskyHour,
    biasBeforeClamp,
    biasFinal: bias,
    decision: negativeBiasAllowed
      ? 'Negative bias allowed (expensive imminent, no downward trend)'
      : hasExpensiveImminent
        ? 'No negative bias; prices trending down toward cheaper period'
        : 'No negative bias trigger'
  });

  return {
    biasC: bias,
    hasCheap,
    hasExpensive: hasExpensiveImminent, // Report only imminent expensive
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

interface FutureEntry {
  price: number;
  tsMs: number;
}

interface AggregatedHour {
  price: number;
  tsMs: number;
  risky: boolean;
}

function detectIntervalMinutes(future: Array<FutureEntry & { intervalMinutes?: number | null }>): number | null {
  if (!Array.isArray(future) || future.length < 2) {
    return null;
  }
  for (let i = 1; i < future.length; i += 1) {
    const prev = future[i - 1].tsMs;
    const current = future[i].tsMs;
    if (Number.isFinite(prev) && Number.isFinite(current)) {
      const diffMinutes = Math.round((current - prev) / 60000);
      if (diffMinutes > 0) {
        return diffMinutes;
      }
    }
  }
  return null;
}

function aggregateHourlyWithRisk(
  future: Array<FutureEntry & { tsMs: number }>,
  spikeRatio: number
): { hourlyPoints: AggregatedHour[]; riskyHours: number[] } {
  const buckets = new Map<number, { sum: number; count: number; max: number }>();

  future.forEach((entry) => {
    const date = new Date(entry.tsMs);
    if (!Number.isFinite(date.getTime())) {
      return;
    }
    const hourStart = Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      date.getUTCHours(),
      0,
      0,
      0
    );
    const bucket = buckets.get(hourStart) || { sum: 0, count: 0, max: -Infinity };
    bucket.sum += entry.price;
    bucket.count += 1;
    bucket.max = Math.max(bucket.max, entry.price);
    buckets.set(hourStart, bucket);
  });

  const hourlyPoints: AggregatedHour[] = Array.from(buckets.entries())
    .sort(([a], [b]) => a - b)
    .map(([tsMs, { sum, count, max }]) => {
      const avg = count > 0 ? sum / count : 0;
      const risky = count > 0 && max > avg * spikeRatio;
      return { tsMs, price: avg, risky };
    });

  const riskyHours = hourlyPoints.filter((h) => h.risky).map((h) => h.tsMs);
  return { hourlyPoints, riskyHours };
}
