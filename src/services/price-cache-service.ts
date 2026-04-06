import type { PriceProvider, TibberPriceInfo } from '../types';

interface TibberPriceCache {
  data: TibberPriceInfo;
  fetchedAt: string;
  hasTomorrow: boolean;
}

interface CacheSettings {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

interface CacheLogger {
  log(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}

const TOMORROW_PRICES_AVAILABLE_HOUR = 13;
const TOMORROW_PRICES_AVAILABLE_MINUTE = 30;

export class PriceCacheService implements PriceProvider {
  private cached: TibberPriceCache | null = null;
  private readonly settingsKey: string;

  constructor(
    private readonly provider: PriceProvider,
    private readonly settings: CacheSettings,
    private readonly logger: CacheLogger,
    homeId?: string
  ) {
    this.settingsKey = `tibber_price_cache_${homeId ?? 'default'}`;
    this.loadFromSettings();
  }

  private loadFromSettings(): void {
    try {
      const stored = this.settings.get(this.settingsKey);
      if (stored && typeof stored === 'object' &&
          'data' in (stored as object) && 'fetchedAt' in (stored as object)) {
        this.cached = stored as TibberPriceCache;
        this.cached.hasTomorrow ??= false;
        this.logger.log(`PriceCacheService: loaded cached prices from settings (fetchedAt: ${this.cached.fetchedAt})`);
      }
    } catch (err) {
      this.logger.error('PriceCacheService: failed to load cache from settings', err);
    }
  }

  private saveToSettings(cache: TibberPriceCache): void {
    try {
      this.settings.set(this.settingsKey, cache);
    } catch (err) {
      this.logger.error('PriceCacheService: failed to save cache to settings', err);
    }
  }

  private isToday(fetchedAt: string): boolean {
    const fetchDate = new Date(fetchedAt);
    const now = new Date();
    return fetchDate.toDateString() === now.toDateString();
  }

  private isPastTomorrowThreshold(): boolean {
    const now = new Date();
    const h = now.getHours();
    const m = now.getMinutes();
    return h > TOMORROW_PRICES_AVAILABLE_HOUR ||
      (h === TOMORROW_PRICES_AVAILABLE_HOUR && m >= TOMORROW_PRICES_AVAILABLE_MINUTE);
  }

  private isCacheValid(): boolean {
    if (!this.cached) return false;
    if (!this.isToday(this.cached.fetchedAt)) return false;
    if (this.isPastTomorrowThreshold() && !this.cached.hasTomorrow) return false;
    return true;
  }

  private hasTomorrowPrices(data: TibberPriceInfo): boolean {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const tomorrowMs = tomorrow.getTime();
    const allPrices = [...(data.prices ?? []), ...(data.quarterHourly ?? [])];
    return allPrices.some(p => {
      const ts = Date.parse(p.time);
      return Number.isFinite(ts) && ts >= tomorrowMs;
    });
  }

  async getPrices(): Promise<TibberPriceInfo> {
    if (this.isCacheValid()) {
      this.logger.log(`PriceCacheService: returning cached prices (fetchedAt: ${this.cached!.fetchedAt})`);
      return this.cached!.data;
    }

    try {
      const data = await this.provider.getPrices();
      const cache: TibberPriceCache = {
        data,
        fetchedAt: new Date().toISOString(),
        hasTomorrow: this.hasTomorrowPrices(data)
      };
      this.cached = cache;
      this.saveToSettings(cache);
      this.logger.log(`PriceCacheService: fetched fresh prices, hasTomorrow=${cache.hasTomorrow}`);
      return data;
    } catch (err) {
      if (this.cached) {
        const staleness = this.isToday(this.cached.fetchedAt) ? 'today' : 'yesterday';
        this.logger.warn(`PriceCacheService: Tibber API failed, using cached prices from ${staleness} (fetchedAt: ${this.cached.fetchedAt})`);
        return this.cached.data;
      }
      throw err;
    }
  }

  updateTimeZoneSettings(offsetHours: number, useDst: boolean, timeZoneName?: string): void {
    this.provider.updateTimeZoneSettings?.(offsetHours, useDst, timeZoneName);
  }

  cleanup(): void {
    this.provider.cleanup?.();
  }
}
