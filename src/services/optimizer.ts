import { MelCloudApi } from './melcloud-api';
import { TibberApi } from './tibber-api';

/**
 * Optimizer Service
 * Handles the optimization logic for MELCloud devices based on electricity prices
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

  /**
   * Constructor
   * @param melCloud MELCloud API instance
   * @param tibber Tibber API instance
   * @param deviceId MELCloud device ID
   * @param buildingId MELCloud building ID
   * @param logger Logger instance
   */
  constructor(
    melCloud: MelCloudApi,
    tibber: TibberApi,
    deviceId: string,
    buildingId: number,
    logger: any
  ) {
    this.melCloud = melCloud;
    this.tibber = tibber;
    this.deviceId = deviceId;
    this.buildingId = buildingId;
    this.logger = logger;
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
      const currentTemp = deviceState.RoomTemperature;
      const currentTarget = deviceState.SetTemperature;
      
      // Get electricity prices
      const priceData = await this.tibber.getPrices();
      const currentPrice = priceData.current.price;
      
      // Calculate price statistics
      const prices = priceData.prices.map((p: any) => p.price);
      const priceAvg = prices.reduce((sum: number, price: number) => sum + price, 0) / prices.length;
      const priceMin = Math.min(...prices);
      const priceMax = Math.max(...prices);
      
      // Calculate optimal temperature based on price
      let newTarget = this.calculateOptimalTemperature(currentPrice, priceAvg, priceMin, priceMax, currentTemp);
      
      // Apply constraints
      newTarget = Math.max(this.minTemp, Math.min(this.maxTemp, newTarget));
      
      // Apply step constraint (don't change by more than tempStep)
      const maxChange = this.tempStep;
      if (Math.abs(newTarget - currentTarget) > maxChange) {
        newTarget = currentTarget + (newTarget > currentTarget ? maxChange : -maxChange);
      }
      
      // Round to nearest 0.5°C
      newTarget = Math.round(newTarget * 2) / 2;
      
      // Calculate savings and comfort impact
      const savings = this.calculateSavings(currentTarget, newTarget, currentPrice);
      const comfort = this.calculateComfortImpact(currentTarget, newTarget);
      
      // Determine reason for change
      let reason = 'No change needed';
      if (newTarget < currentTarget) {
        reason = 'Price is above average, reducing temperature';
      } else if (newTarget > currentTarget) {
        reason = 'Price is below average, increasing temperature';
      }
      
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
      // In a real implementation, this would analyze historical data
      // and adjust the thermal model parameters
      
      // For now, we'll just simulate a calibration
      const newK = this.thermalModel.K * (0.9 + Math.random() * 0.2);
      const newS = this.thermalModel.S || 0.1;
      
      // Update thermal model
      this.setThermalModel(newK, newS);
      
      this.logger.log(`Calibrated thermal model: K=${newK.toFixed(2)}, S=${newS.toFixed(2)}`);
      
      // Return result
      return {
        oldK: this.thermalModel.K,
        newK,
        oldS: this.thermalModel.S,
        newS,
        timestamp: new Date().toISOString(),
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
