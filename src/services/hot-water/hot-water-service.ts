/**
 * Hot Water Service
 *
 * This service manages hot water tank optimization based on usage patterns.
 * It collects data, analyzes patterns, and provides optimal tank temperature recommendations.
 */

import { DateTime } from 'luxon';
import { HotWaterDataCollector, HotWaterUsageDataPoint } from './hot-water-data-collector';
import { HotWaterAnalyzer } from './hot-water-analyzer';
import { TimeZoneHelper } from '../../util/time-zone-helper';
import { HomeyLogger } from '../../util/logger';

export class HotWaterService {
  private dataCollector: HotWaterDataCollector;
  private analyzer: HotWaterAnalyzer;
  private timeZoneHelper: TimeZoneHelper;
  private lastDataCollectionTime: number = 0;
  private dataCollectionInterval: number = 5 * 60 * 1000; // 5 minutes in milliseconds (aligns with device polling cadence)
  private lastAnalysisTime: number = 0;
  private analysisInterval: number = 6 * 60 * 60 * 1000; // 6 hours in milliseconds

  constructor(private homey: any) {
    this.dataCollector = new HotWaterDataCollector(homey);
    this.analyzer = new HotWaterAnalyzer(homey, this.dataCollector);
    
    // Initialize TimeZoneHelper with user settings
    const timeZoneOffset = homey.settings?.get('time_zone_offset') || 2;
    const useDST = homey.settings?.get('use_dst') || false;
    const timeZoneName = homey.settings?.get('time_zone_name');
    
    // Create a minimal logger for TimeZoneHelper
    const logger = new HomeyLogger(homey, { level: 1, logToTimeline: false, prefix: 'HotWater' });
    this.timeZoneHelper = new TimeZoneHelper(
      logger,
      timeZoneOffset,
      useDST,
      typeof timeZoneName === 'string' && timeZoneName.length > 0 ? timeZoneName : undefined
    );
    
    this.homey.log('Hot Water Service initialized with timezone settings');
  }

  /**
   * Update timezone settings for this service
   * @param timeZoneOffset Timezone offset in hours
   * @param useDST Whether to use daylight saving time
   */
  public updateTimeZoneSettings(timeZoneOffset: number, useDST: boolean, timeZoneName?: string): void {
    this.timeZoneHelper.updateSettings(
      timeZoneOffset,
      useDST,
      typeof timeZoneName === 'string' && timeZoneName.length > 0 ? timeZoneName : undefined
    );
    this.homey.log(
      `Hot Water Service timezone settings updated: offset=${timeZoneOffset}, DST=${useDST}, name=${timeZoneName || 'n/a'}`
    );
  }

  /**
   * Collect hot water usage data from MELCloud device
   * @param deviceState Current device state from MELCloud
   * @returns True if data was collected, false otherwise
   */
  public async collectData(deviceState: any): Promise<boolean> {
    try {
      // Throttle collection to align with the 5-minute device polling cadence
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

      // Calculate incremental energy usage (better for hourly pattern analysis)
      // Use user's local time instead of system time
      const localTime = this.timeZoneHelper.getLocalTime();
      const currentHour = localTime.hour;
      const localDate = localTime.date;
      
      const previousDataPoints = this.dataCollector.getAllDataPoints();
      const recentPoint = previousDataPoints.length > 0 ? previousDataPoints[previousDataPoints.length - 1] : null;
      
      // Use incremental energy calculation or fallback to daily totals
      let hotWaterEnergyProduced = deviceState.DailyHotWaterEnergyProduced || 0;
      let hotWaterEnergyConsumed = deviceState.DailyHotWaterEnergyConsumed || 0;
      
      // If we have recent data and it's the same day, calculate incremental usage
      if (recentPoint) {
        const recentTime = new Date(recentPoint.timestamp);
        const isSameDay = recentTime.toDateString() === localDate.toDateString();
        
        if (isSameDay && deviceState.DailyHotWaterEnergyProduced) {
          const incremental = deviceState.DailyHotWaterEnergyProduced - (recentPoint.hotWaterEnergyProduced || 0);
          if (incremental > 0) {
            hotWaterEnergyProduced = incremental;
          }
        }
        
        if (isSameDay && deviceState.DailyHotWaterEnergyConsumed) {
          const incremental = deviceState.DailyHotWaterEnergyConsumed - (recentPoint.hotWaterEnergyConsumed || 0);
          if (incremental > 0) {
            hotWaterEnergyConsumed = incremental;
          }
        }
      }
      
      // If no incremental data and no daily data, use pattern estimation
      if (hotWaterEnergyProduced === 0 && deviceState.TankWaterTemperature && deviceState.SetTankWaterTemperature) {
        // Estimate energy based on temperature difference and heating activity
        const tempDiff = Math.max(0, deviceState.SetTankWaterTemperature - deviceState.TankWaterTemperature);
        if (tempDiff > 1 || this.isHeatingHotWater(deviceState)) {
          // Rough estimation: 0.1-0.5 kWh per hour for active heating
          hotWaterEnergyProduced = Math.min(0.5, tempDiff * 0.05 + (this.isHeatingHotWater(deviceState) ? 0.1 : 0));
          hotWaterEnergyConsumed = hotWaterEnergyProduced / Math.max(2.0, this.calculateCOP(deviceState) || 2.5);
        }
      }

      // Create data point using user's local time
      const dataPoint: HotWaterUsageDataPoint = {
        timestamp: localDate.toISOString(),
        tankTemperature: deviceState.TankWaterTemperature || deviceState.SetTankWaterTemperature,
        targetTankTemperature: deviceState.SetTankWaterTemperature,
        hotWaterEnergyProduced,
        hotWaterEnergyConsumed,
        hotWaterCOP: this.calculateCOP(deviceState),
        isHeating: this.isHeatingHotWater(deviceState),
        hourOfDay: currentHour,
        dayOfWeek: (localDate.getDay() + 6) % 7 // Convert Sunday=0 to 0-6 format (Monday=0)
      };

      // Add data point to collector
      await this.dataCollector.addDataPoint(dataPoint);

      // Enhanced logging with more details
      const totalDataPoints = this.dataCollector.getAllDataPoints().length;
      this.homey.log(`[HotWater] Collected data point #${totalDataPoints}: Tank ${dataPoint.tankTemperature}°C→${dataPoint.targetTankTemperature}°C, Energy ${dataPoint.hotWaterEnergyProduced.toFixed(3)}kWh, COP ${dataPoint.hotWaterCOP.toFixed(2)}, Heating: ${dataPoint.isHeating ? 'YES' : 'NO'}, Hour: ${dataPoint.hourOfDay}`);
      
      // Log progress towards pattern analysis
      if (totalDataPoints < 12) {
        this.homey.log(`[HotWater] Need ${12 - totalDataPoints} more data points for pattern analysis`);
      } else if (totalDataPoints === 12) {
        this.homey.log(`[HotWater] Minimum data points reached! Pattern analysis will start next collection cycle.`);
      }

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
