import moment from 'moment-timezone';
import { countryForZone, fetchPrices } from '../entsoe';
import { PricePoint, PriceProvider, TibberPriceInfo } from '../types';
import FxRateService from './fx-rate-service';
import { CurrencyDetector } from '../util/currency-detector';
import { DEFAULT_CONSUMER_MARKUP, isBuiltInMarkupTable } from './consumer-markup-defaults';

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
  i18n?: {
    getCurrency?(): string;
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
    // Same chain as the rest of the app: the user's currency, else the home country's.
    return CurrencyDetector.getCurrencyWithFallback(this.homey as any);
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

  updateTimeZoneSettings(offsetHours?: number, useDst?: boolean, timeZoneName?: string): void {
    // ENTSO-E timestamps are UTC-based; nothing to adjust for local offsets.
    // Parameters are ignored for compatibility with the interface
  }

  cleanup(): void {
    this.cache = null;
  }

  private getCountryFromEic(): string {
    const eic = this.homey.settings.get('entsoe_area_eic');
    if (typeof eic !== 'string' || !eic.trim()) {
      return 'default';
    }

    const mapped = countryForZone(this.homey, eic);
    if (mapped) return mapped;

    // Try to extract country from common EIC patterns or area codes
    const trimmed = eic.trim().toUpperCase();
    
    // Handle common ISO codes
    if (/^SE[1-4]?$/.test(trimmed)) return 'SE';
    if (/^NO[1-5]?$/.test(trimmed)) return 'NO';
    if (/^DK[1-2]?$/.test(trimmed)) return 'DK';
    if (/^DE$/.test(trimmed)) return 'DE';
    if (/^FR$/.test(trimmed)) return 'FR';
    if (/^AT$/.test(trimmed)) return 'AT';
    if (/^NL$/.test(trimmed)) return 'NL';
    if (/^BE$/.test(trimmed)) return 'BE';
    
    // Handle EIC codes - extract country from EIC pattern
    if (/^10Y[A-Z]{2}/.test(trimmed)) {
      const countryMatch = trimmed.match(/^10Y([A-Z]{2})/);
      if (countryMatch) return countryMatch[1];
    }
    
    return 'default';
  }

  /**
   * The user's own markup table, or null when the built-in one applies (nothing stored, a copy of
   * the built-in table saved by an older settings page, or unreadable JSON).
   */
  private parseConsumerMarkupConfig(): Record<string, any> | null {
    try {
      const configRaw = this.homey.settings.get('consumer_markup_config');
      if (typeof configRaw === 'string' && configRaw.trim()) {
        const parsed = JSON.parse(configRaw.trim());
        return parsed && typeof parsed === 'object' && !isBuiltInMarkupTable(parsed) ? parsed : null;
      }
    } catch (error) {
      this.homey.app?.warn?.('Failed to parse consumer markup configuration, using defaults', error);
    }
    return null;
  }

  /**
   * Adds grid fee, energy tax, retail markup and VAT to a wholesale price. On unless the user
   * turned it off, so ENTSO-E prices are close to what the household pays.
   * @param eurToTarget the EUR rate the wholesale prices were converted with (1 for EUR)
   */
  private applyConsumerMarkup(wholesalePrice: number, country: string, eurToTarget: number): number {
    if (this.homey.settings.get('enable_consumer_markup') === false) {
      return wholesalePrice;
    }

    const customConfig = this.parseConsumerMarkupConfig();
    const config: Record<string, any> = customConfig ?? DEFAULT_CONSUMER_MARKUP;
    const countryConfig = config[country] || config['default'] || {};

    const gridFee = Number(countryConfig.gridFee) || 0;
    const energyTax = Number(countryConfig.energyTax) || 0;
    const retailMarkup = Number(countryConfig.retailMarkup) || 0;
    const vatRate = Number(countryConfig.vatRate) || 1.0;

    // The built-in table is in EUR. A custom table is in the currency the user chose
    // (LOCAL = the price currency, unless set).
    const markupCurrency = customConfig ? (this.homey.settings.get('markup_currency_unit') || 'LOCAL') : 'EUR';
    const markupMultiplier = markupCurrency === 'EUR' && Number.isFinite(eurToTarget) && eurToTarget > 0
      ? eurToTarget
      : 1.0;

    // The user's own grid fee, as on their bill (price currency, VAT included), replaces the
    // table's typical one.
    const userGridFee = this.homey.settings.get('grid_fee_per_kwh');
    const hasUserGridFee = typeof userGridFee === 'number' && Number.isFinite(userGridFee) && userGridFee > 0;

    const adjustedGridFee = hasUserGridFee ? 0 : gridFee * markupMultiplier;
    const adjustedEnergyTax = energyTax * markupMultiplier;
    const adjustedRetailMarkup = retailMarkup * markupMultiplier;

    const preTaxPrice = wholesalePrice + adjustedGridFee + adjustedEnergyTax + adjustedRetailMarkup;
    const finalPrice = preTaxPrice * vatRate + (hasUserGridFee ? userGridFee : 0);

    return Number.isFinite(finalPrice) ? Number(finalPrice.toFixed(6)) : wholesalePrice;
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

    const country = this.getCountryFromEic();
    
    const convertPrice = (value: number): number => {
      // First apply currency conversion if needed
      let convertedPrice = value;
      if (convert) {
        convertedPrice = value * (fxRate as number);
      }
      
      // Then apply consumer markup
      const finalPrice = this.applyConsumerMarkup(convertedPrice, country, convert ? (fxRate as number) : 1);
      
      // Clamp to reasonable precision to avoid floating noise
      return Number.isFinite(finalPrice) ? Number(finalPrice.toFixed(6)) : value;
    };

    const prices: PricePoint[] = pricesEur.map((entry) => ({
      time: entry.time,
      price: convertPrice(entry.price)
    }));

    const intervalMinutes = this.detectIntervalMinutes(prices) ?? undefined;
    const quarterHourlyPrices = intervalMinutes && intervalMinutes <= 30 ? prices : [];
    const hourlyPrices = intervalMinutes && intervalMinutes <= 30
      ? this.aggregateToHourly(prices)
      : prices;

    const current = this.pickCurrentPrice(quarterHourlyPrices.length > 0 ? quarterHourlyPrices : hourlyPrices, nowCet.toDate());
    const priceInfo: TibberPriceInfo = {
      current: {
        time: current.time,
        price: current.price
      },
      prices: hourlyPrices,
      quarterHourly: quarterHourlyPrices.length > 0 ? quarterHourlyPrices : undefined,
      intervalMinutes: intervalMinutes ?? 60,
      currencyCode: appliedCurrency,
      baseCurrency: 'EUR'
    };

    this.cache = {
      data: priceInfo,
      expiresAt: nowMs + this.cacheTtlMs
    };

    if (this.homey.app?.log) {
      const enableMarkup = this.homey.settings.get('enable_consumer_markup') !== false;
      this.homey.app.log(
        `[ENTSO-E] Loaded prices: hourly=${hourlyPrices.length}, quarterHourly=${quarterHourlyPrices.length}, current ${current.price.toFixed(4)} ${appliedCurrency}/kWh${enableMarkup ? ' (with consumer markup)' : ' (wholesale)'}`
      );
      if (convert) {
        this.homey.app.log(
          `ENTSO-E price conversion applied using EUR -> ${currencyCode} rate ${(fxRate as number).toFixed(6)} (${fxSource})`
        );
      }
      if (enableMarkup) {
        this.homey.app.log(
          `ENTSO-E consumer markup applied for country: ${country}`
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

  private detectIntervalMinutes(prices: PricePoint[]): number | null {
    if (!Array.isArray(prices) || prices.length < 2) {
      return null;
    }

    for (let i = 1; i < prices.length; i += 1) {
      const prev = new Date(prices[i - 1].time).getTime();
      const current = new Date(prices[i].time).getTime();
      if (Number.isFinite(prev) && Number.isFinite(current)) {
        const diffMinutes = Math.round((current - prev) / 60000);
        if (diffMinutes > 0) {
          return diffMinutes;
        }
      }
    }

    return null;
  }

  private aggregateToHourly(prices: PricePoint[]): PricePoint[] {
    if (!Array.isArray(prices) || prices.length === 0) {
      return [];
    }

    const buckets = new Map<string, { sum: number; count: number }>();

    prices.forEach(({ time, price }) => {
      const date = new Date(time);
      if (!Number.isFinite(date.getTime())) {
        return;
      }

      const utcYear = date.getUTCFullYear();
      const utcMonth = date.getUTCMonth();
      const utcDate = date.getUTCDate();
      const utcHour = date.getUTCHours();
      const bucketDate = new Date(Date.UTC(utcYear, utcMonth, utcDate, utcHour, 0, 0, 0));
      const bucketKey = bucketDate.toISOString();

      const bucket = buckets.get(bucketKey) || { sum: 0, count: 0 };
      bucket.sum += price;
      bucket.count += 1;
      buckets.set(bucketKey, bucket);
    });

    return Array.from(buckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([timeKey, { sum, count }]) => ({
        time: timeKey,
        price: count > 0 ? sum / count : 0,
      }));
  }
}
