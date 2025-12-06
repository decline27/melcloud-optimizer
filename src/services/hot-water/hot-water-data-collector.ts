/**
 * Hot Water Usage Data Collector
 *
 * This service collects and stores hot water usage data from the MELCloud device
 * to build a learning model of the home's hot water usage patterns.
 *
 * Data is stored in Homey's settings storage, which persists across app updates and reinstallations.
 * Implements data retention policies and memory management to prevent memory leaks.
 */

import { DateTime } from 'luxon';

// Settings key for hot water usage data storage
const HOT_WATER_DATA_SETTINGS_KEY = 'hot_water_usage_data';
// Settings key for aggregated historical data
const HOT_WATER_AGGREGATED_DATA_SETTINGS_KEY = 'hot_water_usage_aggregated_data';
// Maximum number of data points to keep in memory
const DEFAULT_MAX_DATA_POINTS = 2016; // ~7 days of data at 5-minute intervals
// Maximum age of data points in days
const MAX_DATA_AGE_DAYS = 30;
// Maximum size of data to store in settings (bytes)
const MAX_SETTINGS_DATA_SIZE = 500000; // ~500KB
const DEFAULT_INTERVAL_MINUTES = 5;
const MAX_INTERVAL_MINUTES = 30;

export interface HotWaterUsageDataPoint {
  timestamp: string;
  localDayKey?: string;
  tankTemperature: number;
  targetTankTemperature: number;
  hotWaterEnergyProduced: number;
  hotWaterEnergyConsumed: number;
  hotWaterCOP: number;
  timeZoneName?: string;
  timeZoneOffset?: number;
  localTimeString?: string;
  rawHotWaterEnergyProduced?: number;
  rawHotWaterEnergyConsumed?: number;
  isHeating: boolean; // Whether the tank is actively heating
  hourOfDay: number; // Hour of the day (0-23)
  dayOfWeek: number; // Day of the week (0-6, 0 = Monday)
}

export interface AggregatedHotWaterDataPoint {
  date: string; // YYYY-MM-DD format
  avgTankTemperature: number;
  avgTargetTankTemperature: number;
  totalHotWaterEnergyProduced: number;
  totalHotWaterEnergyConsumed: number;
  avgHotWaterCOP: number;
  heatingHours: number;
  usageByHour: number[]; // 24 values representing usage for each hour
  dataPointCount: number;
}

export class HotWaterDataCollector {
  private dataPoints: HotWaterUsageDataPoint[] = [];
  private aggregatedData: AggregatedHotWaterDataPoint[] = [];
  private maxDataPoints: number = DEFAULT_MAX_DATA_POINTS;
  private initialized: boolean = false;
  private lastMemoryCheck: number = 0;
  private memoryWarningIssued: boolean = false;
  private _isSaving: boolean = false; // Guard against recursive saveData calls

  constructor(private homey: any) {
    this.loadStoredData();
  }

  /**
   * Load previously stored hot water usage data from Homey settings
   * Falls back to file storage if settings storage fails
   * Also loads aggregated historical data
   * Includes crash recovery for oversized data that caused issue #40
   */
  private loadStoredData(): void {
    try {
      // First try to load from Homey settings (persists across reinstalls)
      const settingsData = this.homey.settings.get(HOT_WATER_DATA_SETTINGS_KEY);
      const aggregatedData = this.homey.settings.get(HOT_WATER_AGGREGATED_DATA_SETTINGS_KEY);

      let dataLoaded = false;

      // CRASH RECOVERY: Check if stored data exceeds safe limit before parsing
      // This prevents the infinite loop crash from issue #40
      if (settingsData && typeof settingsData === 'string' && settingsData.length > MAX_SETTINGS_DATA_SIZE) {
        this.homey.error(`CRASH RECOVERY: Hot water data size (${settingsData.length} bytes) exceeds safe limit. Clearing to prevent crash loop.`);
        this.homey.settings.unset(HOT_WATER_DATA_SETTINGS_KEY);
        this.dataPoints = [];
        dataLoaded = true; // Mark as loaded (with empty data) to skip file fallback
      } else if (settingsData) {
        try {
          this.dataPoints = JSON.parse(settingsData);
          this.homey.log(`Loaded ${this.dataPoints.length} hot water usage data points from settings storage`);
          dataLoaded = true;
        } catch (parseError) {
          this.homey.error(`Error parsing hot water usage data from settings: ${parseError}`);
        }
      }

      if (aggregatedData) {
        try {
          this.aggregatedData = JSON.parse(aggregatedData);
          this.homey.log(`Loaded ${this.aggregatedData.length} aggregated hot water data points from settings storage`);
        } catch (parseError) {
          this.homey.error(`Error parsing aggregated hot water data from settings: ${parseError}`);
          this.aggregatedData = [];
        }
      }

      // If no data was loaded from settings, start with empty dataset
      if (!dataLoaded) {
        this.homey.log('No hot water usage data found, starting with empty dataset');
        this.dataPoints = [];
      }

      const legacyReset = this.resetLegacyCountersIfNeeded();

      if (legacyReset) {
        // Persist the reset state so future loads start clean
        this.saveData();
      } else {
        // Clean up data on load (remove old data points, trim to max size)
        this.cleanupDataOnLoad();
      }

      this.initialized = true;
    } catch (error) {
      this.homey.error(`Error loading stored hot water usage data: ${error}`);
      this.dataPoints = [];
      this.aggregatedData = [];
      this.initialized = true;
    }
  }

  /**
   * Legacy migration: filter out data points that were stored without localDayKey.
   * Points without localDayKey are truly legacy and cannot be used for day-based analysis.
   * Points with undefined raw counters are acceptable if they have localDayKey (device may not always report counters).
   * @returns true when points were filtered
   */
  private resetLegacyCountersIfNeeded(): boolean {
    try {
      // Only filter points that are missing localDayKey - these are truly legacy
      // Raw counters may be undefined when device doesn't report them, which is acceptable
      const validPoints = this.dataPoints.filter(dp => !!dp.localDayKey);
      const legacyCount = this.dataPoints.length - validPoints.length;
      
      if (legacyCount === 0) {
        return false;
      }

      this.homey.log(`Filtered ${legacyCount} legacy hot water data points missing localDayKey, keeping ${validPoints.length} valid points`);
      this.dataPoints = validPoints;
      
      // Save the filtered dataset
      return true;
    } catch (error) {
      this.homey.error(`Error handling legacy hot water data filter: ${error}`);
      return false;
    }
  }

  /**
   * Clean up data on load - remove old data points and trim to max size
   */
  private cleanupDataOnLoad(): void {
    try {
      // Remove data points older than MAX_DATA_AGE_DAYS
      this.removeOldDataPoints();

      // Trim to maxDataPoints if still too large
      if (this.dataPoints.length > this.maxDataPoints) {
        const excessPoints = this.dataPoints.length - this.maxDataPoints;
        this.dataPoints = this.dataPoints.slice(excessPoints);
        this.homey.log(`Trimmed ${excessPoints} oldest hot water usage data points on load to maintain limit of ${this.maxDataPoints} entries`);
      }

      // Save the cleaned up data
      this.saveData();
    } catch (error) {
      this.homey.error(`Error cleaning up hot water usage data on load: ${error}`);
    }
  }

  /**
   * Save data to Homey settings and backup file
   */
  private async saveData(): Promise<void> {
    // Guard against recursive calls that cause CPU spike and crash
    if (this._isSaving) {
      this.homey.log('saveData() already in progress, skipping to prevent recursion');
      return;
    }

    this._isSaving = true;
    try {
      // Check memory usage before saving
      this.checkMemoryUsage();

      // Convert to JSON string
      let dataJson = JSON.stringify(this.dataPoints);
      const aggregatedDataJson = JSON.stringify(this.aggregatedData);

      // Check if data is too large for settings storage
      if (dataJson.length > MAX_SETTINGS_DATA_SIZE) {
        this.homey.log(`Hot water usage data size (${dataJson.length} bytes) exceeds maximum settings size (${MAX_SETTINGS_DATA_SIZE} bytes)`);
        this.homey.log('Reducing data size by aggregating older data points');

        // Reduce data size - this modifies this.dataPoints directly
        await this.reduceDataSizeInternal();

        // Re-stringify after reduction
        dataJson = JSON.stringify(this.dataPoints);

        // If still too large after reduction, force-trim to fit
        if (dataJson.length > MAX_SETTINGS_DATA_SIZE) {
          this.homey.error(`Hot water data still too large after reduction (${dataJson.length} bytes), force-trimming`);
          this.forceTrimToFit();
          dataJson = JSON.stringify(this.dataPoints);
        }
      }

      // Save to Homey settings
      this.homey.settings.set(HOT_WATER_DATA_SETTINGS_KEY, dataJson);
      this.homey.settings.set(HOT_WATER_AGGREGATED_DATA_SETTINGS_KEY, aggregatedDataJson);

    } catch (error) {
      this.homey.error(`Error saving hot water usage data: ${error}`);
    } finally {
      this._isSaving = false;
    }
  }



  /**
   * Check memory usage and trigger cleanup if necessary
   */
  private checkMemoryUsage(): void {
    try {
      // Only check memory usage every 20 minutes to avoid excessive logging
      const now = Date.now();
      if (now - this.lastMemoryCheck < 20 * 60 * 1000) {
        return;
      }

      this.lastMemoryCheck = now;

      // Get memory usage
      const memoryUsage = this.getMemoryUsage();
      this.homey.log(`Memory usage: ${memoryUsage.usageKB.toFixed(2)} KB, ${this.dataPoints.length} data points, ${memoryUsage.bytesPerDataPoint.toFixed(2)} bytes per data point`);

      // If memory usage is high, trigger cleanup
      if (memoryUsage.usagePercent > 70) {
        if (!this.memoryWarningIssued) {
          this.homey.log(`High memory usage detected (${memoryUsage.usagePercent.toFixed(2)}%), reducing data size`);
          this.memoryWarningIssued = true;
        }

        // Reduce data size (internal version - saveData will handle the actual save)
        this.reduceDataSizeInternal();
      } else {
        // Reset warning flag if memory usage is back to normal
        this.memoryWarningIssued = false;
      }
    } catch (error) {
      this.homey.error(`Error checking memory usage: ${error}`);
    }
  }

  /**
   * Force trim data to fit within MAX_SETTINGS_DATA_SIZE
   * Used as emergency fallback when aggregation doesn't reduce size enough
   */
  private forceTrimToFit(): void {
    const bytesPerPoint = 200; // Approximate bytes per data point
    const targetPoints = Math.floor(MAX_SETTINGS_DATA_SIZE / bytesPerPoint) - 100; // Leave some margin
    
    if (this.dataPoints.length > targetPoints && targetPoints > 0) {
      const removed = this.dataPoints.length - targetPoints;
      this.dataPoints = this.dataPoints.slice(-targetPoints);
      this.homey.error(`Force-trimmed ${removed} hot water data points to fit storage limit`);
    }
  }

  /**
   * Reduce data size by aggregating older data (internal - does not save)
   * This method modifies this.dataPoints directly without calling saveData()
   */
  private async reduceDataSizeInternal(): Promise<void> {
    try {
      const originalCount = this.dataPoints.length;
      
      // Keep the most recent 7 days of data at full resolution
      const sevenDaysAgo = DateTime.now().minus({ days: 7 }).toMillis();
      const recentData = this.dataPoints.filter(dp => new Date(dp.timestamp).getTime() >= sevenDaysAgo);
      const olderData = this.dataPoints.filter(dp => new Date(dp.timestamp).getTime() < sevenDaysAgo);

      if (olderData.length > 0) {
        this.homey.log(`Aggregating ${olderData.length} older hot water usage data points`);

        // Group older data by day
        const dataByDay = new Map<string, HotWaterUsageDataPoint[]>();
        olderData.forEach(dp => {
          const date = dp.localDayKey || dp.timestamp.split('T')[0]; // Prefer local day tracking
          if (!dataByDay.has(date)) {
            dataByDay.set(date, []);
          }
          dataByDay.get(date)?.push(dp);
        });

        // Aggregate each day's data
        for (const [date, points] of dataByDay.entries()) {
          await this.aggregateDataForDay(date, points);
        }

        // Replace data points with recent data only
        this.dataPoints = recentData;
        this.homey.log(`Reduced hot water usage data points from ${originalCount} to ${recentData.length} by aggregating older data`);
      }

      // If we still have too many data points, just keep the most recent ones
      if (this.dataPoints.length > this.maxDataPoints) {
        this.dataPoints = this.dataPoints.slice(-this.maxDataPoints);
        this.homey.log(`Trimmed hot water usage data to the most recent ${this.maxDataPoints} data points`);
      }
    } catch (error) {
      this.homey.error(`Error reducing hot water usage data size: ${error}`);
    }
  }

  /**
   * Reduce data size by aggregating older data
   * Public wrapper that also saves after reduction
   */
  private async reduceDataSize(): Promise<void> {
    await this.reduceDataSizeInternal();
    await this.saveData();
  }

  /**
   * Remove data points older than MAX_DATA_AGE_DAYS
   */
  private removeOldDataPoints(): void {
    try {
      const cutoffDate = DateTime.now().minus({ days: MAX_DATA_AGE_DAYS }).toJSDate();
      const originalCount = this.dataPoints.length;

      this.dataPoints = this.dataPoints.filter(dp => new Date(dp.timestamp) >= cutoffDate);

      const removedCount = originalCount - this.dataPoints.length;
      if (removedCount > 0) {
        this.homey.log(`Removed ${removedCount} hot water usage data points older than ${MAX_DATA_AGE_DAYS} days`);
      }
    } catch (error) {
      this.homey.error(`Error removing old hot water usage data points: ${error}`);
    }
  }

  /**
   * Aggregate data for a specific day
   * @param date Date in YYYY-MM-DD format
   * @param dataPoints Data points for that day
   */
  private async aggregateDataForDay(date: string, dataPoints: HotWaterUsageDataPoint[]): Promise<void> {
    try {
      if (dataPoints.length === 0) {
        return;
      }

      const sortedPoints = [...dataPoints].sort((a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );
      const sampleDurations = this.computeSampleDurations(sortedPoints);

      // Calculate averages and totals
      const avgTankTemperature = sortedPoints.reduce((sum, dp) => sum + dp.tankTemperature, 0) / sortedPoints.length;
      const avgTargetTankTemperature = sortedPoints.reduce((sum, dp) => sum + dp.targetTankTemperature, 0) / sortedPoints.length;
      const totalHotWaterEnergyProduced = sortedPoints.reduce((sum, dp) => sum + dp.hotWaterEnergyProduced, 0);
      const totalHotWaterEnergyConsumed = sortedPoints.reduce((sum, dp) => sum + dp.hotWaterEnergyConsumed, 0);
      const avgHotWaterCOP = totalHotWaterEnergyConsumed > 0 ? totalHotWaterEnergyProduced / totalHotWaterEnergyConsumed : 0;
      const heatingMinutes = sortedPoints.reduce((sum, dp, idx) => {
        return dp.isHeating ? sum + sampleDurations[idx] : sum;
      }, 0);
      const heatingHours = heatingMinutes / 60;

      // Calculate usage by hour (24 values)
      const usageByHour = new Array(24).fill(0);
      sortedPoints.forEach(dp => {
        if (dp.hotWaterEnergyProduced > 0) {
          usageByHour[dp.hourOfDay] += dp.hotWaterEnergyProduced;
        }
      });

      // Create aggregated data point
      const aggregatedDataPoint: AggregatedHotWaterDataPoint = {
        date,
        avgTankTemperature,
        avgTargetTankTemperature,
        totalHotWaterEnergyProduced,
        totalHotWaterEnergyConsumed,
        avgHotWaterCOP,
        heatingHours,
        usageByHour,
        dataPointCount: dataPoints.length
      };

      // Add to aggregated data, replacing any existing entry for the same date
      const existingIndex = this.aggregatedData.findIndex(dp => dp.date === date);
      if (existingIndex >= 0) {
        this.aggregatedData[existingIndex] = aggregatedDataPoint;
      } else {
        this.aggregatedData.push(aggregatedDataPoint);
      }

      // Sort aggregated data by date (oldest first)
      this.aggregatedData.sort((a, b) => a.date.localeCompare(b.date));

      this.homey.log(`Aggregated ${dataPoints.length} hot water usage data points for ${date}`);
    } catch (error) {
      this.homey.error(`Error aggregating hot water usage data for ${date}: ${error}`);
    }
  }

  /**
   * Add a new hot water usage data point
   * @param dataPoint Hot water usage data point to add
   */
  public async addDataPoint(dataPoint: HotWaterUsageDataPoint): Promise<void> {
    try {
      // Validate data point
      if (!this.validateDataPoint(dataPoint)) {
        return;
      }

      // Add data point
      this.dataPoints.push(dataPoint);

      // Trim dataset if it exceeds the maximum size
      if (this.dataPoints.length > this.maxDataPoints) {
        // First try to aggregate older data
        await this.reduceDataSize();

        // If still too large, just slice
        if (this.dataPoints.length > this.maxDataPoints) {
          this.dataPoints = this.dataPoints.slice(-this.maxDataPoints);
        }
      }

      // Save data
      await this.saveData();
    } catch (error) {
      this.homey.error(`Error adding hot water usage data point: ${error}`);
    }
  }

  /**
   * Validate a hot water usage data point
   * @param dataPoint Data point to validate
   * @returns True if valid, false otherwise
   */
  private validateDataPoint(dataPoint: HotWaterUsageDataPoint): boolean {
    try {
      // Check required fields
      if (!dataPoint.timestamp) {
        this.homey.error('Invalid hot water usage data point: missing timestamp');
        return false;
      }

      if (!dataPoint.localDayKey) {
        this.homey.error('Invalid hot water usage data point: missing local day key');
        return false;
      }

      // Check temperature ranges (more lenient validation)
      if (typeof dataPoint.tankTemperature !== 'number' || dataPoint.tankTemperature < 0 || dataPoint.tankTemperature > 100) {
        this.homey.log(`Invalid hot water usage data point: tank temperature out of range or not a number (${dataPoint.tankTemperature}) - skipping this data point`);
        return false;
      }

      if (typeof dataPoint.targetTankTemperature !== 'number' || dataPoint.targetTankTemperature < 0 || dataPoint.targetTankTemperature > 100) {
        this.homey.log(`Invalid hot water usage data point: target tank temperature out of range or not a number (${dataPoint.targetTankTemperature}) - skipping this data point`);
        return false;
      }

      // Check timestamp is not in the future
      // Allow some tolerance for timezone differences and processing delays
      const timestamp = new Date(dataPoint.timestamp).getTime();
      const now = Date.now();
      const tolerance = 4 * 60 * 60 * 1000; // 4 hours tolerance for timezone differences
      if (timestamp > now + tolerance) {
        this.homey.error(`Invalid hot water usage data point: timestamp is in the future (${dataPoint.timestamp})`);
        return false;
      }

      // Check hour of day and day of week
      if (dataPoint.hourOfDay < 0 || dataPoint.hourOfDay > 23) {
        this.homey.error(`Invalid hot water usage data point: hour of day out of range (${dataPoint.hourOfDay})`);
        return false;
      }

      if (dataPoint.dayOfWeek < 0 || dataPoint.dayOfWeek > 6) {
        this.homey.error(`Invalid hot water usage data point: day of week out of range (${dataPoint.dayOfWeek})`);
        return false;
      }

      return true;
    } catch (error) {
      this.homey.error(`Error validating hot water usage data point: ${error}`);
      return false;
    }
  }

  /**
   * Get all hot water usage data points
   * @returns Array of hot water usage data points
   */
  public getAllDataPoints(): HotWaterUsageDataPoint[] {
    return this.dataPoints;
  }

  /**
   * Get aggregated hot water usage data
   * @returns Array of aggregated hot water usage data points
   */
  public getAggregatedData(): AggregatedHotWaterDataPoint[] {
    return this.aggregatedData;
  }

  /**
   * Get combined data for analysis (detailed + aggregated)
   * @returns Object with detailed and aggregated data
   */
  public getCombinedDataForAnalysis(): { detailed: HotWaterUsageDataPoint[], aggregated: AggregatedHotWaterDataPoint[] } {
    return {
      detailed: this.dataPoints,
      aggregated: this.aggregatedData
    };
  }

  /**
   * Compute sample durations (in minutes) for a chronologically sorted list of data points.
   */
  private computeSampleDurations(points: HotWaterUsageDataPoint[]): number[] {
    if (points.length === 0) {
      return [];
    }

    const durations = new Array(points.length).fill(DEFAULT_INTERVAL_MINUTES);
    for (let i = 0; i < points.length - 1; i++) {
      const currentTs = new Date(points[i].timestamp).getTime();
      const nextTs = new Date(points[i + 1].timestamp).getTime();
      const diffMinutes = Math.max(0, (nextTs - currentTs) / 60000);
      durations[i] = Math.min(diffMinutes || DEFAULT_INTERVAL_MINUTES, MAX_INTERVAL_MINUTES);
    }

    if (points.length > 1) {
      durations[points.length - 1] = durations[points.length - 2];
    }

    return durations;
  }

  /**
   * Get recent hot water usage data points
   * @param hours Number of hours to look back
   * @returns Array of recent hot water usage data points
   */
  public getRecentDataPoints(hours: number = 24): HotWaterUsageDataPoint[] {
    try {
      const cutoffTime = DateTime.now().minus({ hours }).toJSDate();
      return this.dataPoints.filter(dp => new Date(dp.timestamp) >= cutoffTime);
    } catch (error) {
      this.homey.error(`Error getting recent hot water usage data points: ${error}`);
      return [];
    }
  }

  /**
   * Get hot water usage statistics
   * @param days Number of days to look back
   * @returns Object with statistics
   */
  public getDataStatistics(days: number = 7): {
    dataPointCount: number;
    avgTankTemperature: number;
    avgTargetTankTemperature: number;
    totalHotWaterEnergyProduced: number;
    totalHotWaterEnergyConsumed: number;
    avgHotWaterCOP: number;
    heatingActivePercentage: number;
    usageByHourOfDay: number[];
    usageByDayOfWeek: number[];
    dataCollectionRatePerDay: number;
  } {
    try {
      const cutoffDate = DateTime.now().minus({ days }).toJSDate();
      const recentData = this.dataPoints.filter(dp => new Date(dp.timestamp) >= cutoffDate);

      if (recentData.length === 0) {
        return {
          dataPointCount: 0,
          avgTankTemperature: 0,
          avgTargetTankTemperature: 0,
          totalHotWaterEnergyProduced: 0,
          totalHotWaterEnergyConsumed: 0,
          avgHotWaterCOP: 0,
          heatingActivePercentage: 0,
          usageByHourOfDay: new Array(24).fill(0),
          usageByDayOfWeek: new Array(7).fill(0),
          dataCollectionRatePerDay: 0
        };
      }

      // Calculate statistics
      const dataPointCount = recentData.length;
      const avgTankTemperature = recentData.reduce((sum, dp) => sum + dp.tankTemperature, 0) / dataPointCount;
      const avgTargetTankTemperature = recentData.reduce((sum, dp) => sum + dp.targetTankTemperature, 0) / dataPointCount;
      const totalHotWaterEnergyProduced = recentData.reduce((sum, dp) => sum + dp.hotWaterEnergyProduced, 0);
      const totalHotWaterEnergyConsumed = recentData.reduce((sum, dp) => sum + dp.hotWaterEnergyConsumed, 0);
      const avgHotWaterCOP = totalHotWaterEnergyConsumed > 0 ? totalHotWaterEnergyProduced / totalHotWaterEnergyConsumed : 0;
      const heatingActiveCount = recentData.filter(dp => dp.isHeating).length;
      const heatingActivePercentage = (heatingActiveCount / dataPointCount) * 100;

      // Calculate usage by hour of day
      const usageByHourOfDay = new Array(24).fill(0);
      recentData.forEach(dp => {
        if (dp.hotWaterEnergyProduced > 0) {
          usageByHourOfDay[dp.hourOfDay] += dp.hotWaterEnergyProduced;
        }
      });

      // Calculate usage by day of week
      const usageByDayOfWeek = new Array(7).fill(0);
      recentData.forEach(dp => {
        if (dp.hotWaterEnergyProduced > 0) {
          usageByDayOfWeek[dp.dayOfWeek] += dp.hotWaterEnergyProduced;
        }
      });

      // Calculate data collection rate per day
      const dataCollectionRatePerDay = dataPointCount / days;

      return {
        dataPointCount,
        avgTankTemperature,
        avgTargetTankTemperature,
        totalHotWaterEnergyProduced,
        totalHotWaterEnergyConsumed,
        avgHotWaterCOP,
        heatingActivePercentage,
        usageByHourOfDay,
        usageByDayOfWeek,
        dataCollectionRatePerDay
      };
    } catch (error) {
      this.homey.error(`Error getting hot water usage statistics: ${error}`);
      return {
        dataPointCount: 0,
        avgTankTemperature: 0,
        avgTargetTankTemperature: 0,
        totalHotWaterEnergyProduced: 0,
        totalHotWaterEnergyConsumed: 0,
        avgHotWaterCOP: 0,
        heatingActivePercentage: 0,
        usageByHourOfDay: new Array(24).fill(0),
        usageByDayOfWeek: new Array(7).fill(0),
        dataCollectionRatePerDay: 0
      };
    }
  }

  /**
   * Set all hot water usage data points (replacing existing data)
   * @param dataPoints Array of hot water usage data points
   */
  public async setDataPoints(dataPoints: HotWaterUsageDataPoint[]): Promise<void> {
    try {
      // Validate all data points
      const validDataPoints = dataPoints.filter(dp => this.validateDataPoint(dp));

      if (validDataPoints.length !== dataPoints.length) {
        this.homey.log(`${dataPoints.length - validDataPoints.length} invalid hot water usage data points were filtered out`);
      }

      // Replace existing data points
      this.dataPoints = validDataPoints;

      // Trim dataset if it exceeds the maximum size
      if (this.dataPoints.length > this.maxDataPoints) {
        // First try to aggregate older data
        await this.reduceDataSize();

        // If still too large, just slice
        if (this.dataPoints.length > this.maxDataPoints) {
          this.dataPoints = this.dataPoints.slice(-this.maxDataPoints);
        }
      }

      // Save data
      await this.saveData();

      this.homey.log(`Set ${validDataPoints.length} hot water usage data points`);
    } catch (error) {
      this.homey.error(`Error setting hot water usage data points: ${error}`);
    }
  }

  /**
   * Set maximum number of data points to keep
   * @param maxDataPoints Maximum number of data points
   */
  public async setMaxDataPoints(maxDataPoints: number): Promise<void> {
    try {
      if (maxDataPoints < 100) {
        this.homey.log(`Maximum data points value ${maxDataPoints} is too low, using minimum value of 100`);
        maxDataPoints = 100;
      }

      this.maxDataPoints = maxDataPoints;
      this.homey.log(`Set maximum hot water usage data points to ${maxDataPoints}`);

      // Trim dataset if it exceeds the new maximum size
      if (this.dataPoints.length > this.maxDataPoints) {
        await this.reduceDataSize();
      }
    } catch (error) {
      this.homey.error(`Error setting maximum hot water usage data points: ${error}`);
    }
  }

  /**
   * Clear all stored hot water usage data
   * @param clearAggregated Whether to clear aggregated data as well (default: true)
   */
  public async clearData(clearAggregated: boolean = true): Promise<void> {
    try {
      this.dataPoints = [];
      
      if (clearAggregated) {
        this.aggregatedData = [];
        
        // Clear settings
        this.homey.settings.unset(HOT_WATER_DATA_SETTINGS_KEY);
        this.homey.settings.unset(HOT_WATER_AGGREGATED_DATA_SETTINGS_KEY);
        

        
        this.homey.log('Cleared all hot water usage data');
      } else {
        // Only clear detailed data points, keep aggregated data
        this.homey.settings.unset(HOT_WATER_DATA_SETTINGS_KEY);
        this.homey.log('Cleared detailed hot water usage data (kept aggregated data)');
      }
      
      // Save the current state
      await this.saveData();
    } catch (error) {
      this.homey.error(`Error clearing hot water usage data: ${error}`);
    }
  }

  /**
   * Get memory usage statistics
   * @returns Object with memory usage statistics
   */
  public getMemoryUsage(): { usageKB: number, usagePercent: number, bytesPerDataPoint: number, dataPointsPerDay: number } {
    try {
      // Estimate memory usage based on data size
      const dataJson = JSON.stringify(this.dataPoints);
      const aggregatedDataJson = JSON.stringify(this.aggregatedData);

      const usageBytes = dataJson.length + aggregatedDataJson.length;
      const usageKB = usageBytes / 1024;
      const usagePercent = (usageBytes / MAX_SETTINGS_DATA_SIZE) * 100;

      // Calculate bytes per data point
      const bytesPerDataPoint = this.dataPoints.length > 0 ? dataJson.length / this.dataPoints.length : 0;

      // Calculate data points per day based on observed collection interval
      let dataPointsPerDay = 0;
      if (this.dataPoints.length > 1) {
        const sortedPoints = [...this.dataPoints].sort((a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );
        const durations = this.computeSampleDurations(sortedPoints);
        const totalMinutes = durations.reduce((sum, val) => sum + val, 0);
        const avgInterval = totalMinutes / durations.length;
        if (avgInterval > 0) {
          dataPointsPerDay = Math.round((24 * 60) / avgInterval);
        }
      } else if (this.dataPoints.length === 1) {
        dataPointsPerDay = Math.round((24 * 60) / DEFAULT_INTERVAL_MINUTES);
      }

      if (dataPointsPerDay === 0) {
        dataPointsPerDay = Math.round((24 * 60) / DEFAULT_INTERVAL_MINUTES);
      }

      return {
        usageKB,
        usagePercent,
        bytesPerDataPoint,
        dataPointsPerDay
      };
    } catch (error) {
      this.homey.error(`Error getting memory usage statistics: ${error}`);
      return {
        usageKB: 0,
        usagePercent: 0,
        bytesPerDataPoint: 0,
        dataPointsPerDay: 0
      };
    }
  }
}
