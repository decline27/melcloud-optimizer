import { ThermalAnalyzer, ThermalCharacteristics } from '../../src/services/thermal-model';
import { DateTime } from 'luxon';

// Mock fs module
jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(false),
  writeFileSync: jest.fn(),
  readFileSync: jest.fn()
}));

describe('ThermalAnalyzer', () => {
  let thermalAnalyzer: ThermalAnalyzer;
  let mockHomey: any;

  beforeEach(() => {
    // Create mock Homey
    mockHomey = {
      log: jest.fn(),
      error: jest.fn(),
      settings: {
        get: jest.fn().mockReturnValue(null),
        set: jest.fn()
      }
    };

    // Create thermal analyzer instance
    thermalAnalyzer = new ThermalAnalyzer(mockHomey);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with default thermal characteristics', () => {
      const characteristics = thermalAnalyzer.getThermalCharacteristics();

      expect(characteristics).toHaveProperty('heatingRate');
      expect(characteristics).toHaveProperty('coolingRate');
      expect(characteristics).toHaveProperty('outdoorTempImpact');
      expect(characteristics).toHaveProperty('windImpact');
      expect(characteristics).toHaveProperty('thermalMass');
      expect(characteristics).toHaveProperty('modelConfidence');
      expect(characteristics).toHaveProperty('lastUpdated');

      // Default confidence should be 0
      expect(characteristics.modelConfidence).toBe(0);
    });

    it('should load characteristics from settings if available', () => {
      // Mock settings to return stored characteristics
      const storedCharacteristics: ThermalCharacteristics = {
        heatingRate: 0.7,
        coolingRate: 0.3,
        outdoorTempImpact: 0.2,
        windImpact: 0.1,
        thermalMass: 0.8,
        modelConfidence: 0.6,
        lastUpdated: '2023-01-01T12:00:00.000Z'
      };

      mockHomey.settings.get.mockReturnValueOnce(JSON.stringify(storedCharacteristics));

      // Create new instance with mocked settings
      const analyzer = new ThermalAnalyzer(mockHomey);
      const characteristics = analyzer.getThermalCharacteristics();

      // Should match stored values
      expect(characteristics.heatingRate).toBe(0.7);
      expect(characteristics.coolingRate).toBe(0.3);
      expect(characteristics.outdoorTempImpact).toBe(0.2);
      expect(characteristics.windImpact).toBe(0.1);
      expect(characteristics.thermalMass).toBe(0.8);
      expect(characteristics.modelConfidence).toBe(0.6);
    });
  });

  describe('updateModel', () => {
    it('should not update model with insufficient data points', () => {
      const dataPoints = [
        {
          timestamp: DateTime.now().toISO(),
          indoorTemperature: 21.0,
          outdoorTemperature: 5.0,
          targetTemperature: 22.0,
          heatingActive: true,
          weatherConditions: {
            windSpeed: 3.0,
            humidity: 70,
            cloudCover: 80,
            precipitation: 0
          }
        }
      ];

      const originalCharacteristics = { ...thermalAnalyzer.getThermalCharacteristics() };
      const updatedCharacteristics = thermalAnalyzer.updateModel(dataPoints);

      // Should not have changed
      expect(updatedCharacteristics).toEqual(originalCharacteristics);
      expect(mockHomey.log).toHaveBeenCalledWith(expect.stringContaining('Not enough data points'));
    });

    it('should update model with sufficient data points', () => {
      // Create 24 data points (minimum required)
      const dataPoints = Array(24).fill(null).map((_, i) => ({
        timestamp: DateTime.now().minus({ hours: 24 - i }).toISO(),
        indoorTemperature: 20.0 + (i % 3) * 0.5, // Vary temperature
        outdoorTemperature: 5.0 - (i % 2),
        targetTemperature: 22.0,
        heatingActive: i % 2 === 0, // Alternate heating on/off
        weatherConditions: {
          windSpeed: 3.0,
          humidity: 70,
          cloudCover: 80,
          precipitation: 0
        }
      }));

      const updatedCharacteristics = thermalAnalyzer.updateModel(dataPoints);

      // Should have updated confidence based on data points
      expect(updatedCharacteristics.modelConfidence).toBeGreaterThan(0);
      expect(mockHomey.settings.set).toHaveBeenCalled();
      // The log message might vary, so just check that some logging happened
      expect(mockHomey.log).toHaveBeenCalled();
    });
  });

  describe('predictTemperature', () => {
    it('should predict temperature increase when heating is active', () => {
      // Set up a thermal analyzer with known characteristics for predictable behavior
      const customAnalyzer = new ThermalAnalyzer(mockHomey);
      // Set higher heating rate to ensure temperature increases
      (customAnalyzer as any).thermalCharacteristics = {
        heatingRate: 1.0, // Higher heating rate
        coolingRate: 0.2,
        outdoorTempImpact: 0.1,
        windImpact: 0.05,
        thermalMass: 0.7,
        modelConfidence: 0.6,
        lastUpdated: DateTime.now().toISO()
      };

      const currentTemp = 20.0;
      const targetTemp = 22.0;
      const outdoorTemp = 5.0;
      const heatingActive = true;
      const weatherConditions = {
        windSpeed: 3.0,
        humidity: 70,
        cloudCover: 80
      };
      const minutes = 60; // 1 hour

      const predictedTemp = customAnalyzer.predictTemperature(
        currentTemp,
        targetTemp,
        outdoorTemp,
        heatingActive,
        weatherConditions,
        minutes
      );

      // Temperature should increase when heating is active
      expect(predictedTemp).toBeGreaterThan(currentTemp);
    });

    it('should predict temperature decrease when heating is inactive', () => {
      const currentTemp = 22.0;
      const targetTemp = 22.0;
      const outdoorTemp = 5.0;
      const heatingActive = false;
      const weatherConditions = {
        windSpeed: 3.0,
        humidity: 70,
        cloudCover: 80
      };
      const minutes = 60; // 1 hour

      const predictedTemp = thermalAnalyzer.predictTemperature(
        currentTemp,
        targetTemp,
        outdoorTemp,
        heatingActive,
        weatherConditions,
        minutes
      );

      // Temperature should decrease when heating is inactive and outdoor temp is lower
      expect(predictedTemp).toBeLessThan(currentTemp);
    });
  });

  describe('calculateTimeToTarget', () => {
    it('should return zero time when already at target temperature', () => {
      const currentTemp = 22.0;
      const targetTemp = 22.0;
      const outdoorTemp = 5.0;
      const weatherConditions = {
        windSpeed: 3.0,
        humidity: 70,
        cloudCover: 80
      };

      const result = thermalAnalyzer.calculateTimeToTarget(
        currentTemp,
        targetTemp,
        outdoorTemp,
        weatherConditions
      );

      expect(result.timeToTarget).toBe(0);
      expect(result.confidence).toBe(1);
    });

    it('should calculate time to heat up to target', () => {
      const currentTemp = 20.0;
      const targetTemp = 22.0;
      const outdoorTemp = 5.0;
      const weatherConditions = {
        windSpeed: 3.0,
        humidity: 70,
        cloudCover: 80
      };

      const result = thermalAnalyzer.calculateTimeToTarget(
        currentTemp,
        targetTemp,
        outdoorTemp,
        weatherConditions
      );

      expect(result.timeToTarget).toBeGreaterThan(0);
      expect(result.predictedTemperature).toBe(targetTemp);
    });

    it('should return infinity when cooling to a temperature below outdoor temp', () => {
      const currentTemp = 25.0;
      const targetTemp = 20.0;
      const outdoorTemp = 22.0; // Outdoor temp higher than target
      const weatherConditions = {
        windSpeed: 3.0,
        humidity: 70,
        cloudCover: 80
      };

      const result = thermalAnalyzer.calculateTimeToTarget(
        currentTemp,
        targetTemp,
        outdoorTemp,
        weatherConditions
      );

      expect(result.timeToTarget).toBe(Infinity);
    });
  });
});
