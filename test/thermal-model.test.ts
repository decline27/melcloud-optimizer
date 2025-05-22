/**
 * Thermal Model Tests
 *
 * This file contains tests for the thermal model functionality.
 */

import { ThermalAnalyzer, ThermalDataCollector, ThermalModelService } from '../src/services/thermal-model';
import { DateTime } from 'luxon';

// Mock Homey with required HomeyApp interface properties
const mockHomey = {
  id: 'com.melcloud.optimize',
  manifest: {
    version: '1.0.0'
  },
  version: '1.0.0',
  platform: 'local',
  log: jest.fn(),
  error: jest.fn(),
  env: {
    userDataPath: './test-data'
  },
  settings: {
    get: jest.fn().mockReturnValue(null),
    set: jest.fn(),
    unset: jest.fn().mockResolvedValue(undefined),
    on: jest.fn()
  }
};

// Mock fs module
jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(false),
  writeFileSync: jest.fn(),
  readFileSync: jest.fn()
}));

describe('Thermal Model', () => {
  describe('ThermalDataCollector', () => {
    let dataCollector: any;

    beforeEach(() => {
      jest.clearAllMocks();
      dataCollector = new ThermalDataCollector(mockHomey);
    });

    test('should initialize correctly', () => {
      expect(dataCollector).toBeDefined();
      expect(mockHomey.log).toHaveBeenCalledWith('No stored thermal data found, starting fresh collection');
    });

    test('should add and retrieve data points', () => {
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

      dataCollector.addDataPoint(dataPoint);
      expect(mockHomey.log).toHaveBeenCalledWith('Added new thermal data point. Total points: 1');

      const allPoints = dataCollector.getAllDataPoints();
      expect(allPoints).toHaveLength(1);
      expect(allPoints[0]).toEqual(dataPoint);
    });
  });

  describe('ThermalAnalyzer', () => {
    let analyzer: any;

    beforeEach(() => {
      jest.clearAllMocks();
      analyzer = new ThermalAnalyzer(mockHomey);
    });

    test('should initialize with default characteristics', () => {
      const characteristics = analyzer.getThermalCharacteristics();
      expect(characteristics).toBeDefined();
      expect(characteristics.heatingRate).toBe(0.5);
      expect(characteristics.coolingRate).toBe(0.2);
      expect(characteristics.modelConfidence).toBe(0);
    });

    test('should predict temperature changes', () => {
      const prediction = analyzer.predictTemperature(
        20, // current temp
        22, // target temp
        5,  // outdoor temp
        true, // heating active
        { windSpeed: 2, humidity: 70, cloudCover: 50 },
        60 // 60 minutes
      );

      // With default characteristics, we expect some temperature change
      expect(prediction).toBeDefined();
    });

    test('should calculate time to target', () => {
      const prediction = analyzer.calculateTimeToTarget(
        20, // current temp
        22, // target temp
        5,  // outdoor temp
        { windSpeed: 2, humidity: 70, cloudCover: 50 }
      );

      expect(prediction).toBeDefined();
      expect(prediction.timeToTarget).toBeGreaterThan(0);
      expect(prediction.confidence).toBe(0); // Default confidence is 0
    });
  });

  describe('ThermalModelService', () => {
    let service: any;

    beforeEach(() => {
      jest.clearAllMocks();

      // Add required properties to mockHomey
      Object.assign(mockHomey, {
        // Mock MELCloud API
        melcloudApi: {
          getDeviceState: jest.fn().mockResolvedValue({
            RoomTemperatureZone1: 21.5,
            SetTemperatureZone1: 22.0,
            OutdoorTemperature: 5.0,
            IdleZone1: false
          })
        },

        // Mock Weather API
        weatherApi: {
          getCurrentWeather: jest.fn().mockResolvedValue({
            temperature: 5.0,
            windSpeed: 3.0,
            humidity: 70,
            cloudCover: 80,
            precipitation: 0
          })
        }
      });

      // Create service with mocked Homey
      service = new ThermalModelService(mockHomey);

      // Mock the intervals to prevent memory leaks in tests
      jest.spyOn(global, 'setInterval').mockReturnValue(123 as any);
      jest.spyOn(global, 'setTimeout').mockReturnValue(456 as any);
    });

    test('should initialize correctly', () => {
      expect(service).toBeDefined();
      // The data collector logs this message during initialization
      expect(mockHomey.log).toHaveBeenCalledWith('No stored thermal data found, starting fresh collection');
      // The analyzer logs this message during initialization
      expect(mockHomey.log).toHaveBeenCalledWith('No saved thermal characteristics found, using defaults');
      // The service logs this message during initialization
      expect(mockHomey.log).toHaveBeenCalledWith('Thermal model updates and data cleanup scheduled (cleanup every 12 hours)');
    });

    test('should provide heating recommendations', async () => {
      const priceForecasts = [
        { time: DateTime.now().toISO(), price: 0.5 },
        { time: DateTime.now().plus({ hours: 1 }).toISO(), price: 0.8 },
        { time: DateTime.now().plus({ hours: 2 }).toISO(), price: 1.2 }
      ];

      const recommendation = service.getHeatingRecommendation(
        priceForecasts,
        22.0, // target temp
        21.5, // current temp
        5.0,  // outdoor temp
        { temperature: 5.0, windSpeed: 3.0, humidity: 70, cloudCover: 80 },
        { dayStart: 7, dayEnd: 23, nightTempReduction: 2, preHeatHours: 2 }
      );

      expect(recommendation).toBeDefined();
      expect(recommendation.recommendedTemperature).toBeDefined();
      expect(recommendation.explanation).toBeDefined();
    });

    test('should calculate optimal preheating time', () => {
      const targetTime = DateTime.now().plus({ hours: 3 }).toISO();

      const optimalTime = service.getOptimalPreheatingTime(
        22.0, // target temp
        targetTime,
        20.0, // current temp
        5.0,  // outdoor temp
        { temperature: 5.0, windSpeed: 3.0, humidity: 70, cloudCover: 80 }
      );

      expect(optimalTime).toBeDefined();

      // The optimal time should be before the target time
      expect(DateTime.fromISO(optimalTime) < DateTime.fromISO(targetTime)).toBe(true);
    });

    // Clean up after tests
    afterEach(() => {
      // Stop the service to clean up intervals
      if (service && typeof service.stop === 'function') {
        service.stop();
      }

      // Restore mocked functions
      jest.restoreAllMocks();
    });
  });
});
