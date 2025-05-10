import fetch from 'node-fetch';
import { Logger } from '../util/logger';

/**
 * Tibber API Service
 * Handles communication with the Tibber API to get electricity prices
 */
export class TibberApi {
  private apiEndpoint = 'https://api.tibber.com/v1-beta/gql';
  private token: string;
  private logger: Logger;

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
       error.message.includes('connection'));
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
       error.message.includes('unauthorized'));
  }

  /**
   * Get current and future electricity prices
   * @returns Promise resolving to price data
   */
  async getPrices(): Promise<any> {
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
      const response = await fetch(this.apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`,
        },
        body: JSON.stringify({ query }),
      });

      const data = await response.json() as any;

      if (data.errors) {
        const errorMessage = `Tibber API error: ${data.errors[0].message}`;
        this.logger.error(errorMessage);
        throw new Error(errorMessage);
      }

      const formattedData = this.formatPriceData(data);
      this.logger.log(`Tibber prices retrieved: ${formattedData.prices.length} price points`);
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
  private formatPriceData(data: any): any {
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

      const result = {
        current: priceInfo.current ? {
          time: priceInfo.current.startsAt,
          price: priceInfo.current.total,
        } : null,
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
