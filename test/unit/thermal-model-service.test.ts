import { ThermalModelService, ThermalDataCollector, ThermalAnalyzer } from '../../src/services/thermal-model';
import { DateTime } from 'luxon';

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

      thermalModelService.collectDataPoint(dataPoint);

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
      const weatherForecast = {};
      const comfortProfile = {};

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
      const weatherForecast = {};
      const comfortProfile = {};

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
      const weatherForecast = {};
      const comfortProfile = {};

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
        cloudCover: 80
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
  });
});
