/**
 * Thermal Model Data Collector
 *
 * This service collects and stores thermal data from the MELCloud device
 * to build a learning model of the home's thermal characteristics.
 *
 * Data is stored in Homey's settings storage, which persists across app updates and reinstallations.
 * Implements data retention policies and memory management to prevent memory leaks.
 */

import { DateTime } from 'luxon';
import * as path from 'path';

// Settings key for thermal data storage
const THERMAL_DATA_SETTINGS_KEY = 'thermal_model_data';
// Settings key for aggregated historical data
const AGGREGATED_DATA_SETTINGS_KEY = 'thermal_model_aggregated_data';
// Maximum number of data points to keep in memory
const DEFAULT_MAX_DATA_POINTS = 2016; // ~2 weeks of data at 10-minute intervals
// Maximum age of data points in days
const MAX_DATA_AGE_DAYS = 30;
// Maximum size of data to store in settings (bytes)
const MAX_SETTINGS_DATA_SIZE = 500000; // ~500KB

export interface ThermalDataPoint {
  timestamp: string;
  indoorTemperature: number;
  outdoorTemperature: number;
  targetTemperature: number;
  heatingActive: boolean;
  weatherConditions: {
    windSpeed: number;
    humidity: number;
    cloudCover: number;
    precipitation: number;
  };
  energyUsage?: number; // Optional if available from MELCloud
}

export interface AggregatedDataPoint {
  date: string; // YYYY-MM-DD format
  avgIndoorTemp: number;
  avgOutdoorTemp: number;
  avgTargetTemp: number;
  heatingHours: number;
  avgWindSpeed: number;
  avgHumidity: number;
  totalEnergyUsage?: number;
  dataPointCount: number;
}

export class ThermalDataCollector {
  private dataPoints: ThermalDataPoint[] = [];
  private aggregatedData: AggregatedDataPoint[] = [];
  private maxDataPoints: number = DEFAULT_MAX_DATA_POINTS;
  private initialized: boolean = false;
  private lastMemoryCheck: number = 0;
  private memoryWarningIssued: boolean = false;

  constructor(private homey: any) {
    const userDataPath = (homey?.env && typeof homey.env.userDataPath === 'string' && homey.env.userDataPath.trim().length > 0)
      ? homey.env.userDataPath
      : path.join(process.cwd(), '.homey-data');

    if (!homey?.env) {
      homey.env = {};
    }
    if (!homey.env.userDataPath) {
      homey.env.userDataPath = userDataPath;
    }
    this.loadStoredData();
  }

  /**
   * Load previously stored thermal data from Homey settings
   * Falls back to file storage if settings storage fails
   * Also loads aggregated historical data
   */
  private loadStoredData(): void {
    try {
      // First try to load from Homey settings (persists across reinstalls)
      const settingsData = this.homey.settings.get(THERMAL_DATA_SETTINGS_KEY);
      const aggregatedData = this.homey.settings.get(AGGREGATED_DATA_SETTINGS_KEY);

      let dataLoaded = false;

      if (settingsData) {
        try {
          this.dataPoints = typeof settingsData === 'string'
            ? JSON.parse(settingsData)
            : Array.isArray(settingsData)
              ? settingsData
              : [];
          this.homey.log(`Loaded ${this.dataPoints.length} thermal data points from settings storage`);
          dataLoaded = true;
        } catch (parseError) {
          this.homey.error(`Error parsing thermal data from settings: ${parseError}`);
          this.dataPoints = [];
        }
      }

      if (aggregatedData) {
        try {
          this.aggregatedData = typeof aggregatedData === 'string'
            ? JSON.parse(aggregatedData)
            : Array.isArray(aggregatedData)
              ? aggregatedData
              : [];
          this.homey.log(`Loaded ${this.aggregatedData.length} aggregated data points from settings storage`);
        } catch (parseError) {
          this.homey.error(`Error parsing aggregated data from settings: ${parseError}`);
          this.aggregatedData = [];
        }
      }

      if (!dataLoaded) {
        this.homey.log('No stored thermal data found, starting fresh collection');
        this.dataPoints = [];
      }

      // Clean up data on load to ensure we don't have too many points
      this.cleanupDataOnLoad();

      this.initialized = true;
    } catch (error) {
      this.homey.error(`Error loading thermal data: ${error}`);
      this.dataPoints = [];
      this.aggregatedData = [];
      this.initialized = true;
    }
  }

  /**
   * Clean up data after loading to ensure we don't exceed limits
   */
  private cleanupDataOnLoad(): void {
    try {
      // Remove data points older than MAX_DATA_AGE_DAYS
      this.removeOldDataPoints();

      // Trim to maxDataPoints if still too large
      if (this.dataPoints.length > this.maxDataPoints) {
        const excessPoints = this.dataPoints.length - this.maxDataPoints;
        this.dataPoints = this.dataPoints.slice(excessPoints);
        this.homey.log(`Trimmed ${excessPoints} oldest thermal data points on load to maintain limit of ${this.maxDataPoints} entries`);
      }
    } catch (error) {
      this.homey.error(`Error cleaning up data on load: ${error}`);
    }
  }

  /**
   * Save thermal data to Homey settings (persists across reinstalls)
   */
  private saveToSettings(): void {
    try {
      // Check memory usage before saving
      this.checkMemoryUsage();

      // Create a new Set for tracking circular references
      const seen = new WeakSet();

      // Stringify with a replacer function to handle circular references
      const dataString = JSON.stringify(this.dataPoints, (key, value) => {
        // Handle circular references
        if (typeof value === 'object' && value !== null) {
          if (seen.has(value)) {
            return '[Circular]';
          }
          seen.add(value);
        }
        return value;
      });

      // Check if the data is too large for settings storage
      if (dataString.length > MAX_SETTINGS_DATA_SIZE) {
        this.homey.log(`Data size (${dataString.length} bytes) exceeds maximum settings size (${MAX_SETTINGS_DATA_SIZE} bytes)`);
        this.reduceDataSize();
        return; // reduceDataSize will call saveToSettings again with reduced data
      }

      this.homey.settings.set(THERMAL_DATA_SETTINGS_KEY, dataString);

      // Also save aggregated data
      if (this.aggregatedData.length > 0) {
        const aggregatedString = JSON.stringify(this.aggregatedData);
        this.homey.settings.set(AGGREGATED_DATA_SETTINGS_KEY, aggregatedString);
        this.homey.log(`Saved ${this.aggregatedData.length} aggregated data points to settings storage`);
      }

      this.homey.log(`Saved ${this.dataPoints.length} thermal data points to settings storage (${dataString.length} bytes)`);
    } catch (error) {
      this.homey.error(`Error saving thermal data to settings`, error);

      // Try to save a smaller subset if the full dataset is too large
      this.reduceDataSize();
    }
  }

  /**
   * Reduce the size of the data to be saved when it's too large
   */
  private reduceDataSize(): void {
    try {
      // First try to aggregate older data
      this.aggregateOlderData();

      // If still too many points, keep only the most recent ones
      if (this.dataPoints.length > 500) {
        const reducedDataPoints = this.dataPoints.slice(-500); // Keep only the most recent 500 points
        const originalCount = this.dataPoints.length;
        this.dataPoints = reducedDataPoints;

        this.homey.log(`Reduced data points from ${originalCount} to ${this.dataPoints.length} due to size constraints`);

        // Try to save the reduced dataset
        try {
          const dataString = JSON.stringify(this.dataPoints);
          this.homey.settings.set(THERMAL_DATA_SETTINGS_KEY, dataString);
          this.homey.log(`Saved reduced set of ${this.dataPoints.length} thermal data points to settings storage`);
        } catch (fallbackError) {
          this.homey.error(`Failed to save even reduced thermal data to settings`, fallbackError);
        }
      }
    } catch (error) {
      this.homey.error(`Error reducing data size: ${error}`);
    }
  }

  /**
   * Check memory usage and log warnings if memory usage is high
   */
  private checkMemoryUsage(): void {
    try {
      // Only check memory usage every 10 minutes to avoid excessive logging
      const now = Date.now();
      if (now - this.lastMemoryCheck < 10 * 60 * 1000) {
        return;
      }

      this.lastMemoryCheck = now;

      // Get memory usage if available
      if (process && process.memoryUsage) {
        const memoryUsage = process.memoryUsage();
        const heapUsedMB = Math.round(memoryUsage.heapUsed / 1024 / 1024 * 100) / 100;
        const heapTotalMB = Math.round(memoryUsage.heapTotal / 1024 / 1024 * 100) / 100;
        const usagePercentage = Math.round((heapUsedMB / heapTotalMB) * 100);

        this.homey.log(`Memory usage: ${heapUsedMB}MB / ${heapTotalMB}MB (${usagePercentage}%)`);

        // If memory usage is high, log a warning and trigger data cleanup
        if (usagePercentage > 80 && !this.memoryWarningIssued) {
          this.homey.error(`High memory usage detected: ${usagePercentage}%. Triggering data cleanup.`);
          this.memoryWarningIssued = true;
          this.aggregateOlderData();
        } else if (usagePercentage < 70) {
          // Reset warning flag when memory usage drops
          this.memoryWarningIssued = false;
        }
      }
    } catch (error) {
      this.homey.error(`Error checking memory usage: ${error}`);
    }
  }

  /**
   * Save thermal data to all storage methods
   */
  private saveData(): void {
    // Remove old data points first
    this.removeOldDataPoints();

    // Save to settings (primary storage that persists across reinstalls)
    this.saveToSettings();
  }

  /**
   * Remove data points older than MAX_DATA_AGE_DAYS
   * @returns Number of data points removed
   */
  private removeOldDataPoints(): number {
    try {
      const originalCount = this.dataPoints.length;

      // Calculate cutoff date (MAX_DATA_AGE_DAYS ago)
      const cutoffDate = DateTime.now().minus({ days: MAX_DATA_AGE_DAYS });

      // Filter out data points older than the cutoff date
      this.dataPoints = this.dataPoints.filter(point => {
        const pointDate = DateTime.fromISO(point.timestamp);
        return pointDate >= cutoffDate;
      });

      const removedCount = originalCount - this.dataPoints.length;

      if (removedCount > 0) {
        this.homey.log(`Removed ${removedCount} data points older than ${MAX_DATA_AGE_DAYS} days`);
      }

      return removedCount;
    } catch (error) {
      this.homey.error(`Error removing old data points: ${error}`);
      return 0;
    }
  }

  /**
   * Aggregate older data to reduce memory usage while preserving historical patterns
   */
  private aggregateOlderData(): void {
    try {
      // Only aggregate if we have enough data points
      if (this.dataPoints.length < 100) {
        return;
      }

      // Keep the most recent 7 days of data at full resolution
      const sevenDaysAgo = DateTime.now().minus({ days: 7 });

      // Split data into recent (keep as is) and older (to be aggregated)
      const recentData: ThermalDataPoint[] = [];
      const olderData: ThermalDataPoint[] = [];

      this.dataPoints.forEach(point => {
        const pointDate = DateTime.fromISO(point.timestamp);
        if (pointDate >= sevenDaysAgo) {
          recentData.push(point);
        } else {
          olderData.push(point);
        }
      });

      // If no older data, nothing to aggregate
      if (olderData.length === 0) {
        return;
      }

      this.homey.log(`Aggregating ${olderData.length} older data points`);

      // Group older data by day
      const dataByDay: Record<string, ThermalDataPoint[]> = {};

      olderData.forEach(point => {
        const date = DateTime.fromISO(point.timestamp).toFormat('yyyy-MM-dd');
        if (!dataByDay[date]) {
          dataByDay[date] = [];
        }
        dataByDay[date].push(point);
      });

      // Create daily aggregates
      const newAggregates: AggregatedDataPoint[] = [];

      Object.entries(dataByDay).forEach(([date, points]) => {
        // Skip if we already have an aggregate for this date
        if (this.aggregatedData.some(agg => agg.date === date)) {
          return;
        }

        // Calculate averages
        const avgIndoorTemp = points.reduce((sum, p) => sum + p.indoorTemperature, 0) / points.length;
        const avgOutdoorTemp = points.reduce((sum, p) => sum + p.outdoorTemperature, 0) / points.length;
        const avgTargetTemp = points.reduce((sum, p) => sum + p.targetTemperature, 0) / points.length;
        const heatingHours = points.filter(p => p.heatingActive).length * (24 / points.length);
        const avgWindSpeed = points.reduce((sum, p) => sum + p.weatherConditions.windSpeed, 0) / points.length;
        const avgHumidity = points.reduce((sum, p) => sum + p.weatherConditions.humidity, 0) / points.length;

        // Calculate total energy usage if available
        let totalEnergyUsage: number | undefined = undefined;
        if (points.some(p => p.energyUsage !== undefined)) {
          totalEnergyUsage = points.reduce((sum, p) => sum + (p.energyUsage || 0), 0);
        }

        // Create aggregated data point
        const aggregatedPoint: AggregatedDataPoint = {
          date,
          avgIndoorTemp,
          avgOutdoorTemp,
          avgTargetTemp,
          heatingHours,
          avgWindSpeed,
          avgHumidity,
          totalEnergyUsage,
          dataPointCount: points.length
        };

        newAggregates.push(aggregatedPoint);
      });

      // Add new aggregates to existing ones
      this.aggregatedData = [...this.aggregatedData, ...newAggregates];

      // Update data points to only include recent data
      this.dataPoints = recentData;

      this.homey.log(`Aggregated ${olderData.length} older data points into ${newAggregates.length} daily aggregates. Kept ${recentData.length} recent points.`);
    } catch (error) {
      this.homey.error(`Error aggregating older data: ${error}`);
    }
  }

  /**
   * Add a new thermal data point
   * @param dataPoint The thermal data point to add
   */
  public addDataPoint(dataPoint: ThermalDataPoint): void {
    if (!this.initialized) {
      this.homey.log('Thermal data collector not yet initialized, waiting...');
      return;
    }

    try {
      // Validate the data point
      if (!this.validateDataPoint(dataPoint)) {
        this.homey.error('Invalid thermal data point, skipping');
        return;
      }

      // Add the new data point
      this.dataPoints.push(dataPoint);

      // Trim the data set if it exceeds the maximum size
      if (this.dataPoints.length > this.maxDataPoints) {
        // Instead of just slicing, try to aggregate older data first
        this.aggregateOlderData();

        // If still too large, then slice
        if (this.dataPoints.length > this.maxDataPoints) {
          const excessPoints = this.dataPoints.length - this.maxDataPoints;
          this.dataPoints = this.dataPoints.slice(excessPoints);
          this.homey.log(`Trimmed ${excessPoints} oldest thermal data points to maintain limit of ${this.maxDataPoints} entries`);
        }
      }

      // Save the updated data
      this.saveData();

      this.homey.log(`Added new thermal data point. Total points: ${this.dataPoints.length}`);
    } catch (error) {
      this.homey.error('Error adding thermal data point:', error);
    }
  }

  /**
   * Validate a thermal data point to ensure it contains valid data
   * @param dataPoint The data point to validate
   * @returns True if the data point is valid, false otherwise
   */
  private validateDataPoint(dataPoint: ThermalDataPoint): boolean {
    try {
      // Check for required fields
      if (!dataPoint.timestamp ||
          typeof dataPoint.indoorTemperature !== 'number' ||
          typeof dataPoint.outdoorTemperature !== 'number' ||
          typeof dataPoint.targetTemperature !== 'number' ||
          typeof dataPoint.heatingActive !== 'boolean') {
        return false;
      }

      // Check for valid temperature ranges
      if (dataPoint.indoorTemperature < -10 || dataPoint.indoorTemperature > 40 ||
          dataPoint.outdoorTemperature < -50 || dataPoint.outdoorTemperature > 50 ||
          dataPoint.targetTemperature < 5 || dataPoint.targetTemperature > 30) {
        return false;
      }

      // Check for valid timestamp
      try {
        const timestamp = DateTime.fromISO(dataPoint.timestamp);
        if (!timestamp.isValid) {
          return false;
        }

        // Check that timestamp is not in the future
        if (timestamp > DateTime.now()) {
          return false;
        }
      } catch (e) {
        return false;
      }

      // Check weather conditions
      if (!dataPoint.weatherConditions ||
          typeof dataPoint.weatherConditions.windSpeed !== 'number' ||
          typeof dataPoint.weatherConditions.humidity !== 'number' ||
          typeof dataPoint.weatherConditions.cloudCover !== 'number' ||
          typeof dataPoint.weatherConditions.precipitation !== 'number') {
        return false;
      }

      return true;
    } catch (error) {
      this.homey.error('Error validating data point:', error);
      return false;
    }
  }

  /**
   * Get all thermal data points
   * @returns Array of all thermal data points
   */
  public getAllDataPoints(): ThermalDataPoint[] {
    return this.dataPoints;
  }

  /**
   * Get aggregated historical data
   * @returns Array of aggregated data points
   */
  public getAggregatedData(): AggregatedDataPoint[] {
    return this.aggregatedData;
  }

  /**
   * Get combined data for analysis (recent detailed points + historical aggregates)
   * This provides a comprehensive dataset for analysis while keeping memory usage low
   * @returns Object containing both detailed and aggregated data
   */
  public getCombinedDataForAnalysis(): {
    detailed: ThermalDataPoint[];
    aggregated: AggregatedDataPoint[];
    totalDataPoints: number;
  } {
    return {
      detailed: this.dataPoints,
      aggregated: this.aggregatedData,
      totalDataPoints: this.dataPoints.length + this.aggregatedData.reduce((sum, agg) => sum + agg.dataPointCount, 0)
    };
  }

  /**
   * Get data points from the last N hours
   * @param hours Number of hours to look back
   * @returns Array of data points from the specified time period
   */
  public getRecentDataPoints(hours: number): ThermalDataPoint[] {
    try {
      const cutoffTime = DateTime.now().minus({ hours });
      return this.dataPoints.filter(point => {
        const pointTime = DateTime.fromISO(point.timestamp);
        return pointTime.isValid && pointTime >= cutoffTime;
      });
    } catch (error) {
      this.homey.error(`Error getting recent data points: ${error}`);
      return [];
    }
  }

  /**
   * Get data statistics for a specific time period
   * @param days Number of days to analyze
   * @returns Statistics about the data for the specified period
   */
  public getDataStatistics(days: number = 7): {
    dataPointCount: number;
    avgIndoorTemp: number;
    avgOutdoorTemp: number;
    heatingActivePercentage: number;
    oldestDataPoint: string;
    newestDataPoint: string;
    dataCollectionRate: number; // points per day
  } {
    try {
      const cutoffDate = DateTime.now().minus({ days });
      const recentPoints = this.dataPoints.filter(point => {
        const pointDate = DateTime.fromISO(point.timestamp);
        return pointDate.isValid && pointDate >= cutoffDate;
      });

      if (recentPoints.length === 0) {
        return {
          dataPointCount: 0,
          avgIndoorTemp: 0,
          avgOutdoorTemp: 0,
          heatingActivePercentage: 0,
          oldestDataPoint: '',
          newestDataPoint: '',
          dataCollectionRate: 0
        };
      }

      // Sort points by timestamp
      const sortedPoints = [...recentPoints].sort((a, b) => {
        return DateTime.fromISO(a.timestamp).toMillis() - DateTime.fromISO(b.timestamp).toMillis();
      });

      const oldestPoint = sortedPoints[0];
      const newestPoint = sortedPoints[sortedPoints.length - 1];

      // Calculate statistics
      const avgIndoorTemp = recentPoints.reduce((sum, p) => sum + p.indoorTemperature, 0) / recentPoints.length;
      const avgOutdoorTemp = recentPoints.reduce((sum, p) => sum + p.outdoorTemperature, 0) / recentPoints.length;
      const heatingActiveCount = recentPoints.filter(p => p.heatingActive).length;
      const heatingActivePercentage = (heatingActiveCount / recentPoints.length) * 100;

      // Calculate data collection rate (points per day)
      const oldestDate = DateTime.fromISO(oldestPoint.timestamp);
      const newestDate = DateTime.fromISO(newestPoint.timestamp);
      const daysDiff = newestDate.diff(oldestDate, 'days').days;
      const dataCollectionRate = daysDiff > 0 ? recentPoints.length / daysDiff : recentPoints.length;

      return {
        dataPointCount: recentPoints.length,
        avgIndoorTemp: Math.round(avgIndoorTemp * 10) / 10,
        avgOutdoorTemp: Math.round(avgOutdoorTemp * 10) / 10,
        heatingActivePercentage: Math.round(heatingActivePercentage * 10) / 10,
        oldestDataPoint: oldestPoint.timestamp,
        newestDataPoint: newestPoint.timestamp,
        dataCollectionRate: Math.round(dataCollectionRate * 10) / 10
      };
    } catch (error) {
      this.homey.error(`Error calculating data statistics: ${error}`);
      return {
        dataPointCount: 0,
        avgIndoorTemp: 0,
        avgOutdoorTemp: 0,
        heatingActivePercentage: 0,
        oldestDataPoint: '',
        newestDataPoint: '',
        dataCollectionRate: 0
      };
    }
  }

  /**
   * Set data points (replace all existing data)
   * Used for data cleanup and management
   * @param dataPoints Array of data points to set
   */
  public setDataPoints(dataPoints: ThermalDataPoint[]): void {
    if (!this.initialized) {
      this.homey.log('Thermal data collector not yet initialized, waiting...');
      return;
    }

    try {
      // Validate the data points
      const validDataPoints = dataPoints.filter(point => this.validateDataPoint(point));

      if (validDataPoints.length < dataPoints.length) {
        this.homey.log(`Filtered out ${dataPoints.length - validDataPoints.length} invalid data points`);
      }

      // Replace the data points
      this.dataPoints = validDataPoints;

      // Save the updated data
      this.saveData();

      this.homey.log(`Updated thermal data points. Total points: ${this.dataPoints.length}`);
    } catch (error) {
      this.homey.error('Error setting thermal data points:', error);
    }
  }

  /**
   * Set the maximum number of data points to keep in memory
   * @param maxPoints Maximum number of data points
   */
  public setMaxDataPoints(maxPoints: number): void {
    try {
      if (maxPoints < 100) {
        this.homey.error(`Invalid maxDataPoints value: ${maxPoints}. Must be at least 100.`);
        return;
      }

      const oldMax = this.maxDataPoints;
      this.maxDataPoints = maxPoints;
      this.homey.log(`Updated maxDataPoints from ${oldMax} to ${maxPoints}`);

      // If current data exceeds the new maximum, trim it
      if (this.dataPoints.length > this.maxDataPoints) {
        this.aggregateOlderData();

        if (this.dataPoints.length > this.maxDataPoints) {
          const excessPoints = this.dataPoints.length - this.maxDataPoints;
          this.dataPoints = this.dataPoints.slice(excessPoints);
          this.homey.log(`Trimmed ${excessPoints} oldest thermal data points to match new limit of ${this.maxDataPoints}`);
        }

        // Save the updated data
        this.saveData();
      }
    } catch (error) {
      this.homey.error(`Error setting max data points: ${error}`);
    }
  }

  /**
   * Clear all stored data (for testing or reset)
   * @param clearAggregated Whether to also clear aggregated data (default: true)
   */
  public clearData(clearAggregated: boolean = true): void {
    try {
      this.dataPoints = [];

      if (clearAggregated) {
        this.aggregatedData = [];
        this.homey.log('Cleared all thermal data (including aggregated data)');
      } else {
        this.homey.log('Cleared detailed thermal data points (kept aggregated data)');
      }

      this.saveData();
    } catch (error) {
      this.homey.error(`Error clearing data: ${error}`);
    }
  }

  /**
   * Get memory usage statistics for the data collector
   * @returns Object with memory usage information
   */
  public getMemoryUsage(): {
    dataPointCount: number;
    aggregatedDataCount: number;
    estimatedMemoryUsageKB: number;
    dataPointsPerDay: number;
  } {
    try {
      // Estimate memory usage (rough approximation)
      // Average data point is about 200 bytes, average aggregated point is about 100 bytes
      const dataPointsMemory = this.dataPoints.length * 200;
      const aggregatedMemory = this.aggregatedData.length * 100;
      const totalMemoryKB = Math.round((dataPointsMemory + aggregatedMemory) / 1024);

      // Calculate data points per day
      let dataPointsPerDay = 0;
      if (this.dataPoints.length > 0) {
        const now = DateTime.now();
        const oneDayAgo = now.minus({ days: 1 });
        const lastDayPoints = this.dataPoints.filter(point => {
          const pointDate = DateTime.fromISO(point.timestamp);
          return pointDate >= oneDayAgo && pointDate <= now;
        });
        dataPointsPerDay = lastDayPoints.length;
      }

      return {
        dataPointCount: this.dataPoints.length,
        aggregatedDataCount: this.aggregatedData.length,
        estimatedMemoryUsageKB: totalMemoryKB,
        dataPointsPerDay
      };
    } catch (error) {
      this.homey.error(`Error getting memory usage: ${error}`);
      return {
        dataPointCount: this.dataPoints.length,
        aggregatedDataCount: this.aggregatedData.length,
        estimatedMemoryUsageKB: 0,
        dataPointsPerDay: 0
      };
    }
  }
}
