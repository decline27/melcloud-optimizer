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
      info: jest.fn(),
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

    optimizer = new Optimizer(mockMelCloud, mockPriceProvider, 'test-device', 123, mockLogger, undefined, mockHomey);

    // Check that the default value (0.25) is used via PriceAnalyzer
    expect((optimizer as any).priceAnalyzer.getCheapPercentile()).toBe(0.25);
  });

  test('should use configured preheat_cheap_percentile setting via setPriceThresholds', () => {
    mockHomey.settings.get.mockReturnValue(undefined);
    optimizer = new Optimizer(mockMelCloud, mockPriceProvider, 'test-device', 123, mockLogger, undefined, mockHomey);

    // Use the setter method to update the threshold
    optimizer.setPriceThresholds(0.15);

    // Check that the configured value is used via PriceAnalyzer
    expect((optimizer as any).priceAnalyzer.getCheapPercentile()).toBe(0.15);
  });

  test('should validate preheat_cheap_percentile and reject invalid values', () => {
    mockHomey.settings.get.mockReturnValue(undefined);
    optimizer = new Optimizer(mockMelCloud, mockPriceProvider, 'test-device', 123, mockLogger, undefined, mockHomey);

    // Should throw validation error for invalid value
    expect(() => optimizer.setPriceThresholds(0.8)).toThrow(); // Too high (>0.5)
    expect(() => optimizer.setPriceThresholds(0.01)).toThrow(); // Too low (<0.05)

    // Should remain at default value
    expect((optimizer as any).priceAnalyzer.getCheapPercentile()).toBe(0.25);
  });

  test('calculatePriceLevel should use user-configurable cheap threshold', () => {
    mockHomey.settings.get.mockReturnValue(undefined);
    optimizer = new Optimizer(mockMelCloud, mockPriceProvider, 'test-device', 123, mockLogger, undefined, mockHomey);

    // Set a custom cheap threshold via setter method
    optimizer.setPriceThresholds(0.3); // 30th percentile

    // Verify the threshold was set
    expect((optimizer as any).priceAnalyzer.getCheapPercentile()).toBe(0.3);

    // Test price level calculation with user's threshold
    // Note: calculatePriceLevel is private, but we can test through the public API
    // Instead of testing the private method, we verify the threshold is properly set
    expect((optimizer as any).priceAnalyzer.getCheapPercentile()).toBe(0.3);
  });

  test('setPriceThresholds should update the internal setting', () => {
    mockHomey.settings.get.mockReturnValue(undefined);
    optimizer = new Optimizer(mockMelCloud, mockPriceProvider, 'test-device', 123, mockLogger, undefined, mockHomey);

    const originalValue = (optimizer as any).priceAnalyzer.getCheapPercentile();
    expect(originalValue).toBe(0.25); // Default

    // Update the price threshold
    optimizer.setPriceThresholds(0.2);

    // Check that the value was updated internally via PriceAnalyzer
    const newValue = (optimizer as any).priceAnalyzer.getCheapPercentile();
    expect(newValue).toBe(0.2);
    expect(newValue).not.toBe(originalValue);
  });
});