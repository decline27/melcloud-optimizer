import { ThermalModelService, OptimizationRecommendation } from '../../src/services/thermal-model/thermal-model-service';
import {
  createMockHomey
} from '../mocks';

// Mock the thermal analyzer and data collector
jest.mock('../../src/services/thermal-model/data-collector', () => ({
  ThermalDataCollector: jest.fn().mockImplementation(() => ({
    collectDataPoint: jest.fn(),
    getDataPoints: jest.fn().mockReturnValue([]),
    getRecentDataPoints: jest.fn().mockReturnValue([]),
    getMemoryUsage: jest.fn().mockReturnValue({
      totalDataPoints: 100,
      estimatedMemoryUsageKB: 50,
      oldestDataPoint: '2023-01-01T00:00:00Z',
      newestDataPoint: '2023-01-01T12:00:00Z'
    }),
    aggregateOldData: jest.fn().mockReturnValue({
      aggregatedCount: 10,
      removedCount: 50,
      memoryFreedKB: 25
    }),
    getAggregatedData: jest.fn().mockReturnValue([]),
    forceDataCleanup: jest.fn().mockReturnValue({
      aggregatedCount: 5,
      removedCount: 20,
      memoryFreedKB: 10
    })
  }))
}));

jest.mock('../../src/services/thermal-model/thermal-analyzer', () => ({
  ThermalAnalyzer: jest.fn().mockImplementation(() => ({
    updateModel: jest.fn().mockReturnValue({
      heatingRate: 0.5,
      coolingRate: 0.2,
      outdoorTempImpact: 0.3,
      windImpact: 0.1,
      thermalMass: 0.8,
      modelConfidence: 0.7,
      lastUpdated: '2023-01-01T12:00:00Z'
    }),
    predictHeating: jest.fn().mockReturnValue({
      targetReachedAt: '2023-01-01T13:00:00Z',
      energyRequired: 10.5,
      confidence: 0.8,
      explanation: 'Test prediction'
    }),
    getOptimalStartTime: jest.fn().mockReturnValue({
      startTime: '2023-01-01T12:30:00Z',
      confidence: 0.9
    })
  }))
}));

// Mock luxon DateTime
jest.mock('luxon', () => ({
  DateTime: {
    now: jest.fn().mockReturnValue({
      toISO: jest.fn().mockReturnValue('2023-01-01T12:00:00Z')
    }),
    fromISO: jest.fn().mockImplementation((iso) => ({
      toISO: jest.fn().mockReturnValue(iso),
      plus: jest.fn().mockReturnThis(),
      minus: jest.fn().mockReturnThis(),
      startOf: jest.fn().mockReturnThis(),
      endOf: jest.fn().mockReturnThis()
    }))
  }
}));

describe('ThermalModelService Enhanced Tests', () => {
  let service: ThermalModelService;
  let mockHomey: ReturnType<typeof createMockHomey>;
  let mockDataCollector: any;
  let mockAnalyzer: any;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
    jest.useFakeTimers();

    mockHomey = createMockHomey();
    
    // Create service
    service = new ThermalModelService(mockHomey as any);
    
    // Get the mocked instances
    const DataCollectorMock = require('../../src/services/thermal-model/data-collector').ThermalDataCollector;
    const AnalyzerMock = require('../../src/services/thermal-model/thermal-analyzer').ThermalAnalyzer;
    
    mockDataCollector = DataCollectorMock.mock.instances[DataCollectorMock.mock.instances.length - 1];
    mockAnalyzer = AnalyzerMock.mock.instances[AnalyzerMock.mock.instances.length - 1];
  });

  afterEach(() => {
    jest.useRealTimers();
    // Clean up any running intervals
    if (service) {
      (service as any).stop();
    }
  });

  describe('Constructor', () => {
    test('should initialize with HomeyApp', () => {
      expect(service).toBeDefined();
      
      const DataCollectorMock = require('../../src/services/thermal-model/data-collector').ThermalDataCollector;
      const AnalyzerMock = require('../../src/services/thermal-model/thermal-analyzer').ThermalAnalyzer;
      
      expect(DataCollectorMock).toHaveBeenCalledWith(mockHomey);
      expect(AnalyzerMock).toHaveBeenCalledWith(mockHomey);
    });

    test('should schedule model updates', () => {
      // Check that intervals are set up
      expect(jest.getTimerCount()).toBeGreaterThan(0);
    });
  });

  describe('collectDataPoint', () => {
    test('should collect data point successfully', async () => {
      const dataPoint = {
        timestamp: '2023-01-01T12:00:00Z',
        indoorTemperature: 21.5,
        outdoorTemperature: 5.0,
        targetTemperature: 22.0,
        heatingActive: true,
        energyConsumption: 2.5,
        weatherConditions: {
          temperature: 5.0,
          humidity: 60,
          windSpeed: 10,
          description: 'clear'
        }
      };

      await service.collectDataPoint(dataPoint);

      expect(mockDataCollector.collectDataPoint).toHaveBeenCalledWith(dataPoint);
      expect(mockHomey.log).toHaveBeenCalledWith(
        expect.stringContaining('Data point collected')
      );
    });

    test('should handle data collection errors gracefully', async () => {
      mockDataCollector.collectDataPoint.mockRejectedValue(new Error('Collection failed'));

      const dataPoint = {
        timestamp: '2023-01-01T12:00:00Z',
        indoorTemperature: 21.5,
        outdoorTemperature: 5.0,
        targetTemperature: 22.0,
        heatingActive: true,
        energyConsumption: 2.5,
        weatherConditions: {
          temperature: 5.0,
          humidity: 60,
          windSpeed: 10,
          description: 'clear'
        }
      };

      await expect(service.collectDataPoint(dataPoint)).rejects.toThrow('Collection failed');
      expect(mockHomey.error).toHaveBeenCalledWith(
        'Error collecting data point:',
        expect.any(Error)
      );
    });

    test('should validate data point parameters', async () => {
      const invalidDataPoint = {
        timestamp: '2023-01-01T12:00:00Z',
        indoorTemperature: 'invalid' as any,
        outdoorTemperature: 5.0,
        targetTemperature: 22.0,
        heatingActive: true,
        energyConsumption: 2.5,
        weatherConditions: {
          temperature: 5.0,
          humidity: 60,
          windSpeed: 10,
          description: 'clear'
        }
      };

      await expect(service.collectDataPoint(invalidDataPoint)).rejects.toThrow();
    });
  });

  describe('getThermalCharacteristics', () => {
    test('should return thermal characteristics from analyzer', () => {
      const characteristics = service.getThermalCharacteristics();

      expect(characteristics).toEqual({
        heatingRate: 0.5,
        coolingRate: 0.2,
        outdoorTempImpact: 0.3,
        windImpact: 0.1,
        thermalMass: 0.8,
        modelConfidence: 0.7,
        lastUpdated: '2023-01-01T12:00:00Z'
      });
    });

    test('should handle analyzer errors gracefully', () => {
      mockAnalyzer.updateModel.mockImplementation(() => {
        throw new Error('Analyzer error');
      });

      // This should not throw, should return default characteristics
      const characteristics = service.getThermalCharacteristics();
      expect(characteristics).toBeDefined();
      expect(characteristics.modelConfidence).toBeDefined();
    });
  });

  describe('getHeatingRecommendation', () => {
    test('should get heating recommendation successfully', () => {
      const priceForecasts = [
        { time: '2023-01-01T12:00:00Z', price: 1.2 },
        { time: '2023-01-01T13:00:00Z', price: 0.8 },
        { time: '2023-01-01T14:00:00Z', price: 1.5 }
      ];
      const targetTemp = 22.0;
      const currentTemp = 20.0;
      const outdoorTemp = 5.0;
      const weatherForecast = {
        temperature: 5.0,
        humidity: 60,
        windSpeed: 10,
        description: 'clear'
      };
      const comfortProfile = {
        dayStart: 6,
        dayEnd: 22,
        nightTempReduction: 2,
        preHeatHours: 1
      };

      const recommendation = service.getHeatingRecommendation(
        priceForecasts, targetTemp, currentTemp, outdoorTemp, weatherForecast, comfortProfile
      );

      expect(recommendation).toBeDefined();
      expect(recommendation.recommendedTemperature).toBeDefined();
      expect(recommendation.recommendedStartTime).toBeDefined();
      expect(recommendation.estimatedSavings).toBeDefined();
      expect(recommendation.confidence).toBeDefined();
      expect(recommendation.explanation).toBeDefined();
    });

    test('should handle no price data', () => {
      const priceForecasts: any[] = [];
      const targetTemp = 22.0;
      const currentTemp = 20.0;
      const outdoorTemp = 5.0;
      const weatherForecast = {
        temperature: 5.0,
        humidity: 60,
        windSpeed: 10,
        description: 'clear'
      };
      const comfortProfile = {
        dayStart: 6,
        dayEnd: 22,
        nightTempReduction: 2,
        preHeatHours: 1
      };

      const recommendation = service.getHeatingRecommendation(
        priceForecasts, targetTemp, currentTemp, outdoorTemp, weatherForecast, comfortProfile
      );

      expect(recommendation).toBeDefined();
      expect(recommendation.confidence).toBeLessThan(0.5); // Low confidence without price data
    });

    test('should validate temperature parameters', () => {
      const priceForecasts = [{ time: '2023-01-01T12:00:00Z', price: 1.2 }];
      const outdoorTemp = 5.0;
      const weatherForecast = {
        temperature: 5.0,
        humidity: 60,
        windSpeed: 10,
        description: 'clear'
      };
      const comfortProfile = {
        dayStart: 6,
        dayEnd: 22,
        nightTempReduction: 2,
        preHeatHours: 1
      };

      expect(() => service.getHeatingRecommendation(
        priceForecasts, -100, 20, outdoorTemp, weatherForecast, comfortProfile
      )).toThrow();
      expect(() => service.getHeatingRecommendation(
        priceForecasts, 22, 100, outdoorTemp, weatherForecast, comfortProfile
      )).toThrow();
    });

    test('should handle edge case temperatures', () => {
      const priceForecasts = [{ time: '2023-01-01T12:00:00Z', price: 1.2 }];
      const outdoorTemp = 5.0;
      const weatherForecast = {
        temperature: 5.0,
        humidity: 60,
        windSpeed: 10,
        description: 'clear'
      };
      const comfortProfile = {
        dayStart: 6,
        dayEnd: 22,
        nightTempReduction: 2,
        preHeatHours: 1
      };

      // Target lower than current (cooling scenario)
      const recommendation1 = service.getHeatingRecommendation(
        priceForecasts, 18.0, 22.0, outdoorTemp, weatherForecast, comfortProfile
      );
      expect(recommendation1).toBeDefined();

      // Same temperatures
      const recommendation2 = service.getHeatingRecommendation(
        priceForecasts, 20.0, 20.0, outdoorTemp, weatherForecast, comfortProfile
      );
      expect(recommendation2).toBeDefined();
    });
  });

  describe('getTimeToTarget', () => {
    test('should calculate time to target temperature', () => {
      const currentTemp = 20.0;
      const targetTemp = 22.0;

      const result = service.getTimeToTarget(currentTemp, targetTemp);

      expect(result).toBeDefined();
      expect(result.timeToTarget).toBeGreaterThan(0);
      expect(result.confidence).toBeGreaterThan(0);
    });

    test('should handle cooling scenarios', () => {
      const currentTemp = 24.0;
      const targetTemp = 22.0;

      const result = service.getTimeToTarget(currentTemp, targetTemp);

      expect(result).toBeDefined();
      expect(result.timeToTarget).toBeGreaterThan(0);
    });

    test('should handle same temperatures', () => {
      const currentTemp = 22.0;
      const targetTemp = 22.0;

      const result = service.getTimeToTarget(currentTemp, targetTemp);

      expect(result).toBeDefined();
      expect(result.timeToTarget).toBe(0);
    });

    test('should validate temperature inputs', () => {
      expect(() => service.getTimeToTarget(-100, 20)).toThrow();
      expect(() => service.getTimeToTarget(20, 100)).toThrow();
    });
  });

  describe('Memory Management', () => {
    test('should report memory usage', () => {
      const memoryUsage = service.getMemoryUsage();

      expect(memoryUsage).toBeDefined();
      expect(memoryUsage.totalDataPoints).toBe(100);
      expect(memoryUsage.estimatedMemoryUsageKB).toBe(50);
      expect(mockDataCollector.getMemoryUsage).toHaveBeenCalled();
    });

    test('should force data cleanup', () => {
      const cleanupResult = service.forceDataCleanup();

      expect(cleanupResult).toBeDefined();
      expect(cleanupResult.success).toBeDefined();
      expect(mockDataCollector.forceDataCleanup).toHaveBeenCalled();
    });

    test('should handle automatic cleanup on schedule', () => {
      // Fast-forward time to trigger cleanup
      jest.advanceTimersByTime(24 * 60 * 60 * 1000); // 24 hours

      expect(mockDataCollector.aggregateOldData).toHaveBeenCalled();
    });
  });

  describe('Model Updates', () => {
    test('should update model with recent data', () => {
      const mockDataPoints = [
        {
          timestamp: '2023-01-01T12:00:00Z',
          indoorTemperature: 21.0,
          outdoorTemperature: 5.0,
          targetTemperature: 22.0,
          heatingActive: true,
          energyConsumption: 2.5,
          weatherConditions: {
            temperature: 5.0,
            humidity: 60,
            windSpeed: 10,
            description: 'clear'
          }
        }
      ];

      mockDataCollector.getRecentDataPoints.mockReturnValue(mockDataPoints);

      // Trigger model update
      jest.advanceTimersByTime(60 * 60 * 1000); // 1 hour

      expect(mockDataCollector.getRecentDataPoints).toHaveBeenCalled();
      expect(mockAnalyzer.updateModel).toHaveBeenCalledWith(mockDataPoints);
    });

    test('should handle model update with insufficient data', () => {
      mockDataCollector.getRecentDataPoints.mockReturnValue([]);

      // Trigger model update
      jest.advanceTimersByTime(60 * 60 * 1000); // 1 hour

      expect(mockHomey.log).toHaveBeenCalledWith(
        expect.stringContaining('Insufficient data')
      );
    });

    test('should handle model update errors', () => {
      mockAnalyzer.updateModel.mockImplementation(() => {
        throw new Error('Model update failed');
      });

      const mockDataPoints = [
        {
          timestamp: '2023-01-01T12:00:00Z',
          indoorTemperature: 21.0,
          outdoorTemperature: 5.0,
          targetTemperature: 22.0,
          heatingActive: true,
          energyConsumption: 2.5,
          weatherConditions: {
            temperature: 5.0,
            humidity: 60,
            windSpeed: 10,
            description: 'clear'
          }
        }
      ];

      mockDataCollector.getRecentDataPoints.mockReturnValue(mockDataPoints);

      // Trigger model update
      jest.advanceTimersByTime(60 * 60 * 1000); // 1 hour

      expect(mockHomey.error).toHaveBeenCalledWith(
        'Error updating thermal model:',
        expect.any(Error)
      );
    });
  });

  describe('Service Lifecycle', () => {
    test('should stop all intervals when stopped', () => {
      const timerCountBefore = jest.getTimerCount();
      
      service.stop();

      // All timers should be cleared
      expect(jest.getTimerCount()).toBeLessThan(timerCountBefore);
    });

    test('should handle stop when already stopped', () => {
      service.stop();
      
      // Should not throw when called again
      expect(() => service.stop()).not.toThrow();
    });
  });

  describe('Error Handling', () => {
    test('should handle invalid price data gracefully', () => {
      const priceForecasts = [
        { time: 'invalid-date', price: 1.2 },
        { time: '2023-01-01T13:00:00Z', price: 'invalid' as any }
      ];
      const targetTemp = 22.0;
      const currentTemp = 20.0;
      const outdoorTemp = 5.0;
      const weatherForecast = {
        temperature: 5.0,
        humidity: 60,
        windSpeed: 10,
        description: 'clear'
      };
      const comfortProfile = {
        dayStart: 6,
        dayEnd: 22,
        nightTempReduction: 2,
        preHeatHours: 1
      };

      const recommendation = service.getHeatingRecommendation(
        priceForecasts, targetTemp, currentTemp, outdoorTemp, weatherForecast, comfortProfile
      );

      expect(recommendation).toBeDefined();
      expect(recommendation.confidence).toBeLessThan(0.5); // Low confidence with invalid data
    });

    test('should handle analyzer initialization errors', () => {
      const AnalyzerMock = require('../../src/services/thermal-model/thermal-analyzer').ThermalAnalyzer;
      AnalyzerMock.mockImplementation(() => {
        throw new Error('Analyzer init failed');
      });

      expect(() => new ThermalModelService(mockHomey as any)).toThrow('Analyzer init failed');
    });

    test('should handle data collector initialization errors', () => {
      const DataCollectorMock = require('../../src/services/thermal-model/data-collector').ThermalDataCollector;
      DataCollectorMock.mockImplementation(() => {
        throw new Error('Data collector init failed');
      });

      expect(() => new ThermalModelService(mockHomey as any)).toThrow('Data collector init failed');
    });
  });
});