import os from 'os';
import fs from 'fs';
import { HotWaterDataCollector, HotWaterUsageDataPoint } from '../../src/services/hot-water/hot-water-data-collector';

describe('HotWaterDataCollector', () => {
  let homey: any;
  let collector: HotWaterDataCollector;

  beforeEach(async () => {
    // Create fresh mock for each test
    homey = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      settings: {
        get: jest.fn().mockReturnValue(undefined),
        set: jest.fn(),
        unset: jest.fn()
      },
      env: { userDataPath: os.tmpdir() }
    };

    // Create fresh collector for each test
    collector = new HotWaterDataCollector(homey);
    
    // Ensure clean state
    await collector.clearData(true);
  });

  test('validateDataPoint rejects future timestamps', () => {
    const future: HotWaterUsageDataPoint = {
      timestamp: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
      tankTemperature: 40,
      targetTankTemperature: 45,
      hotWaterEnergyProduced: 1,
      hotWaterEnergyConsumed: 2,
      hotWaterCOP: 0.5,
      isHeating: true,
      hourOfDay: 12,
      dayOfWeek: 3
    };

    // validateDataPoint is private; call addDataPoint which uses validation
    return collector.addDataPoint(future as any).then(() => {
      // addDataPoint will silently return; dataPoints should remain empty
      expect(collector.getAllDataPoints().length).toBe(0);
    });
  });

  test('setDataPoints filters invalid points and saves', async () => {
    const now = new Date().toISOString();
    const valid: HotWaterUsageDataPoint = {
      timestamp: now,
      tankTemperature: 45,
      targetTankTemperature: 47,
      hotWaterEnergyProduced: 1,
      hotWaterEnergyConsumed: 2,
      hotWaterCOP: 0.5,
      isHeating: true,
      hourOfDay: 12,
      dayOfWeek: 2
    };

    const invalid: any = { ...valid, hourOfDay: 99 };

    await collector.setDataPoints([valid, invalid]);
    expect(collector.getAllDataPoints().length).toBe(1);
  });

  test('getDataStatistics returns zeros when no data', async () => {
    const stats = collector.getDataStatistics(7);
    expect(stats.dataPointCount).toBe(0);
    expect(Array.isArray(stats.usageByHourOfDay)).toBe(true);
  });

  // Additional comprehensive tests for HotWaterDataCollector

  test('constructor initializes with default values', () => {
    expect(collector.getAllDataPoints()).toEqual([]);
    expect(collector.getAggregatedData()).toEqual([]);
  });

  test('addDataPoint validates and stores valid data points', async () => {
    const validDataPoint: HotWaterUsageDataPoint = {
      timestamp: new Date().toISOString(),
      tankTemperature: 45,
      targetTankTemperature: 50,
      hotWaterEnergyProduced: 1.5,
      hotWaterEnergyConsumed: 2.0,
      hotWaterCOP: 0.75,
      isHeating: true,
      hourOfDay: 14,
      dayOfWeek: 2
    };

    await collector.addDataPoint(validDataPoint);
    const dataPoints = collector.getAllDataPoints();
    expect(dataPoints.length).toBe(1);
    expect(dataPoints[0]).toEqual(validDataPoint);
  });

  test('addDataPoint rejects invalid tank temperature', async () => {
    const invalidDataPoint: HotWaterUsageDataPoint = {
      timestamp: new Date().toISOString(),
      tankTemperature: -5, // Invalid: negative temperature
      targetTankTemperature: 50,
      hotWaterEnergyProduced: 1.5,
      hotWaterEnergyConsumed: 2.0,
      hotWaterCOP: 0.75,
      isHeating: true,
      hourOfDay: 14,
      dayOfWeek: 2
    };

    await collector.addDataPoint(invalidDataPoint);
    expect(collector.getAllDataPoints().length).toBe(0);
  });

  test('addDataPoint rejects invalid target tank temperature', async () => {
    const invalidDataPoint: HotWaterUsageDataPoint = {
      timestamp: new Date().toISOString(),
      tankTemperature: 45,
      targetTankTemperature: 150, // Invalid: too high
      hotWaterEnergyProduced: 1.5,
      hotWaterEnergyConsumed: 2.0,
      hotWaterCOP: 0.75,
      isHeating: true,
      hourOfDay: 14,
      dayOfWeek: 2
    };

    await collector.addDataPoint(invalidDataPoint);
    expect(collector.getAllDataPoints().length).toBe(0);
  });

  test('addDataPoint rejects invalid hour of day', async () => {
    const invalidDataPoint: HotWaterUsageDataPoint = {
      timestamp: new Date().toISOString(),
      tankTemperature: 45,
      targetTankTemperature: 50,
      hotWaterEnergyProduced: 1.5,
      hotWaterEnergyConsumed: 2.0,
      hotWaterCOP: 0.75,
      isHeating: true,
      hourOfDay: 25, // Invalid: > 23
      dayOfWeek: 2
    };

    await collector.addDataPoint(invalidDataPoint);
    expect(collector.getAllDataPoints().length).toBe(0);
  });

  test('addDataPoint rejects invalid day of week', async () => {
    const invalidDataPoint: HotWaterUsageDataPoint = {
      timestamp: new Date().toISOString(),
      tankTemperature: 45,
      targetTankTemperature: 50,
      hotWaterEnergyProduced: 1.5,
      hotWaterEnergyConsumed: 2.0,
      hotWaterCOP: 0.75,
      isHeating: true,
      hourOfDay: 14,
      dayOfWeek: 7 // Invalid: > 6
    };

    await collector.addDataPoint(invalidDataPoint);
    expect(collector.getAllDataPoints().length).toBe(0);
  });

  test('addDataPoint rejects missing timestamp', async () => {
    const invalidDataPoint: any = {
      tankTemperature: 45,
      targetTankTemperature: 50,
      hotWaterEnergyProduced: 1.5,
      hotWaterEnergyConsumed: 2.0,
      hotWaterCOP: 0.75,
      isHeating: true,
      hourOfDay: 14,
      dayOfWeek: 2
      // Missing timestamp
    };

    await collector.addDataPoint(invalidDataPoint);
    expect(collector.getAllDataPoints().length).toBe(0);
  });

  test('getAllDataPoints returns all stored data points', async () => {
    const dataPoint1: HotWaterUsageDataPoint = {
      timestamp: new Date().toISOString(),
      tankTemperature: 45,
      targetTankTemperature: 50,
      hotWaterEnergyProduced: 1.5,
      hotWaterEnergyConsumed: 2.0,
      hotWaterCOP: 0.75,
      isHeating: true,
      hourOfDay: 14,
      dayOfWeek: 2
    };

    const dataPoint2: HotWaterUsageDataPoint = {
      timestamp: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
      tankTemperature: 40,
      targetTankTemperature: 45,
      hotWaterEnergyProduced: 1.0,
      hotWaterEnergyConsumed: 1.5,
      hotWaterCOP: 0.67,
      isHeating: false,
      hourOfDay: 13,
      dayOfWeek: 2
    };

    await collector.setDataPoints([dataPoint1, dataPoint2]);
    const allData = collector.getAllDataPoints();
    expect(allData.length).toBe(2);
    expect(allData).toEqual([dataPoint1, dataPoint2]);
  });

  test('getAggregatedData returns aggregated data', () => {
    const aggregatedData = collector.getAggregatedData();
    expect(Array.isArray(aggregatedData)).toBe(true);
  });

  test('getCombinedDataForAnalysis returns both detailed and aggregated data', () => {
    const combinedData = collector.getCombinedDataForAnalysis();
    expect(combinedData).toHaveProperty('detailed');
    expect(combinedData).toHaveProperty('aggregated');
    expect(Array.isArray(combinedData.detailed)).toBe(true);
    expect(Array.isArray(combinedData.aggregated)).toBe(true);
  });

  test('getRecentDataPoints returns data from specified hours', async () => {
    const now = new Date();
    const recentDataPoint: HotWaterUsageDataPoint = {
      timestamp: now.toISOString(),
      tankTemperature: 45,
      targetTankTemperature: 50,
      hotWaterEnergyProduced: 1.5,
      hotWaterEnergyConsumed: 2.0,
      hotWaterCOP: 0.75,
      isHeating: true,
      hourOfDay: 14,
      dayOfWeek: 2
    };

    const oldDataPoint: HotWaterUsageDataPoint = {
      timestamp: new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString(), // 48 hours ago
      tankTemperature: 40,
      targetTankTemperature: 45,
      hotWaterEnergyProduced: 1.0,
      hotWaterEnergyConsumed: 1.5,
      hotWaterCOP: 0.67,
      isHeating: false,
      hourOfDay: 13,
      dayOfWeek: 1
    };

    await collector.setDataPoints([recentDataPoint, oldDataPoint]);
    const recentData = collector.getRecentDataPoints(24); // Last 24 hours
    expect(recentData.length).toBe(1);
    expect(recentData[0]).toEqual(recentDataPoint);
  });

  test('setMaxDataPoints updates maximum data points limit', async () => {
    // Test minimum value enforcement
    await collector.setMaxDataPoints(50);
    expect(homey.log).toHaveBeenCalledWith('Maximum data points value 50 is too low, using minimum value of 100');

    // Test with valid value
    await collector.setMaxDataPoints(200);

    // Add 250 data points
    for (let i = 0; i < 250; i++) {
      await collector.addDataPoint({
        timestamp: new Date(Date.now() - i * 60 * 1000).toISOString(),
        tankTemperature: 45,
        targetTankTemperature: 50,
        hotWaterEnergyProduced: 1.5,
        hotWaterEnergyConsumed: 2.0,
        hotWaterCOP: 0.75,
        isHeating: true,
        hourOfDay: 14,
        dayOfWeek: 2
      });
    }

    // Should be trimmed to maxDataPoints (200)
    expect(collector.getAllDataPoints().length).toBe(200);
    expect(homey.log).toHaveBeenCalledWith('Set maximum hot water usage data points to 200');
  });

  test('setDataPoints handles errors gracefully', async () => {
    // Mock saveData to throw an error
    const originalSaveData = (collector as any).saveData;
    (collector as any).saveData = jest.fn().mockRejectedValue(new Error('Save failed'));

    const dataPoints: HotWaterUsageDataPoint[] = [{
      timestamp: new Date().toISOString(),
      tankTemperature: 45,
      targetTankTemperature: 50,
      hotWaterEnergyProduced: 1.5,
      hotWaterEnergyConsumed: 2.0,
      hotWaterCOP: 0.75,
      isHeating: true,
      hourOfDay: 14,
      dayOfWeek: 2
    }];

    // Should not throw, should handle error gracefully
    await expect(collector.setDataPoints(dataPoints)).resolves.not.toThrow();
    expect(homey.error).toHaveBeenCalledWith('Error setting hot water usage data points: Error: Save failed');

    // Restore original method
    (collector as any).saveData = originalSaveData;
  });

  test('setMaxDataPoints handles errors gracefully', async () => {
    // Mock reduceDataSize to throw an error
    const originalReduceDataSize = (collector as any).reduceDataSize;
    (collector as any).reduceDataSize = jest.fn().mockRejectedValue(new Error('Reduce failed'));

    // Add some data points first
    for (let i = 0; i < 150; i++) {
      await collector.addDataPoint({
        timestamp: new Date(Date.now() - i * 60 * 1000).toISOString(),
        tankTemperature: 45,
        targetTankTemperature: 50,
        hotWaterEnergyProduced: 1.5,
        hotWaterEnergyConsumed: 2.0,
        hotWaterCOP: 0.75,
        isHeating: true,
        hourOfDay: 14,
        dayOfWeek: 2
      });
    }

    // Should not throw, should handle error gracefully
    await expect(collector.setMaxDataPoints(100)).resolves.not.toThrow();
    expect(homey.error).toHaveBeenCalledWith('Error setting maximum hot water usage data points: Error: Reduce failed');

    // Restore original method
    (collector as any).reduceDataSize = originalReduceDataSize;
  });

  test('clearData removes all data points', async () => {
    const dataPoint: HotWaterUsageDataPoint = {
      timestamp: new Date().toISOString(),
      tankTemperature: 45,
      targetTankTemperature: 50,
      hotWaterEnergyProduced: 1.5,
      hotWaterEnergyConsumed: 2.0,
      hotWaterCOP: 0.75,
      isHeating: true,
      hourOfDay: 14,
      dayOfWeek: 2
    };

    await collector.addDataPoint(dataPoint);
    expect(collector.getAllDataPoints().length).toBe(1);

    await collector.clearData();
    expect(collector.getAllDataPoints().length).toBe(0);
  });

  test('getMemoryUsage returns memory usage statistics', () => {
    const memoryUsage = collector.getMemoryUsage();
    expect(memoryUsage).toHaveProperty('usageKB');
    expect(memoryUsage).toHaveProperty('usagePercent');
    expect(memoryUsage).toHaveProperty('bytesPerDataPoint');
    expect(memoryUsage).toHaveProperty('dataPointsPerDay');
    expect(typeof memoryUsage.usageKB).toBe('number');
    expect(typeof memoryUsage.usagePercent).toBe('number');
  });

  test('getDataStatistics calculates statistics correctly with data', async () => {
    const now = new Date();
    const dataPoints: HotWaterUsageDataPoint[] = [];

    // Create data points for different hours
    for (let hour = 0; hour < 24; hour++) {
      dataPoints.push({
        timestamp: new Date(now.getTime() - hour * 60 * 60 * 1000).toISOString(),
        tankTemperature: 45 + Math.random() * 10,
        targetTankTemperature: 50,
        hotWaterEnergyProduced: 1.5 + Math.random(),
        hotWaterEnergyConsumed: 2.0 + Math.random(),
        hotWaterCOP: 0.5 + Math.random() * 0.5,
        isHeating: Math.random() > 0.5,
        hourOfDay: hour,
        dayOfWeek: 2
      });
    }

    await collector.setDataPoints(dataPoints);
    const stats = collector.getDataStatistics(1); // Last day

    expect(stats.dataPointCount).toBeGreaterThan(0);
    expect(stats.usageByHourOfDay.length).toBe(24);
    expect(typeof stats.avgTankTemperature).toBe('number');
    expect(typeof stats.avgHotWaterCOP).toBe('number');
    expect(typeof stats.totalHotWaterEnergyConsumed).toBe('number');
  });

  test('handles validation errors gracefully', async () => {
    // Test with malformed data that causes validation error
    const malformedDataPoint: any = {
      timestamp: new Date().toISOString(),
      tankTemperature: 'invalid', // Should be number
      targetTankTemperature: 50,
      hotWaterEnergyProduced: 1.5,
      hotWaterEnergyConsumed: 2.0,
      hotWaterCOP: 0.75,
      isHeating: true,
      hourOfDay: 14,
      dayOfWeek: 2
    };

    // Should not throw, should handle error gracefully
    await expect(collector.addDataPoint(malformedDataPoint)).resolves.not.toThrow();
    expect(collector.getAllDataPoints().length).toBe(0);
  });
});
