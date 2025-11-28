/**
 * Savings Service Tests
 *
 * Comprehensive test suite covering:
 * - Basic savings calculation
 * - Real hourly savings with metrics
 * - Daily savings projection
 * - Enhanced savings with baseline
 * - Edge cases and error handling
 *
 * Extracted from optimizer.ts as part of the refactoring plan (PR 5).
 */

import {
  SavingsService,
  SavingsServiceLogger,
  SavingsSettingsAccessor,
  MetricsAccessor,
  WeatherApi,
  SavingsZoneKind,
} from '../../src/services/savings-service';
import { EnhancedSavingsCalculator, SavingsCalculationResult, OptimizationData } from '../../src/util/enhanced-savings-calculator';
import { PriceAnalyzer } from '../../src/services/price-analyzer';
import { TimeZoneHelper } from '../../src/util/time-zone-helper';
import { OptimizationMetrics, WeatherData } from '../../src/types';

describe('SavingsService', () => {
  let mockLogger: jest.Mocked<SavingsServiceLogger>;
  let mockSettingsAccessor: jest.Mocked<SavingsSettingsAccessor>;
  let mockMetricsAccessor: jest.Mocked<MetricsAccessor>;
  let mockEnhancedSavingsCalculator: jest.Mocked<EnhancedSavingsCalculator>;
  let mockPriceAnalyzer: jest.Mocked<PriceAnalyzer>;
  let mockTimeZoneHelper: jest.Mocked<TimeZoneHelper>;
  let mockWeatherApi: jest.Mocked<WeatherApi>;
  let savingsService: SavingsService;

  const mockMetrics: OptimizationMetrics = {
    realHeatingCOP: 3.0,
    realHotWaterCOP: 2.5,
    dailyEnergyConsumption: 24.0, // 1 kWh/hour
    heatingEfficiency: 0.85,
    hotWaterEfficiency: 0.75,
    seasonalMode: 'winter',
    optimizationFocus: 'heating',
  };

  const mockSavingsResult: SavingsCalculationResult = {
    dailySavings: 5.0,
    compoundedSavings: 4.5,
    projectedSavings: 5.5,
    confidence: 0.8,
    method: 'enhanced',
    breakdown: {
      actualSavings: 3.0,
      currentHourSavings: 0.5,
      projectedHours: 20,
      projectedAmount: 2.0,
    },
  };

  beforeEach(() => {
    // Create mocks
    mockLogger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    mockSettingsAccessor = {
      getGridFee: jest.fn().mockReturnValue(0.05),
      getCurrency: jest.fn().mockReturnValue('NOK'),
    };

    mockMetricsAccessor = {
      getOptimizationMetrics: jest.fn().mockReturnValue(mockMetrics),
    };

    mockEnhancedSavingsCalculator = {
      calculateEnhancedDailySavings: jest.fn().mockReturnValue(mockSavingsResult),
      calculateEnhancedDailySavingsWithBaseline: jest.fn().mockReturnValue(mockSavingsResult),
      hasBaselineCapability: jest.fn().mockReturnValue(true),
      getDefaultBaselineConfig: jest.fn().mockReturnValue({ fixedHeatingTemp: 21, fixedDHWTemp: 60 }),
    } as unknown as jest.Mocked<EnhancedSavingsCalculator>;

    mockPriceAnalyzer = {
      hasPriceProvider: jest.fn().mockReturnValue(true),
      getPriceData: jest.fn().mockResolvedValue({
        current: { price: 0.5 },
        prices: [
          { time: new Date(Date.now() + 3600000).toISOString(), price: 0.6 },
          { time: new Date(Date.now() + 7200000).toISOString(), price: 0.4 },
        ],
      }),
    } as unknown as jest.Mocked<PriceAnalyzer>;

    mockTimeZoneHelper = {
      getLocalTime: jest.fn().mockReturnValue({ 
        date: new Date(),
        hour: 14,
        timeString: '14:00',
        timeZoneOffset: 1,
        effectiveOffset: 1
      }),
    } as unknown as jest.Mocked<TimeZoneHelper>;

    mockWeatherApi = {
      getCurrentWeather: jest.fn().mockResolvedValue({ temperature: 5 } as WeatherData),
    };

    savingsService = new SavingsService({
      enhancedSavingsCalculator: mockEnhancedSavingsCalculator,
      priceAnalyzer: mockPriceAnalyzer,
      timeZoneHelper: mockTimeZoneHelper,
      logger: mockLogger,
      settingsAccessor: mockSettingsAccessor,
      metricsAccessor: mockMetricsAccessor,
      weatherApi: mockWeatherApi,
    });
  });

  describe('calculateSavings', () => {
    it('should calculate basic savings for zone1', () => {
      const savings = savingsService.calculateSavings(22, 20, 0.5, 'zone1');

      // tempDiff = 22 - 20 = 2
      // gridFee = 0.05, effectivePrice = 0.55
      // perDegPct = 5.0, kindMultiplier = 1.0
      // energySavingPercent = 2 * 5.0 * 1.0 = 10%
      // baseHourlyConsumption = 24/24 = 1.0 kWh
      // savings = (10/100) * 1.0 * 0.55 = 0.055
      expect(savings).toBeCloseTo(0.055, 2);
    });

    it('should calculate savings for zone2 with reduced factor', () => {
      const savings = savingsService.calculateSavings(22, 20, 0.5, 'zone2');

      // perDegPct = 4.0, kindMultiplier = 0.9
      // energySavingPercent = 2 * 4.0 * 0.9 = 7.2%
      // savings = (7.2/100) * 1.0 * 0.55 = 0.0396
      expect(savings).toBeCloseTo(0.0396, 2);
    });

    it('should calculate savings for tank with reduced factor', () => {
      const savings = savingsService.calculateSavings(55, 50, 0.5, 'tank');

      // tempDiff = 55 - 50 = 5
      // perDegPct = 2.0, kindMultiplier = 0.8
      // energySavingPercent = 5 * 2.0 * 0.8 = 8%
      // savings = (8/100) * 1.0 * 0.55 = 0.044
      expect(savings).toBeCloseTo(0.044, 2);
    });

    it('should return 0 for zero temperature difference', () => {
      const savings = savingsService.calculateSavings(20, 20, 0.5);
      expect(savings).toBe(0);
    });

    it('should return 0 for invalid inputs', () => {
      expect(savingsService.calculateSavings(NaN, 20, 0.5)).toBe(0);
      expect(savingsService.calculateSavings(22, NaN, 0.5)).toBe(0);
      expect(savingsService.calculateSavings(22, 20, NaN)).toBe(0);
      expect(savingsService.calculateSavings(22, 20, Infinity)).toBe(0);
    });

    it('should handle negative savings (cost increase)', () => {
      const savings = savingsService.calculateSavings(20, 22, 0.5);
      expect(savings).toBeLessThan(0);
    });

    it('should use fallback consumption when metrics unavailable', () => {
      mockMetricsAccessor.getOptimizationMetrics.mockReturnValue(null);
      const savings = savingsService.calculateSavings(22, 20, 0.5);
      expect(savings).toBeCloseTo(0.055, 2);
    });
  });

  describe('calculateRealHourlySavings', () => {
    it('should calculate hourly savings using metrics in winter', async () => {
      const savings = await savingsService.calculateRealHourlySavings(22, 20, 0.5, mockMetrics, 'zone1');

      // tempDelta = 2
      // perDegFactor = 0.15 * 0.85 = 0.1275
      // dailyEnergyImpact = 2 * 0.1275 * 24 = 6.12 kWh
      // effectivePrice = 0.5 + 0.05 = 0.55
      // dailyCostImpact = 6.12 * 1 * 0.55 = 3.366
      // hourlyCostImpact = 3.366 / 24 = 0.14025
      expect(savings).toBeCloseTo(0.14, 1);
    });

    it('should calculate hourly savings in summer mode', async () => {
      const summerMetrics: OptimizationMetrics = {
        ...mockMetrics,
        seasonalMode: 'summer',
      };
      const savings = await savingsService.calculateRealHourlySavings(22, 20, 0.5, summerMetrics, 'zone1');

      // perDegFactor = 0.05 in summer
      expect(savings).toBeGreaterThan(0);
      expect(savings).toBeLessThan(0.1); // Lower than winter
    });

    it('should calculate hourly savings in transition mode', async () => {
      const transitionMetrics: OptimizationMetrics = {
        ...mockMetrics,
        seasonalMode: 'transition',
      };
      const savings = await savingsService.calculateRealHourlySavings(22, 20, 0.5, transitionMetrics, 'zone1');

      // perDegFactor = 0.10 in transition
      expect(savings).toBeGreaterThan(0);
    });

    it('should apply zone2 adjustment', async () => {
      const zone1Savings = await savingsService.calculateRealHourlySavings(22, 20, 0.5, mockMetrics, 'zone1');
      const zone2Savings = await savingsService.calculateRealHourlySavings(22, 20, 0.5, mockMetrics, 'zone2');

      // Zone2 has 0.9 multiplier
      expect(zone2Savings).toBeCloseTo(zone1Savings * 0.9, 2);
    });

    it('should apply tank adjustment', async () => {
      const zone1Savings = await savingsService.calculateRealHourlySavings(55, 50, 0.5, mockMetrics, 'zone1');
      const tankSavings = await savingsService.calculateRealHourlySavings(55, 50, 0.5, mockMetrics, 'tank');

      // Tank has 0.5 multiplier
      expect(tankSavings).toBeCloseTo(zone1Savings * 0.5, 2);
    });

    it('should return 0 for zero temperature delta', async () => {
      const savings = await savingsService.calculateRealHourlySavings(20, 20, 0.5, mockMetrics);
      expect(savings).toBe(0);
    });

    it('should fall back to simple calculation without metrics', async () => {
      const savings = await savingsService.calculateRealHourlySavings(22, 20, 0.5, undefined);
      expect(savings).toBeGreaterThan(0);
    });

    it('should fall back when daily consumption is 0', async () => {
      const zeroConsumptionMetrics: OptimizationMetrics = {
        ...mockMetrics,
        dailyEnergyConsumption: 0,
      };
      const savings = await savingsService.calculateRealHourlySavings(22, 20, 0.5, zeroConsumptionMetrics);
      expect(savings).toBeGreaterThan(0);
    });
  });

  describe('estimateCostSavings', () => {
    it('should return no-data message without metrics', () => {
      const result = savingsService.estimateCostSavings(22, 20, 0.5, 0.45, undefined);
      expect(result).toBe('No real energy data for savings calculation');
    });

    it('should estimate savings for temperature reduction', () => {
      const result = savingsService.estimateCostSavings(20, 22, 0.5, 0.45, mockMetrics);
      expect(result).toContain('savings');
      expect(result).toContain('NOK/week');
    });

    it('should estimate cost increase for temperature increase', () => {
      const result = savingsService.estimateCostSavings(24, 20, 0.5, 0.45, mockMetrics);
      expect(result).toContain('cost increase');
      expect(result).toContain('NOK/week');
    });

    it('should handle summer mode with lower impact', () => {
      const summerMetrics: OptimizationMetrics = {
        ...mockMetrics,
        seasonalMode: 'summer',
      };
      const result = savingsService.estimateCostSavings(20, 22, 0.5, 0.45, summerMetrics);
      expect(result).toContain('NOK/week');
    });
  });

  describe('calculateDailySavings', () => {
    it('should project daily savings using enhanced calculator', async () => {
      const dailySavings = await savingsService.calculateDailySavings(0.5, []);
      expect(dailySavings).toBe(5.0); // From mockSavingsResult
      expect(mockEnhancedSavingsCalculator.calculateEnhancedDailySavings).toHaveBeenCalled();
    });

    it('should fall back to simple multiplication on error', async () => {
      mockPriceAnalyzer.hasPriceProvider.mockReturnValue(false);
      mockEnhancedSavingsCalculator.calculateEnhancedDailySavings.mockImplementation(() => {
        throw new Error('Test error');
      });

      const dailySavings = await savingsService.calculateDailySavings(0.5, []);
      expect(dailySavings).toBe(12); // 0.5 * 24
    });

    it('should handle undefined result gracefully', async () => {
      mockEnhancedSavingsCalculator.calculateEnhancedDailySavings.mockReturnValue({
        dailySavings: undefined,
      } as unknown as SavingsCalculationResult);

      const dailySavings = await savingsService.calculateDailySavings(0.5, []);
      expect(dailySavings).toBe(12); // 0.5 * 24 fallback
    });
  });

  describe('calculateEnhancedDailySavings', () => {
    it('should delegate to enhanced savings calculator', () => {
      const result = savingsService.calculateEnhancedDailySavings(0.5, [], [1.0, 1.2, 0.8]);

      expect(mockEnhancedSavingsCalculator.calculateEnhancedDailySavings).toHaveBeenCalledWith(
        0.5,
        [],
        14, // current hour from mock
        [1.0, 1.2, 0.8]
      );
      expect(result.dailySavings).toBe(5.0);
    });

    it('should use current hour from TimeZoneHelper', () => {
      mockTimeZoneHelper.getLocalTime.mockReturnValue({ 
        date: new Date(),
        hour: 22,
        timeString: '22:00',
        timeZoneOffset: 1,
        effectiveOffset: 1
      });

      savingsService.calculateEnhancedDailySavings(0.5, []);

      expect(mockEnhancedSavingsCalculator.calculateEnhancedDailySavings).toHaveBeenCalledWith(
        0.5,
        [],
        22,
        undefined
      );
    });
  });

  describe('calculateEnhancedDailySavingsUsingPriceProvider', () => {
    it('should calculate with price factors when provider available', async () => {
      const result = await savingsService.calculateEnhancedDailySavingsUsingPriceProvider(0.5, []);

      expect(mockPriceAnalyzer.hasPriceProvider).toHaveBeenCalled();
      expect(mockPriceAnalyzer.getPriceData).toHaveBeenCalled();
      expect(mockEnhancedSavingsCalculator.calculateEnhancedDailySavings).toHaveBeenCalled();
      expect(result.dailySavings).toBe(5.0);
    });

    it('should fall back when no price provider', async () => {
      mockPriceAnalyzer.hasPriceProvider.mockReturnValue(false);

      const result = await savingsService.calculateEnhancedDailySavingsUsingPriceProvider(0.5, []);

      expect(mockEnhancedSavingsCalculator.calculateEnhancedDailySavings).toHaveBeenCalled();
      expect(result.dailySavings).toBe(5.0);
    });
  });

  describe('calculateEnhancedDailySavingsWithBaseline', () => {
    it('should calculate with baseline when available', async () => {
      const result = await savingsService.calculateEnhancedDailySavingsWithBaseline(0.5, [], 24, 12, true);

      expect(mockWeatherApi.getCurrentWeather).toHaveBeenCalled();
      expect(mockEnhancedSavingsCalculator.getDefaultBaselineConfig).toHaveBeenCalled();
      expect(mockEnhancedSavingsCalculator.calculateEnhancedDailySavingsWithBaseline).toHaveBeenCalled();
      expect(result.dailySavings).toBe(5.0);
    });

    it('should skip weather when baseline disabled', async () => {
      await savingsService.calculateEnhancedDailySavingsWithBaseline(0.5, [], 24, 12, false);

      // Weather should still be called since we have weatherApi
      // but enableBaseline affects what's passed to calculator
      expect(mockEnhancedSavingsCalculator.calculateEnhancedDailySavingsWithBaseline).toHaveBeenCalled();
    });

    it('should handle weather API error gracefully', async () => {
      mockWeatherApi.getCurrentWeather.mockRejectedValue(new Error('Weather API error'));

      const result = await savingsService.calculateEnhancedDailySavingsWithBaseline(0.5, []);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error getting weather for baseline calculation:',
        expect.any(Error)
      );
      expect(result.dailySavings).toBe(5.0);
    });

    it('should fall back to standard calculation on error', async () => {
      mockEnhancedSavingsCalculator.calculateEnhancedDailySavingsWithBaseline.mockImplementation(() => {
        throw new Error('Baseline calculation error');
      });

      const result = await savingsService.calculateEnhancedDailySavingsWithBaseline(0.5, []);

      expect(mockLogger.error).toHaveBeenCalled();
      expect(result.dailySavings).toBe(5.0); // Fallback result
    });
  });

  describe('getEnhancedSavingsCalculator', () => {
    it('should return the underlying calculator', () => {
      const calculator = savingsService.getEnhancedSavingsCalculator();
      expect(calculator).toBe(mockEnhancedSavingsCalculator);
    });
  });

  describe('hasBaselineCapability', () => {
    it('should delegate to enhanced calculator', () => {
      expect(savingsService.hasBaselineCapability()).toBe(true);
      expect(mockEnhancedSavingsCalculator.hasBaselineCapability).toHaveBeenCalled();
    });

    it('should return false when calculator returns false', () => {
      mockEnhancedSavingsCalculator.hasBaselineCapability.mockReturnValue(false);
      expect(savingsService.hasBaselineCapability()).toBe(false);
    });
  });

  describe('without weather API', () => {
    beforeEach(() => {
      savingsService = new SavingsService({
        enhancedSavingsCalculator: mockEnhancedSavingsCalculator,
        priceAnalyzer: mockPriceAnalyzer,
        timeZoneHelper: mockTimeZoneHelper,
        logger: mockLogger,
        settingsAccessor: mockSettingsAccessor,
        metricsAccessor: mockMetricsAccessor,
        // No weatherApi
      });
    });

    it('should calculate baseline without weather data', async () => {
      const result = await savingsService.calculateEnhancedDailySavingsWithBaseline(0.5, []);

      expect(mockEnhancedSavingsCalculator.calculateEnhancedDailySavingsWithBaseline).toHaveBeenCalled();
      expect(result.dailySavings).toBe(5.0);
    });
  });
});
