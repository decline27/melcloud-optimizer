import fetch from 'node-fetch';
import { Logger } from '../util/logger';
import { TibberPriceInfo } from '../types';
import { ErrorHandler, AppError, ErrorCategory } from '../util/error-handler';
import { BaseApiService } from './base-api-service';
import { TimeZoneHelper } from '../util/time-zone-helper';

// No global logger: this service requires an injected Logger instance.

/**
 * Tibber API Service
 * Handles communication with the Tibber API to get electricity prices
 */
export class TibberApi extends BaseApiService {
  private apiEndpoint = 'https://api.tibber.com/v1-beta/gql';
  private token: string;
  private timeZoneHelper: TimeZoneHelper;
  private homeySettings?: any;

  /**
   * Constructor
   * @param token Tibber API token
   * @param logger Logger instance (required)
   * @param homeySettings Homey settings provider (required)
   */
  constructor(token: string, logger: Logger, homeySettings: any) {
    // Call the parent constructor with service name and logger
  super('Tibber', logger, {
      failureThreshold: 3,
      resetTimeout: 60000, // 1 minute
      halfOpenSuccessThreshold: 1,
      timeout: 15000 // 15 seconds
    });

  this.homeySettings = homeySettings;

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
   * Clean up any pending timers and resources
   * This is important for tests to prevent memory leaks and lingering timers
   */
  cleanup(): void {
    // Call parent class cleanup to handle cache and circuit breaker
    super.cleanup();
  }
}
