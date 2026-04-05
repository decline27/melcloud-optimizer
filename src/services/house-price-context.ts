import { AbsolutePriceLevel, HousePriceContext, PricePoint } from '../types';

const ENTSO_E_VERY_CHEAP_RATIO = 0.55;
const ENTSO_E_CHEAP_RATIO = 0.70;
const ENTSO_E_EXPENSIVE_RATIO = 1.30;
const ENTSO_E_VERY_EXPENSIVE_RATIO = 1.45;

const TYPICAL_PREHEAT_DELTA_C = 1.5;
const BREAKEVEN_WINDOW_HOURS = 6;
const EXCELLENT_COP_NORMALIZED = 0.8;

export interface HousePriceContextParams {
  tibberPriceLevel: string | undefined;
  historicalAvgPrice: number | undefined;
  currentPrice: number;
  futurePrices: PricePoint[];
  coolingRate: number;        // °C per hour per °C of (indoor - outdoor) temp diff
  currentTemp: number;
  outdoorTemp: number;
  normalizedCOP: number;      // 0-1 normalized COP
}

export class HousePriceContextResolver {
  resolve(params: HousePriceContextParams): HousePriceContext {
    const absoluteLevel = this.resolveAbsoluteLevel(params);
    const { houseBreakevenSpread, economicSpread } = this.computeEconomics(params);
    const isCheapForThisHouse = this.computeIsCheap(
      absoluteLevel, economicSpread, houseBreakevenSpread, params.normalizedCOP
    );
    return {
      absoluteLevel,
      isCheapForThisHouse,
      houseBreakevenSpread,
      economicSpread,
      priceSource: this.determinePriceSource(params),
    };
  }

  private resolveAbsoluteLevel(params: HousePriceContextParams): AbsolutePriceLevel {
    if (params.tibberPriceLevel) {
      return normalizeProviderLevel(params.tibberPriceLevel);
    }
    if (params.historicalAvgPrice && params.historicalAvgPrice > 0) {
      return deriveFromHistoricalRatio(params.currentPrice, params.historicalAvgPrice);
    }
    return deriveFromLocalPercentile(params.currentPrice, params.futurePrices);
  }

  private computeEconomics(params: HousePriceContextParams): {
    houseBreakevenSpread: number;
    economicSpread: number;
  } {
    const tempDiff = Math.max(params.currentTemp - params.outdoorTemp, 0);
    const heatLossPerHour = params.coolingRate * tempDiff;
    const lostDegrees = heatLossPerHour * BREAKEVEN_WINDOW_HOURS;
    const savedDegrees = Math.min(TYPICAL_PREHEAT_DELTA_C, lostDegrees);
    const savedFraction = savedDegrees / TYPICAL_PREHEAT_DELTA_C;
    const houseBreakevenSpread = savedFraction > 0.05
      ? Math.max(0, (1 / savedFraction) - 1)
      : 1.0;

    const nowMs = Date.now();
    const next6h = params.futurePrices
      .filter(p => {
        const ts = Date.parse(p.time);
        return Number.isFinite(ts) && ts > nowMs;
      })
      .slice(0, 6);
    const avgFuturePrice = next6h.length > 0
      ? next6h.reduce((sum, p) => sum + p.price, 0) / next6h.length
      : params.currentPrice;
    const economicSpread = params.currentPrice > 0
      ? (avgFuturePrice - params.currentPrice) / params.currentPrice
      : 0;

    return { houseBreakevenSpread, economicSpread };
  }

  private computeIsCheap(
    absoluteLevel: AbsolutePriceLevel,
    economicSpread: number,
    houseBreakevenSpread: number,
    normalizedCOP: number
  ): boolean {
    if (absoluteLevel === 'VERY_CHEAP') return true;
    if (absoluteLevel === 'CHEAP') return economicSpread >= houseBreakevenSpread * 0.5;
    if (absoluteLevel === 'NORMAL') {
      return economicSpread >= houseBreakevenSpread * 1.5
        && normalizedCOP >= EXCELLENT_COP_NORMALIZED;
    }
    return false;
  }

  private determinePriceSource(
    params: HousePriceContextParams
  ): HousePriceContext['priceSource'] {
    if (params.tibberPriceLevel) return 'tibber_native';
    if (params.historicalAvgPrice && params.historicalAvgPrice > 0) return 'entsoe_historical';
    return 'local_percentile';
  }
}

function normalizeProviderLevel(level: string): AbsolutePriceLevel {
  const map: Record<string, AbsolutePriceLevel> = {
    VERY_CHEAP: 'VERY_CHEAP',
    VERYCHEAP: 'VERY_CHEAP',
    CHEAP: 'CHEAP',
    NORMAL: 'NORMAL',
    EXPENSIVE: 'EXPENSIVE',
    VERY_EXPENSIVE: 'VERY_EXPENSIVE',
    VERYEXPENSIVE: 'VERY_EXPENSIVE',
  };
  return map[level.toUpperCase()] ?? 'NORMAL';
}

function deriveFromHistoricalRatio(
  currentPrice: number,
  historicalAvg: number
): AbsolutePriceLevel {
  const ratio = currentPrice / historicalAvg;
  if (ratio < ENTSO_E_VERY_CHEAP_RATIO) return 'VERY_CHEAP';
  if (ratio < ENTSO_E_CHEAP_RATIO) return 'CHEAP';
  if (ratio <= ENTSO_E_EXPENSIVE_RATIO) return 'NORMAL';
  if (ratio <= ENTSO_E_VERY_EXPENSIVE_RATIO) return 'EXPENSIVE';
  return 'VERY_EXPENSIVE';
}

function deriveFromLocalPercentile(
  currentPrice: number,
  prices: PricePoint[]
): AbsolutePriceLevel {
  if (prices.length === 0) return 'NORMAL';
  const percentile = prices.filter(p => p.price <= currentPrice).length / prices.length;
  if (percentile <= 0.10) return 'VERY_CHEAP';
  if (percentile <= 0.30) return 'CHEAP';
  if (percentile <= 0.70) return 'NORMAL';
  if (percentile <= 0.90) return 'EXPENSIVE';
  return 'VERY_EXPENSIVE';
}
