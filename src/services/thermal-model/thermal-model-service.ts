/**
 * Thermal Model Service
 *
 * This service integrates the thermal data collection and analysis
 * with the MELCloud optimizer to provide intelligent heating predictions
 * and optimizations based on the home's learned thermal characteristics.
 */

import { DateTime } from 'luxon';
import { ThermalDataCollector, ThermalDataPoint } from './data-collector';
import { ThermalAnalyzer, ThermalCharacteristics, HeatingPrediction } from './thermal-analyzer';

export interface OptimizationRecommendation {
  // Recommended target temperature
  recommendedTemperature: number;

  // Recommended start time for heating
  recommendedStartTime: string;

  // Estimated energy savings compared to constant temperature
  estimatedSavings: number;

  // Confidence in the recommendation (0-1)
  confidence: number;

  // Explanation of the recommendation
  explanation: string;
}

export class ThermalModelService {
  private dataCollector: ThermalDataCollector;
  private analyzer: ThermalAnalyzer;
  private dataCollectionInterval: any;
  private modelUpdateInterval: any;
  private lastDeviceState: any = null;

  constructor(private homey: any) {
    this.dataCollector = new ThermalDataCollector(homey);
    this.analyzer = new ThermalAnalyzer(homey);

    // Initialize data collection
    this.startDataCollection();

    // Schedule regular model updates
    this.scheduleModelUpdates();
  }

  /**
   * Start collecting thermal data at regular intervals
   */
  private startDataCollection(): void {
    // Collect data every 10 minutes
    this.dataCollectionInterval = setInterval(() => {
      this.collectDataPoint();
    }, 10 * 60 * 1000);

    // Collect initial data point
    this.collectDataPoint();

    this.homey.log('Thermal data collection started');
  }

  /**
   * Schedule regular updates to the thermal model
   */
  private scheduleModelUpdates(): void {
    // Update model every 6 hours
    this.modelUpdateInterval = setInterval(() => {
      this.updateThermalModel();
    }, 6 * 60 * 60 * 1000);

    // Initial model update
    setTimeout(() => {
      this.updateThermalModel();
    }, 30 * 60 * 1000); // First update after 30 minutes

    this.homey.log('Thermal model updates scheduled');
  }

  /**
   * Collect a single data point from current device state
   */
  private async collectDataPoint(): Promise<void> {
    try {
      // Get current device state from MELCloud API
      const melcloudApi = this.homey.melcloudApi;
      if (!melcloudApi) {
        this.homey.error('MELCloud API not available for thermal data collection');
        return;
      }

      const deviceState = await melcloudApi.getDeviceState();
      this.lastDeviceState = deviceState;

      // Get weather data
      const weatherApi = this.homey.weatherApi;
      let weatherData = {
        temperature: deviceState.OutdoorTemperature || 0,
        windSpeed: 0,
        humidity: 50,
        cloudCover: 50,
        precipitation: 0
      };

      if (weatherApi) {
        try {
          const currentWeather = await weatherApi.getCurrentWeather();
          weatherData = {
            temperature: currentWeather.temperature,
            windSpeed: currentWeather.windSpeed,
            humidity: currentWeather.humidity,
            cloudCover: currentWeather.cloudCover || 50,
            precipitation: currentWeather.precipitation || 0
          };
        } catch (weatherError) {
          this.homey.error('Error getting weather data for thermal model:', weatherError);
        }
      }

      // Create data point
      const dataPoint: ThermalDataPoint = {
        timestamp: DateTime.now().toISO(),
        indoorTemperature: deviceState.RoomTemperatureZone1 || 20,
        outdoorTemperature: weatherData.temperature,
        targetTemperature: deviceState.SetTemperatureZone1 || 20,
        heatingActive: !deviceState.IdleZone1,
        weatherConditions: {
          windSpeed: weatherData.windSpeed,
          humidity: weatherData.humidity,
          cloudCover: weatherData.cloudCover,
          precipitation: weatherData.precipitation
        }
      };

      // Add to collector
      this.dataCollector.addDataPoint(dataPoint);

    } catch (error) {
      this.homey.error('Error collecting thermal data point:', error);
    }
  }

  /**
   * Update the thermal model with collected data
   */
  private updateThermalModel(): void {
    try {
      // Get all data points
      const dataPoints = this.dataCollector.getAllDataPoints();

      if (dataPoints.length < 24) {
        this.homey.log(`Not enough data for thermal model update. Have ${dataPoints.length} points, need at least 24.`);
        return;
      }

      // Update the model
      const updatedCharacteristics = this.analyzer.updateModel(dataPoints);

      this.homey.log('Thermal model updated successfully');
      this.homey.log('New thermal characteristics:', JSON.stringify(updatedCharacteristics));

    } catch (error) {
      this.homey.error('Error updating thermal model:', error);
    }
  }

  /**
   * Get the optimal pre-heating start time to reach target temperature by a specific time
   * @param targetTemp Target temperature to reach
   * @param targetTime Time by which the target temperature should be reached
   * @param currentTemp Current indoor temperature
   * @param outdoorTemp Current outdoor temperature
   * @param weatherForecast Weather forecast for the relevant period
   */
  public getOptimalPreheatingTime(
    targetTemp: number,
    targetTime: string,
    currentTemp: number,
    outdoorTemp: number,
    weatherForecast: any
  ): string {
    try {
      const targetDateTime = DateTime.fromISO(targetTime);
      const now = DateTime.now();

      if (targetDateTime <= now) {
        return now.toISO(); // Target time is now or in the past
      }

      // Get thermal characteristics
      const characteristics = this.analyzer.getThermalCharacteristics();

      // If model confidence is too low, use a conservative estimate
      if (characteristics.modelConfidence < 0.3) {
        // Default to 2 hours before target time
        return targetDateTime.minus({ hours: 2 }).toISO();
      }

      // Calculate heating rate based on thermal characteristics
      const tempDiff = targetTemp - currentTemp;

      if (tempDiff <= 0) {
        return now.toISO(); // Already at or above target temperature
      }

      // Calculate heating time in hours
      const heatingRatePerHour = characteristics.heatingRate * tempDiff;
      const hoursNeeded = tempDiff / heatingRatePerHour;

      // Add safety margin based on model confidence (less confidence = more margin)
      const safetyMargin = (1 - characteristics.modelConfidence) * 1.5;
      const totalHoursNeeded = hoursNeeded + safetyMargin;

      // Calculate optimal start time
      const optimalStartTime = targetDateTime.minus({ hours: totalHoursNeeded });

      // Don't return a time in the past
      return optimalStartTime < now ? now.toISO() : optimalStartTime.toISO();

    } catch (error) {
      this.homey.error('Error calculating optimal preheating time:', error);
      // Fall back to default preheating time (2 hours)
      // Use current time + 2 hours as a safe default if targetTime is invalid
      return DateTime.now().toISO();
    }
  }

  /**
   * Get heating recommendation based on price forecast and thermal model
   * @param priceForecasts Electricity price forecasts
   * @param targetTemp Target temperature to maintain
   * @param currentTemp Current indoor temperature
   * @param outdoorTemp Current outdoor temperature
   * @param weatherForecast Weather forecast
   * @param comfortProfile User's comfort profile
   */
  public getHeatingRecommendation(
    priceForecasts: any[],
    targetTemp: number,
    currentTemp: number,
    outdoorTemp: number, // Used for future enhancements
    weatherForecast: any, // Used for future enhancements
    comfortProfile: any   // Used for future enhancements
  ): OptimizationRecommendation {
    // Note: outdoorTemp, weatherForecast, and comfortProfile parameters are currently not used
    // but are included for future enhancements and API consistency
    try {
      const characteristics = this.analyzer.getThermalCharacteristics();
      const now = DateTime.now();

      // Default recommendation
      const defaultRecommendation: OptimizationRecommendation = {
        recommendedTemperature: targetTemp,
        recommendedStartTime: now.toISO(),
        estimatedSavings: 0,
        confidence: characteristics.modelConfidence,
        explanation: "Recommendation based on thermal model with limited data."
      };

      // If model confidence is too low, return default recommendation
      if (characteristics.modelConfidence < 0.2) {
        return defaultRecommendation;
      }

      // Find periods of cheap and expensive electricity
      const avgPrice = priceForecasts.reduce((sum, p) => sum + p.price, 0) / priceForecasts.length;
      const cheapPeriods = priceForecasts.filter(p => p.price < avgPrice * 0.8);
      const expensivePeriods = priceForecasts.filter(p => p.price > avgPrice * 1.2);

      // If no price variation, return default
      if (cheapPeriods.length === 0 || expensivePeriods.length === 0) {
        return {
          ...defaultRecommendation,
          explanation: "No significant price variations found for optimization."
        };
      }

      // Calculate thermal inertia (how long the house retains heat)
      // Based on cooling rate and thermal mass
      const thermalInertiaHours = (1 / characteristics.coolingRate) * characteristics.thermalMass;

      // Find if we're approaching an expensive period
      const upcomingExpensivePeriod = expensivePeriods.find(p =>
        DateTime.fromISO(p.time) > now &&
        DateTime.fromISO(p.time).diff(now).as('hours') < 6
      );

      // Find if we're in a cheap period now
      const inCheapPeriod = cheapPeriods.some(p =>
        DateTime.fromISO(p.time) <= now &&
        DateTime.fromISO(p.time).plus({ hours: 1 }) > now
      );

      // Find next cheap period
      const nextCheapPeriod = cheapPeriods.find(p =>
        DateTime.fromISO(p.time) > now
      );

      let recommendation: OptimizationRecommendation;

      if (inCheapPeriod && upcomingExpensivePeriod) {
        // We're in a cheap period before an expensive one - pre-heat
        const preHeatTemp = Math.min(targetTemp + 1.5, targetTemp + (characteristics.thermalMass * 2));

        recommendation = {
          recommendedTemperature: preHeatTemp,
          recommendedStartTime: now.toISO(),
          estimatedSavings: this.calculateSavings(targetTemp, preHeatTemp, upcomingExpensivePeriod.price),
          confidence: characteristics.modelConfidence,
          explanation: `Pre-heating to ${preHeatTemp.toFixed(1)}°C during cheap electricity period to save during upcoming expensive period.`
        };
      } else if (upcomingExpensivePeriod) {
        // Expensive period coming up - prepare by pre-heating if we have time
        const hoursUntilExpensive = DateTime.fromISO(upcomingExpensivePeriod.time).diff(now).as('hours');

        if (hoursUntilExpensive < thermalInertiaHours) {
          // We have time to pre-heat
          const preHeatTemp = Math.min(targetTemp + 1, targetTemp + (characteristics.thermalMass * 1.5));

          recommendation = {
            recommendedTemperature: preHeatTemp,
            recommendedStartTime: now.toISO(),
            estimatedSavings: this.calculateSavings(targetTemp, preHeatTemp, upcomingExpensivePeriod.price),
            confidence: characteristics.modelConfidence * (hoursUntilExpensive / thermalInertiaHours),
            explanation: `Pre-heating to ${preHeatTemp.toFixed(1)}°C to prepare for upcoming expensive electricity period.`
          };
        } else {
          // Too far away to pre-heat now
          // Ensure time is valid before using it
          let preHeatTime: string = now.toISO();

          if (upcomingExpensivePeriod && typeof upcomingExpensivePeriod.time === 'string') {
            try {
              preHeatTime = DateTime.fromISO(upcomingExpensivePeriod.time)
                .minus({ hours: thermalInertiaHours })
                .toISO();
            } catch (err) {
              this.homey.error('Error calculating preheat time:', err);
            }
          }

          recommendation = {
            ...defaultRecommendation,
            recommendedStartTime: preHeatTime,
            explanation: "Maintaining normal temperature now, will pre-heat before expensive period."
          };
        }
      } else if (nextCheapPeriod) {
        // Cheap period coming up - consider waiting for heating
        const hoursUntilCheap = DateTime.fromISO(nextCheapPeriod.time).diff(now).as('hours');

        if (hoursUntilCheap < 3 && currentTemp > targetTemp - 1.5) {
          // Close enough to cheap period and temperature is acceptable
          const reducedTemp = Math.max(targetTemp - 1, targetTemp - (characteristics.thermalMass * 1.5));

          // Ensure we have a valid time
          const startTime = typeof nextCheapPeriod.time === 'string' ?
            nextCheapPeriod.time : now.toISO();

          recommendation = {
            recommendedTemperature: reducedTemp,
            recommendedStartTime: startTime,
            estimatedSavings: this.calculateSavings(targetTemp, reducedTemp, avgPrice),
            confidence: characteristics.modelConfidence * 0.8,
            explanation: `Temporarily reducing temperature to ${reducedTemp.toFixed(1)}°C until cheaper electricity period begins.`
          };
        } else {
          // Too long to wait or temperature would drop too much
          recommendation = {
            ...defaultRecommendation,
            explanation: "Maintaining target temperature as waiting for cheaper electricity would impact comfort."
          };
        }
      } else {
        // No special price patterns detected
        recommendation = {
          ...defaultRecommendation,
          explanation: "Maintaining target temperature based on current conditions."
        };
      }

      return recommendation;

    } catch (error) {
      this.homey.error('Error generating heating recommendation:', error);
      return {
        recommendedTemperature: targetTemp,
        recommendedStartTime: DateTime.now().toISO(),
        estimatedSavings: 0,
        confidence: 0,
        explanation: "Error generating recommendation, using default settings."
      };
    }
  }

  /**
   * Calculate estimated savings from thermal optimization
   */
  private calculateSavings(normalTemp: number, optimizedTemp: number, expensivePrice: number): number {
    try {
      const characteristics = this.analyzer.getThermalCharacteristics();

      // Calculate energy difference between heating strategies
      const tempDiff = Math.abs(normalTemp - optimizedTemp);

      // Simplified energy calculation based on temperature difference
      // This is a rough estimate - actual savings would depend on many factors
      const energySavingFactor = 0.1 * tempDiff * characteristics.thermalMass;

      // Calculate monetary savings based on price
      const savings = energySavingFactor * expensivePrice;

      return Math.round(savings * 100) / 100; // Round to 2 decimal places
    } catch (error) {
      this.homey.error('Error calculating savings:', error);
      return 0;
    }
  }

  /**
   * Get the current thermal characteristics
   */
  public getThermalCharacteristics(): ThermalCharacteristics {
    return this.analyzer.getThermalCharacteristics();
  }

  /**
   * Get prediction for how temperature will change
   */
  public getTemperaturePrediction(
    currentTemp: number,
    targetTemp: number,
    outdoorTemp: number,
    heatingActive: boolean,
    weatherConditions: any,
    minutes: number
  ): number {
    return this.analyzer.predictTemperature(
      currentTemp,
      targetTemp,
      outdoorTemp,
      heatingActive,
      weatherConditions,
      minutes
    );
  }

  /**
   * Calculate time needed to reach target temperature
   */
  public getTimeToTarget(
    currentTemp: number,
    targetTemp: number,
    outdoorTemp: number,
    weatherConditions: any
  ): HeatingPrediction {
    return this.analyzer.calculateTimeToTarget(
      currentTemp,
      targetTemp,
      outdoorTemp,
      weatherConditions
    );
  }

  /**
   * Stop all data collection and model updates
   */
  public stop(): void {
    if (this.dataCollectionInterval) {
      clearInterval(this.dataCollectionInterval);
    }

    if (this.modelUpdateInterval) {
      clearInterval(this.modelUpdateInterval);
    }

    this.homey.log('Thermal model service stopped');
  }
}
