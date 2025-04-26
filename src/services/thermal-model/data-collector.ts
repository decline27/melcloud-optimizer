/**
 * Thermal Model Data Collector
 *
 * This service collects and stores thermal data from the MELCloud device
 * to build a learning model of the home's thermal characteristics.
 *
 * Data is stored in Homey's settings storage, which persists across app updates and reinstallations.
 */

import { DateTime } from 'luxon';
import * as fs from 'fs';
import * as path from 'path';

// Settings key for thermal data storage
const THERMAL_DATA_SETTINGS_KEY = 'thermal_model_data';
// Backup file path (as fallback)
const BACKUP_FILE_NAME = 'thermal-data-backup.json';

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

export class ThermalDataCollector {
  private dataPoints: ThermalDataPoint[] = [];
  private backupFilePath: string;
  private maxDataPoints: number = 2016; // Store 2 weeks of data at 10-minute intervals
  private initialized: boolean = false;

  constructor(private homey: any) {
    this.backupFilePath = path.join(homey.env.userDataPath, BACKUP_FILE_NAME);
    this.loadStoredData();
  }

  /**
   * Load previously stored thermal data from Homey settings
   * Falls back to file storage if settings storage fails
   */
  private loadStoredData(): void {
    try {
      // First try to load from Homey settings (persists across reinstalls)
      const settingsData = this.homey.settings.get(THERMAL_DATA_SETTINGS_KEY);

      if (settingsData) {
        this.dataPoints = JSON.parse(settingsData);
        this.homey.log(`Loaded ${this.dataPoints.length} thermal data points from settings storage`);
        this.initialized = true;
        return;
      }

      // If no data in settings, try to load from backup file
      if (fs.existsSync(this.backupFilePath)) {
        const fileData = fs.readFileSync(this.backupFilePath, 'utf8');
        this.dataPoints = JSON.parse(fileData);
        this.homey.log(`Loaded ${this.dataPoints.length} thermal data points from backup file`);

        // Save to settings for future persistence
        this.saveToSettings();
      } else {
        this.homey.log('No stored thermal data found, starting fresh collection');
      }

      this.initialized = true;
    } catch (error) {
      this.homey.error(`Error loading thermal data: ${error}`);
      this.dataPoints = [];
      this.initialized = true;
    }
  }

  /**
   * Save thermal data to Homey settings (persists across reinstalls)
   */
  private saveToSettings(): void {
    try {
      this.homey.settings.set(THERMAL_DATA_SETTINGS_KEY, JSON.stringify(this.dataPoints));
      this.homey.log(`Saved ${this.dataPoints.length} thermal data points to settings storage`);
    } catch (error) {
      this.homey.error(`Error saving thermal data to settings: ${error}`);
    }
  }

  /**
   * Save thermal data to backup file (fallback storage)
   */
  private saveToFile(): void {
    try {
      fs.writeFileSync(this.backupFilePath, JSON.stringify(this.dataPoints), 'utf8');
      this.homey.log(`Saved ${this.dataPoints.length} thermal data points to backup file`);
    } catch (error) {
      this.homey.error(`Error saving thermal data to backup file: ${error}`);
    }
  }

  /**
   * Save thermal data to all storage methods
   */
  private saveData(): void {
    // Save to settings (primary storage that persists across reinstalls)
    this.saveToSettings();

    // Also save to file as backup
    this.saveToFile();
  }

  /**
   * Add a new thermal data point
   */
  public addDataPoint(dataPoint: ThermalDataPoint): void {
    if (!this.initialized) {
      this.homey.log('Thermal data collector not yet initialized, waiting...');
      return;
    }

    // Add the new data point
    this.dataPoints.push(dataPoint);

    // Trim the data set if it exceeds the maximum size
    if (this.dataPoints.length > this.maxDataPoints) {
      this.dataPoints = this.dataPoints.slice(this.dataPoints.length - this.maxDataPoints);
    }

    // Save the updated data
    this.saveData();

    this.homey.log(`Added new thermal data point. Total points: ${this.dataPoints.length}`);
  }

  /**
   * Get all thermal data points
   */
  public getAllDataPoints(): ThermalDataPoint[] {
    return this.dataPoints;
  }

  /**
   * Get data points from the last N hours
   */
  public getRecentDataPoints(hours: number): ThermalDataPoint[] {
    const cutoffTime = DateTime.now().minus({ hours }).toISO();
    return this.dataPoints.filter(point =>
      DateTime.fromISO(point.timestamp) >= DateTime.fromISO(cutoffTime)
    );
  }

  /**
   * Clear all stored data (for testing or reset)
   */
  public clearData(): void {
    this.dataPoints = [];
    this.saveData();
    this.homey.log('Cleared all thermal data points');
  }
}
