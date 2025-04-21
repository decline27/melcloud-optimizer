import fetch from 'node-fetch';

/**
 * Tibber API Service
 * Handles communication with the Tibber API to get electricity prices
 */
export class TibberApi {
  private apiEndpoint = 'https://api.tibber.com/v1-beta/gql';
  private token: string;

  /**
   * Constructor
   * @param token Tibber API token
   */
  constructor(token: string) {
    this.token = token;
  }

  /**
   * Get current and future electricity prices
   * @returns Promise resolving to price data
   */
  async getPrices(): Promise<any> {
    try {
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
        throw new Error(`Tibber API error: ${data.errors[0].message}`);
      }

      return this.formatPriceData(data);
    } catch (error) {
      console.error('Tibber API error:', error);
      throw error;
    }
  }

  /**
   * Format price data from Tibber API response
   * @param data Tibber API response data
   * @returns Formatted price data
   */
  private formatPriceData(data: any): any {
    const homes = data.data.viewer.homes;
    if (!homes || homes.length === 0) {
      throw new Error('No homes found in Tibber account');
    }

    const priceInfo = homes[0].currentSubscription?.priceInfo;
    if (!priceInfo) {
      throw new Error('No price information available');
    }

    // Combine today and tomorrow prices
    const prices = [
      ...(priceInfo.today || []),
      ...(priceInfo.tomorrow || []),
    ].map(price => ({
      time: price.startsAt,
      price: price.total,
    }));

    return {
      current: priceInfo.current ? {
        time: priceInfo.current.startsAt,
        price: priceInfo.current.total,
      } : null,
      prices,
    };
  }
}
