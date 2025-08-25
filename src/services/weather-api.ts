/**
 * Weather API Service for MELCloud Optimizer
 * Uses the Met.no API (Norwegian Meteorological Institute)
 *
 * This service fetches weather data and forecasts for a specific location
 * to enhance the MELCloud optimization algorithm with weather-based adjustments.
 */

import { HomeyApp } from '../types';

export interface WeatherData {
  time: string;
  temperature?: number;
  humidity?: number;
  pressure?: number;
  windSpeed?: number;
  windDirection?: number;
  cloudCover?: number;
  precipitation?: number;
  symbol?: string;
  temperatureMax?: number;
  temperatureMin?: number;
}

export interface WeatherLocation {
  latitude: number;
  longitude: number;
  altitude: number;
}

export interface WeatherUnits {
  temperature: string;
  windSpeed: string;
  precipitation: string;
  pressure: string;
  humidity: string;
}

export interface DailyWeather {
  date: string;
  temperatureMin: number;
  temperatureMax: number;
  temperatureAvg: number;
  precipitation: number;
  windSpeedAvg?: number;
  symbol?: string;
}

export interface WeatherForecast {
  location: WeatherLocation;
  units: WeatherUnits;
  current: WeatherData | null;
  hourly: WeatherData[];
  daily: DailyWeather[];
}

export interface WeatherAdjustment {
  adjustment: number;
  reason: string;
  factors: {
    outdoorTemp: number;
    windSpeed: number;
    cloudCover: number;
    heatLoss: number;
    solarGain: number;
    priceRatio: number;
  };
}

export interface WeatherTrend {
  trend: 'warming' | 'cooling' | 'stable' | 'unknown';
  details: string;
  temperatureChange: number;
  precipitation: number;
}

export class WeatherApi {
  private userAgent: string;
  private logger: { log: Function; error: Function };
  private baseUrl: string = 'https://api.met.no/weatherapi/locationforecast/2.0';
  private cachedForecasts: Map<string, { timestamp: number; data: WeatherForecast }> = new Map();
  private cacheExpiryTime: number = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

  /**
   * Create a new WeatherApi instance
   * @param userAgent - User agent string for API requests (required by Met.no)
   * @param logger - Logger instance for logging messages
   */
  constructor(userAgent?: string, logger: { log: Function; error: Function } = console) {
    this.userAgent = userAgent || 'MELCloudOptimizer/1.0 github.com/decline27/melcloud-optimizer';
    this.logger = logger;
  }

  /**
   * Get weather forecast for a specific location
   * @param latitude - Latitude in decimal degrees
   * @param longitude - Longitude in decimal degrees
   * @param altitude - Altitude in meters (optional)
   * @returns Weather forecast data
   */
  async getForecast(latitude: number, longitude: number, altitude?: number): Promise<WeatherForecast> {
    try {
      this.logger.log(`Getting weather forecast for location: ${latitude}, ${longitude}, altitude: ${altitude || 'not specified'}`);

      // Create cache key based on coordinates (rounded to 2 decimal places)
      const cacheKey = `${parseFloat(latitude.toString()).toFixed(2)},${parseFloat(longitude.toString()).toFixed(2)}`;

      // Check if we have a valid cached forecast
      const cachedForecast = this.cachedForecasts.get(cacheKey);
      if (cachedForecast && (Date.now() - cachedForecast.timestamp) < this.cacheExpiryTime) {
        const cacheAge = Math.round((Date.now() - cachedForecast.timestamp) / (60 * 1000)); // in minutes
        this.logger.log(`Using cached weather forecast (${cacheAge} minutes old, expires in ${Math.round((this.cacheExpiryTime - (Date.now() - cachedForecast.timestamp)) / (60 * 60 * 1000))} hours)`);
        return cachedForecast.data;
      }

      // Build the API URL
      let url = `${this.baseUrl}/compact?lat=${latitude}&lon=${longitude}`;
      if (altitude !== null && altitude !== undefined) {
        url += `&altitude=${Math.round(altitude)}`;
      }

      // Make the API request
      const data = await this.makeRequest(url);

      // Process the forecast data
      const processedData = this.processWeatherData(data);

      // Cache the forecast
      this.cachedForecasts.set(cacheKey, {
        timestamp: Date.now(),
        data: processedData
      });

      return processedData;
    } catch (error) {
      this.logger.error('Error getting weather forecast:', error);
      throw error;
    }
  }

  /**
   * Process the raw weather data from Met.no API
   * @param data - Raw weather data from API
   * @returns Processed weather data
   */
  private processWeatherData(data: any): WeatherForecast {
    try {
      // Extract relevant information from the API response
      const result: WeatherForecast = {
        location: {
          latitude: data.geometry.coordinates[1],
          longitude: data.geometry.coordinates[0],
          altitude: data.geometry.coordinates[2]
        },
        units: {
          temperature: 'celsius',
          windSpeed: 'm/s',
          precipitation: 'mm',
          pressure: 'hPa',
          humidity: '%'
        },
        current: null,
        hourly: [],
        daily: []
      };

      // Process timeseries data
      if (data.properties && data.properties.timeseries) {
        const timeseries = data.properties.timeseries;

        // Set current weather (first timepoint)
        if (timeseries.length > 0) {
          result.current = this.extractWeatherData(timeseries[0]);
        }

        // Process hourly forecast (next 24 hours)
        for (let i = 0; i < Math.min(24, timeseries.length); i++) {
          result.hourly.push(this.extractWeatherData(timeseries[i]));
        }

        // Process daily forecast (aggregate by day for next 7 days)
        const dailyMap = new Map<string, {
          date: string;
          temperatures: number[];
          precipitations: number[];
          windSpeeds: number[];
          symbols: string[];
        }>();

        for (const item of timeseries) {
          const date = new Date(item.time);
          const dateKey = date.toISOString().split('T')[0];

          if (!dailyMap.has(dateKey)) {
            dailyMap.set(dateKey, {
              date: dateKey,
              temperatures: [],
              precipitations: [],
              windSpeeds: [],
              symbols: []
            });
          }

          const daily = dailyMap.get(dateKey)!;
          const weatherData = this.extractWeatherData(item);

          if (weatherData.temperature !== undefined) {
            daily.temperatures.push(weatherData.temperature);
          }

          if (weatherData.precipitation !== undefined) {
            daily.precipitations.push(weatherData.precipitation);
          }

          if (weatherData.windSpeed !== undefined) {
            daily.windSpeeds.push(weatherData.windSpeed);
          }

          if (weatherData.symbol !== undefined) {
            daily.symbols.push(weatherData.symbol);
          }
        }

        // Calculate daily aggregates
        for (const [dateKey, daily] of dailyMap) {
          // Only include complete days (with at least 12 data points)
          if (daily.temperatures.length >= 12) {
            result.daily.push({
              date: dateKey,
              temperatureMin: Math.min(...daily.temperatures),
              temperatureMax: Math.max(...daily.temperatures),
              temperatureAvg: daily.temperatures.reduce((sum, temp) => sum + temp, 0) / daily.temperatures.length,
              precipitation: daily.precipitations.reduce((sum, precip) => sum + (precip || 0), 0),
              windSpeedAvg: daily.windSpeeds.length > 0
                ? daily.windSpeeds.reduce((sum, speed) => sum + speed, 0) / daily.windSpeeds.length
                : undefined,
              // Most common symbol for the day
              symbol: daily.symbols.length > 0
                ? this.getMostFrequent(daily.symbols)
                : undefined
            });
          }
        }

        // Sort daily forecasts by date
        result.daily.sort((a, b) => a.date.localeCompare(b.date));
      }

      return result;
    } catch (error) {
      this.logger.error('Error processing weather data:', error);
      throw new Error(`Failed to process weather data: ${(error as Error).message}`);
    }
  }

  /**
   * Extract weather data from a single timepoint
   * @param timepoint - Single timepoint from the API
   * @returns Extracted weather data
   */
  private extractWeatherData(timepoint: any): WeatherData {
    const result: WeatherData = {
      time: timepoint.time
    };

    // Extract instant data
    if (timepoint.data && timepoint.data.instant && timepoint.data.instant.details) {
      const details = timepoint.data.instant.details;

      result.temperature = details.air_temperature;
      result.humidity = details.relative_humidity;
      result.pressure = details.air_pressure_at_sea_level;
      result.windSpeed = details.wind_speed;
      result.windDirection = details.wind_from_direction;
      result.cloudCover = details.cloud_area_fraction;
    }

    // Extract next 1 hour data
    if (timepoint.data && timepoint.data.next_1_hours) {
      if (timepoint.data.next_1_hours.summary && timepoint.data.next_1_hours.summary.symbol_code) {
        result.symbol = timepoint.data.next_1_hours.summary.symbol_code;
      }

      if (timepoint.data.next_1_hours.details && timepoint.data.next_1_hours.details.precipitation_amount) {
        result.precipitation = timepoint.data.next_1_hours.details.precipitation_amount;
      }
    }
    // If next_1_hours is not available, try next_6_hours
    else if (timepoint.data && timepoint.data.next_6_hours) {
      if (timepoint.data.next_6_hours.summary && timepoint.data.next_6_hours.summary.symbol_code) {
        result.symbol = timepoint.data.next_6_hours.summary.symbol_code;
      }

      if (timepoint.data.next_6_hours.details) {
        if (timepoint.data.next_6_hours.details.precipitation_amount) {
          result.precipitation = timepoint.data.next_6_hours.details.precipitation_amount / 6; // Convert to hourly
        }

        if (timepoint.data.next_6_hours.details.air_temperature_max) {
          result.temperatureMax = timepoint.data.next_6_hours.details.air_temperature_max;
        }

        if (timepoint.data.next_6_hours.details.air_temperature_min) {
          result.temperatureMin = timepoint.data.next_6_hours.details.air_temperature_min;
        }
      }
    }

    return result;
  }

  /**
   * Find the most frequent item in an array
   * @param arr - Array of items
   * @returns Most frequent item
   */
  private getMostFrequent<T>(arr: T[]): T | undefined {
    const counts: Record<string, number> = {};
    let maxItem: T | undefined = undefined;
    let maxCount = 0;

    for (const item of arr) {
      const key = String(item);
      counts[key] = (counts[key] || 0) + 1;
      if (counts[key] > maxCount) {
        maxCount = counts[key];
        maxItem = item;
      }
    }

    return maxItem;
  }

  /**
   * Make an HTTP request to the Met.no API
   * @param url - URL to request
   * @returns Parsed JSON response
   */
  private async makeRequest(url: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const https = require('https');
      const { URL } = require('url');

      const urlObj = new URL(url);
      const options = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: 'GET',
        headers: {
          'User-Agent': this.userAgent,
          'Accept': 'application/json'
        }
      };

      this.logger.log(`Making weather API request to: ${url}`);

      const req = https.request(options, (res: any) => {
        let data = '';

        res.on('data', (chunk: any) => {
          data += chunk;
        });

        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const parsedData = JSON.parse(data);
              resolve(parsedData);
            } catch (error) {
              reject(new Error(`Failed to parse weather API response: ${(error as Error).message}`));
            }
          } else {
            reject(new Error(`Weather API request failed with status code ${res.statusCode}: ${data}`));
          }
        });
      });

      req.on('error', (error: Error) => {
        reject(new Error(`Weather API request error: ${error.message}`));
      });

      req.end();
    });
  }

  /**
   * Calculate the heat loss coefficient based on weather conditions
   * @param indoorTemp - Indoor temperature in Celsius
   * @param outdoorTemp - Outdoor temperature in Celsius
   * @param windSpeed - Wind speed in m/s
   * @returns Heat loss coefficient
   */
  calculateHeatLossCoefficient(indoorTemp: number, outdoorTemp: number, windSpeed: number): number {
    // Basic heat loss is proportional to temperature difference
    const tempDiff = indoorTemp - outdoorTemp;

    // Wind chill effect increases heat loss
    // Using a simplified model: higher wind speeds increase heat loss
    const windFactor = 1 + (windSpeed * 0.1); // 10% increase per m/s of wind

    return tempDiff * windFactor;
  }

  /**
   * Calculate the solar gain coefficient based on weather conditions
   * @param cloudCover - Cloud cover percentage (0-100)
   * @param symbol - Weather symbol code
   * @returns Solar gain coefficient (0-1)
   */
  calculateSolarGainCoefficient(cloudCover: number, symbol?: string): number {
    // Base solar gain is inverse of cloud cover
    let solarGain = 1 - (cloudCover / 100);

    // Adjust based on weather symbol if available
    if (symbol) {
      if (symbol.includes('clearsky')) {
        solarGain = Math.max(solarGain, 0.9); // Clear sky has high solar gain
      } else if (symbol.includes('fair')) {
        solarGain = Math.max(solarGain, 0.7); // Fair weather has good solar gain
      } else if (symbol.includes('cloudy')) {
        solarGain = Math.min(solarGain, 0.5); // Cloudy weather reduces solar gain
      } else if (symbol.includes('rain') || symbol.includes('snow')) {
        solarGain = Math.min(solarGain, 0.3); // Precipitation significantly reduces solar gain
      }
    }

    return solarGain;
  }

  /**
   * Calculate the optimal temperature adjustment based on weather forecast
   * @param forecast - Weather forecast data
   * @param currentIndoorTemp - Current indoor temperature
   * @param currentTargetTemp - Current target temperature
   * @param currentPrice - Current electricity price
   * @param avgPrice - Average electricity price
   * @returns Temperature adjustment recommendation
   */
  calculateWeatherBasedAdjustment(
    forecast: WeatherForecast,
    currentIndoorTemp: number,
    currentTargetTemp: number,
    currentPrice: number,
    avgPrice: number
  ): WeatherAdjustment {
    if (!forecast || !forecast.current) {
      return {
        adjustment: 0,
        reason: 'No weather data available',
        factors: {
          outdoorTemp: 0,
          windSpeed: 0,
          cloudCover: 0,
          heatLoss: 0,
          solarGain: 0,
          priceRatio: 1
        }
      };
    }

    // Get current weather conditions
    const outdoorTemp = forecast.current.temperature || 0;
    const windSpeed = forecast.current.windSpeed || 0;
    const cloudCover = forecast.current.cloudCover || 50; // Default to 50% if not available
    const symbol = forecast.current.symbol;

    // Calculate heat loss coefficient
    const heatLoss = this.calculateHeatLossCoefficient(currentIndoorTemp, outdoorTemp, windSpeed);

    // Calculate solar gain coefficient
    const solarGain = this.calculateSolarGainCoefficient(cloudCover, symbol);

    // Calculate weather-based adjustment
    // Higher heat loss suggests increasing temperature
    // Higher solar gain suggests decreasing temperature
    // Price ratio affects the magnitude of adjustment
    const priceRatio = currentPrice / avgPrice;
    const weatherAdjustment = (heatLoss * 0.05) - (solarGain * 0.5);
    const priceAdjustedWeatherEffect = weatherAdjustment / priceRatio;

    // Limit the adjustment to a reasonable range (-1 to +1)
    const adjustment = Math.max(-1, Math.min(1, priceAdjustedWeatherEffect));

    // Determine the reason for adjustment
    let reason = '';
    if (adjustment > 0.2) {
      reason = 'Cold and/or windy conditions, increasing temperature';
    } else if (adjustment < -0.2) {
      reason = 'Sunny conditions with solar gain, decreasing temperature';
    } else {
      reason = 'Weather conditions have minimal impact';
    }

    return {
      adjustment,
      reason,
      factors: {
        outdoorTemp,
        windSpeed,
        cloudCover,
        heatLoss,
        solarGain,
        priceRatio
      }
    };
  }

  /**
   * Get weather trend for the next 24 hours
   * @param forecast - Weather forecast data
   * @returns Weather trend information
   */
  getWeatherTrend(forecast: WeatherForecast): WeatherTrend {
    if (!forecast || !forecast.hourly || forecast.hourly.length === 0) {
      return {
        trend: 'unknown',
        details: 'No forecast data available',
        temperatureChange: 0,
        precipitation: 0
      };
    }

    const hourly = forecast.hourly;

    // Calculate temperature trend
    const temperatures = hourly.map(h => h.temperature).filter(t => t !== undefined) as number[];
    const firstTemp = temperatures[0];
    const lastTemp = temperatures[temperatures.length - 1];
    const tempDiff = lastTemp - firstTemp;

    // Calculate precipitation trend
    const precipitations = hourly.map(h => h.precipitation || 0);
    const totalPrecipitation = precipitations.reduce((sum, p) => sum + p, 0);
    const hasPrecipitation = totalPrecipitation > 0.5; // More than 0.5mm in 24h

    // Determine overall trend
    let trend: 'warming' | 'cooling' | 'stable' | 'unknown' = 'stable';
    let details = '';

    if (tempDiff > 3) {
      trend = 'warming';
      details = `Temperature rising by ${tempDiff.toFixed(1)}°C over next 24h`;
    } else if (tempDiff < -3) {
      trend = 'cooling';
      details = `Temperature falling by ${Math.abs(tempDiff).toFixed(1)}°C over next 24h`;
    } else {
      details = `Temperature relatively stable (${tempDiff.toFixed(1)}°C change)`;
    }

    if (hasPrecipitation) {
      details += `, with ${totalPrecipitation.toFixed(1)}mm precipitation expected`;
    }

    return {
      trend,
      details,
      temperatureChange: tempDiff,
      precipitation: totalPrecipitation
    };
  }
}