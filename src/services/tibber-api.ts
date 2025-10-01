import { Logger } from '../util/logger';
import { TibberPriceInfo, PricePoint } from '../types';
import { ErrorHandler, AppError, ErrorCategory } from '../util/error-handler';
import { BaseApiService, RateLimitError } from './base-api-service';
import { TimeZoneHelper } from '../util/time-zone-helper';

// Add global declaration for logger
declare global {
  var logger: Logger;
}

/**
 * Tibber API Service
 * Handles communication with the Tibber API to get electricity prices
 */
export class TibberApi extends BaseApiService {
  private apiEndpoint = 'https://api.tibber.com/v1-beta/gql';
  private token: string;
  private timeZoneHelper: TimeZoneHelper;

  /**
   * Constructor
   * @param token Tibber API token
   * @param logger Logger instance
   */
  constructor(token: string, logger?: Logger) {
    // Call the parent constructor with service name and logger
    super('Tibber', logger || (global.logger as Logger), {
      failureThreshold: 3,
      resetTimeout: 60000, // 1 minute
      halfOpenSuccessThreshold: 1,
      timeout: 15000 // 15 seconds
    });

    this.token = token;

    // Initialize time zone helper
    this.timeZoneHelper = new TimeZoneHelper(this.logger);

    this.logger.api('Tibber API service initialized', { token: token ? '***' : 'not provided' });
  }

  /**
   * Update timezone settings for this service
   * @param timeZoneOffset Timezone offset in hours
   * @param useDST Whether to use daylight saving time
   */
  public updateTimeZoneSettings(timeZoneOffset: number, useDST: boolean): void {
    this.timeZoneHelper.updateSettings(timeZoneOffset, useDST);
    this.logger.info(`Tibber API timezone settings updated: offset=${timeZoneOffset}, DST=${useDST}`);
  }

  /**
   * Check if an error is an authentication error
   * @param error Error to check
   * @returns True if it's an authentication error
   */
  private isAuthError(error: unknown): boolean {
    const appError = this.errorHandler.createAppError(error);
    return appError.category === ErrorCategory.AUTHENTICATION;
  }

  /**
   * Throttled API call to prevent rate limiting
   * @param query GraphQL query
   * @returns Promise resolving to API response
   */
  private async throttledApiCall<T>(query: string): Promise<T> {
    // Use circuit breaker to protect against cascading failures
    return this.circuitBreaker.execute(async () => {
      // Throttle requests using the base class method
      await this.throttle();

      // Log the API call
      this.logApiCall('POST', this.apiEndpoint, { query: 'GraphQL query' });

      // Make the API call
      this.logger.debug(`API Call to Tibber GraphQL endpoint`);

      const fetchFn = getFetch();
      const response = await fetchFn(this.apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`,
        },
        body: JSON.stringify({ query }),
      });

      if (response.status === 429) {
        const retryAfterHeader = (response as any).headers?.get?.('retry-after') ?? null;
        const retryAfterMs = parseRetryAfterHeader(retryAfterHeader) ?? 60000;
        this.applyRateLimit(retryAfterMs);
        throw new RateLimitError(`API rate limit: ${response.status} ${response.statusText}`, retryAfterMs);
      }

      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }

      return await response.json() as T;
    });
  }

  /**
   * Get current and future electricity prices
   * @returns Promise resolving to price data
   */
  async getPrices(): Promise<TibberPriceInfo> {
    // Check cache first
    const cacheKey = 'tibber_prices';
    const cachedData = this.getCachedData<any>(cacheKey);

    if (cachedData) {
      // Validate price data freshness even if cached
      if (this.isPriceDataFresh(cachedData)) {
        this.logger.debug(`Using cached Tibber price data`);
        return cachedData;
      } else {
        this.logger.warn(`Cached Tibber price data is stale, fetching fresh data`);
        // Clear stale cache
        this.cache.delete(cacheKey);
      }
    }

    const query = `{
      viewer {
        homes {
          currentSubscription {
            priceInfo(resolution: QUARTER_HOURLY) {
              current {
                total
                energy
                tax
                startsAt
              }
              today {
                total
                energy
                tax
                startsAt
              }
              tomorrow {
                total
                energy
                tax
                startsAt
              }
            }
          }
        }
      }
    }`;

    try {
      const data = await this.retryableRequest(
        () => this.throttledApiCall<any>(query)
      );

      if (data.errors) {
        const errorMessage = `Tibber API error: ${data.errors[0].message}`;
        throw this.createApiError(new Error(errorMessage), {
          operation: 'getPrices',
          graphqlErrors: data.errors
        });
      }

      const formattedData = this.formatPriceData(data);
      const summaryCounts = {
        hourly: formattedData.prices?.length || 0,
        quarterHourly: formattedData.quarterHourly?.length || 0
      };
      this.logger.log(
        `Tibber prices retrieved: hourly=${summaryCounts.hourly}, quarterHourly=${summaryCounts.quarterHourly}`
      );

      // Validate freshness of the fetched data
      if (!this.isPriceDataFresh(formattedData)) {
        this.logger.warn('Fetched price data is stale - this may indicate system time issues or Tibber API delays');
        // Still cache and return the data as it's the best we have
        // But log a warning for monitoring
      }

      // Cache the result
      this.setCachedData(cacheKey, formattedData);

      return formattedData;
    } catch (error) {
      // If this is already an AppError, just rethrow it
      if (error instanceof AppError) {
        throw error;
      }

      // Create a standardized error with context
      const appError = this.createApiError(error, {
        operation: 'getPrices'
      });

      // Log the error with appropriate level based on category
      this.errorHandler.logError(appError);

      // Throw the standardized error
      throw appError;
    }
  }

  /**
   * Format price data from Tibber API response
   * @param data Tibber API response data
   * @returns Formatted price data
   */
  private formatPriceData(data: any): TibberPriceInfo {
    try {
      const homes = data.data.viewer.homes;
      if (!homes || homes.length === 0) {
        const errorMessage = 'No homes found in Tibber account';
        this.logger.error(errorMessage);
        throw new Error(errorMessage);
      }

      const priceInfo = homes[0].currentSubscription?.priceInfo;
      if (!priceInfo) {
        const errorMessage = 'No price information available';
        this.logger.error(errorMessage);
        throw new Error(errorMessage);
      }

      // Combine today and tomorrow prices
      const quarterHourlyPrices: PricePoint[] = [
        ...(priceInfo.today || []),
        ...(priceInfo.tomorrow || []),
      ].map(price => ({
        time: price.startsAt,
        price: price.total,
      }));

      const intervalMinutes = this.detectIntervalMinutes(quarterHourlyPrices) ?? undefined;
      const hourlyPrices = this.aggregateToHourly(quarterHourlyPrices);

      const result: TibberPriceInfo = {
        current: priceInfo.current ? {
          time: priceInfo.current.startsAt,
          price: priceInfo.current.total,
        } : {
          time: new Date().toISOString(),
          price: 0
        },
        prices: hourlyPrices.length > 0 ? hourlyPrices : quarterHourlyPrices,
        quarterHourly: quarterHourlyPrices,
        intervalMinutes,
      };

      this.logger.log(
        `Formatted price data: current price ${result.current?.price || 'N/A'}, hourly=${result.prices.length}, quarterHourly=${quarterHourlyPrices.length}`
      );
      return result;
    } catch (error) {
      // Create a standardized error with context
      const appError = this.errorHandler.createAppError(error, {
        service: this.serviceName,
        operation: 'formatPriceData'
      }, 'Failed to format price data');

      // Log the error
      this.errorHandler.logError(appError);

      // Throw the standardized error
      throw appError;
    }
  }

  /**
   * Check if price data is fresh (not stale)
   * @param priceData Price data to validate
   * @returns True if data is fresh, false if stale
   */
  private isPriceDataFresh(priceData: TibberPriceInfo): boolean {
    try {
      if (!priceData?.current?.time) {
        this.logger.warn('Price data missing current time - considering stale');
        return false;
      }

  const currentPriceTime = new Date(priceData.current.time);
  const now = new Date();

  const intervalMinutes = priceData.intervalMinutes ?? 60;
  const maxStaleMinutes = intervalMinutes === 15 ? 20 : 65;
  const maxStaleTime = maxStaleMinutes * 60 * 1000;
      const timeDiff = now.getTime() - currentPriceTime.getTime();

      if (timeDiff > maxStaleTime) {
        this.logger.warn(`Price data is stale: current price from ${currentPriceTime.toISOString()}, age: ${Math.round(timeDiff / 60000)} minutes`);
        return false;
      }

  const futureThresholdMinutes = intervalMinutes === 15 ? 20 : 65;
  if (timeDiff < -futureThresholdMinutes * 60 * 1000) {
        this.logger.warn(`Price data has future timestamp: ${currentPriceTime.toISOString()}, system time: ${now.toISOString()}`);
        return false;
      }

      this.logger.debug(`Price data is fresh: current price from ${currentPriceTime.toISOString()}, age: ${Math.round(Math.abs(timeDiff) / 60000)} minutes`);
      return true;
    } catch (error) {
      this.logger.error(`Error validating price data freshness: ${error}`, { error });
      // If we can't validate, assume stale to be safe
      return false;
    }
  }

  /**
   * Clean up any pending timers and resources
   * This is important for tests to prevent memory leaks and lingering timers
   */
  cleanup(): void {
    // Call parent class cleanup to handle cache and circuit breaker
    super.cleanup();
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

      date.setMinutes(0, 0, 0);
      const bucketKey = date.toISOString();
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

type FetchInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};

interface FetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers?: {
    get(name: string): string | null;
  };
  json(): Promise<any>;
}

type FetchFn = (url: string, init?: FetchInit) => Promise<FetchResponse>;

let cachedFetch: FetchFn | null = null;

async function loadFetchModule(): Promise<FetchFn> {
  const dynamicImport = new Function('specifier', 'return import(specifier);') as (specifier: string) => Promise<unknown>;
  const mod: unknown = await dynamicImport('node-fetch');
  const candidate = (mod && typeof mod === 'object' && 'default' in mod)
    ? (mod as { default: unknown }).default
    : mod;
  if (typeof candidate !== 'function') {
    throw new AppError(
      'node-fetch module does not export a fetch-compatible function.',
      ErrorCategory.INTERNAL
    );
  }
  return (candidate as FetchFn).bind(globalThis);
}

function getFetch(): FetchFn {
  if (cachedFetch) {
    return cachedFetch;
  }

  const maybeFetch = (globalThis as any).fetch;
  if (typeof maybeFetch === 'function') {
    const boundFetch = (maybeFetch as FetchFn).bind(globalThis);
    cachedFetch = boundFetch;
    return boundFetch;
  }

  cachedFetch = (async (...args: Parameters<FetchFn>): ReturnType<FetchFn> => {
    cachedFetch = await loadFetchModule();
    return cachedFetch(...args);
  }) as FetchFn;

  return cachedFetch;
}

function parseRetryAfterHeader(headerValue: string | null): number | null {
  if (!headerValue) {
    return null;
  }

  const numeric = Number(headerValue);
  if (!Number.isNaN(numeric)) {
    return Math.max(0, numeric * 1000);
  }

  const parsedDate = Date.parse(headerValue);
  if (!Number.isNaN(parsedDate)) {
    const diff = parsedDate - Date.now();
    return diff > 0 ? diff : 0;
  }

  return null;
}
