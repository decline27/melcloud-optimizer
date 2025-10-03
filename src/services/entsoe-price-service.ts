import moment from 'moment-timezone';
import { fetchPrices } from '../entsoe';
import { PricePoint, PriceProvider, TibberPriceInfo } from '../types';
import FxRateService from './fx-rate-service';

type HomeyLike = {
  settings: {
    get(key: string): any;
    set?(key: string, value: any): void | Promise<void>;
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

  private readonly fxRateService: FxRateService;

  constructor(private readonly homey: HomeyLike, options?: { cacheTtlMinutes?: number }) {
    const ttlMinutes = options?.cacheTtlMinutes ?? 5;
    this.cacheTtlMs = Math.max(1, ttlMinutes) * 60 * 1000;
    this.fxRateService = new FxRateService(homey);
  }

  private getLocalCurrency(): string {
    try {
      const code = this.homey.settings.get('currency_code') || this.homey.settings.get('currency');
      if (typeof code === 'string' && code.trim()) {
        return code.trim().toUpperCase();
      }
    } catch (_error) {
      // Ignore setting lookup errors and fall back to EUR
    }
    return 'EUR';
  }

  private getNumericSetting(key: string): number | null {
    try {
      const raw = this.homey.settings.get(key);
      if (raw == null) return null;
      const value = typeof raw === 'number' ? raw : Number(raw);
      return Number.isFinite(value) && value > 0 ? value : null;
    } catch (_error) {
      return null;
    }
  }

  private getStoredFxRate(currency: string): number | null {
    if (!currency || currency === 'EUR') {
      return 1;
    }

    const specificKey = `fx_rate_eur_to_${currency.toLowerCase()}`;
    const specific = this.getNumericSetting(specificKey);
    if (specific) {
      return specific;
    }

    const generic = this.getNumericSetting('fx_rate_eur_to_currency');
    if (generic) {
      return generic;
    }

    // Legacy support for SEK-specific rate
    if (currency === 'SEK') {
      const legacy = this.getNumericSetting('fx_rate_eur_to_sek');
      if (legacy) {
        return legacy;
      }
    }

    return null;
  }

  private async persistFxRate(currency: string, rate: number): Promise<void> {
    const upper = currency.toUpperCase();
    const entries: Array<[string, number]> = [
      ['fx_rate_eur_to_currency', rate],
      [`fx_rate_eur_to_${upper.toLowerCase()}`, rate]
    ];

    if (upper === 'SEK') {
      entries.push(['fx_rate_eur_to_sek', rate]);
    }

    for (const [key, value] of entries) {
      if (typeof this.homey.settings.set !== 'function') {
        continue;
      }
      try {
        const result = this.homey.settings.set(key, value);
        if (result instanceof Promise) {
          await result;
        }
      } catch (error) {
        this.homey.app?.warn?.(`Failed to store FX rate setting ${key}`, error);
      }
    }
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

    const pricesEur: PricePoint[] = entsoePoints
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

    if (pricesEur.length === 0) {
      throw new Error('ENTSO-E response returned no usable price data.');
    }

    const currencyCode = this.getLocalCurrency();
    const targetIsEur = currencyCode === 'EUR';
    let fxRate = targetIsEur ? 1 : this.getStoredFxRate(currencyCode) ?? 0;
    let fxSource = targetIsEur ? 'EUR' : 'manual';

    if (!targetIsEur) {
      const fxResult = await this.fxRateService.getRate(currencyCode);
      if (fxResult.rate && fxResult.rate > 0) {
        fxRate = fxResult.rate;
        fxSource = fxResult.source ?? 'auto';
        await this.persistFxRate(currencyCode, fxRate);
      } else if (!fxRate || fxRate <= 0) {
        fxRate = 1;
        fxSource = 'fallback';
        this.homey.app?.warn?.(
          `Using EUR prices because no valid exchange rate for ${currencyCode} was retrieved.`
        );
      }
    }

    const convert = !targetIsEur && Number.isFinite(fxRate) && fxRate > 0;
    if (!targetIsEur && !convert) {
      this.homey.app?.warn?.(`Currency conversion to ${currencyCode} failed; using EUR prices instead.`);
    }

    const appliedCurrency = convert ? currencyCode : 'EUR';

    const convertPrice = (value: number): number => {
      if (!convert) {
        return value;
      }
      const converted = value * (fxRate as number);
      // Clamp to reasonable precision to avoid floating noise
      return Number.isFinite(converted) ? Number(converted.toFixed(6)) : value;
    };

    const prices: PricePoint[] = pricesEur.map((entry) => ({
      time: entry.time,
      price: convertPrice(entry.price)
    }));

    const current = this.pickCurrentPrice(prices, nowCet.toDate());
    const priceInfo: TibberPriceInfo = {
      current: {
        time: current.time,
        price: current.price
      },
      prices,
      intervalMinutes: 60,
      currencyCode: appliedCurrency,
      baseCurrency: 'EUR'
    };

    this.cache = {
      data: priceInfo,
      expiresAt: nowMs + this.cacheTtlMs
    };

    if (this.homey.app?.log) {
      this.homey.app.log(
        `[ENTSO-E] Loaded ${prices.length} hourly prices, current ${current.price.toFixed(4)} ${appliedCurrency}/kWh`
      );
      if (convert) {
        this.homey.app.log(
          `ENTSO-E price conversion applied using EUR -> ${currencyCode} rate ${(fxRate as number).toFixed(6)} (${fxSource})`
        );
      }
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
