import { ThermalModelService, ThermalDataCollector, ThermalAnalyzer } from '../../src/services/thermal-model';
import { DateTime } from 'luxon';
import { createMockLogger } from '../mocks';

// Mock dependencies
jest.mock('../../src/services/thermal-model/data-collector');
jest.mock('../../src/services/thermal-model/thermal-analyzer');

describe('ThermalModelService', () => {
  let thermalModelService: ThermalModelService;
  let mockHomey: any;
  let mockDataCollector: jest.Mocked<ThermalDataCollector>;
  let mockAnalyzer: jest.Mocked<ThermalAnalyzer>;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create mock Homey
    mockHomey = {
      log: jest.fn(),
      error: jest.fn(),
      settings: {
        get: jest.fn().mockReturnValue(null),
        set: jest.fn()
      },
      melcloudApi: {
        getDeviceState: jest.fn().mockResolvedValue({
          DeviceID: '123',
          BuildingID: 456,
          RoomTemperatureZone1: 21.5,
          SetTemperatureZone1: 21.0,
          OutdoorTemperature: 5.0,
          IdleZone1: false
        })
      },
      weatherApi: {
        getCurrentWeather: jest.fn().mockResolvedValue({
          temperature: 5.0,
          windSpeed: 3.0,
          humidity: 70,
          cloudCover: 80,
          precipitation: 0
        })
      }
    };

    // Create mock data collector
    mockDataCollector = new ThermalDataCollector(mockHomey) as jest.Mocked<ThermalDataCollector>;
    mockDataCollector.addDataPoint = jest.fn();
    mockDataCollector.getAllDataPoints = jest.fn().mockReturnValue([]);
    mockDataCollector.getRecentDataPoints = jest.fn().mockReturnValue([]);

    // Create mock analyzer
    mockAnalyzer = new ThermalAnalyzer(mockHomey) as jest.Mocked<ThermalAnalyzer>;
    mockAnalyzer.updateModel = jest.fn().mockReturnValue({
      heatingRate: 0.5,
      coolingRate: 0.2,
      outdoorTempImpact: 0.1,
      windImpact: 0.05,
      thermalMass: 0.7,
      modelConfidence: 0.6,
      lastUpdated: DateTime.now().toISO()
    });
    mockAnalyzer.getThermalCharacteristics = jest.fn().mockReturnValue({
      heatingRate: 0.5,
      coolingRate: 0.2,
      outdoorTempImpact: 0.1,
      windImpact: 0.05,
      thermalMass: 0.7,
      modelConfidence: 0.6,
      lastUpdated: DateTime.now().toISO()
    });
    mockAnalyzer.predictTemperature = jest.fn().mockReturnValue(22.0);
    mockAnalyzer.calculateTimeToTarget = jest.fn().mockReturnValue({
      predictedTemperature: 22.0,
      timeToTarget: 60,
      confidence: 0.6
    });

    // Create thermal model service instance
    thermalModelService = new ThermalModelService(mockHomey);

    // Set private properties for testing
    (thermalModelService as any).dataCollector = mockDataCollector;
    (thermalModelService as any).analyzer = mockAnalyzer;
  });

  describe('constructor', () => {
    it('should initialize with data collector and analyzer', () => {
      expect((thermalModelService as any).dataCollector).toBeDefined();
      expect((thermalModelService as any).analyzer).toBeDefined();
    });
  });

  describe('collectDataPoint', () => {
    it('should add data point to collector', () => {
      const dataPoint = {
        timestamp: DateTime.now().toISO(),
        indoorTemperature: 21.5,
        outdoorTemperature: 5.0,
        targetTemperature: 22.0,
        heatingActive: true,
        weatherConditions: {
          windSpeed: 3.0,
          humidity: 70,
          cloudCover: 80,
          precipitation: 0
        }
      };

      thermalModelService.collectDataPoint(dataPoint);

      expect(mockDataCollector.addDataPoint).toHaveBeenCalledWith(dataPoint);
      expect(mockHomey.log).toHaveBeenCalledWith(expect.stringContaining('Thermal data point collected'));
    });

    it('should handle errors when collecting data point', () => {
      const dataPoint = {
        timestamp: DateTime.now().toISO(),
        indoorTemperature: 21.5,
        outdoorTemperature: 5.0,
        targetTemperature: 22.0,
        heatingActive: true,
        weatherConditions: {
          windSpeed: 3.0,
          humidity: 70,
          cloudCover: 80,
          precipitation: 0
        }
      };

      // Make addDataPoint throw an error
      mockDataCollector.addDataPoint.mockImplementationOnce(() => {
        throw new Error('Test error');
      });

      // The method throws an error, so we need to catch it
      expect(() => {
        thermalModelService.collectDataPoint(dataPoint);
      }).toThrow('Test error');

      expect(mockHomey.error).toHaveBeenCalledWith(
        'Error collecting thermal data point:',
        expect.any(Error)
      );
    });
  });

  describe('getHeatingRecommendation', () => {
    it('should return recommendation based on thermal model', () => {
      const priceForecasts = [
        { price: 0.15, time: DateTime.now().toISO() },
        { price: 0.10, time: DateTime.now().plus({ hours: 1 }).toISO() },
        { price: 0.20, time: DateTime.now().plus({ hours: 2 }).toISO() }
      ];
      const targetTemp = 22.0;
      const currentTemp = 21.0;
      const outdoorTemp = 5.0;
      const weatherForecast = {
        temperature: 5.0,
        windSpeed: 3.0,
        humidity: 70,
        cloudCover: 80,
        precipitation: 0
      };
      const comfortProfile = {
        dayStart: 7,
        dayEnd: 23,
        nightTempReduction: 2,
        preHeatHours: 2
      };

      const recommendation = thermalModelService.getHeatingRecommendation(
        priceForecasts,
        targetTemp,
        currentTemp,
        outdoorTemp,
        weatherForecast,
        comfortProfile
      );

      expect(recommendation).toHaveProperty('recommendedTemperature');
      expect(recommendation).toHaveProperty('recommendedStartTime');
      expect(recommendation).toHaveProperty('estimatedSavings');
      expect(recommendation).toHaveProperty('confidence');
      expect(recommendation).toHaveProperty('explanation');
    });

    it('should return default recommendation when model confidence is low', () => {
      // Set low model confidence
      mockAnalyzer.getThermalCharacteristics.mockReturnValueOnce({
        heatingRate: 0.5,
        coolingRate: 0.2,
        outdoorTempImpact: 0.1,
        windImpact: 0.05,
        thermalMass: 0.7,
        modelConfidence: 0.1, // Low confidence
        lastUpdated: DateTime.now().toISO()
      });

      const priceForecasts = [
        { price: 0.15, time: DateTime.now().toISO() }
      ];
      const targetTemp = 22.0;
      const currentTemp = 21.0;
      const outdoorTemp = 5.0;
      const weatherForecast = {
        temperature: 5.0,
        windSpeed: 3.0,
        humidity: 70,
        cloudCover: 80,
        precipitation: 0
      };
      const comfortProfile = {
        dayStart: 7,
        dayEnd: 23,
        nightTempReduction: 2,
        preHeatHours: 2
      };

      const recommendation = thermalModelService.getHeatingRecommendation(
        priceForecasts,
        targetTemp,
        currentTemp,
        outdoorTemp,
        weatherForecast,
        comfortProfile
      );

      expect(recommendation.recommendedTemperature).toBe(targetTemp);
      expect(recommendation.explanation).toContain('limited data');
    });

    it('should handle errors and return default recommendation', () => {
      // Make getThermalCharacteristics throw an error
      mockAnalyzer.getThermalCharacteristics.mockImplementationOnce(() => {
        throw new Error('Test error');
      });

      const priceForecasts = [
        { price: 0.15, time: DateTime.now().toISO() }
      ];
      const targetTemp = 22.0;
      const currentTemp = 21.0;
      const outdoorTemp = 5.0;
      const weatherForecast = {
        temperature: 5.0,
        windSpeed: 3.0,
        humidity: 70,
        cloudCover: 80,
        precipitation: 0
      };
      const comfortProfile = {
        dayStart: 7,
        dayEnd: 23,
        nightTempReduction: 2,
        preHeatHours: 2
      };

      const recommendation = thermalModelService.getHeatingRecommendation(
        priceForecasts,
        targetTemp,
        currentTemp,
        outdoorTemp,
        weatherForecast,
        comfortProfile
      );

      expect(mockHomey.error).toHaveBeenCalledWith(
        'Error generating heating recommendation:',
        expect.any(Error)
      );
      expect(recommendation.recommendedTemperature).toBe(targetTemp);
      expect(recommendation.explanation).toContain('Error generating recommendation');
    });
  });

  describe('getTimeToTarget', () => {
    it('should return time to target from analyzer', () => {
      const currentTemp = 20.0;
      const targetTemp = 22.0;
      const outdoorTemp = 5.0;
      const weatherConditions = {
        windSpeed: 3.0,
        humidity: 70,
        cloudCover: 80,
        precipitation: 0 // Add required precipitation property
      };

      const result = thermalModelService.getTimeToTarget(
        currentTemp,
        targetTemp,
        outdoorTemp,
        weatherConditions
      );

      expect(mockAnalyzer.calculateTimeToTarget).toHaveBeenCalledWith(
        currentTemp,
        targetTemp,
        outdoorTemp,
        weatherConditions
      );
      expect(result).toEqual({
        predictedTemperature: 22.0,
        timeToTarget: 60,
        confidence: 0.6
      });
    });
  });

  describe('getThermalCharacteristics', () => {
    it('should return thermal characteristics from analyzer', () => {
      const characteristics = thermalModelService.getThermalCharacteristics();

      expect(mockAnalyzer.getThermalCharacteristics).toHaveBeenCalled();
      expect(characteristics).toEqual({
        heatingRate: 0.5,
        coolingRate: 0.2,
        outdoorTempImpact: 0.1,
        windImpact: 0.05,
        thermalMass: 0.7,
        modelConfidence: 0.6,
        lastUpdated: expect.any(String)
      });
    });

    it('should handle errors when getting thermal characteristics', () => {
      // Make getThermalCharacteristics throw an error
      mockAnalyzer.getThermalCharacteristics.mockImplementationOnce(() => {
        throw new Error('Test error');
      });

      // Mock the homey.error method to capture the error
      mockHomey.error.mockImplementationOnce((message: string, error: Error) => {
        // Verify the error message and error object
        expect(message).toBe('Error getting thermal characteristics:');
        expect(error.message).toBe('Test error');
      });

      const characteristics = thermalModelService.getThermalCharacteristics();

      // Verify the error was logged
      expect(mockHomey.error).toHaveBeenCalled();

      // Verify the default characteristics were returned
      expect(characteristics).toEqual({
        heatingRate: 0,
        coolingRate: 0,
        outdoorTempImpact: 0,
        windImpact: 0,
        thermalMass: 0,
        modelConfidence: 0,
        lastUpdated: expect.any(String)
      });
    });
  });

  describe('updateThermalModel', () => {
    it('should update the thermal model with new data points', () => {
      // Mock data points - at least 24 data points required
      const dataPoints = [];
      for (let i = 0; i < 24; i++) {
        dataPoints.push({
          timestamp: DateTime.now().minus({ hours: i }).toISO(),
          indoorTemperature: 20.0 + (i % 5) * 0.5,
          outdoorTemperature: 5.0 - (i % 3) * 0.5,
          targetTemperature: 22.0,
          heatingActive: i % 2 === 0,
          weatherConditions: {
            windSpeed: 3.0 + (i % 4) * 0.5,
            humidity: 70 + (i % 3) * 5,
            cloudCover: 80 - (i % 2) * 10,
            precipitation: 0
          }
        });
      }

      // Mock the combined data for analysis
      mockDataCollector.getCombinedDataForAnalysis = jest.fn().mockReturnValue({
        detailed: dataPoints,
        aggregated: [
          {
            timestamp: DateTime.now().minus({ days: 7 }).toISO(),
            indoorTemperature: 21.0,
            outdoorTemperature: 5.0,
            targetTemperature: 22.0,
            heatingActive: true,
            weatherConditions: {
              windSpeed: 3.0,
              humidity: 70,
              cloudCover: 80,
              precipitation: 0
            },
            count: 24 // This represents 24 aggregated data points
          }
        ],
        totalDataPoints: dataPoints.length + 24
      });

      mockDataCollector.getAllDataPoints.mockReturnValueOnce(dataPoints);

      // Mock the memory usage
      mockDataCollector.getMemoryUsage = jest.fn().mockReturnValue({
        dataPointCount: dataPoints.length,
        aggregatedDataCount: 1,
        estimatedMemoryUsageKB: 100,
        dataPointsPerDay: 24
      });

      // Mock the updateModel method to return thermal characteristics
      mockAnalyzer.updateModel.mockReturnValueOnce({
        heatingRate: 0.5,
        coolingRate: 0.2,
        outdoorTempImpact: 0.1,
        windImpact: 0.05,
        thermalMass: 0.7,
        modelConfidence: 0.6,
        lastUpdated: DateTime.now().toISO()
      });

      // Create a spy on the private method
      const updateThermalModelSpy = jest.spyOn(
        thermalModelService as any,
        'updateThermalModel'
      );

      // Call the method directly using the spy
      const result = (thermalModelService as any).updateThermalModel();

      // Verify the spy was called
      expect(updateThermalModelSpy).toHaveBeenCalled();

      // Verify the analyzer was called with the data points
      expect(mockAnalyzer.updateModel).toHaveBeenCalled();
      expect(result).toEqual({
        heatingRate: 0.5,
        coolingRate: 0.2,
        outdoorTempImpact: 0.1,
        windImpact: 0.05,
        thermalMass: 0.7,
        modelConfidence: 0.6,
        lastUpdated: expect.any(String)
      });

      // Clean up the spy
      updateThermalModelSpy.mockRestore();
    });

    it('should handle insufficient data points', () => {
      // Mock empty data points
      mockDataCollector.getAllDataPoints.mockReturnValueOnce([]);

      // Mock the combined data for analysis
      mockDataCollector.getCombinedDataForAnalysis = jest.fn().mockReturnValue({
        detailed: [],
        aggregated: [],
        totalDataPoints: 0
      });

      // Mock the log method to capture the message
      mockHomey.log.mockImplementationOnce((message: string) => {
        expect(message).toContain('Not enough data');
      });

      // Create a spy on the private method
      const updateThermalModelSpy = jest.spyOn(
        thermalModelService as any,
        'updateThermalModel'
      );

      // Call the method directly using the spy
      const result = (thermalModelService as any).updateThermalModel();

      // Verify the spy was called
      expect(updateThermalModelSpy).toHaveBeenCalled();

      // Verify the analyzer was not called
      expect(mockAnalyzer.updateModel).not.toHaveBeenCalled();

      // Verify the log message was called
      expect(mockHomey.log).toHaveBeenCalled();

      // Create a default characteristics object to compare with
      const defaultCharacteristics = {
        heatingRate: 0,
        coolingRate: 0,
        outdoorTempImpact: 0,
        windImpact: 0,
        thermalMass: 0,
        modelConfidence: 0,
        lastUpdated: expect.any(String)
      };

      // Check that the result has all the expected properties
      expect(result).toMatchObject(defaultCharacteristics);

      // Clean up the spy
      updateThermalModelSpy.mockRestore();
    });

    it('should handle errors during model update', () => {
      // Mock data points - at least 24 data points required
      const dataPoints = [];
      for (let i = 0; i < 24; i++) {
        dataPoints.push({
          timestamp: DateTime.now().minus({ hours: i }).toISO(),
          indoorTemperature: 20.0 + (i % 5) * 0.5,
          outdoorTemperature: 5.0 - (i % 3) * 0.5,
          targetTemperature: 22.0,
          heatingActive: i % 2 === 0,
          weatherConditions: {
            windSpeed: 3.0 + (i % 4) * 0.5,
            humidity: 70 + (i % 3) * 5,
            cloudCover: 80 - (i % 2) * 10,
            precipitation: 0
          }
        });
      }

      // Mock the combined data for analysis
      mockDataCollector.getCombinedDataForAnalysis = jest.fn().mockReturnValue({
        detailed: dataPoints,
        aggregated: [
          {
            timestamp: DateTime.now().minus({ days: 7 }).toISO(),
            indoorTemperature: 21.0,
            outdoorTemperature: 5.0,
            targetTemperature: 22.0,
            heatingActive: true,
            weatherConditions: {
              windSpeed: 3.0,
              humidity: 70,
              cloudCover: 80,
              precipitation: 0
            },
            count: 24 // This represents 24 aggregated data points
          }
        ],
        totalDataPoints: dataPoints.length + 24
      });

      mockDataCollector.getAllDataPoints.mockReturnValueOnce(dataPoints);

      // Mock the memory usage
      mockDataCollector.getMemoryUsage = jest.fn().mockReturnValue({
        dataPointCount: dataPoints.length,
        aggregatedDataCount: 1,
        estimatedMemoryUsageKB: 100,
        dataPointsPerDay: 24
      });

      // Make updateModel throw an error
      mockAnalyzer.updateModel.mockImplementationOnce(() => {
        throw new Error('Test error');
      });

      // Create a spy on the private method
      const updateThermalModelSpy = jest.spyOn(
        thermalModelService as any,
        'updateThermalModel'
      );

      // Call the method directly using the spy
      const result = (thermalModelService as any).updateThermalModel();

      // Verify error handling
      expect(mockHomey.error).toHaveBeenCalledWith(
        'Error updating thermal model:',
        expect.objectContaining({
          message: 'Test error'
        })
      );

      // Create a default characteristics object to compare with
      const defaultCharacteristics = {
        heatingRate: 0,
        coolingRate: 0,
        outdoorTempImpact: 0,
        windImpact: 0,
        thermalMass: 0,
        modelConfidence: 0,
        lastUpdated: expect.any(String)
      };

      // Check that the result has all the expected properties
      expect(result).toMatchObject(defaultCharacteristics);

      // Clean up the spy
      updateThermalModelSpy.mockRestore();
    });
  });

  describe('stop', () => {
    it('should stop all intervals', () => {
      // Add mock intervals
      Object.defineProperty(thermalModelService, 'dataCollectionInterval', {
        value: setInterval(() => {}, 1000),
        writable: true
      });
      Object.defineProperty(thermalModelService, 'modelUpdateInterval', {
        value: setInterval(() => {}, 1000),
        writable: true
      });
      Object.defineProperty(thermalModelService, 'dataCleanupInterval', {
        value: setInterval(() => {}, 1000),
        writable: true
      });

      // Call the stop method
      thermalModelService.stop();

      // Verify logs were called
      expect(mockHomey.log).toHaveBeenCalledWith('Thermal model data collection interval stopped');
      expect(mockHomey.log).toHaveBeenCalledWith('Thermal model update interval stopped');
      expect(mockHomey.log).toHaveBeenCalledWith('Thermal model data cleanup interval stopped');
      expect(mockHomey.log).toHaveBeenCalledWith('Thermal model service stopped and resources cleaned up');
    });

    it('should handle errors during stop', () => {
      // Mock clearInterval to throw an error
      const originalClearInterval = global.clearInterval;
      global.clearInterval = jest.fn().mockImplementation(() => {
        throw new Error('Test error');
      });

      // Call the stop method
      thermalModelService.stop();

      // Verify error handling
      expect(mockHomey.error).toHaveBeenCalledWith(
        'Error stopping thermal model service:',
        expect.any(Error)
      );

      // Restore original clearInterval
      global.clearInterval = originalClearInterval;
    });
  });
});
