import fetch from 'node-fetch';

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

interface FxRateRecord {
  currency: string;
  rate: number;
  fetchedAt: number;
  source: string;
}

const SETTINGS_KEY_RATE = 'fx_rate_cache';
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const API_ENDPOINT = 'https://api.frankfurter.app/latest';

function safeLog(homey: HomeyLike, level: 'log' | 'warn' | 'error', message: string, ...args: unknown[]): void {
  const logger = homey.app;
  if (!logger) return;
  const fn = logger[level];
  if (typeof fn === 'function') {
    fn.call(logger, message, ...args);
  }
}

enum FetchStatus {
  SKIPPED = 'skipped',
  SUCCESS = 'success',
  FAILED = 'failed'
}

export interface FxRateResult {
  rate: number | null;
  currency: string;
  fetchedAt: number | null;
  status: FetchStatus;
  source: string | null;
  error?: string;
}

export class FxRateService {
  constructor(private readonly homey: HomeyLike) {}

  public static SETTINGS_KEY_RATE = SETTINGS_KEY_RATE;

  private getCache(): FxRateRecord | null {
    try {
      const raw = this.homey.settings.get(SETTINGS_KEY_RATE);
      if (!raw) return null;
      if (typeof raw === 'object') {
        return raw as FxRateRecord;
      }
      if (typeof raw === 'string') {
        return JSON.parse(raw) as FxRateRecord;
      }
    } catch (error) {
      safeLog(this.homey, 'warn', 'Failed to read FX rate cache', error);
    }
    return null;
  }

  private async saveCache(record: FxRateRecord): Promise<void> {
    if (typeof this.homey.settings.set !== 'function') {
      return;
    }
    try {
      const result = this.homey.settings.set(SETTINGS_KEY_RATE, record);
      if (result instanceof Promise) {
        await result;
      }
    } catch (error) {
      safeLog(this.homey, 'warn', 'Failed to persist FX rate cache', error);
    }
  }

  private isCacheFresh(cache: FxRateRecord | null, currency: string, ttlMs: number): cache is FxRateRecord {
    if (!cache) return false;
    if (!cache.currency || cache.currency.toUpperCase() !== currency.toUpperCase()) {
      return false;
    }
    const age = Date.now() - Number(cache.fetchedAt || 0);
    return Number.isFinite(age) && age >= 0 && age <= ttlMs;
  }

  private async fetchFromApi(currency: string): Promise<FxRateRecord> {
    const url = new URL(API_ENDPOINT);
    url.searchParams.set('from', 'EUR');
    url.searchParams.set('to', currency.toUpperCase());

    const response = await fetch(url.toString(), {
      headers: {
        'User-Agent': 'com.melcloud.optimize (Homey)'
      }
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`FX API responded with ${response.status} ${response.statusText}: ${body}`);
    }

    const payload = await response.json();
    if (!payload || typeof payload !== 'object') {
      throw new Error('FX API returned invalid JSON payload');
    }

    const rates = (payload as any).rates;
    if (!rates || typeof rates !== 'object') {
      throw new Error('FX API payload missing rates property');
    }

    const rate = Number(rates[currency.toUpperCase()]);
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error(`FX API did not return a valid rate for ${currency}`);
    }

    return {
      currency: currency.toUpperCase(),
      rate,
      fetchedAt: Date.now(),
      source: 'frankfurter.app'
    };
  }

  public async getRate(currency: string, options?: { ttlMs?: number; forceRefresh?: boolean }): Promise<FxRateResult> {
    const normalizedCurrency = (currency || 'EUR').toUpperCase();
    const ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;

    const cache = this.getCache();
    if (!options?.forceRefresh && this.isCacheFresh(cache, normalizedCurrency, ttlMs)) {
      return {
        rate: cache.rate,
        currency: normalizedCurrency,
        fetchedAt: cache.fetchedAt,
        status: FetchStatus.SKIPPED,
        source: cache.source
      };
    }

    try {
      const record = await this.fetchFromApi(normalizedCurrency);
      await this.saveCache(record);
      safeLog(this.homey, 'log', `FX rate updated: 1 EUR = ${record.rate.toFixed(6)} ${record.currency}`);
      return {
        rate: record.rate,
        currency: normalizedCurrency,
        fetchedAt: record.fetchedAt,
        status: FetchStatus.SUCCESS,
        source: record.source
      };
    } catch (error) {
      safeLog(this.homey, 'warn', `Failed to refresh FX rate for ${normalizedCurrency}`, error);
      return {
        rate: cache && cache.currency === normalizedCurrency ? cache.rate : null,
        currency: normalizedCurrency,
        fetchedAt: cache?.fetchedAt ?? null,
        status: FetchStatus.FAILED,
        source: cache?.source ?? null,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
}

export default FxRateService;
