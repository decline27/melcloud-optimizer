import moment from 'moment-timezone';
import { fetchPrices } from '../entsoe';
import { PricePoint, PriceProvider, TibberPriceInfo } from '../types';

type HomeyLike = {
  settings: {
    get(key: string): any;
  };
  app?: {
    log(message: string, ...args: any[]): void;
    warn?(message: string, ...args: any[]): void;
    error?(message: string, ...args: any[]): void;
  };
};

interface CacheEntry {
  expiresAt: number;
  data: TibberPriceInfo;
}

export class EntsoePriceService implements PriceProvider {
  private cache: CacheEntry | null = null;

  private readonly cacheTtlMs: number;

  constructor(private readonly homey: HomeyLike, options?: { cacheTtlMinutes?: number }) {
    const ttlMinutes = options?.cacheTtlMinutes ?? 5;
    this.cacheTtlMs = Math.max(1, ttlMinutes) * 60 * 1000;
  }

  updateTimeZoneSettings(): void {
    // ENTSO-E timestamps are UTC-based; nothing to adjust for local offsets.
  }

  cleanup(): void {
    this.cache = null;
  }

  async getPrices(): Promise<TibberPriceInfo> {
    const nowMs = Date.now();
    if (this.cache && this.cache.expiresAt > nowMs) {
      return this.cache.data;
    }

    const nowCet = moment.tz('Europe/Brussels');
    const startCet = nowCet.clone().startOf('day');
    const endCet = startCet.clone().add(48, 'hours');
    const startUtc = startCet.clone().utc().toISOString();
    const endUtc = endCet.clone().utc().toISOString();

    const zoneInput = this.homey.settings.get('entsoe_area_eic');
    const entsoePoints = await fetchPrices(
      this.homey as any,
      typeof zoneInput === 'string' && zoneInput.trim().length > 0 ? zoneInput : undefined,
      startUtc,
      endUtc
    );

    const prices: PricePoint[] = entsoePoints
      .map((point) => {
        const price = Number.isFinite(point.price_eur_per_kwh)
          ? Number(point.price_eur_per_kwh)
          : Number.isFinite(point.price_eur_per_mwh)
            ? Number(point.price_eur_per_mwh) / 1000
            : NaN;
        return {
          time: point.ts_iso_utc,
          price
        };
      })
      .filter((entry) => Number.isFinite(entry.price));

    if (prices.length === 0) {
      throw new Error('ENTSO-E response returned no usable price data.');
    }

    const current = this.pickCurrentPrice(prices, nowCet.toDate());
    const priceInfo: TibberPriceInfo = {
      current: {
        time: current.time,
        price: current.price
      },
      prices,
      intervalMinutes: 60
    };

    this.cache = {
      data: priceInfo,
      expiresAt: nowMs + this.cacheTtlMs
    };

    if (this.homey.app?.log) {
      this.homey.app.log(
        `[ENTSO-E] Loaded ${prices.length} hourly prices, current ${current.price.toFixed(4)} EUR/kWh`
      );
    }

    return priceInfo;
  }

  private pickCurrentPrice(prices: PricePoint[], now: Date): PricePoint {
    const nowMs = now.getTime();
    for (let i = 0; i < prices.length; i += 1) {
      const startMs = new Date(prices[i].time).getTime();
      if (!Number.isFinite(startMs)) {
        continue;
      }
      const endMs = i + 1 < prices.length
        ? new Date(prices[i + 1].time).getTime()
        : startMs + 60 * 60 * 1000;
      if (!Number.isFinite(endMs)) {
        continue;
      }
      if (startMs <= nowMs && nowMs < endMs) {
        return prices[i];
      }
    }
    return prices[prices.length - 1];
  }
}
