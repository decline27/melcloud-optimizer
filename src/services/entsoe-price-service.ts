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

  private parseConsumerMarkupConfig(): Record<string, any> {
    try {
      const configRaw = this.homey.settings.get('consumer_markup_config');
      if (typeof configRaw === 'string' && configRaw.trim()) {
        return JSON.parse(configRaw.trim());
      }
    } catch (error) {
      this.homey.app?.warn?.('Failed to parse consumer markup configuration, using defaults', error);
    }
    
    // Default configuration with major European markets
    return {
      SE: { gridFee: 0.030, energyTax: 0.036, retailMarkup: 0.010, vatRate: 1.25 },
      DE: { gridFee: 0.070, energyTax: 0.025, retailMarkup: 0.015, vatRate: 1.19 },
      NO: { gridFee: 0.035, energyTax: 0.017, retailMarkup: 0.008, vatRate: 1.25 },
      DK: { gridFee: 0.045, energyTax: 0.089, retailMarkup: 0.012, vatRate: 1.25 },
      FR: { gridFee: 0.045, energyTax: 0.022, retailMarkup: 0.012, vatRate: 1.20 },
      NL: { gridFee: 0.055, energyTax: 0.030, retailMarkup: 0.018, vatRate: 1.21 },
      BE: { gridFee: 0.048, energyTax: 0.028, retailMarkup: 0.015, vatRate: 1.21 },
      AT: { gridFee: 0.038, energyTax: 0.015, retailMarkup: 0.012, vatRate: 1.20 },
      CH: { gridFee: 0.065, energyTax: 0.023, retailMarkup: 0.020, vatRate: 1.077 },
      FI: { gridFee: 0.042, energyTax: 0.027, retailMarkup: 0.015, vatRate: 1.24 },
      PL: { gridFee: 0.025, energyTax: 0.012, retailMarkup: 0.008, vatRate: 1.23 },
      CZ: { gridFee: 0.030, energyTax: 0.018, retailMarkup: 0.010, vatRate: 1.21 },
      IT: { gridFee: 0.055, energyTax: 0.035, retailMarkup: 0.018, vatRate: 1.22 },
      ES: { gridFee: 0.045, energyTax: 0.051, retailMarkup: 0.015, vatRate: 1.21 },
      PT: { gridFee: 0.042, energyTax: 0.034, retailMarkup: 0.013, vatRate: 1.23 },
      GB: { gridFee: 0.050, energyTax: 0.006, retailMarkup: 0.020, vatRate: 1.05 },
      EE: { gridFee: 0.035, energyTax: 0.007, retailMarkup: 0.012, vatRate: 1.20 },
      LV: { gridFee: 0.038, energyTax: 0.009, retailMarkup: 0.014, vatRate: 1.21 },
      LT: { gridFee: 0.040, energyTax: 0.011, retailMarkup: 0.016, vatRate: 1.21 },
      SK: { gridFee: 0.028, energyTax: 0.015, retailMarkup: 0.009, vatRate: 1.20 },
      SI: { gridFee: 0.045, energyTax: 0.030, retailMarkup: 0.012, vatRate: 1.22 },
      HU: { gridFee: 0.022, energyTax: 0.008, retailMarkup: 0.007, vatRate: 1.27 },
      default: { gridFee: 0.040, energyTax: 0.020, retailMarkup: 0.010, vatRate: 1.20 }
    };
  }

  private applyConsumerMarkup(wholesalePrice: number, country: string, targetCurrency: string): number {
    const enableMarkup = this.homey.settings.get('enable_consumer_markup');
    if (!enableMarkup) {
      return wholesalePrice;
    }

    const config = this.parseConsumerMarkupConfig();
    const countryConfig = config[country] || config['default'] || {};
    
    const gridFee = Number(countryConfig.gridFee) || 0;
    const energyTax = Number(countryConfig.energyTax) || 0;
    const retailMarkup = Number(countryConfig.retailMarkup) || 0;
    const vatRate = Number(countryConfig.vatRate) || 1.0;

    // Check if markup values need currency conversion
    const markupCurrency = this.homey.settings.get('markup_currency_unit') || 'LOCAL';
    let markupMultiplier = 1.0;
    
    if (markupCurrency === 'EUR' && targetCurrency !== 'EUR') {
      // Convert EUR-denominated markup to target currency
      const fxRate = this.getStoredFxRate(targetCurrency);
      if (fxRate && fxRate > 0) {
        markupMultiplier = fxRate;
      }
    }

    const adjustedGridFee = gridFee * markupMultiplier;
    const adjustedEnergyTax = energyTax * markupMultiplier;
    const adjustedRetailMarkup = retailMarkup * markupMultiplier;

    const preTaxPrice = wholesalePrice + adjustedGridFee + adjustedEnergyTax + adjustedRetailMarkup;
    const finalPrice = preTaxPrice * vatRate;

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
      const finalPrice = this.applyConsumerMarkup(convertedPrice, country, appliedCurrency);
      
      // Clamp to reasonable precision to avoid floating noise
      return Number.isFinite(finalPrice) ? Number(finalPrice.toFixed(6)) : value;
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
      const enableMarkup = this.homey.settings.get('enable_consumer_markup');
      this.homey.app.log(
        `[ENTSO-E] Loaded ${prices.length} hourly prices, current ${current.price.toFixed(4)} ${appliedCurrency}/kWh${enableMarkup ? ' (with consumer markup)' : ' (wholesale)'}`
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
}
