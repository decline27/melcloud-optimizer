import { ServiceBase } from './base/service-base';
import { ConfigurationService } from './configuration-service';
import { HomeyLogger } from '../util/logger';

export interface WeatherData {
  timestamp: string;
  temperature: number;
  humidity?: number;
  windSpeed?: number;
  cloudCover?: number;
  precipitation?: number;
  pressure?: number;
  symbol?: string;
}

export interface WeatherImpact {
  heating: {
    adjustment: number; // Temperature adjustment recommendation
    efficiency: number; // Expected efficiency factor (0-1)
    reasoning: string;
  };
  hotWater: {
    adjustment: number; // Hot water temperature adjustment
    efficiency: number; // Expected efficiency factor (0-1)
    reasoning: string;
  };
  thermal: {
    massUtilization: number; // How much to utilize thermal mass (0-1)
    strategy: 'conserve' | 'utilize' | 'boost';
    reasoning: string;
  };
}

export interface WeatherOptimizationInput {
  currentWeather: WeatherData;
  forecast: WeatherData[];
  currentIndoorTemp: number;
  targetIndoorTemp: number;
  currentOutdoorTemp: number;
  currentPrice?: number;
  avgPrice?: number;
}

export interface WeatherStatistics {
  averageTemp: number;
  tempRange: { min: number; max: number };
  averageHumidity: number;
  averageWindSpeed: number;
  dataPoints: number;
  lastUpdated: string;
}

export interface WeatherTrend {
  trend: 'warming' | 'cooling' | 'stable' | 'unknown';
  details: string;
  temperatureChange: number;
  precipitation: number;
  confidence: number;
}

export interface WeatherConfig {
  location: {
    latitude: number;
    longitude: number;
    altitude?: number;
  };
  cacheTimeout: number; // Minutes
  updateInterval: number; // Minutes
  apiConfig: {
    userAgent: string;
    baseUrl: string;
    timeout: number;
  };
}

export class WeatherIntegrationService extends ServiceBase {
  private weatherHistory: WeatherData[] = [];
  private lastWeatherUpdate = 0;
  private weatherCacheTimeout = 15 * 60 * 1000; // Default 15 minutes
  private config: WeatherConfig | null = null;
  private forecastData: WeatherData[] | null = null;

  constructor(
    private configService: ConfigurationService,
    private weatherApi?: { getCurrentWeather(): Promise<WeatherData>; getForecast(lat: number, lon: number, alt?: number): Promise<any> },
    logger?: HomeyLogger
  ) {
    super(logger!);
    this.initializeService();
  }

  private async initializeService(): Promise<void> {
    try {
      // Load weather configuration or use defaults
      const fullConfig = await this.configService.getConfig('optimization');
      // Note: weather config would be added to optimization config in the future
      // For now, use default configuration
      this.config = {
        location: { latitude: 59.9139, longitude: 10.7522 }, // Default to Oslo
        cacheTimeout: 15,
        updateInterval: 30,
        apiConfig: {
          userAgent: 'MELCloudOptimizer/1.0',
          baseUrl: 'https://api.met.no/weatherapi/locationforecast/2.0',
          timeout: 10000
        }
      };

      this.weatherCacheTimeout = this.config.cacheTimeout * 60 * 1000; // Convert to milliseconds
      this.logInfo('Weather integration service initialized', { 
        location: this.config.location,
        cacheTimeout: this.config.cacheTimeout 
      });

      // Initial weather data update
      await this.updateWeatherData();
    } catch (error) {
      this.logError(error as Error, { context: 'weather service initialization' });
      // Use default configuration if config loading fails
      this.config = {
        location: { latitude: 59.9139, longitude: 10.7522 },
        cacheTimeout: 15,
        updateInterval: 30,
        apiConfig: {
          userAgent: 'MELCloudOptimizer/1.0',
          baseUrl: 'https://api.met.no/weatherapi/locationforecast/2.0',
          timeout: 10000
        }
      };
      this.weatherCacheTimeout = 15 * 60 * 1000;
    }
  }

  async analyzeWeatherImpact(input: WeatherOptimizationInput): Promise<WeatherImpact> {
    return this.executeWithRetry(async () => {
      // Ensure weather data is current
      await this.updateWeatherData();

      // Analyze heating impact
      const heatingImpact = this.analyzeHeatingImpact(input);

      // Analyze hot water impact
      const hotWaterImpact = this.analyzeHotWaterImpact(input);

      // Analyze thermal mass strategy
      const thermalImpact = this.analyzeThermalImpact(input);

      return {
        heating: heatingImpact,
        hotWater: hotWaterImpact,
        thermal: thermalImpact
      };
    });
  }

  private async updateWeatherData(): Promise<void> {
    const now = Date.now();
    if (now - this.lastWeatherUpdate < this.weatherCacheTimeout) {
      return; // Use cached data
    }

    if (!this.weatherApi || !this.config) {
      this.logDebug('No weather API configured - using default assumptions');
      return;
    }

    try {
      // Get current weather
      const currentWeather = await this.weatherApi.getCurrentWeather();
      
      // Get forecast if available
      if (this.weatherApi.getForecast && this.config.location) {
        const forecastResponse = await this.weatherApi.getForecast(
          this.config.location.latitude,
          this.config.location.longitude,
          this.config.location.altitude
        );
        
        if (forecastResponse?.hourly) {
          this.forecastData = forecastResponse.hourly.slice(0, 24); // Next 24 hours
        }
      }

      // Add to history
      this.weatherHistory.push(currentWeather);
      
      // Keep only last 48 hours of data
      const cutoffTime = new Date(Date.now() - 48 * 60 * 60 * 1000);
      this.weatherHistory = this.weatherHistory.filter(
        weather => new Date(weather.timestamp) > cutoffTime
      );

      this.lastWeatherUpdate = now;
      this.logDebug('Weather data updated', { 
        temperature: currentWeather.temperature,
        humidity: currentWeather.humidity,
        forecastHours: this.forecastData?.length || 0
      });
    } catch (error) {
      this.logError(error as Error, { context: 'weather data update' });
      // Continue with cached/default data
    }
  }

  private analyzeHeatingImpact(input: WeatherOptimizationInput): WeatherImpact['heating'] {
    const outdoorTemp = input.currentOutdoorTemp;
    const indoorTargetTemp = input.targetIndoorTemp;
    const tempDifference = indoorTargetTemp - outdoorTemp;

    // Base efficiency on outdoor temperature (heat pump efficiency curve)
    let efficiency = 1.0;
    if (outdoorTemp < -10) {
      efficiency = 0.6; // Very cold - heat pump efficiency drops significantly
    } else if (outdoorTemp < 0) {
      efficiency = 0.8; // Cold weather - reduced efficiency
    } else if (outdoorTemp > 20) {
      efficiency = 1.1; // Warm weather - very efficient operation
    }

    // Calculate temperature adjustment based on weather conditions
    let adjustment = 0;
    let reasoning = 'Moderate weather conditions - maintain normal settings';

    if (tempDifference > 35) {
      // Very large temperature difference - reduce target for efficiency
      adjustment = -1.0;
      reasoning = 'Large indoor/outdoor temperature difference - reducing target for efficiency';
      efficiency *= 0.9;
    } else if (tempDifference < 15) {
      // Small temperature difference - can be more aggressive
      adjustment = 0.5;
      reasoning = 'Small indoor/outdoor temperature difference - can increase comfort';
      efficiency *= 1.1;
    }

    // Weather pattern analysis from forecast
    if (input.forecast && input.forecast.length > 0) {
      const next12Hours = input.forecast.slice(0, 12);
      const avgForecastTemp = next12Hours.reduce((sum, w) => sum + w.temperature, 0) / next12Hours.length;
      
      if (avgForecastTemp > outdoorTemp + 5) {
        adjustment += 0.3;
        reasoning += '. Weather warming up - slight comfort increase recommended';
      } else if (avgForecastTemp < outdoorTemp - 5) {
        adjustment -= 0.3;
        reasoning += '. Weather cooling down - slight conservation recommended';
      }
    }

    // Wind and humidity effects
    if (input.currentWeather.humidity && input.currentWeather.humidity > 80) {
      efficiency *= 0.95; // High humidity reduces efficiency slightly
      reasoning += '. High humidity detected';
    }

    if (input.currentWeather.windSpeed && input.currentWeather.windSpeed > 10) {
      adjustment += 0.2; // Higher wind increases heat loss
      efficiency *= 0.98;
      reasoning += '. High wind speed increases heat loss';
    }

    return {
      adjustment: Math.round(adjustment * 10) / 10,
      efficiency: Math.round(efficiency * 100) / 100,
      reasoning
    };
  }

  private analyzeHotWaterImpact(input: WeatherOptimizationInput): WeatherImpact['hotWater'] {
    const outdoorTemp = input.currentOutdoorTemp;
    
    // Hot water efficiency is less affected by outdoor temperature than space heating
    let efficiency = 1.0;
    let adjustment = 0;
    let reasoning = 'Standard hot water operation';

    if (outdoorTemp < 0) {
      efficiency = 0.9; // Some efficiency loss in very cold weather
      adjustment = 2; // Slightly higher temperature to compensate
      reasoning = 'Cold weather - slight temperature increase for efficiency';
    } else if (outdoorTemp > 25) {
      efficiency = 1.05; // Better efficiency in warm weather
      adjustment = -1; // Can reduce temperature slightly
      reasoning = 'Warm weather - can reduce hot water temperature for savings';
    }

    // Ground/water temperature effects (seasonal variation)
    const month = new Date().getMonth();
    if (month >= 5 && month <= 8) { // Summer months (June-September)
      adjustment -= 1;
      efficiency *= 1.02;
      reasoning += '. Summer operation - incoming water temperature higher';
    } else if (month >= 11 || month <= 2) { // Winter months (December-March)
      adjustment += 1;
      efficiency *= 0.98;
      reasoning += '. Winter operation - incoming water temperature lower';
    }

    // Price consideration for hot water (if available)
    if (input.currentPrice && input.avgPrice) {
      const priceRatio = input.currentPrice / input.avgPrice;
      if (priceRatio > 1.5) {
        // Very expensive electricity - reduce hot water temperature
        adjustment -= 1;
        reasoning += '. High electricity prices - reduce hot water temperature';
      } else if (priceRatio < 0.7) {
        // Very cheap electricity - can increase hot water temperature
        adjustment += 0.5;
        reasoning += '. Low electricity prices - can increase hot water temperature';
      }
    }

    return {
      adjustment: Math.round(adjustment * 10) / 10,
      efficiency: Math.round(efficiency * 100) / 100,
      reasoning
    };
  }

  private analyzeThermalImpact(input: WeatherOptimizationInput): WeatherImpact['thermal'] {
    const outdoorTemp = input.currentOutdoorTemp;
    const forecast = input.forecast || [];
    
    let massUtilization = 0.5; // Default moderate utilization
    let strategy: 'conserve' | 'utilize' | 'boost' = 'utilize';
    let reasoning = 'Standard thermal mass utilization';

    // Analyze temperature trends in forecast
    if (forecast.length >= 6) {
      const next6Hours = forecast.slice(0, 6);
      const tempTrend = next6Hours[5].temperature - next6Hours[0].temperature;
      
      if (tempTrend > 3) {
        // Temperature rising - utilize thermal mass to prepare
        massUtilization = 0.7;
        strategy = 'utilize';
        reasoning = 'Temperature rising - increase thermal mass utilization to prepare for warming';
      } else if (tempTrend < -3) {
        // Temperature falling - conserve thermal energy
        massUtilization = 0.3;
        strategy = 'conserve';
        reasoning = 'Temperature falling - conserve thermal mass for upcoming cold period';
      }
    }

    // Extreme weather handling
    if (outdoorTemp < -5) {
      massUtilization = 0.8;
      strategy = 'boost';
      reasoning = 'Very cold weather - maximize thermal mass to maintain comfort efficiently';
    } else if (outdoorTemp > 20) {
      massUtilization = 0.2;
      strategy = 'conserve';
      reasoning = 'Warm weather - minimal thermal mass needed';
    }

    // Weather volatility analysis
    if (forecast.length >= 12) {
      const temperatures = forecast.slice(0, 12).map(w => w.temperature);
      const tempRange = Math.max(...temperatures) - Math.min(...temperatures);
      
      if (tempRange > 10) {
        massUtilization = Math.min(0.9, massUtilization + 0.2);
        reasoning += '. High temperature volatility - increase thermal buffer';
      }
    }

    // Wind impact on thermal mass strategy
    if (input.currentWeather.windSpeed && input.currentWeather.windSpeed > 15) {
      massUtilization = Math.min(0.9, massUtilization + 0.1);
      reasoning += '. High wind speed - increase thermal mass for stability';
    }

    return {
      massUtilization: Math.round(massUtilization * 100) / 100,
      strategy,
      reasoning
    };
  }

  async getWeatherTrend(): Promise<WeatherTrend> {
    await this.updateWeatherData();

    if (!this.forecastData || this.forecastData.length < 12) {
      return {
        trend: 'unknown',
        details: 'Insufficient forecast data available',
        temperatureChange: 0,
        precipitation: 0,
        confidence: 0
      };
    }

    const next24Hours = this.forecastData.slice(0, 24);
    const temperatures = next24Hours.map(w => w.temperature);
    const firstTemp = temperatures[0];
    const lastTemp = temperatures[temperatures.length - 1];
    const tempDiff = lastTemp - firstTemp;

    // Calculate precipitation
    const precipitation = next24Hours.reduce((sum, w) => sum + (w.precipitation || 0), 0);

    // Determine trend
    let trend: WeatherTrend['trend'] = 'stable';
    let details = '';
    let confidence = 0.8;

    if (tempDiff > 3) {
      trend = 'warming';
      details = `Temperature rising by ${tempDiff.toFixed(1)}°C over next 24h`;
    } else if (tempDiff < -3) {
      trend = 'cooling';
      details = `Temperature falling by ${Math.abs(tempDiff).toFixed(1)}°C over next 24h`;
    } else {
      details = `Temperature relatively stable (${tempDiff.toFixed(1)}°C change)`;
    }

    if (precipitation > 0.5) {
      details += `, with ${precipitation.toFixed(1)}mm precipitation expected`;
      confidence *= 0.9; // Slightly less confident with precipitation
    }

    return {
      trend,
      details,
      temperatureChange: tempDiff,
      precipitation,
      confidence
    };
  }

  getWeatherHistory(): WeatherData[] {
    return [...this.weatherHistory];
  }

  getCurrentForecast(): WeatherData[] | null {
    return this.forecastData ? [...this.forecastData] : null;
  }

  async getWeatherStatistics(): Promise<WeatherStatistics> {
    if (this.weatherHistory.length === 0) {
      return {
        averageTemp: 15, // Default assumption
        tempRange: { min: 10, max: 20 },
        averageHumidity: 60,
        averageWindSpeed: 5,
        dataPoints: 0,
        lastUpdated: new Date().toISOString()
      };
    }

    const temperatures = this.weatherHistory.map(w => w.temperature);
    const humidities = this.weatherHistory.map(w => w.humidity).filter(h => h !== undefined) as number[];
    const windSpeeds = this.weatherHistory.map(w => w.windSpeed).filter(w => w !== undefined) as number[];

    return {
      averageTemp: Math.round((temperatures.reduce((sum, t) => sum + t, 0) / temperatures.length) * 10) / 10,
      tempRange: {
        min: Math.min(...temperatures),
        max: Math.max(...temperatures)
      },
      averageHumidity: humidities.length > 0 ? 
        Math.round(humidities.reduce((sum, h) => sum + h, 0) / humidities.length) : 60,
      averageWindSpeed: windSpeeds.length > 0 ?
        Math.round((windSpeeds.reduce((sum, w) => sum + w, 0) / windSpeeds.length) * 10) / 10 : 5,
      dataPoints: this.weatherHistory.length,
      lastUpdated: new Date(this.lastWeatherUpdate).toISOString()
    };
  }

  /**
   * Calculate heat loss coefficient based on weather conditions
   * @param indoorTemp Indoor temperature in Celsius
   * @param outdoorTemp Outdoor temperature in Celsius  
   * @param windSpeed Wind speed in m/s
   * @returns Heat loss coefficient
   */
  calculateHeatLossCoefficient(indoorTemp: number, outdoorTemp: number, windSpeed: number = 0): number {
    // Basic heat loss is proportional to temperature difference
    const tempDiff = indoorTemp - outdoorTemp;

    // Wind chill effect increases heat loss
    // Using a simplified model: higher wind speeds increase heat loss
    const windFactor = 1 + (windSpeed * 0.1); // 10% increase per m/s of wind

    return tempDiff * windFactor;
  }

  /**
   * Calculate solar gain coefficient based on cloud cover
   * @param cloudCover Cloud cover percentage (0-100)
   * @returns Solar gain coefficient (0-1)
   */
  calculateSolarGainCoefficient(cloudCover: number = 50): number {
    // Invert cloud cover to get solar intensity
    // 0% cloud cover = 100% solar gain = 1.0
    // 100% cloud cover = 0% solar gain = 0.0
    return (100 - Math.max(0, Math.min(100, cloudCover))) / 100;
  }

  /**
   * Calculate weather-based temperature adjustment
   * @param input Weather optimization input
   * @returns Temperature adjustment and reasoning
   */
  calculateWeatherBasedAdjustment(input: WeatherOptimizationInput): { adjustment: number; reason: string; factors: any } {
    if (!input.currentWeather) {
      return { adjustment: 0, reason: 'No weather data available', factors: {} };
    }

    const outdoorTemp = input.currentWeather.temperature;
    const windSpeed = input.currentWeather.windSpeed || 0;
    const cloudCover = input.currentWeather.cloudCover || 50;

    // Calculate heat loss coefficient
    const heatLoss = this.calculateHeatLossCoefficient(input.currentIndoorTemp, outdoorTemp, windSpeed);

    // Calculate solar gain coefficient
    const solarGain = this.calculateSolarGainCoefficient(cloudCover);

    // Calculate weather-based adjustment
    // Higher heat loss suggests increasing temperature
    // Higher solar gain suggests decreasing temperature
    const priceRatio = (input.currentPrice && input.avgPrice) ? input.currentPrice / input.avgPrice : 1.0;
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
      adjustment: Math.round(adjustment * 10) / 10,
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

  async updateConfiguration(newConfig: Partial<WeatherConfig>): Promise<void> {
    try {
      if (this.config) {
        // Update internal config
        this.config = { ...this.config, ...newConfig };
        
        // Update cache timeout if changed
        if (newConfig.cacheTimeout) {
          this.weatherCacheTimeout = newConfig.cacheTimeout * 60 * 1000;
        }

        // Try to save to configuration service (weather config will be part of optimization config)
        const currentOptimizationConfig = await this.configService.getConfig('optimization');
        await this.configService.updateConfig('optimization', {
          ...currentOptimizationConfig,
          weather: newConfig
        } as any);

        // Force weather data refresh if location changed
        if (newConfig.location) {
          this.lastWeatherUpdate = 0; // Force refresh
          await this.updateWeatherData();
        }

        this.logInfo('Weather integration service configuration updated', { newConfig });
      }
    } catch (error) {
      this.logError(error as Error, { newConfig });
      throw this.createServiceError(
        'Failed to update weather configuration',
        'WEATHER_CONFIG_ERROR',
        true
      );
    }
  }

  /**
   * Get the current weather configuration
   */
  getConfiguration(): WeatherConfig | null {
    return this.config ? { ...this.config } : null;
  }

  /**
   * Force refresh of weather data (ignores cache)
   */
  async forceRefresh(): Promise<void> {
    this.lastWeatherUpdate = 0; // Reset cache timestamp
    await this.updateWeatherData();
  }

  /**
   * Clear weather history and cache
   */
  clearCache(): void {
    this.weatherHistory = [];
    this.forecastData = null;
    this.lastWeatherUpdate = 0;
    this.logInfo('Weather cache cleared');
  }
}
