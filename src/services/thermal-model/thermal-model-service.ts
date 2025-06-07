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
import { HomeyApp, PricePoint, WeatherData } from '../../types';
import { validateNumber, validateBoolean } from '../../util/validation';

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
  private dataCollectionInterval: NodeJS.Timeout | null = null;
  private modelUpdateInterval: NodeJS.Timeout | null = null;
  private dataCleanupInterval: NodeJS.Timeout | null = null;

  constructor(private homey: HomeyApp) {
    this.dataCollector = new ThermalDataCollector(homey);
    this.analyzer = new ThermalAnalyzer(homey);

    // Remove the 10-minute data collection interval
    // this.startDataCollection();

    // Keep the model updates schedule
    this.scheduleModelUpdates();
  }

  /**
   * Start collecting thermal data at regular intervals
   * This method is no longer used as data collection happens in the hourly optimization
   */
  private startDataCollection(): void {
    // Method kept for reference but no longer called
    this.homey.log('Thermal data collection now happens during hourly optimization');

    // If we wanted to collect data at intervals, we would use:
    // this.dataCollectionInterval = setInterval(() => {
    //   this.collectDataPointFromDevice();
    // }, 10 * 60 * 1000); // Every 10 minutes
  }

  /**
   * Schedule regular updates to the thermal model
   */
  private scheduleModelUpdates(): void {
    // Update model every 6 hours
    this.modelUpdateInterval = setInterval(() => {
      this.updateThermalModel();
    }, 6 * 60 * 60 * 1000);

    // Clean up old data once a day
    // Reduced from 24 hours to 12 hours to better manage memory
    this.dataCleanupInterval = setInterval(() => {
      this.cleanupOldData();
    }, 12 * 60 * 60 * 1000);

    // Initial model update
    setTimeout(() => {
      this.updateThermalModel();
    }, 30 * 60 * 1000); // First update after 30 minutes

    // Initial data cleanup
    setTimeout(() => {
      this.cleanupOldData();
    }, 60 * 60 * 1000); // First cleanup after 1 hour

    this.homey.log('Thermal model updates and data cleanup scheduled (cleanup every 12 hours)');
  }

  /**
   * Collect a single data point from current device state
   */
  private async collectDataPointFromDevice(): Promise<void> {
    try {
      // Get current device state from MELCloud API
      const melcloudApi = this.homey.melcloudApi;
      if (!melcloudApi) {
        this.homey.error('MELCloud API not available for thermal data collection');
        return;
      }

      const deviceState = await melcloudApi.getDeviceState();

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
   * Now uses both detailed and aggregated data for better analysis
   * @returns The updated thermal characteristics or default values if update fails
   */
  private updateThermalModel(): ThermalCharacteristics {
    try {
      // Get combined data (detailed + aggregated) for more comprehensive analysis
      const combinedData = this.dataCollector.getCombinedDataForAnalysis();
      const dataPoints = this.dataCollector.getAllDataPoints();

      // Log data availability
      this.homey.log(`Updating thermal model with ${dataPoints.length} detailed points and ${combinedData.aggregated.length} aggregated data points`);
      this.homey.log(`Total data points represented: ${combinedData.totalDataPoints}`);

      if (dataPoints.length < 24) {
        this.homey.log(`Not enough data for thermal model update. Have ${dataPoints.length} points, need at least 24.`);
        return {
          heatingRate: 0,
          coolingRate: 0,
          outdoorTempImpact: 0,
          windImpact: 0,
          thermalMass: 0,
          modelConfidence: 0,
          lastUpdated: DateTime.now().toISO()
        };
      }

      // Get memory usage before update
      const memoryBefore = this.dataCollector.getMemoryUsage();

      // Update the model with detailed data points
      // Note: In the future, we could enhance the analyzer to also use aggregated data
      const updatedCharacteristics = this.analyzer.updateModel(dataPoints);

      // Get memory usage after update
      const memoryAfter = this.dataCollector.getMemoryUsage();

      // Calculate memory impact of the update
      const memoryImpact = memoryAfter.estimatedMemoryUsageKB - memoryBefore.estimatedMemoryUsageKB;

      this.homey.log('Thermal model updated successfully');
      this.homey.log(`Memory impact of update: ${memoryImpact}KB`);
      this.homey.log('New thermal characteristics:', JSON.stringify(updatedCharacteristics));

      return updatedCharacteristics;
    } catch (error) {
      this.homey.error('Error updating thermal model:', error);
      return {
        heatingRate: 0,
        coolingRate: 0,
        outdoorTempImpact: 0,
        windImpact: 0,
        thermalMass: 0,
        modelConfidence: 0,
        lastUpdated: DateTime.now().toISO()
      };
    }
  }

  /**
   * Clean up old data to manage memory usage
   * This method now uses the data collector's aggregation functionality
   * to preserve historical patterns while reducing memory usage
   */
  private cleanupOldData(): void {
    try {
      // Get memory usage statistics before cleanup
      const beforeStats = this.dataCollector.getMemoryUsage();

      // First, trigger data aggregation for older data points
      // This will preserve the information in aggregated form while reducing memory usage
      this.homey.log('Running thermal data cleanup and aggregation...');

      // The data collector now handles removing old data points and aggregating older data
      // We don't need to manually filter by date anymore

      // Trigger aggregation of older data
      // This is now handled internally by the data collector
      // which will aggregate data older than 7 days and keep only the last 30 days

      // Get all data points (this will trigger removeOldDataPoints in the data collector)
      const dataPoints = this.dataCollector.getAllDataPoints();

      // Get data statistics for reporting
      const dataStats = this.dataCollector.getDataStatistics(30);

      // Log cleanup results
      const afterStats = this.dataCollector.getMemoryUsage();

      this.homey.log(`Thermal data cleanup complete.`);
      this.homey.log(`Data points: ${beforeStats.dataPointCount} → ${afterStats.dataPointCount}`);
      this.homey.log(`Aggregated data points: ${beforeStats.aggregatedDataCount} → ${afterStats.aggregatedDataCount}`);
      this.homey.log(`Estimated memory usage: ${beforeStats.estimatedMemoryUsageKB}KB → ${afterStats.estimatedMemoryUsageKB}KB`);
      this.homey.log(`Data statistics: ${dataStats.dataPointCount} points over last 30 days, avg indoor temp: ${dataStats.avgIndoorTemp}°C`);

      // Update the thermal model with the cleaned data
      this.updateThermalModel();
    } catch (error) {
      this.homey.error('Error cleaning up old thermal data:', error);
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
    weatherForecast: WeatherData
  ): string {
    // Prevent unused parameter warnings
    void(outdoorTemp); void(weatherForecast);
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
        const result = targetDateTime.minus({ hours: 2 }).toISO();
        // Ensure we never return null (TypeScript safety)
        return result || now.toISO();
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
      const result = optimalStartTime < now ? now.toISO() : optimalStartTime.toISO();
      // Ensure we never return null (TypeScript safety)
      return result || now.toISO();

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
    priceForecasts: PricePoint[],
    targetTemp: number,
    currentTemp: number,
    outdoorTemp: number,
    weatherForecast: WeatherData,
    comfortProfile: {
      enabled: boolean; // Added
      dayStart: number;
      dayEnd: number;
      nightTempReduction: number;
      preHeatHours: number;
    }
  ): OptimizationRecommendation {
    // Note: outdoorTemp (current device outdoor temp) and weatherForecast (external forecast) are now used.
    try {
      const characteristics = this.analyzer.getThermalCharacteristics();
      const now = DateTime.now();
      const currentHour = now.hour;

      let effectiveTargetTemp = targetTemp;
      const preheatTargetTemp = targetTemp; // Original target is the goal for pre-heating
      let comfortExplanation = "";

      if (comfortProfile.enabled) {
        this.homey.log(`Comfort profile enabled: Day ${comfortProfile.dayStart}-${comfortProfile.dayEnd}, Reduction ${comfortProfile.nightTempReduction}°C, PreHeat ${comfortProfile.preHeatHours}h`);
        let isDayTime = false;
        if (comfortProfile.dayStart <= comfortProfile.dayEnd) { // Normal day period e.g., 7 to 22
          isDayTime = currentHour >= comfortProfile.dayStart && currentHour < comfortProfile.dayEnd;
        } else { // Overnight day period e.g., 22 to 7 (day is 22-23 and 0-6)
          isDayTime = currentHour >= comfortProfile.dayStart || currentHour < comfortProfile.dayEnd;
        }

        if (!isDayTime) {
          effectiveTargetTemp = targetTemp - comfortProfile.nightTempReduction;
          comfortExplanation = `Night reduction active (target ${effectiveTargetTemp.toFixed(1)}°C). `;
          this.homey.log(`Comfort profile: Night period. Effective target: ${effectiveTargetTemp}°C (Original: ${targetTemp}°C)`);

          // Check for pre-heating for the upcoming day period
          const hoursUntilDayStart = (comfortProfile.dayStart - currentHour + 24) % 24;
          if (comfortProfile.preHeatHours > 0 && hoursUntilDayStart > 0 && hoursUntilDayStart <= comfortProfile.preHeatHours) {
            // We are in the pre-heat window for the day period
            // The goal is to reach `preheatTargetTemp` (original targetTemp) by `comfortProfile.dayStart`
            // The optimization logic below should consider this.
            // For now, we adjust effectiveTargetTemp if preheating for day is more important than night reduction.
            // This implies that if we need to preheat for the day, we ignore the night reduction.
            effectiveTargetTemp = preheatTargetTemp;
            comfortExplanation = `Pre-heating for day period (target ${preheatTargetTemp.toFixed(1)}°C). `;
            this.homey.log(`Comfort profile: Pre-heating for day start. Aiming for ${preheatTargetTemp}°C.`);
          }
        } else {
          comfortExplanation = `Day period active (target ${targetTemp.toFixed(1)}°C). `;
          this.homey.log(`Comfort profile: Day period. Target: ${targetTemp}°C`);
        }
      } else {
        this.homey.log('Comfort profile: Disabled. Using original target temperature.');
        comfortExplanation = "Comfort profile disabled. ";
      }

      // Default recommendation - uses effectiveTargetTemp which reflects comfort profile adjustments
      const defaultRecommendation: OptimizationRecommendation = {
        recommendedTemperature: effectiveTargetTemp,
        recommendedStartTime: now.toISO(),
        estimatedSavings: 0, // Will be calculated later if optimization occurs
        confidence: characteristics.modelConfidence,
        explanation: comfortProfile.enabled ?
                       `${comfortExplanation}Maintaining temperature based on comfort profile and current conditions.` :
                       "Maintaining target temperature based on current conditions (comfort profile disabled)."
      };

      // If model confidence is too low, return default recommendation (already adjusted for comfort profile)
      if (characteristics.modelConfidence < 0.2) {
        this.homey.log("Low model confidence, returning default recommendation.");
        return defaultRecommendation;
      }

      // Find periods of cheap and expensive electricity
      const avgPrice = priceForecasts.reduce((sum, p) => sum + p.price, 0) / priceForecasts.length;
      const cheapPeriods = priceForecasts.filter(p => p.price < avgPrice * 0.8);
      const expensivePeriods = priceForecasts.filter(p => p.price > avgPrice * 1.2);

      // If no price variation, return default (already adjusted for comfort)
      if (cheapPeriods.length === 0 || expensivePeriods.length === 0) {
        this.homey.log("No significant price variations, returning default recommendation.");
        defaultRecommendation.explanation = comfortExplanation + "No significant price variations for optimization.";
        return defaultRecommendation;
      }

      // Calculate thermal inertia (how long the house retains heat)
      // Base calculation using learned characteristics
      let thermalInertiaHours = (1 / characteristics.coolingRate) * characteristics.thermalMass;
      let weatherExplanation = ""; // For logging and user messages

      // Dynamically adjust thermal inertia based on current/forecasted weather
      const currentOutdoorTemp = weatherForecast?.temperature ?? outdoorTemp; // Prioritize forecast temp
      const currentWindSpeed = weatherForecast?.windSpeed ?? 0;

      if (currentOutdoorTemp < 0) {
        thermalInertiaHours *= 0.75;
        weatherExplanation += `Significantly reduced thermal inertia due to very cold conditions (${currentOutdoorTemp.toFixed(1)}°C). `;
      } else if (currentOutdoorTemp < 10) {
        thermalInertiaHours *= 0.9;
        weatherExplanation += `Slightly reduced thermal inertia due to cool conditions (${currentOutdoorTemp.toFixed(1)}°C). `;
      }

      if (currentWindSpeed > 15) { // m/s
        thermalInertiaHours *= 0.8;
        weatherExplanation += `Reduced thermal inertia due to high wind (${currentWindSpeed.toFixed(1)} m/s). `;
      } else if (currentWindSpeed > 7) {
        thermalInertiaHours *= 0.9;
        weatherExplanation += `Slightly reduced thermal inertia due to wind (${currentWindSpeed.toFixed(1)} m/s). `;
      }
      if (weatherExplanation) {
        this.homey.log(`WeatherImpact: ${weatherExplanation} Original inertia: ${((1 / characteristics.coolingRate) * characteristics.thermalMass).toFixed(2)}h, Adjusted: ${thermalInertiaHours.toFixed(2)}h`);
      }


      // Find if we're approaching an expensive period
      const upcomingExpensivePeriod = expensivePeriods.find(p =>
        DateTime.fromISO(p.time) > now &&
        DateTime.fromISO(p.time).diff(now).as('hours') < 6 // Consider expensive periods within the next 6 hours
      );

      // Find if we're in a cheap period now
      const inCheapPeriod = cheapPeriods.some(p =>
        DateTime.fromISO(p.time) <= now &&
        DateTime.fromISO(p.time).plus({ hours: 1 }) > now // Current hour is within a cheap period
      );

      // Find next cheap period
      const nextCheapPeriod = cheapPeriods.find(p =>
        DateTime.fromISO(p.time) > now
      );

      let recommendation: OptimizationRecommendation = { ...defaultRecommendation }; // Start with default

      if (inCheapPeriod && upcomingExpensivePeriod) {
        // We're in a cheap period before an expensive one - pre-heat.
        let preHeatBuffer = 1.5; // Default buffer
        let weatherPreHeatExplanation = "";
        if (currentOutdoorTemp < 5) { preHeatBuffer += 0.5; weatherPreHeatExplanation += `Colder (${currentOutdoorTemp.toFixed(1)}°C). `; }
        if (currentWindSpeed > 10) { preHeatBuffer += 0.5; weatherPreHeatExplanation += `Windy (${currentWindSpeed.toFixed(1)}m/s). `; }

        const calculatedPreHeatTemp = Math.min(preheatTargetTemp + preHeatBuffer, preheatTargetTemp + (characteristics.thermalMass * 2.5)); // Max buffer, e.g. thermalMass * 2.5

        let explanation = `${comfortExplanation}${weatherExplanation}Pre-heating to ${calculatedPreHeatTemp.toFixed(1)}°C during cheap electricity (due to ${weatherPreHeatExplanation || 'standard conditions'}) to save during upcoming expensive period.`;

        recommendation = {
          recommendedTemperature: calculatedPreHeatTemp,
          recommendedStartTime: now.toISO(),
          estimatedSavings: this.calculateSavings(effectiveTargetTemp, calculatedPreHeatTemp, upcomingExpensivePeriod.price),
          confidence: characteristics.modelConfidence,
          explanation: explanation
        };
        this.homey.log(`PriceLogic: Cheap period before expensive. Pre-heating to ${calculatedPreHeatTemp.toFixed(1)}°C. ${weatherPreHeatExplanation}`);
      } else if (upcomingExpensivePeriod) {
        // Expensive period coming up - prepare by pre-heating if we have time, using dynamicThermalInertiaHours.
        const hoursUntilExpensive = DateTime.fromISO(upcomingExpensivePeriod.time).diff(now).as('hours');

        if (hoursUntilExpensive < thermalInertiaHours) { // Use dynamically adjusted inertia
          let preHeatBuffer = 1.0; // Default buffer
          let weatherPreHeatExplanation = "";
          if (currentOutdoorTemp < 5) { preHeatBuffer += 0.5; weatherPreHeatExplanation += `Colder (${currentOutdoorTemp.toFixed(1)}°C). `; }
          if (currentWindSpeed > 10) { preHeatBuffer += 0.5; weatherPreHeatExplanation += `Windy (${currentWindSpeed.toFixed(1)}m/s). `; }

          const calculatedPreHeatTemp = Math.min(preheatTargetTemp + preHeatBuffer, preheatTargetTemp + (characteristics.thermalMass * 2.0));
          let explanation = `${comfortExplanation}${weatherExplanation}Pre-heating to ${calculatedPreHeatTemp.toFixed(1)}°C (due to ${weatherPreHeatExplanation || 'standard conditions'}) to prepare for upcoming expensive electricity.`;

          recommendation = {
            recommendedTemperature: calculatedPreHeatTemp,
            recommendedStartTime: now.toISO(),
            estimatedSavings: this.calculateSavings(effectiveTargetTemp, calculatedPreHeatTemp, upcomingExpensivePeriod.price),
            confidence: characteristics.modelConfidence * (hoursUntilExpensive / thermalInertiaHours), // Confidence based on dynamic inertia
            explanation: explanation
          };
          this.homey.log(`PriceLogic: Upcoming expensive period. Pre-heating to ${calculatedPreHeatTemp.toFixed(1)}°C. ${weatherPreHeatExplanation} Dynamic Inertia: ${thermalInertiaHours.toFixed(2)}h`);
        } else {
          // Too far away to pre-heat now for price reasons.
          recommendation.explanation = `${comfortExplanation}${weatherExplanation}Maintaining temperature. Will pre-heat later if needed for expensive period. Dynamic Inertia: ${thermalInertiaHours.toFixed(2)}h`;
          this.homey.log(`PriceLogic: Expensive period too far. Using default recommendation logic. Dynamic Inertia: ${thermalInertiaHours.toFixed(2)}h`);
        }
      } else if (nextCheapPeriod) {
        // Cheap period coming up - consider waiting for heating if it doesn't compromise comfort too much.
        const hoursUntilCheap = DateTime.fromISO(nextCheapPeriod.time).diff(now).as('hours');

        // Only reduce if current temp is above the (potentially night-reduced) effectiveTargetTemp minus a small buffer
        // And if not currently in a pre-heat window for the day start.
        let canReduceForUpcomingCheap = currentTemp > effectiveTargetTemp - 0.5; // Check against current effective target
        if (comfortProfile.enabled) {
            const hoursUntilDayStart = (comfortProfile.dayStart - currentHour + 24) % 24;
            if (comfortProfile.preHeatHours > 0 && hoursUntilDayStart > 0 && hoursUntilDayStart <= comfortProfile.preHeatHours) {
                canReduceForUpcomingCheap = false; // Don't reduce if we are pre-heating for day
            }
        }

        if (hoursUntilCheap < 3 && canReduceForUpcomingCheap) {
          // Reduce temperature slightly, but not below a comfortable minimum or the night-reduced target.
          const reducedTemp = Math.max(effectiveTargetTemp - 1, effectiveTargetTemp - (characteristics.thermalMass * 0.5), this.homey.app.minComfortTemp || 18); // Ensure a floor

          recommendation = {
            recommendedTemperature: reducedTemp,
            recommendedStartTime: nextCheapPeriod.time, // Start heating when cheap period begins
            estimatedSavings: this.calculateSavings(effectiveTargetTemp, reducedTemp, avgPrice), // Savings vs current effective target
            confidence: characteristics.modelConfidence * 0.8,
            explanation: `${comfortExplanation}${weatherExplanation}Temporarily reducing to ${reducedTemp.toFixed(1)}°C until cheaper electricity at ${DateTime.fromISO(nextCheapPeriod.time).toFormat('HH:mm')}.`
          };
          this.homey.log(`PriceLogic: Upcoming cheap period. Reducing to ${reducedTemp.toFixed(1)}°C. ${weatherExplanation}`);
        } else {
          // Default recommendation applies (already set).
          recommendation.explanation = `${comfortExplanation}${weatherExplanation}Maintaining temperature. Waiting for cheaper electricity would impact comfort or is too far.`;
          this.homey.log(`PriceLogic: Cheap period too far or would impact comfort. Using default recommendation logic. ${weatherExplanation}`);
        }
      } else {
        // No special price patterns. Default recommendation applies.
        recommendation.explanation = `${comfortExplanation}${weatherExplanation}Maintaining temperature based on current conditions.`;
        this.homey.log(`PriceLogic: No specific price patterns. Using default recommendation logic. ${weatherExplanation}`);
      }

      // Final check: if comfort profile demands pre-heating for day, and price logic decided lower, override.
      // This pre-heating for day start should also consider weather for its aggressiveness if needed,
      // but for now, it simply ensures the target is met.
      if (comfortProfile.enabled) {
        let isDayTime = false;
        if (comfortProfile.dayStart <= comfortProfile.dayEnd) { isDayTime = currentHour >= comfortProfile.dayStart && currentHour < comfortProfile.dayEnd; }
        else { isDayTime = currentHour >= comfortProfile.dayStart || currentHour < comfortProfile.dayEnd; }

        const hoursUntilDayStart = (comfortProfile.dayStart - currentHour + 24) % 24;
        if (!isDayTime && comfortProfile.preHeatHours > 0 && hoursUntilDayStart > 0 && hoursUntilDayStart <= comfortProfile.preHeatHours) {
          // Determine if weather conditions warrant a more aggressive pre-heat to reach dayTarget by dayStart
          let dayPreHeatTarget = preheatTargetTemp;
          let weatherDayPreHeatExplanation = "";
          if (currentOutdoorTemp < 2) { // More aggressive if very cold for day pre-heat
            dayPreHeatTarget += 0.5;
            weatherDayPreHeatExplanation += `More aggressive day pre-heat due to very cold (${currentOutdoorTemp.toFixed(1)}°C). `;
          }
          if (currentWindSpeed > 12) {
             dayPreHeatTarget += 0.5;
             weatherDayPreHeatExplanation += `More aggressive day pre-heat due to high wind (${currentWindSpeed.toFixed(1)}m/s). `;
          }
          dayPreHeatTarget = Math.min(dayPreHeatTarget, preheatTargetTemp + 1.5); // Cap day pre-heat adjustment


          if (recommendation.recommendedTemperature < dayPreHeatTarget) {
            this.homey.log(`OVERRIDE: Comfort pre-heat for day start. Setting to ${dayPreHeatTarget.toFixed(1)}°C from ${recommendation.recommendedTemperature.toFixed(1)}°C. ${weatherDayPreHeatExplanation}`);
            recommendation.recommendedTemperature = dayPreHeatTarget;
            recommendation.explanation = `${comfortExplanation}${weatherExplanation}${weatherDayPreHeatExplanation}Pre-heating to ${dayPreHeatTarget.toFixed(1)}°C for upcoming day period, overriding other optimizations.`;
            recommendation.estimatedSavings = 0;
          }
        }
      }

      // Ensure final recommended temperature is within global min/max if defined in Homey App settings
      if (this.homey.app.minDeviceTemp && recommendation.recommendedTemperature < this.homey.app.minDeviceTemp) {
        recommendation.recommendedTemperature = this.homey.app.minDeviceTemp;
      }
      if (this.homey.app.maxDeviceTemp && recommendation.recommendedTemperature > this.homey.app.maxDeviceTemp) {
        recommendation.recommendedTemperature = this.homey.app.maxDeviceTemp;
      }

      return recommendation;

    } catch (error) {
      this.homey.error('Error generating heating recommendation:', error);
      // Fallback uses original targetTemp if comfortProfile is not available or parsing fails
      const fallbackTemp = comfortProfile && comfortProfile.enabled === false ? targetTemp : (comfortProfile ? targetTemp - (comfortProfile.nightTempReduction ?? 0) : targetTemp);
      return {
        recommendedTemperature: fallbackTemp,
        recommendedStartTime: DateTime.now().toISO(),
        estimatedSavings: 0,
        confidence: 0,
        explanation: "Error generating recommendation, using default settings adjusted for comfort profile if possible."
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
    try {
      return this.analyzer.getThermalCharacteristics();
    } catch (error) {
      this.homey.error('Error getting thermal characteristics:', error);
      return {
        heatingRate: 0,
        coolingRate: 0,
        outdoorTempImpact: 0,
        windImpact: 0,
        thermalMass: 0,
        modelConfidence: 0,
        lastUpdated: DateTime.now().toISO()
      };
    }
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
   * @param currentTemp Current indoor temperature
   * @param targetTemp Target temperature to reach
   * @param outdoorTemp Current outdoor temperature
   * @param weatherConditions Weather conditions
   * @returns Heating prediction with time to target and confidence
   * @throws Error if validation fails
   */
  public getTimeToTarget(
    currentTemp: number,
    targetTemp: number,
    outdoorTemp: number,
    weatherConditions: any
  ): HeatingPrediction {
    // Default value for validated current temp in case of error
    let validatedCurrentTemp: number = 20; // Default to room temperature

    try {
      // Validate inputs
      validatedCurrentTemp = validateNumber(currentTemp, 'currentTemp', { min: -10, max: 40 });
      const validatedTargetTemp = validateNumber(targetTemp, 'targetTemp', { min: 5, max: 30 });
      const validatedOutdoorTemp = validateNumber(outdoorTemp, 'outdoorTemp', { min: -50, max: 50 });

      // Validate or create default weather conditions
      let validatedWeatherConditions = {
        windSpeed: 0,
        humidity: 50,
        cloudCover: 50,
        precipitation: 0
      };

      if (weatherConditions) {
        validatedWeatherConditions = {
          windSpeed: validateNumber(weatherConditions.windSpeed || 0, 'windSpeed', { min: 0, max: 200 }),
          humidity: validateNumber(weatherConditions.humidity || 50, 'humidity', { min: 0, max: 100 }),
          cloudCover: validateNumber(weatherConditions.cloudCover || 50, 'cloudCover', { min: 0, max: 100 }),
          precipitation: validateNumber(weatherConditions.precipitation || 0, 'precipitation', { min: 0, max: 500 })
        };
      }

      return this.analyzer.calculateTimeToTarget(
        validatedCurrentTemp,
        validatedTargetTemp,
        validatedOutdoorTemp,
        validatedWeatherConditions
      );
    } catch (error) {
      this.homey.error('Error calculating time to target:', error);
      // If we couldn't validate the current temp, use a safe default
      if (typeof validatedCurrentTemp === 'undefined') {
        validatedCurrentTemp = 20; // Default room temperature
      }
      // Return a default prediction with zero confidence
      return {
        timeToTarget: 60, // Default 60 minutes
        confidence: 0,
        predictedTemperature: validatedCurrentTemp // Use current temperature as prediction
      };
    }
  }

  /**
   * Stop all data collection and model updates
   * Ensures proper cleanup of resources
   */
  public stop(): void {
    try {
      // Run final data cleanup to ensure data is properly saved
      try {
        this.cleanupOldData();
      } catch (cleanupError) {
        this.homey.error('Error during final data cleanup:', cleanupError);
      }

      // Clear all intervals
      if (this.dataCollectionInterval) {
        clearInterval(this.dataCollectionInterval);
        this.dataCollectionInterval = null;
        this.homey.log('Thermal model data collection interval stopped');
      }

      if (this.modelUpdateInterval) {
        clearInterval(this.modelUpdateInterval);
        this.modelUpdateInterval = null;
        this.homey.log('Thermal model update interval stopped');
      }

      if (this.dataCleanupInterval) {
        clearInterval(this.dataCleanupInterval);
        this.dataCleanupInterval = null;
        this.homey.log('Thermal model data cleanup interval stopped');
      }

      // Log memory usage statistics before stopping
      try {
        const memoryStats = this.dataCollector.getMemoryUsage();
        this.homey.log(`Final memory stats - Data points: ${memoryStats.dataPointCount}, Aggregated: ${memoryStats.aggregatedDataCount}, Memory: ${memoryStats.estimatedMemoryUsageKB}KB`);
      } catch (statsError) {
        this.homey.error('Error getting final memory statistics:', statsError);
      }

      this.homey.log('Thermal model service stopped and resources cleaned up');
    } catch (error) {
      this.homey.error('Error stopping thermal model service:', error);
    }
  }

  /**
   * Collect a data point from the optimizer
   * @param dataPoint The thermal data point to collect
   * @throws Error if validation fails
   */
  public collectDataPoint(dataPoint: ThermalDataPoint): void {
    try {
      // Validate data point
      if (!dataPoint) {
        throw new Error('Invalid data point: data point is null or undefined');
      }

      // Validate required fields
      const timestamp = dataPoint.timestamp || DateTime.now().toISO();
      const indoorTemperature = validateNumber(dataPoint.indoorTemperature, 'indoorTemperature', { min: -10, max: 40 });
      const outdoorTemperature = validateNumber(dataPoint.outdoorTemperature, 'outdoorTemperature', { min: -50, max: 50 });
      const targetTemperature = validateNumber(dataPoint.targetTemperature, 'targetTemperature', { min: 5, max: 30 });
      const heatingActive = validateBoolean(dataPoint.heatingActive, 'heatingActive');

      // Validate weather conditions if present
      let weatherConditions = dataPoint.weatherConditions || {
        windSpeed: 0,
        humidity: 50,
        cloudCover: 50,
        precipitation: 0
      };

      if (dataPoint.weatherConditions) {
        weatherConditions = {
          windSpeed: validateNumber(dataPoint.weatherConditions.windSpeed, 'windSpeed', { min: 0, max: 200 }),
          humidity: validateNumber(dataPoint.weatherConditions.humidity, 'humidity', { min: 0, max: 100 }),
          cloudCover: validateNumber(dataPoint.weatherConditions.cloudCover, 'cloudCover', { min: 0, max: 100 }),
          precipitation: validateNumber(dataPoint.weatherConditions.precipitation, 'precipitation', { min: 0, max: 500 })
        };
      }

      // Create validated data point
      const validatedDataPoint: ThermalDataPoint = {
        timestamp,
        indoorTemperature,
        outdoorTemperature,
        targetTemperature,
        heatingActive,
        weatherConditions
      };

      // Add to collector
      this.dataCollector.addDataPoint(validatedDataPoint);
      this.homey.log('Thermal data point collected during hourly optimization');
    } catch (error) {
      this.homey.error('Error collecting thermal data point:', error);
      throw error; // Re-throw to propagate the error
    }
  }

  /**
   * Get memory usage statistics for the thermal model service
   * @returns Object with memory usage information
   */
  public getMemoryUsage(): {
    dataPointCount: number;
    aggregatedDataCount: number;
    estimatedMemoryUsageKB: number;
    dataPointsPerDay: number;
    modelCharacteristics: {
      heatingRate: number;
      coolingRate: number;
      outdoorTempImpact: number;
      windImpact: number;
      thermalMass: number;
      modelConfidence: number;
      lastUpdated: string;
    };
  } {
    try {
      // Get memory usage from data collector
      const collectorStats = this.dataCollector.getMemoryUsage();

      // Get model characteristics
      const characteristics = this.analyzer.getThermalCharacteristics();

      return {
        ...collectorStats,
        modelCharacteristics: characteristics
      };
    } catch (error) {
      this.homey.error('Error getting memory usage statistics:', error);
      return {
        dataPointCount: 0,
        aggregatedDataCount: 0,
        estimatedMemoryUsageKB: 0,
        dataPointsPerDay: 0,
        modelCharacteristics: {
          heatingRate: 0,
          coolingRate: 0,
          outdoorTempImpact: 0,
          windImpact: 0,
          thermalMass: 0,
          modelConfidence: 0,
          lastUpdated: DateTime.now().toISO()
        }
      };
    }
  }

  /**
   * Force data cleanup and aggregation
   * This can be called from the app to manually trigger cleanup
   * @returns Object with cleanup results
   */
  public forceDataCleanup(): {
    success: boolean;
    dataPointsBefore: number;
    dataPointsAfter: number;
    aggregatedPointsBefore: number;
    aggregatedPointsAfter: number;
    memoryUsageBefore: number;
    memoryUsageAfter: number;
    message: string;
  } {
    try {
      // Get memory usage before cleanup
      const beforeStats = this.dataCollector.getMemoryUsage();

      // Run cleanup
      this.cleanupOldData();

      // Get memory usage after cleanup
      const afterStats = this.dataCollector.getMemoryUsage();

      return {
        success: true,
        dataPointsBefore: beforeStats.dataPointCount,
        dataPointsAfter: afterStats.dataPointCount,
        aggregatedPointsBefore: beforeStats.aggregatedDataCount,
        aggregatedPointsAfter: afterStats.aggregatedDataCount,
        memoryUsageBefore: beforeStats.estimatedMemoryUsageKB,
        memoryUsageAfter: afterStats.estimatedMemoryUsageKB,
        message: `Cleanup successful. Reduced memory usage by ${beforeStats.estimatedMemoryUsageKB - afterStats.estimatedMemoryUsageKB}KB.`
      };
    } catch (error) {
      this.homey.error('Error forcing data cleanup:', error);
      return {
        success: false,
        dataPointsBefore: 0,
        dataPointsAfter: 0,
        aggregatedPointsBefore: 0,
        aggregatedPointsAfter: 0,
        memoryUsageBefore: 0,
        memoryUsageAfter: 0,
        message: `Error during cleanup: ${error}`
      };
    }
  }
}
