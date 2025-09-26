import { Logger } from '../util/logger';
import { TibberPriceInfo } from '../types';
import { ErrorHandler, AppError, ErrorCategory } from '../util/error-handler';
import { BaseApiService, RateLimitError } from './base-api-service';
import { TimeZoneHelper } from '../util/time-zone-helper';
import { TIBBER_API } from '../constants/melcloud-api';

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
      resetTimeout: TIBBER_API.RESET_TIMEOUT,
      halfOpenSuccessThreshold: 1,
      timeout: TIBBER_API.REQUEST_TIMEOUT
    });

    this.token = token;

    // Initialize time zone helper
    this.timeZoneHelper = new TimeZoneHelper(this.logger);

    this.logger.api('Tibber API service initialized', { token: token ? '***' : 'not provided' });
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
        const retryAfterMs = parseRetryAfterHeader(retryAfterHeader) ?? TIBBER_API.DEFAULT_RETRY_DELAY;
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
            priceInfo {
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
      this.logger.log(`Tibber prices retrieved: ${formattedData.prices.length} price points`);

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
      const prices = [
        ...(priceInfo.today || []),
        ...(priceInfo.tomorrow || []),
      ].map(price => ({
        time: price.startsAt,
        price: price.total,
      }));

      const result: TibberPriceInfo = {
        current: priceInfo.current ? {
          time: priceInfo.current.startsAt,
          price: priceInfo.current.total,
        } : {
          time: new Date().toISOString(),
          price: 0
        },
        prices,
      };

      this.logger.log(`Formatted price data: current price ${result.current?.price || 'N/A'}, ${prices.length} price points`);
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
      
      // Current price should be within the last hour (Tibber updates hourly)
      // Allow for 5 minutes grace period for API delays
      const maxStaleTime = TIBBER_API.MAX_PRICE_DATA_AGE;
      const timeDiff = now.getTime() - currentPriceTime.getTime();

      if (timeDiff > maxStaleTime) {
        this.logger.warn(`Price data is stale: current price from ${currentPriceTime.toISOString()}, age: ${Math.round(timeDiff / TIBBER_API.MS_TO_MINUTES)} minutes`);
        return false;
      }

      // Additional check: current price time should not be in the future (beyond next hour)
      if (timeDiff < -TIBBER_API.MAX_PRICE_DATA_AGE) {
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
