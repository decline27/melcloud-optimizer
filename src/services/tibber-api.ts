import fetch from 'node-fetch';
import { Logger } from '../util/logger';
import { TibberPriceInfo } from '../types';
import { ErrorHandler, AppError, ErrorCategory } from '../util/error-handler';

// Add global declaration for logger
declare global {
  var logger: Logger;
}

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
  private errorHandler: ErrorHandler;

  /**
   * Constructor
   * @param token Tibber API token
   * @param logger Logger instance
   */
  constructor(token: string, logger?: Logger) {
    this.token = token;

    // Use the provided logger or try to get the global logger
    if (logger) {
      this.logger = logger;
    } else if (global.logger) {
      this.logger = global.logger;
    } else {
      // Create a default console logger if none provided (for tests)
      this.logger = {
        log: (message: string, ...args: any[]) => console.log(message, ...args),
        info: (message: string, ...args: any[]) => console.log(`INFO: ${message}`, ...args),
        error: (message: string, error?: Error | unknown, context?: Record<string, any>) => console.error(message, error, context),
        debug: (message: string, ...args: any[]) => console.debug(message, ...args),
        warn: (message: string, context?: Record<string, any>) => console.warn(message, context),
        api: (message: string, context?: Record<string, any>) => console.log(`API: ${message}`, context),
        optimization: (message: string, context?: Record<string, any>) => console.log(`OPTIMIZATION: ${message}`, context),
        notify: async (message: string) => Promise.resolve(),
        marker: (message: string) => console.log(`===== ${message} =====`),
        sendToTimeline: async (message: string, type?: 'info' | 'warning' | 'error') => Promise.resolve(),
        setLogLevel: () => {},
        setTimelineLogging: () => {},
        getLogLevel: () => 1, // INFO level
        enableCategory: () => {},
        disableCategory: () => {},
        isCategoryEnabled: () => true,
        formatValue: (value: any) => typeof value === 'object' ? JSON.stringify(value) : String(value)
      };
    }

    // Initialize error handler
    this.errorHandler = new ErrorHandler(this.logger);
    this.logger.api('Tibber API service initialized', { token: token ? '***' : 'not provided' });
  }

  /**
   * Log API call details
   * @param method HTTP method
   * @param endpoint API endpoint
   * @param params Optional parameters
   */
  private logApiCall(method: string, endpoint: string, params?: any): void {
    this.logger.api(`${method} ${endpoint}`, {
      method,
      endpoint,
      params: params || null,
      timestamp: new Date().toISOString(),
      service: 'Tibber'
    });
  }

  /**
   * Check if an error is a network error
   * @param error Error to check
   * @returns True if it's a network error
   */
  private isNetworkError(error: unknown): boolean {
    const appError = this.errorHandler.createAppError(error);
    return appError.category === ErrorCategory.NETWORK;
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
   * Create a standardized API error
   * @param error Original error
   * @param context Additional context
   * @param message Optional custom message
   * @returns AppError instance
   */
  private createApiError(error: unknown, context?: Record<string, any>, message?: string): AppError {
    return this.errorHandler.createAppError(error, {
      api: 'Tibber',
      ...context
    }, message);
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
          // Create a standardized error with context
          const appError = this.createApiError(error, {
            attempt,
            maxRetries,
            retryDelay,
            retryable: true
          });

          this.logger.warn(
            `Network error on attempt ${attempt}/${maxRetries}, retrying in ${retryDelay}ms: ${appError.message}`,
            { attempt, maxRetries, retryDelay }
          );

          // Wait before retrying
          await new Promise(resolve => setTimeout(resolve, retryDelay));

          // Increase delay for next attempt (exponential backoff)
          retryDelay *= 2;
        } else {
          // Not a retryable error
          throw this.createApiError(error, {
            attempt,
            maxRetries,
            retryable: false
          });
        }
      }
    }

    // If we get here, all retries failed
    throw this.createApiError(lastError, {
      allRetriesFailed: true,
      maxRetries
    }, `All ${maxRetries} retry attempts failed`);
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
        throw this.createApiError(new Error(errorMessage), {
          operation: 'getPrices',
          graphqlErrors: data.errors
        });
      }

      const formattedData = this.formatPriceData(data);
      this.logger.log(`Tibber prices retrieved: ${formattedData.prices.length} price points`);

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
      const appError = this.createApiError(error, {
        operation: 'formatPriceData'
      }, 'Failed to format price data');

      // Log the error
      this.errorHandler.logError(appError);

      // Throw the standardized error
      throw appError;
    }
  }
}
