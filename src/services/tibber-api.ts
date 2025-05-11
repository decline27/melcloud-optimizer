import fetch from 'node-fetch';
import { Logger } from '../util/logger';
import { TibberPriceInfo } from '../types';

/**
 * Tibber API Service
 * Handles communication with the Tibber API to get electricity prices
 */
export class TibberApi {
  private apiEndpoint = 'https://api.tibber.com/v1-beta/gql';
  private token: string;
  private logger: Logger;
  private cache: Map<string, { data: any; timestamp: number }> = new Map();
  private cacheTTL: number = 30 * 60 * 1000; // 30 minutes default TTL
  private lastApiCallTime: number = 0;
  private minApiCallInterval: number = 2000; // 2 seconds minimum between calls

  /**
   * Constructor
   * @param token Tibber API token
   * @param logger Logger instance
   */
  constructor(token: string, logger?: Logger) {
    this.token = token;
    // Create a default console logger if none provided (for tests)
    this.logger = logger || {
      log: (message: string, ...args: any[]) => console.log(message, ...args),
      info: (message: string, ...args: any[]) => console.log(`INFO: ${message}`, ...args),
      error: (message: string, error?: Error | unknown, ...args: any[]) => console.error(message, error, ...args),
      debug: (message: string, ...args: any[]) => console.debug(message, ...args),
      warn: (message: string, ...args: any[]) => console.warn(message, ...args),
      notify: async (message: string) => Promise.resolve(),
      marker: (message: string) => console.log(`===== ${message} =====`),
      sendToTimeline: async (message: string) => Promise.resolve(),
      setLogLevel: () => {},
      setTimelineLogging: () => {}
    };
  }

  /**
   * Log API call details
   * @param method HTTP method
   * @param endpoint API endpoint
   * @param params Optional parameters
   */
  private logApiCall(method: string, endpoint: string, params?: any): void {
    this.logger.log(`API Call: ${method} ${endpoint}${params ? ' with params: ' + JSON.stringify(params) : ''}`);
  }

  /**
   * Check if an error is a network error
   * @param error Error to check
   * @returns True if it's a network error
   */
  private isNetworkError(error: unknown): boolean {
    return error instanceof Error &&
      (error.message.includes('network') ||
       error.message.includes('timeout') ||
       error.message.includes('connection') ||
       error.message.includes('ENOTFOUND') ||
       error.message.includes('ETIMEDOUT'));
  }

  /**
   * Check if an error is an authentication error
   * @param error Error to check
   * @returns True if it's an authentication error
   */
  private isAuthError(error: unknown): boolean {
    return error instanceof Error &&
      (error.message.includes('auth') ||
       error.message.includes('token') ||
       error.message.includes('unauthorized') ||
       error.message.includes('Authentication'));
  }

  /**
   * Retryable request with exponential backoff
   * @param requestFn Function that returns a promise with the request
   * @param maxRetries Maximum number of retry attempts
   * @param retryDelay Initial delay between retries in ms
   * @returns Promise resolving to the request result
   */
  private async retryableRequest<T>(
    requestFn: () => Promise<T>,
    maxRetries: number = 3,
    retryDelay: number = 2000
  ): Promise<T> {
    let lastError: Error | unknown;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await requestFn();
      } catch (error) {
        lastError = error;

        // Check if it's a network error that we should retry
        if (this.isNetworkError(error)) {
          this.logger.warn(
            `Network error on attempt ${attempt}/${maxRetries}, retrying in ${retryDelay}ms:`,
            error
          );

          // Wait before retrying
          await new Promise(resolve => setTimeout(resolve, retryDelay));

          // Increase delay for next attempt (exponential backoff)
          retryDelay *= 2;
        } else {
          // Not a retryable error
          throw error;
        }
      }
    }

    // If we get here, all retries failed
    throw lastError;
  }

  /**
   * Get cached data if available and not expired
   * @param key Cache key
   * @returns Cached data or null if not found or expired
   */
  private getCachedData<T>(key: string): T | null {
    const cached = this.cache.get(key);

    if (!cached) {
      return null;
    }

    // Check if cache is still valid
    const now = Date.now();
    if (now - cached.timestamp > this.cacheTTL) {
      this.cache.delete(key);
      return null;
    }

    return cached.data as T;
  }

  /**
   * Set data in cache
   * @param key Cache key
   * @param data Data to cache
   */
  private setCachedData<T>(key: string, data: T): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  /**
   * Throttled API call to prevent rate limiting
   * @param query GraphQL query
   * @returns Promise resolving to API response
   */
  private async throttledApiCall<T>(query: string): Promise<T> {
    // Ensure minimum time between API calls
    const now = Date.now();
    const timeSinceLastCall = now - this.lastApiCallTime;

    if (timeSinceLastCall < this.minApiCallInterval) {
      const waitTime = this.minApiCallInterval - timeSinceLastCall;
      this.logger.debug(`Throttling API call to Tibber, waiting ${waitTime}ms`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    this.lastApiCallTime = Date.now();

    // Make the API call
    this.logger.debug(`API Call to Tibber GraphQL endpoint`);

    const response = await fetch(this.apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.token}`,
      },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    return await response.json() as T;
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
      this.logger.debug(`Using cached Tibber price data`);
      return cachedData;
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

    this.logApiCall('POST', this.apiEndpoint, { query: 'Tibber price query' });

    try {
      const data = await this.retryableRequest(
        () => this.throttledApiCall<any>(query)
      );

      if (data.errors) {
        const errorMessage = `Tibber API error: ${data.errors[0].message}`;
        this.logger.error(errorMessage);
        throw new Error(errorMessage);
      }

      const formattedData = this.formatPriceData(data);
      this.logger.log(`Tibber prices retrieved: ${formattedData.prices.length} price points`);

      // Cache the result
      this.setCachedData(cacheKey, formattedData);

      return formattedData;
    } catch (error) {
      if (this.isAuthError(error)) {
        this.logger.error('Authentication error in Tibber API:', error);
        throw new Error(`Authentication error: ${error instanceof Error ? error.message : String(error)}`);
      } else if (this.isNetworkError(error)) {
        this.logger.error('Network error in Tibber API:', error);
        throw new Error(`Network error: ${error instanceof Error ? error.message : String(error)}`);
      } else {
        this.logger.error('Tibber API error:', error);
        const enhancedError = error instanceof Error
          ? new Error(`Tibber API failed: ${error.message}`)
          : new Error(`Tibber API failed: ${String(error)}`);
        throw enhancedError;
      }
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
      this.logger.error('Error formatting Tibber price data:', error);
      throw new Error(`Failed to format price data: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
