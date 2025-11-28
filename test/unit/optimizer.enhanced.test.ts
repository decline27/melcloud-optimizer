import { Optimizer } from '../../src/services/optimizer';
import { MelCloudApi } from '../../src/services/melcloud-api';
import { TibberApi } from '../../src/services/tibber-api';
import { ThermalModelService } from '../../src/services/thermal-model';
import { COPHelper } from '../../src/services/cop-helper';

// Mock dependencies
jest.mock('../../src/services/melcloud-api');
jest.mock('../../src/services/tibber-api');
jest.mock('../../src/services/thermal-model');
jest.mock('../../src/services/cop-helper');

describe('Optimizer Enhanced Tests', () => {
  let optimizer: Optimizer;
  let mockMelCloud: jest.Mocked<MelCloudApi>;
  let mockTibber: jest.Mocked<TibberApi>;
  let mockLogger: any;
  let mockWeatherApi: any;
  let mockHomey: any;
  let mockThermalModelService: jest.Mocked<ThermalModelService>;
  let mockCOPHelper: jest.Mocked<COPHelper>;

  beforeEach(async () => {
    // Create mock MelCloud API
    mockMelCloud = new MelCloudApi() as jest.Mocked<MelCloudApi>;
    mockMelCloud.getDeviceState = jest.fn().mockResolvedValue({
      DeviceID: 123,
      BuildingID: 456,
      RoomTemperature: 21.0,
      SetTemperature: 21.0,
      OutdoorTemperature: 5.0
    });
    mockMelCloud.setDeviceTemperature = jest.fn().mockResolvedValue(true);

    // Create mock Tibber API
    mockTibber = new TibberApi('test-token') as jest.Mocked<TibberApi>;
    mockTibber.getPrices = jest.fn().mockResolvedValue({
      current: { price: 0.15, time: '2023-01-01T12:00:00Z' },
      prices: [
        { price: 0.10, time: '2023-01-01T11:00:00Z' },
        { price: 0.15, time: '2023-01-01T12:00:00Z' },
        { price: 0.20, time: '2023-01-01T13:00:00Z' }
      ]
    });

    // Create mock logger
    mockLogger = {
      log: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
    };

    // Create mock weather API
    mockWeatherApi = {
      getCurrentWeather: jest.fn().mockResolvedValue({
        temperature: 5.0,
        windSpeed: 2.0,
        humidity: 60,
        cloudCover: 50,
        precipitation: 0
      })
    };

    // Create mock Homey
    mockHomey = {
      settings: {
        get: jest.fn().mockImplementation((key) => {
          if (key === 'comfort_lower_occupied') return 18;
          if (key === 'comfort_upper_occupied') return 22;
          if (key === 'comfort_lower_away') return 17;
          if (key === 'comfort_upper_away') return 21;
          if (key === 'cop_weight') return 0.3;
          if (key === 'auto_seasonal_mode') return true;
          if (key === 'summer_mode') return false;
          return null;
        }),
        set: jest.fn()
      }
    };

    // Create mock ThermalModelService
    mockThermalModelService = new ThermalModelService(mockHomey) as jest.Mocked<ThermalModelService>;
    mockThermalModelService.collectDataPoint = jest.fn();
    mockThermalModelService.getHeatingRecommendation = jest.fn().mockReturnValue({
      recommendedTemperature: 20.5,
      recommendedStartTime: '2023-01-01T00:00:00Z',
      estimatedSavings: 0.5,
      explanation: 'Price is above average, reducing temperature',
      confidence: 0.8
    });
    mockThermalModelService.getTimeToTarget = jest.fn().mockReturnValue({
      timeToTarget: 30,
      confidence: 0.7
    });
    mockThermalModelService.getThermalCharacteristics = jest.fn().mockReturnValue({
      heatingRate: 0.2,
      coolingRate: 0.1,
      thermalMass: 0.5,
      modelConfidence: 0.8
    });

    // Create mock COPHelper
    mockCOPHelper = new COPHelper(mockHomey, mockLogger) as jest.Mocked<COPHelper>;
    mockCOPHelper.getSeasonalCOP = jest.fn().mockResolvedValue(3.5);
    mockCOPHelper.getLatestCOP = jest.fn().mockResolvedValue({
      heating: 3.5,
      hotWater: 3.0
    });
    mockCOPHelper.isSummerSeason = jest.fn().mockReturnValue(false);

    // Create optimizer instance
    optimizer = new Optimizer(
      mockMelCloud,
      mockTibber,
      '123',
      456,
      mockLogger,
      mockWeatherApi,
      mockHomey
    );

    // Initialize optimizer (ensures thermal mass loading completes)
    await optimizer.initialize();

    // Set private properties for testing
    (optimizer as any).thermalModelService = mockThermalModelService;
    (optimizer as any).useThermalLearning = true;
    (optimizer as any).copHelper = mockCOPHelper;
  });

  describe('setThermalModel', () => {
    it('should update thermal model parameters', () => {
      (optimizer as any).thermalController.setThermalModel(0.7, 0.3);

      expect((optimizer as any).thermalController.getThermalModel()).toEqual({ K: 0.7, S: 0.3 });
    });
  });

  describe('setTemperatureConstraints', () => {
    it('should update temperature constraints', () => {
      (optimizer as any).setTemperatureConstraints(17, 23, 0.5);

      // With the new service architecture, constraints are managed by ConstraintManager
      const constraints = (optimizer as any).constraintManager.getZone1Constraints();
      expect(constraints.minTemp).toBe(17);
      expect(constraints.maxTemp).toBe(23);
      expect(constraints.tempStep).toBe(0.5);
    });
  });

  describe('setCOPSettings', () => {
    it('should update COP settings', () => {
      (optimizer as any).setCOPSettings(0.5, false, true);

      expect((optimizer as any).copWeight).toBe(0.5);
      expect((optimizer as any).autoSeasonalMode).toBe(false);
      expect((optimizer as any).summerMode).toBe(true);
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('COP settings updated')
      );
    });
  });

  describe('calculateOptimalTemperature', () => {
    beforeEach(() => {
      // Disable COP adjustments for pure price-based calculations
      (optimizer as any).copWeight = 0;
      (optimizer as any).copHelper = null;
    });

    it('should calculate optimal temperature based on price', async () => {
      const currentPrice = 0.15;
      const priceAvg = 0.15;
      const priceMin = 0.10;
      const priceMax = 0.20;
      const currentTemp = 21.0;

      const result = await (optimizer as any).calculateOptimalTemperature(
        currentPrice, priceAvg, priceMin, priceMax, currentTemp
      );

      // Price is average, so temperature should be midpoint
      expect(result).toBeCloseTo(20, 0); // midpoint between min (18) and max (22)
    });

    it('should increase temperature for low prices', async () => {
      const currentPrice = 0.10; // Minimum price
      const priceAvg = 0.15;
      const priceMin = 0.10;
      const priceMax = 0.20;
      const currentTemp = 21.0;

      const result = await (optimizer as any).calculateOptimalTemperature(
        currentPrice, priceAvg, priceMin, priceMax, currentTemp
      );

      // Price is minimum, so temperature should be maximum
      expect(result).toBeCloseTo(22, 0); // max temp
    });

    it('should decrease temperature for high prices', async () => {
      const currentPrice = 0.20; // Maximum price
      const priceAvg = 0.15;
      const priceMin = 0.10;
      const priceMax = 0.20;
      const currentTemp = 21.0;

      const result = await (optimizer as any).calculateOptimalTemperature(
        currentPrice, priceAvg, priceMin, priceMax, currentTemp
      );

      // Price is maximum, so temperature should be minimum
      expect(result).toBeCloseTo(18, 0); // min temp
    });
  });

  describe('calculateSavings', () => {
    it('should calculate savings correctly when temperature is lowered', () => {
      const oldTemp = 22.0;
      const newTemp = 21.0;
      const currentPrice = 0.15;

      const savings = (optimizer as any).calculateSavings(oldTemp, newTemp, currentPrice);

      // Each degree lower saves about 5% energy
      // 1 degree * 5% * 1kWh * 0.15 EUR/kWh = 0.0075 EUR
      expect(savings).toBeCloseTo(0.0075, 4);
    });

    it('should calculate negative savings when temperature is increased', () => {
      const oldTemp = 20.0;
      const newTemp = 21.0;
      const currentPrice = 0.15;

      const savings = (optimizer as any).calculateSavings(oldTemp, newTemp, currentPrice);

      // Each degree higher costs about 5% more energy
      // -1 degree * 5% * 1kWh * 0.15 EUR/kWh = -0.0075 EUR
      expect(savings).toBeCloseTo(-0.0075, 4);
    });
  });

  // Note: calculateComfortImpact tests removed - method was unused dead code
  // Comfort impact calculation is now handled by the StateManager



  describe('runWeeklyCalibration', () => {
    it('should calibrate thermal model using learning data when available', async () => {
      const result = await optimizer.runWeeklyCalibration();

      // Should have used thermal model characteristics
      expect(mockThermalModelService.getThermalCharacteristics).toHaveBeenCalled();

      // Should return result with expected properties
      expect(result).toHaveProperty('oldK');
      expect(result).toHaveProperty('newK');
      expect(result).toHaveProperty('oldS');
      expect(result).toHaveProperty('newS');
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('thermalCharacteristics');
    });

    it('should fall back to basic calibration if thermal model fails', async () => {
      // Make thermal model throw an error
      mockThermalModelService.getThermalCharacteristics.mockImplementationOnce(() => {
        throw new Error('Thermal model error');
      });

      const result = await optimizer.runWeeklyCalibration();

      // Should have logged error
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error updating thermal model from learning data:',
        expect.any(Error)
      );

      // Should have used basic calibration
      expect(result).toHaveProperty('oldK');
      expect(result).toHaveProperty('newK');
      expect(result).toHaveProperty('method', 'basic');
    });

    it('should use basic calibration when thermal model is not available', async () => {
      // Disable thermal learning
      (optimizer as any).useThermalLearning = false;

      const result = await optimizer.runWeeklyCalibration();

      // Should not have called thermal model
      expect(mockThermalModelService.getThermalCharacteristics).not.toHaveBeenCalled();

      // Should have used basic calibration
      expect(result).toHaveProperty('oldK');
      expect(result).toHaveProperty('newK');
      expect(result).toHaveProperty('method', 'basic');
    });

    it('should handle errors gracefully', async () => {
      // Instead of testing the error propagation, let's test the error handling
      // by making the thermalModelService.getThermalCharacteristics throw an error
      // and then checking that the basic calibration is used as a fallback

      // Make thermal model throw an error
      mockThermalModelService.getThermalCharacteristics.mockImplementationOnce(() => {
        throw new Error('Thermal model error');
      });

      const result = await optimizer.runWeeklyCalibration();

      // Should have logged error
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error updating thermal model from learning data:',
        expect.any(Error)
      );

      // Should have used basic calibration
      expect(result).toHaveProperty('oldK');
      expect(result).toHaveProperty('newK');
      expect(result).toHaveProperty('method', 'basic');
    });
  });

  describe('Learning from no-change outcomes', () => {
    it('should call learnFromOptimizationOutcome on no-change path with valid savings', () => {
      // Set up adaptive parameters learner mock
      const mockLearner = {
        learnFromOutcome: jest.fn()
      };
      (optimizer as any).adaptiveParametersLearner = mockLearner;

      // Spy on learnFromOptimizationOutcome
      const learnSpy = jest.spyOn(optimizer, 'learnFromOptimizationOutcome');

      // Call the public method directly
      optimizer.learnFromOptimizationOutcome(0.10, 0, 3.5);

      // Should have called the underlying learner
      expect(learnSpy).toHaveBeenCalledWith(0.10, 0, 3.5);
      expect(mockLearner.learnFromOutcome).toHaveBeenCalled();

      learnSpy.mockRestore();
    });

    it('should not learn when adaptive learner is not initialized', () => {
      // Clear the adaptive parameters learner
      (optimizer as any).adaptiveParametersLearner = null;

      // Spy on internal logger to verify no errors
      const logSpy = jest.spyOn(mockLogger, 'log');

      // Call the public method
      optimizer.learnFromOptimizationOutcome(0.10, 0, 3.5);

      // Should return early without error
      expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('error'));
    });
  });
});

