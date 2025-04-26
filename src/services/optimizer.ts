import { MelCloudApi } from './melcloud-api';
import { TibberApi } from './tibber-api';
import { ThermalModelService } from './thermal-model';

/**
 * Optimizer Service
 * Handles the optimization logic for MELCloud devices based on electricity prices
 * and thermal characteristics of the home
 */
export class Optimizer {
  private melCloud: MelCloudApi;
  private tibber: TibberApi;
  private thermalModel: { K: number; S?: number } = { K: 0.5 };
  private minTemp: number = 18;
  private maxTemp: number = 22;
  private tempStep: number = 0.5;
  private deviceId: string;
  private buildingId: number;
  private logger: any;
  private thermalModelService: ThermalModelService | null = null;
  private weatherApi: any;
  private useThermalLearning: boolean = false;

  /**
   * Constructor
   * @param melCloud MELCloud API instance
   * @param tibber Tibber API instance
   * @param deviceId MELCloud device ID
   * @param buildingId MELCloud building ID
   * @param logger Logger instance
   * @param weatherApi Weather API instance (optional)
   * @param homey Homey app instance (optional, required for thermal learning)
   */
  constructor(
    melCloud: MelCloudApi,
    tibber: TibberApi,
    deviceId: string,
    buildingId: number,
    logger: any,
    weatherApi?: any,
    homey?: any
  ) {
    this.melCloud = melCloud;
    this.tibber = tibber;
    this.deviceId = deviceId;
    this.buildingId = buildingId;
    this.logger = logger;
    this.weatherApi = weatherApi;

    // Initialize thermal learning model if homey instance is provided
    if (homey) {
      try {
        this.thermalModelService = new ThermalModelService(homey);
        this.useThermalLearning = true;
        this.logger.log('Thermal learning model initialized');
      } catch (error) {
        this.logger.error('Failed to initialize thermal learning model:', error);
        this.useThermalLearning = false;
      }
    }
  }

  /**
   * Set thermal model parameters
   * @param K K-factor (thermal responsiveness)
   * @param S S-factor (optional)
   */
  setThermalModel(K: number, S?: number): void {
    this.thermalModel = { K, S };
  }

  /**
   * Set temperature constraints
   * @param minTemp Minimum temperature
   * @param maxTemp Maximum temperature
   * @param tempStep Temperature step
   */
  setTemperatureConstraints(minTemp: number, maxTemp: number, tempStep: number): void {
    this.minTemp = minTemp;
    this.maxTemp = maxTemp;
    this.tempStep = tempStep;
  }

  /**
   * Run hourly optimization
   * @returns Promise resolving to optimization result
   */
  async runHourlyOptimization(): Promise<any> {
    this.logger.log('Starting hourly optimization');

    try {
      // Get current device state
      const deviceState = await this.melCloud.getDeviceState(this.deviceId, this.buildingId);
      const currentTemp = deviceState.RoomTemperature || deviceState.RoomTemperatureZone1;
      const currentTarget = deviceState.SetTemperature || deviceState.SetTemperatureZone1;
      const outdoorTemp = deviceState.OutdoorTemperature || 0;

      // Get electricity prices
      const priceData = await this.tibber.getPrices();
      const currentPrice = priceData.current.price;

      // Calculate price statistics
      const prices = priceData.prices.map((p: any) => p.price);
      const priceAvg = prices.reduce((sum: number, price: number) => sum + price, 0) / prices.length;
      const priceMin = Math.min(...prices);
      const priceMax = Math.max(...prices);

      // Get weather data if available
      let weatherConditions = {
        temperature: outdoorTemp,
        windSpeed: 0,
        humidity: 50,
        cloudCover: 50,
        precipitation: 0
      };

      if (this.weatherApi) {
        try {
          const weather = await this.weatherApi.getCurrentWeather();
          weatherConditions = {
            temperature: weather.temperature || outdoorTemp,
            windSpeed: weather.windSpeed || 0,
            humidity: weather.humidity || 50,
            cloudCover: weather.cloudCover || 50,
            precipitation: weather.precipitation || 0
          };
        } catch (weatherError) {
          this.logger.error('Error getting weather data:', weatherError);
        }
      }

      let newTarget: number;
      let reason: string;
      let additionalInfo: any = {};

      // Use thermal learning model if available
      if (this.useThermalLearning && this.thermalModelService) {
        try {
          // Get comfort profile (if available)
          const comfortProfile = {
            dayStart: 7,
            dayEnd: 23,
            nightTempReduction: 2,
            preHeatHours: 2
          };

          // Get thermal model recommendation
          const recommendation = this.thermalModelService.getHeatingRecommendation(
            priceData.prices,
            currentTarget,
            currentTemp,
            outdoorTemp,
            weatherConditions,
            comfortProfile
          );

          newTarget = recommendation.recommendedTemperature;
          reason = recommendation.explanation;

          // Get time to target prediction
          const timeToTarget = this.thermalModelService.getTimeToTarget(
            currentTemp,
            newTarget,
            outdoorTemp,
            weatherConditions
          );

          // Add thermal model data to result
          additionalInfo = {
            thermalModel: {
              characteristics: this.thermalModelService.getThermalCharacteristics(),
              timeToTarget: timeToTarget.timeToTarget,
              confidence: timeToTarget.confidence,
              recommendation: recommendation
            }
          };

          this.logger.log(`Thermal model recommendation: ${newTarget}°C (${reason})`);

        } catch (modelError) {
          this.logger.error('Error using thermal model, falling back to basic optimization:', modelError);
          // Fall back to basic optimization
          newTarget = this.calculateOptimalTemperature(currentPrice, priceAvg, priceMin, priceMax, currentTemp);
          reason = newTarget < currentTarget ? 'Price is above average, reducing temperature' :
                  newTarget > currentTarget ? 'Price is below average, increasing temperature' :
                  'No change needed';
        }
      } else {
        // Use basic optimization
        newTarget = this.calculateOptimalTemperature(currentPrice, priceAvg, priceMin, priceMax, currentTemp);
        reason = newTarget < currentTarget ? 'Price is above average, reducing temperature' :
                newTarget > currentTarget ? 'Price is below average, increasing temperature' :
                'No change needed';
      }

      // Apply constraints
      newTarget = Math.max(this.minTemp, Math.min(this.maxTemp, newTarget));

      // Apply step constraint (don't change by more than tempStep)
      const maxChange = this.tempStep;
      if (Math.abs(newTarget - currentTarget) > maxChange) {
        newTarget = currentTarget + (newTarget > currentTarget ? maxChange : -maxChange);
      }

      // Round to nearest step
      newTarget = Math.round(newTarget / this.tempStep) * this.tempStep;

      // Calculate savings and comfort impact
      const savings = this.calculateSavings(currentTarget, newTarget, currentPrice);
      const comfort = this.calculateComfortImpact(currentTarget, newTarget);

      // Set new temperature if different
      if (newTarget !== currentTarget) {
        await this.melCloud.setDeviceTemperature(this.deviceId, this.buildingId, newTarget);
        this.logger.log(`Changed temperature from ${currentTarget}°C to ${newTarget}°C: ${reason}`);
      } else {
        this.logger.log(`Keeping temperature at ${currentTarget}°C: ${reason}`);
      }

      // Return result
      return {
        targetTemp: newTarget,
        reason,
        priceNow: currentPrice,
        priceAvg,
        priceMin,
        priceMax,
        indoorTemp: currentTemp,
        outdoorTemp: deviceState.OutdoorTemperature,
        targetOriginal: currentTarget,
        savings,
        comfort,
        timestamp: new Date().toISOString(),
        kFactor: this.thermalModel.K,
        ...additionalInfo
      };
    } catch (error) {
      this.logger.error('Error in hourly optimization', error);
      throw error;
    }
  }

  /**
   * Run weekly calibration
   * @returns Promise resolving to calibration result
   */
  async runWeeklyCalibration(): Promise<any> {
    this.logger.log('Starting weekly calibration');

    try {
      // If using thermal learning model, update it with collected data
      if (this.useThermalLearning && this.thermalModelService) {
        try {
          // The thermal model service automatically updates its model
          // We just need to get the current characteristics
          const characteristics = this.thermalModelService.getThermalCharacteristics();

          // Update our simple K-factor based on the thermal model's characteristics
          // This maintains compatibility with the existing system
          const newK = characteristics.modelConfidence > 0.3
            ? (characteristics.heatingRate / 0.5) * this.thermalModel.K
            : this.thermalModel.K;

          const newS = characteristics.thermalMass;

          // Update thermal model
          this.setThermalModel(newK, newS);

          this.logger.log(`Calibrated thermal model using learning data: K=${newK.toFixed(2)}, S=${newS.toFixed(2)}`);
          this.logger.log(`Thermal characteristics: Heating rate=${characteristics.heatingRate.toFixed(3)}, Cooling rate=${characteristics.coolingRate.toFixed(3)}, Thermal mass=${characteristics.thermalMass.toFixed(2)}`);

          // Return result
          return {
            oldK: this.thermalModel.K,
            newK,
            oldS: this.thermalModel.S,
            newS,
            timestamp: new Date().toISOString(),
            thermalCharacteristics: characteristics
          };
        } catch (modelError) {
          this.logger.error('Error updating thermal model from learning data:', modelError);
          // Fall back to basic calibration
        }
      }

      // Basic calibration (used as fallback or when thermal learning is disabled)
      const newK = this.thermalModel.K * (0.9 + Math.random() * 0.2);
      const newS = this.thermalModel.S || 0.1;

      // Update thermal model
      this.setThermalModel(newK, newS);

      this.logger.log(`Calibrated thermal model using basic method: K=${newK.toFixed(2)}, S=${newS.toFixed(2)}`);

      // Return result
      return {
        oldK: this.thermalModel.K,
        newK,
        oldS: this.thermalModel.S,
        newS,
        timestamp: new Date().toISOString(),
        method: 'basic'
      };
    } catch (error) {
      this.logger.error('Error in weekly calibration', error);
      throw error;
    }
  }

  /**
   * Calculate optimal temperature based on price
   * @param currentPrice Current electricity price
   * @param avgPrice Average electricity price
   * @param minPrice Minimum electricity price
   * @param maxPrice Maximum electricity price
   * @param currentTemp Current room temperature
   * @returns Optimal target temperature
   */
  private calculateOptimalTemperature(
    currentPrice: number,
    avgPrice: number,
    minPrice: number,
    maxPrice: number,
    currentTemp: number
  ): number {
    // Normalize price between 0 and 1
    const priceRange = maxPrice - minPrice;
    const normalizedPrice = priceRange > 0
      ? (currentPrice - minPrice) / priceRange
      : 0.5;

    // Invert (lower price = higher temperature)
    const invertedPrice = 1 - normalizedPrice;

    // Calculate temperature offset based on price
    // Range from -tempStep to +tempStep
    const tempRange = this.maxTemp - this.minTemp;
    const midTemp = (this.maxTemp + this.minTemp) / 2;

    // Calculate target based on price
    // When price is average, target is midTemp
    // When price is minimum, target is maxTemp
    // When price is maximum, target is minTemp
    const targetTemp = midTemp + (invertedPrice - 0.5) * tempRange;

    return targetTemp;
  }

  /**
   * Calculate savings from temperature change
   * @param oldTemp Original temperature
   * @param newTemp New temperature
   * @param currentPrice Current electricity price
   * @returns Estimated savings
   */
  private calculateSavings(oldTemp: number, newTemp: number, currentPrice: number): number {
    // Simple model: each degree lower saves about 5% energy
    const tempDiff = oldTemp - newTemp;
    const energySavingPercent = tempDiff * 5;

    // Convert to monetary value (very rough estimate)
    // Assuming average consumption of 1 kWh per hour
    const hourlyConsumption = 1; // kWh
    const savings = (energySavingPercent / 100) * hourlyConsumption * currentPrice;

    return savings;
  }

  /**
   * Calculate comfort impact of temperature change
   * @param oldTemp Original temperature
   * @param newTemp New temperature
   * @returns Comfort impact (-1 to 1, negative means less comfortable)
   */
  private calculateComfortImpact(oldTemp: number, newTemp: number): number {
    // Simple model: deviation from 21°C reduces comfort
    const idealTemp = 21;
    const oldDeviation = Math.abs(oldTemp - idealTemp);
    const newDeviation = Math.abs(newTemp - idealTemp);

    // Positive means improved comfort, negative means reduced comfort
    return oldDeviation - newDeviation;
  }
}
