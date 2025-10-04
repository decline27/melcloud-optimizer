// Prevent MelCloudApi network activity during these unit tests
jest.mock('../../src/services/melcloud-api', () => ({
  MelCloudApi: class {}
}));

import { Optimizer } from '../../src/services/optimizer';
import {
  createMockLogger,
  createMockMelCloudApi,
  createMockTibberApi,
  createMockCOPHelper,
  createMockHomey,
  createMockThermalModelService
} from '../mocks';

describe('Optimizer Edge Cases', () => {
  let optimizer: Optimizer;
  let mockMelCloud: ReturnType<typeof createMockMelCloudApi>;
  let mockTibber: ReturnType<typeof createMockTibberApi>;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let mockHomey: ReturnType<typeof createMockHomey>;
  let mockCOPHelper: ReturnType<typeof createMockCOPHelper>;
  let mockThermalModelService: ReturnType<typeof createMockThermalModelService>;

  beforeEach(() => {
    mockMelCloud = createMockMelCloudApi();
    mockTibber = createMockTibberApi();
    mockLogger = createMockLogger();
    mockHomey = createMockHomey();
    mockCOPHelper = createMockCOPHelper();
    mockThermalModelService = createMockThermalModelService();

    optimizer = new Optimizer(
      mockMelCloud as any,
      mockTibber as any,
      'device-1',
      1,
      mockLogger as any,
      undefined,
      mockHomey as any
    );

    // Set up optimizer
    optimizer.setTemperatureConstraints(18, 22, 0.5);
    optimizer.setCOPSettings(0.3, true, false);

    // Disable COP adjustments for pure price-based calculations
    (optimizer as any).copWeight = 0;
    (optimizer as any).copHelper = null;

    // Set the services using reflection to avoid TypeScript errors
    // This is only for testing purposes
    Object.defineProperty(optimizer, 'thermalModelService', {
      value: mockThermalModelService,
      writable: true
    });

    Object.defineProperty(optimizer, 'copHelper', {
      value: mockCOPHelper,
      writable: true
    });
  });

  test('calculateOptimalTemperature should handle equal min and max prices', async () => {
    // Access private method using reflection
    const calculateOptimalTemperature = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(optimizer),
      'calculateOptimalTemperature'
    )?.value;

    // Bind the method to the optimizer instance
    const boundMethod = calculateOptimalTemperature.bind(optimizer);

    const result = await boundMethod(
      10, // currentPrice
      10, // avgPrice
      10, // minPrice
      10, // maxPrice
      20  // currentTemp
    );

    // Should default to midpoint when prices are equal
    expect(result).toBeCloseTo(20, 0); // (18 + 22) / 2
  });

  test('calculateOptimalTemperature should handle extremely high prices', async () => {
    // Access private method using reflection
    const calculateOptimalTemperature = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(optimizer),
      'calculateOptimalTemperature'
    )?.value;

    // Bind the method to the optimizer instance
    const boundMethod = calculateOptimalTemperature.bind(optimizer);

    const result = await boundMethod(
      1000, // currentPrice (extremely high)
      100,  // avgPrice
      10,   // minPrice
      1000, // maxPrice
      20    // currentTemp
    );

    // Should set to minimum temperature
    expect(result).toBeCloseTo(18, 0);
  });

  test('calculateOptimalTemperature should handle extremely low prices', async () => {
    // Access private method using reflection
    const calculateOptimalTemperature = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(optimizer),
      'calculateOptimalTemperature'
    )?.value;

    // Bind the method to the optimizer instance
    const boundMethod = calculateOptimalTemperature.bind(optimizer);

    const result = await boundMethod(
      0.01, // currentPrice (extremely low)
      1,    // avgPrice
      0.01, // minPrice
      10,   // maxPrice
      20    // currentTemp
    );

    // Should set to maximum temperature
    expect(result).toBeCloseTo(22, 0);
  });

  test('runHourlyOptimization should handle API errors gracefully', async () => {
    // Setup optimizer with mock dependencies that will fail
    const failingMelCloud = {
      getDeviceState: jest.fn().mockRejectedValue(new Error('API error')),
      setDeviceTemperature: jest.fn()
    };

    const optimizer = new Optimizer(
      failingMelCloud as any,
      mockTibber as any,
      'device-1',
      1,
      mockLogger as any,
      undefined,
      mockHomey as any
    );

    // Set temperature constraints
    optimizer.setTemperatureConstraints(18, 22, 0.5);

    // Should throw but not crash
    await expect(optimizer.runHourlyOptimization()).rejects.toThrow('API error');
    expect(mockLogger.error).toHaveBeenCalled();
  });

  test('runHourlyOptimization should handle missing COP data gracefully', async () => {
    // Mock COP helper to throw an error
    const mockCopHelper = {
      getSeasonalCOP: jest.fn().mockRejectedValue(new Error('COP data unavailable')),
      getLatestCOP: jest.fn().mockRejectedValue(new Error('COP data unavailable')),
      isSummerSeason: jest.fn().mockReturnValue(false)
    };

    // @ts-ignore - Set the COP helper directly
    optimizer.copHelper = mockCopHelper;
    optimizer.setCOPSettings(0.5, true, false);

    // Should complete without throwing
    const result = await optimizer.runHourlyOptimization();

    // Should still have valid result
    expect(result).toBeDefined();
    expect(result.targetTemp).toBeDefined();
    expect(mockLogger.error).toHaveBeenCalled();
  });

  test('runHourlyOptimization should handle missing price data gracefully', async () => {
    // Setup optimizer with mock Tibber API that will fail
    const failingTibber = {
      getPrices: jest.fn().mockRejectedValue(new Error('Price data unavailable'))
    };

    const optimizer = new Optimizer(
      mockMelCloud as any,
      failingTibber as any,
      'device-1',
      1,
      mockLogger as any,
      undefined,
      mockHomey as any
    );

    // Set temperature constraints
    optimizer.setTemperatureConstraints(18, 22, 0.5);

    // Should throw but not crash
    await expect(optimizer.runHourlyOptimization()).rejects.toThrow('Price data unavailable');
    expect(mockLogger.error).toHaveBeenCalled();
  });

  test('runHourlyOptimization should handle device state with missing temperature data', async () => {
    // Mock device state with missing temperature data
    mockMelCloud.getDeviceState = jest.fn().mockResolvedValue({
      DeviceID: 'device-1',
      // Missing RoomTemperature and SetTemperature
      OutdoorTemperature: 5
    });

    // Should complete without throwing
    const result = await optimizer.runHourlyOptimization();

    // Should still have valid result
    expect(result).toBeDefined();
    expect(result.targetTemp).toBeDefined();
    // The optimizer might log an error instead of a warning for missing temperature data
    expect(mockLogger.error).toHaveBeenCalled();
  });

  test('runWeeklyCalibration should handle insufficient data gracefully', async () => {
    // Mock thermal model service to indicate insufficient data
    mockThermalModelService.getThermalCharacteristics = jest.fn().mockReturnValue({
      heatingRate: 0,
      coolingRate: 0,
      thermalMass: 0,
      modelConfidence: 0,
      lastUpdated: new Date().toISOString()
    });

    // Should complete without throwing
    const result = await optimizer.runWeeklyCalibration();

    // Should indicate no change
    expect(result).toBeDefined();
    expect(result.newK).toBeGreaterThanOrEqual(result.oldK * 0.9);
    expect(result.newK).toBeLessThanOrEqual(result.oldK * 1.1);
    // The optimizer might log an info message instead of a warning for insufficient data
    expect(mockLogger.log).toHaveBeenCalled();
  });

  test('runWeeklyCalibration should handle thermal model errors gracefully', async () => {
    // Mock thermal model service to throw an error
    mockThermalModelService.getThermalCharacteristics = jest.fn().mockImplementation(() => {
      throw new Error('Thermal model error');
    });

    // Should complete without throwing
    const result = await optimizer.runWeeklyCalibration();

    // Should indicate no change
    expect(result).toBeDefined();
    expect(result.newK).toBeGreaterThanOrEqual(result.oldK * 0.9);
    expect(result.newK).toBeLessThanOrEqual(result.oldK * 1.1);
    expect(mockLogger.error).toHaveBeenCalled();
  });
});
