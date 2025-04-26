/**
 * Thermal Model Data Collector
 * 
 * This service collects and stores thermal data from the MELCloud device
 * to build a learning model of the home's thermal characteristics.
 */

import { DateTime } from 'luxon';
import * as fs from 'fs';
import * as path from 'path';

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
  private dataStoragePath: string;
  private maxDataPoints: number = 2016; // Store 2 weeks of data at 10-minute intervals
  private initialized: boolean = false;

  constructor(private homey: any) {
    this.dataStoragePath = path.join(homey.env.userDataPath, 'thermal-data.json');
    this.loadStoredData();
  }

  /**
   * Load previously stored thermal data
   */
  private loadStoredData(): void {
    try {
      if (fs.existsSync(this.dataStoragePath)) {
        const data = fs.readFileSync(this.dataStoragePath, 'utf8');
        this.dataPoints = JSON.parse(data);
        this.homey.log(`Loaded ${this.dataPoints.length} thermal data points from storage`);
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
   * Save thermal data to persistent storage
   */
  private saveData(): void {
    try {
      fs.writeFileSync(this.dataStoragePath, JSON.stringify(this.dataPoints), 'utf8');
      this.homey.log(`Saved ${this.dataPoints.length} thermal data points to storage`);
    } catch (error) {
      this.homey.error(`Error saving thermal data: ${error}`);
    }
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
