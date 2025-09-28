/**
 * Hot Water Service
 *
 * This service manages hot water tank optimization based on usage patterns.
 * It collects data, analyzes patterns, and provides optimal tank temperature recommendations.
 */

import { DateTime } from 'luxon';
import { HotWaterDataCollector, HotWaterUsageDataPoint } from './hot-water-data-collector';
import { HotWaterAnalyzer } from './hot-water-analyzer';

export class HotWaterService {
  private dataCollector: HotWaterDataCollector;
  private analyzer: HotWaterAnalyzer;
  private lastDataCollectionTime: number = 0;
  private dataCollectionInterval: number = 60 * 60 * 1000; // 60 minutes in milliseconds (matches optimizer schedule)
  private lastAnalysisTime: number = 0;
  private analysisInterval: number = 6 * 60 * 60 * 1000; // 6 hours in milliseconds

  constructor(private homey: any) {
    this.dataCollector = new HotWaterDataCollector(homey);
    this.analyzer = new HotWaterAnalyzer(homey, this.dataCollector);
    this.homey.log('Hot Water Service initialized');
  }

  /**
   * Collect hot water usage data from MELCloud device
   * @param deviceState Current device state from MELCloud
   * @returns True if data was collected, false otherwise
   */
  public async collectData(deviceState: any): Promise<boolean> {
    try {
      // Check if it's time to collect data (every hour, matching optimizer schedule)
      const now = Date.now();
      if (now - this.lastDataCollectionTime < this.dataCollectionInterval) {
        return false;
      }

      this.lastDataCollectionTime = now;

      // Extract relevant data from device state
      if (!deviceState || !deviceState.SetTankWaterTemperature) {
        this.homey.log('No tank water temperature data available');
        return false;
      }

      // Create data point
      const dataPoint: HotWaterUsageDataPoint = {
        timestamp: new Date().toISOString(),
        tankTemperature: deviceState.TankWaterTemperature || deviceState.SetTankWaterTemperature,
        targetTankTemperature: deviceState.SetTankWaterTemperature,
        hotWaterEnergyProduced: deviceState.DailyHotWaterEnergyProduced || 0,
        hotWaterEnergyConsumed: deviceState.DailyHotWaterEnergyConsumed || 0,
        hotWaterCOP: this.calculateCOP(deviceState),
        isHeating: this.isHeatingHotWater(deviceState),
        hourOfDay: DateTime.now().hour,
        dayOfWeek: DateTime.now().weekday % 7 // Convert to 0-6 (0 = Sunday)
      };

      // Add data point to collector
      await this.dataCollector.addDataPoint(dataPoint);

      this.homey.log(`Collected hot water usage data: Tank temp ${dataPoint.tankTemperature}°C, Target ${dataPoint.targetTankTemperature}°C, Energy produced ${dataPoint.hotWaterEnergyProduced} kWh`);

      // Check if it's time to analyze data
      if (now - this.lastAnalysisTime >= this.analysisInterval) {
        this.lastAnalysisTime = now;
        await this.analyzer.updatePatterns();
      }

      return true;
    } catch (error) {
      this.homey.error(`Error collecting hot water usage data: ${error}`);
      return false;
    }
  }

  /**
   * Calculate COP (Coefficient of Performance) for hot water
   * @param deviceState Current device state from MELCloud
   * @returns COP value
   */
  private calculateCOP(deviceState: any): number {
    try {
      const produced = deviceState.DailyHotWaterEnergyProduced || 0;
      const consumed = deviceState.DailyHotWaterEnergyConsumed || 0;

      // Avoid division by zero
      if (consumed <= 0) {
        return 0;
      }

      return produced / consumed;
    } catch (error) {
      this.homey.error(`Error calculating hot water COP: ${error}`);
      return 0;
    }
  }

  /**
   * Check if the device is currently heating hot water
   * @param deviceState Current device state from MELCloud
   * @returns True if heating hot water, false otherwise
   */
  private isHeatingHotWater(deviceState: any): boolean {
    try {
      // This is a simplified check - the actual logic may depend on the specific device model
      // For most heat pumps, hot water heating is indicated by specific operation modes or flags
      
      // Check if the device is in hot water mode
      const isHotWaterMode = deviceState.OperationMode === 1; // Assuming 1 is hot water mode
      
      // Check if the tank temperature is below target (indicating heating is needed)
      const tankTemp = deviceState.TankWaterTemperature || 0;
      const targetTemp = deviceState.SetTankWaterTemperature || 0;
      const isBelowTarget = tankTemp < targetTemp;
      
      // Some devices have a specific flag for hot water heating
      const hasHotWaterFlag = deviceState.HotWaterActive || false;
      
      return isHotWaterMode || (isBelowTarget && hasHotWaterFlag);
    } catch (error) {
      this.homey.error(`Error checking if device is heating hot water: ${error}`);
      return false;
    }
  }

  /**
   * Get optimal tank temperature based on usage patterns and price
   * @param minTemp Minimum allowed tank temperature
   * @param maxTemp Maximum allowed tank temperature
   * @param currentPrice Current electricity price
   * @param priceLevel Tibber price level (VERY_CHEAP, CHEAP, NORMAL, EXPENSIVE, VERY_EXPENSIVE)
   * @returns Optimal tank temperature
   */
  public getOptimalTankTemperature(minTemp: number, maxTemp: number, currentPrice: number, priceLevel: string): number {
    try {
      const memoryBefore = this.dataCollector.getMemoryUsage();
      this.homey.log(`Calculating optimal tank temperature (min: ${minTemp}°C, max: ${maxTemp}°C, price: ${currentPrice}, level: ${priceLevel})`);
      
      const optimalTemp = this.analyzer.getOptimalTankTemperature(minTemp, maxTemp, currentPrice, priceLevel);
      
      const memoryAfter = this.dataCollector.getMemoryUsage();
      this.homey.log(`Optimal tank temperature calculation complete: ${optimalTemp}°C (memory usage: ${memoryBefore} → ${memoryAfter})`);
      
      return optimalTemp;
    } catch (error) {
      this.homey.error(`Error getting optimal tank temperature: ${error}`);
      // Return middle temperature as fallback
      return minTemp + ((maxTemp - minTemp) / 2);
    }
  }

  /**
   * Get hot water usage statistics
   * @param days Number of days to look back
   * @returns Hot water usage statistics
   */
  public getUsageStatistics(days: number = 7): any {
    try {
      const stats = this.dataCollector.getDataStatistics(days);
      const patterns = this.analyzer.getPatterns();

      return {
        statistics: stats,
        patterns,
        predictions: this.analyzer.predictNext24Hours()
      };
    } catch (error) {
      this.homey.error(`Error getting hot water usage statistics: ${error}`);
      return null;
    }
  }

  /**
   * Force data cleanup
   * @returns Result of cleanup operation
   */
  public async forceDataCleanup(): Promise<any> {
    try {
      const memoryBefore = this.dataCollector.getMemoryUsage();
      // We need to implement our own cleanup since removeOldDataPoints is private
      const dataPointsBefore = this.dataCollector.getAllDataPoints().length;
      await this.dataCollector.clearData(false); // Clear data but keep aggregated data
      const memoryAfter = this.dataCollector.getMemoryUsage();
      const dataPointsAfter = this.dataCollector.getAllDataPoints().length;

      return {
        memoryBefore,
        memoryAfter,
        dataPointsBefore,
        dataPointsAfter
      };
    } catch (error: unknown) {
      this.homey.error(`Error forcing hot water data cleanup: ${error}`);
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Reset hot water usage patterns to defaults
   */
  public resetPatterns(): void {
    try {
      this.analyzer.resetPatterns();
      this.homey.log('Reset hot water usage patterns to defaults');
    } catch (error) {
      this.homey.error(`Error resetting hot water usage patterns: ${error}`);
    }
  }

  /**
   * Clear all hot water usage data
   * @param clearAggregated Whether to clear aggregated data as well (default: true)
   */
  public async clearData(clearAggregated: boolean = true): Promise<void> {
    try {
      await this.dataCollector.clearData(clearAggregated);
      if (clearAggregated) {
        this.resetPatterns();
      }
      this.homey.log(`Cleared hot water usage data${clearAggregated ? ' including aggregated data' : ' (kept aggregated data)'}`);
    } catch (error: unknown) {
      this.homey.error(`Error clearing hot water usage data: ${error}`);
    }
  }
}