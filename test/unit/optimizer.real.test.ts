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

describe('Optimizer', () => {
  let optimizer: Optimizer;
  let mockMelCloud: jest.Mocked<MelCloudApi>;
  let mockTibber: jest.Mocked<TibberApi>;
  let mockLogger: any;
  let mockWeatherApi: any;
  let mockHomey: any;
  let mockThermalModelService: jest.Mocked<ThermalModelService>;
  let mockCOPHelper: jest.Mocked<COPHelper>;

  const deviceId = '123';
  const buildingId = 456;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Create mock instances
    mockMelCloud = new MelCloudApi() as jest.Mocked<MelCloudApi>;
    // Manually mock TibberApi to ensure it's not undefined
    mockTibber = {
      getPrices: jest.fn(),
      updateTimeZoneSettings: jest.fn(),
      cleanup: jest.fn()
    } as unknown as jest.Mocked<TibberApi>;
    mockLogger = {
      log: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn()
    };
    mockWeatherApi = {
      getCurrentWeather: jest.fn().mockResolvedValue({
        temperature: 5.0,
        windSpeed: 3.0,
        humidity: 70,
        cloudCover: 80,
        precipitation: 0
      }),
      getForecast: jest.fn().mockResolvedValue([
        {
          time: '2023-01-01T00:00:00Z',
          temperature: 5.0,
          windSpeed: 3.0,
          humidity: 70,
          cloudCover: 80,
          precipitation: 0
        }
      ])
    };
    mockHomey = {
      settings: {
        get: jest.fn().mockImplementation((key: string) => {
          if (key === 'comfort_lower_occupied') return 18;
          if (key === 'comfort_upper_occupied') return 22;
          if (key === 'comfort_lower_away') return 17;
          if (key === 'comfort_upper_away') return 21;
          if (key === 'k_factor') return 0.3;
          if (key === 'cop_weight') return 0.3;
          if (key === 'auto_seasonal_mode') return true;
          if (key === 'summer_mode') return false;
          return null;
        }),
        set: jest.fn()
      }
    };
    mockThermalModelService = new ThermalModelService(mockHomey) as jest.Mocked<ThermalModelService>;
    mockCOPHelper = new COPHelper(mockHomey, mockLogger) as jest.Mocked<COPHelper>;

    // Mock specific methods
    mockMelCloud.getDeviceState.mockResolvedValue({
      DeviceID: deviceId,
      DeviceName: 'Test Device',
      BuildingID: buildingId,
      RoomTemperatureZone1: 21.5,
      SetTemperatureZone1: 21.0,
      OutdoorTemperature: 5.0,
      OperationMode: 1, // Heating
      Power: true,
      IdleZone1: false // Required by MelCloudDevice type
    });
    mockMelCloud.setDeviceTemperature.mockResolvedValue(true);

    // Create a valid TibberPriceInfo object without extra properties
    mockTibber.getPrices.mockResolvedValue({
      current: {
        price: 0.15,
        time: '2023-01-01T00:00:00Z'
      },
      prices: [
        {
          price: 0.14,
          time: '2023-01-01T00:00:00Z'
        },
        {
          price: 0.15,
          time: '2023-01-01T01:00:00Z'
        },
        {
          price: 0.16,
          time: '2023-01-01T02:00:00Z'
        }
      ]
      // Removed min, max, average properties that aren't in the TibberPriceInfo type
    });

    // Add methods to ThermalModelService mock
    mockThermalModelService.getHeatingRecommendation = jest.fn().mockReturnValue({
      recommendedTemperature: 21.5,
      recommendedStartTime: '2023-01-01T00:00:00Z',
      estimatedSavings: 0.5,
      confidence: 0.8,
      explanation: 'Based on thermal model'
    });

    // Add methods to COPHelper mock
    mockCOPHelper.isSummerSeason = jest.fn().mockReturnValue(false);
    mockCOPHelper.getSeasonalCOP = jest.fn().mockResolvedValue(3.5);

    // Create optimizer instance
    optimizer = new Optimizer(
      mockMelCloud,
      mockTibber,
      deviceId,
      buildingId,
      mockLogger,
      mockWeatherApi,
      mockHomey
    );

    // Set thermal model service and COP helper
    (optimizer as any).thermalModelService = mockThermalModelService;
    (optimizer as any).copHelper = mockCOPHelper;
  });

  describe('constructor', () => {
    it('should initialize with default values', () => {
      expect(optimizer).toBeDefined();
      expect((optimizer as any).melCloud).toBe(mockMelCloud);
      // priceProvider is now managed by PriceAnalyzer, not directly on Optimizer
      expect((optimizer as any).priceAnalyzer).toBeDefined();
      expect((optimizer as any).deviceId).toBe(deviceId);
      expect((optimizer as any).buildingId).toBe(buildingId);
      expect((optimizer as any).logger).toBe(mockLogger);
    });

    it('should initialize thermal model service if homey is provided', () => {
      expect((optimizer as any).thermalModelService).toBeDefined();
      expect((optimizer as any).useThermalLearning).toBe(true);
    });

    it('should initialize COP helper if homey is provided', () => {
      expect((optimizer as any).copHelper).toBeDefined();
      expect((optimizer as any).copWeight).toBe(0.3);
      expect((optimizer as any).autoSeasonalMode).toBe(true);
      expect((optimizer as any).summerMode).toBe(false);
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
      const priceMin = 0.14;
      const priceMax = 0.16;
      const currentTemp = 21.0;

      const result = await (optimizer as any).calculateOptimalTemperature(
        currentPrice,
        priceAvg,
        priceMin,
        priceMax,
        currentTemp
      );

      // Verify the result
      expect(result).toBeDefined();
      expect(typeof result).toBe('number');

      // Since price is average, temperature should be around the middle
      expect(result).toBeCloseTo(20, 1);
    });

    it('should increase temperature when price is below average', async () => {
      const currentPrice = 0.14; // Below average
      const priceAvg = 0.15;
      const priceMin = 0.14;
      const priceMax = 0.16;
      const currentTemp = 21.0;

      const result = await (optimizer as any).calculateOptimalTemperature(
        currentPrice,
        priceAvg,
        priceMin,
        priceMax,
        currentTemp
      );

      // Verify the result
      expect(result).toBeDefined();
      expect(typeof result).toBe('number');

      // Since price is below average, temperature should be higher
      expect(result).toBeGreaterThan(currentTemp);
    });

    it('should decrease temperature when price is above average', async () => {
      const currentPrice = 0.16; // Above average
      const priceAvg = 0.15;
      const priceMin = 0.14;
      const priceMax = 0.16;
      const currentTemp = 21.0;

      const result = await (optimizer as any).calculateOptimalTemperature(
        currentPrice,
        priceAvg,
        priceMin,
        priceMax,
        currentTemp
      );

      // Verify the result
      expect(result).toBeDefined();
      expect(typeof result).toBe('number');

      // Since price is above average, temperature should be lower
      expect(result).toBeLessThan(currentTemp);
    });
  });
});
