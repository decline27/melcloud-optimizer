import { Optimizer } from '../../src/services/optimizer';

describe('Preheat Cheap Percentile Setting', () => {
  let optimizer: Optimizer;
  let mockHomey: any;
  let mockLogger: any;
  let mockMelCloud: any;
  let mockPriceProvider: any;

  beforeEach(() => {
    mockLogger = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    };

    mockMelCloud = {
      getDeviceState: jest.fn(),
      setDeviceTemperature: jest.fn(),
    };

    mockPriceProvider = {
      getPrices: jest.fn(),
    };

    mockHomey = {
      settings: {
        get: jest.fn(),
        set: jest.fn(),
      },
    };
  });

  test('should use default preheat_cheap_percentile when setting is not configured', () => {
    // Mock homey.settings.get to return undefined for preheat_cheap_percentile
    mockHomey.settings.get.mockImplementation((key: string) => {
      if (key === 'preheat_cheap_percentile') return undefined;
      return undefined;
    });

    optimizer = new Optimizer(mockMelCloud, mockPriceProvider, 'test-device', 123, mockLogger, mockHomey);

    // Check that the default value (0.25) is used
    expect((optimizer as any).preheatCheapPercentile).toBe(0.25);
  });

  test('should use configured preheat_cheap_percentile setting via setPriceThresholds', () => {
    mockHomey.settings.get.mockReturnValue(undefined);
    optimizer = new Optimizer(mockMelCloud, mockPriceProvider, 'test-device', 123, mockLogger, mockHomey);

    // Use the setter method to update the threshold
    optimizer.setPriceThresholds(0.15);

    // Check that the configured value is used
    expect((optimizer as any).preheatCheapPercentile).toBe(0.15);
  });

  test('should validate preheat_cheap_percentile and reject invalid values', () => {
    mockHomey.settings.get.mockReturnValue(undefined);
    optimizer = new Optimizer(mockMelCloud, mockPriceProvider, 'test-device', 123, mockLogger, mockHomey);

    // Should throw validation error for invalid value
    expect(() => optimizer.setPriceThresholds(0.8)).toThrow(); // Too high (>0.5)
    expect(() => optimizer.setPriceThresholds(0.01)).toThrow(); // Too low (<0.05)

    // Should remain at default value
    expect((optimizer as any).preheatCheapPercentile).toBe(0.25);
  });

  test('calculatePriceLevel should use user-configurable cheap threshold', () => {
    mockHomey.settings.get.mockReturnValue(undefined);
    optimizer = new Optimizer(mockMelCloud, mockPriceProvider, 'test-device', 123, mockLogger, mockHomey);

    // Set a custom cheap threshold via setter method
    optimizer.setPriceThresholds(0.3); // 30th percentile

    // Test price level calculation with user's threshold
    expect((optimizer as any).calculatePriceLevel(10)).toBe('VERY_CHEAP'); // 10% < 12% (30% * 0.4)
    expect((optimizer as any).calculatePriceLevel(20)).toBe('CHEAP'); // 20% < 30%
    expect((optimizer as any).calculatePriceLevel(50)).toBe('NORMAL'); // 50% between 30% and 70%
    expect((optimizer as any).calculatePriceLevel(80)).toBe('EXPENSIVE'); // 80% > 70% but < 88%
    expect((optimizer as any).calculatePriceLevel(95)).toBe('VERY_EXPENSIVE'); // 95% > 88%
  });

  test('setPriceThresholds should update the internal setting', () => {
    mockHomey.settings.get.mockReturnValue(undefined);
    optimizer = new Optimizer(mockMelCloud, mockPriceProvider, 'test-device', 123, mockLogger, mockHomey);

    const originalValue = (optimizer as any).preheatCheapPercentile;
    expect(originalValue).toBe(0.25); // Default

    // Update the price threshold
    optimizer.setPriceThresholds(0.2);

    // Check that the value was updated internally
    expect((optimizer as any).preheatCheapPercentile).toBe(0.2);
    expect((optimizer as any).preheatCheapPercentile).not.toBe(originalValue);
  });
});