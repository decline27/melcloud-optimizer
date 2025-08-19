import { PriceIntegrationService, PriceAnalysis, PriceOptimizationRecommendation } from '../../src/services/price-integration-service';
import { ConfigurationService } from '../../src/services/configuration-service';
import { HomeyLogger } from '../../src/util/logger';

// Mock dependencies
jest.mock('../../src/services/configuration-service');
jest.mock('../../src/util/logger');

describe('PriceIntegrationService', () => {
  let service: PriceIntegrationService;
  let mockConfigService: jest.Mocked<ConfigurationService>;
  let mockLogger: jest.Mocked<HomeyLogger>;

  const mockTibberConfig = {
    enabled: true,
    apiKey: 'test-key',
    homeId: 'test-home'
  };

  beforeEach(() => {
    mockConfigService = {
      getConfig: jest.fn(),
      updateConfig: jest.fn()
    } as any;

    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    } as any;

    // Reset mocks
    jest.clearAllMocks();
    
    // Setup default config mock
    mockConfigService.getConfig.mockResolvedValue(mockTibberConfig);
  });

  afterEach(() => {
    if (service) {
      service.shutdown();
    }
  });

  describe('Initialization', () => {
    test('should initialize with Tibber enabled', async () => {
      service = new PriceIntegrationService(mockConfigService, mockLogger);
      
      // Wait for async initialization
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockConfigService.getConfig).toHaveBeenCalledWith('tibber');
      expect(mockLogger.info).toHaveBeenCalledWith(
        'PriceIntegrationService: Price integration service initialized',
        expect.objectContaining({
          tibberEnabled: true,
          priceHistoryCount: expect.any(Number)
        })
      );
    });

    test('should initialize with Tibber disabled', async () => {
      mockConfigService.getConfig.mockResolvedValue({ ...mockTibberConfig, enabled: false });
      
      service = new PriceIntegrationService(mockConfigService, mockLogger);
      
      // Wait for async initialization
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockLogger.info).toHaveBeenCalledWith(
        'PriceIntegrationService: Price integration service initialized',
        expect.objectContaining({
          tibberEnabled: false
        })
      );
    });

    test('should handle initialization errors gracefully', async () => {
      mockConfigService.getConfig.mockRejectedValue(new Error('Config error'));
      
      // Service construction should not throw, but async initialization will fail
      service = new PriceIntegrationService(mockConfigService, mockLogger);

      // Wait for async initialization to complete and expect it to fail
      await new Promise(resolve => setTimeout(resolve, 200));

      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('Price Analysis', () => {
    beforeEach(async () => {
      service = new PriceIntegrationService(mockConfigService, mockLogger);
      await new Promise(resolve => setTimeout(resolve, 100)); // Wait for initialization
    });

    test('should analyze current price conditions', async () => {
      const analysis = await service.analyzePrices();

      expect(analysis).toHaveProperty('current');
      expect(analysis.current).toHaveProperty('price');
      expect(analysis.current).toHaveProperty('timestamp');
      expect(analysis.current).toHaveProperty('level');
      expect(['very_cheap', 'cheap', 'normal', 'expensive', 'very_expensive']).toContain(analysis.current.level);
    });

    test('should analyze price trends', async () => {
      const analysis = await service.analyzePrices();

      expect(analysis).toHaveProperty('trend');
      expect(analysis.trend).toHaveProperty('direction');
      expect(analysis.trend).toHaveProperty('confidence');
      expect(analysis.trend).toHaveProperty('change');
      expect(['rising', 'falling', 'stable']).toContain(analysis.trend.direction);
      expect(analysis.trend.confidence).toBeGreaterThanOrEqual(0);
      expect(analysis.trend.confidence).toBeLessThanOrEqual(1);
    });

    test('should generate 24-hour forecast', async () => {
      const analysis = await service.analyzePrices();

      expect(analysis).toHaveProperty('forecast');
      expect(analysis.forecast).toHaveProperty('next24h');
      expect(analysis.forecast.next24h).toHaveLength(24);
      
      analysis.forecast.next24h.forEach(item => {
        expect(item).toHaveProperty('hour');
        expect(item).toHaveProperty('price');
        expect(item).toHaveProperty('level');
        expect(item).toHaveProperty('recommendation');
        expect(['buy', 'wait', 'avoid']).toContain(item.recommendation);
      });
    });

    test('should identify cheap and expensive periods', async () => {
      const analysis = await service.analyzePrices();

      expect(analysis.forecast).toHaveProperty('cheapestPeriods');
      expect(analysis.forecast).toHaveProperty('expensivePeriods');
      expect(Array.isArray(analysis.forecast.cheapestPeriods)).toBe(true);
      expect(Array.isArray(analysis.forecast.expensivePeriods)).toBe(true);
    });

    test('should calculate price statistics', async () => {
      const analysis = await service.analyzePrices();

      expect(analysis).toHaveProperty('statistics');
      expect(analysis.statistics).toHaveProperty('dailyAverage');
      expect(analysis.statistics).toHaveProperty('weeklyAverage');
      expect(analysis.statistics).toHaveProperty('volatility');
      expect(analysis.statistics).toHaveProperty('priceSpread');
      expect(analysis.statistics.priceSpread).toHaveProperty('min');
      expect(analysis.statistics.priceSpread).toHaveProperty('max');
      expect(analysis.statistics.priceSpread).toHaveProperty('range');
    });

    test('should cache analysis results', async () => {
      const analysis1 = await service.analyzePrices();
      const analysis2 = await service.analyzePrices();

      // Should return the same cached result
      expect(analysis1).toEqual(analysis2);
    });

    test('should throw error when Tibber is disabled', async () => {
      mockConfigService.getConfig.mockResolvedValue({ ...mockTibberConfig, enabled: false });
      service = new PriceIntegrationService(mockConfigService, mockLogger);
      await new Promise(resolve => setTimeout(resolve, 100));

      await expect(service.analyzePrices()).rejects.toThrow('Tibber integration not enabled');
    });
  });

  describe('Optimization Recommendations', () => {
    beforeEach(async () => {
      service = new PriceIntegrationService(mockConfigService, mockLogger);
      await new Promise(resolve => setTimeout(resolve, 100)); // Wait for initialization
    });

    test('should generate optimization recommendations', async () => {
      const recommendations = await service.getOptimizationRecommendations();

      expect(recommendations).toHaveProperty('timing');
      expect(recommendations).toHaveProperty('strategies');
      expect(recommendations).toHaveProperty('confidence');

      expect(recommendations.timing).toHaveProperty('optimal');
      expect(recommendations.timing).toHaveProperty('avoid');
      expect(Array.isArray(recommendations.timing.optimal)).toBe(true);
      expect(Array.isArray(recommendations.timing.avoid)).toBe(true);
    });

    test('should provide heating strategy recommendations', async () => {
      const recommendations = await service.getOptimizationRecommendations();

      expect(recommendations.strategies).toHaveProperty('heating');
      expect(recommendations.strategies.heating).toHaveProperty('action');
      expect(recommendations.strategies.heating).toHaveProperty('reasoning');
      expect(recommendations.strategies.heating).toHaveProperty('expectedSavings');
      expect(['increase', 'maintain', 'decrease']).toContain(recommendations.strategies.heating.action);
    });

    test('should provide hot water strategy recommendations', async () => {
      const recommendations = await service.getOptimizationRecommendations();

      expect(recommendations.strategies).toHaveProperty('hotWater');
      expect(recommendations.strategies.hotWater).toHaveProperty('action');
      expect(recommendations.strategies.hotWater).toHaveProperty('reasoning');
      expect(recommendations.strategies.hotWater).toHaveProperty('expectedSavings');
      expect(['preheat', 'maintain', 'delay']).toContain(recommendations.strategies.hotWater.action);
    });

    test('should respect user constraints', async () => {
      const input = {
        currentConsumption: 2.5,
        scheduledOperations: [],
        constraints: {
          comfortTemperature: 21,
          hotWaterRequirement: 50,
          maxDelayHours: 1
        }
      };

      const recommendations = await service.getOptimizationRecommendations(input);
      
      expect(recommendations).toBeDefined();
      expect(recommendations.confidence).toBeGreaterThan(0);
      expect(recommendations.confidence).toBeLessThanOrEqual(1);
    });

    test('should calculate confidence levels appropriately', async () => {
      const recommendations = await service.getOptimizationRecommendations();

      expect(recommendations.confidence).toBeGreaterThan(0);
      expect(recommendations.confidence).toBeLessThanOrEqual(1);
    });
  });

  describe('Configuration Management', () => {
    beforeEach(async () => {
      service = new PriceIntegrationService(mockConfigService, mockLogger);
      await new Promise(resolve => setTimeout(resolve, 100)); // Wait for initialization
    });

    test('should update configuration successfully', async () => {
      const newConfig = { enabled: false, apiKey: 'new-key' };
      
      await service.updateConfiguration(newConfig);

      expect(mockConfigService.updateConfig).toHaveBeenCalledWith('tibber', newConfig);
      expect(mockLogger.info).toHaveBeenLastCalledWith(
        'PriceIntegrationService: Price integration service reconfigured',
        { newConfig }
      );
    });

    test('should handle configuration update errors', async () => {
      mockConfigService.updateConfig.mockRejectedValue(new Error('Update failed'));
      
      await expect(service.updateConfiguration({ enabled: false })).rejects.toThrow();
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('Data Management', () => {
    beforeEach(async () => {
      service = new PriceIntegrationService(mockConfigService, mockLogger);
      await new Promise(resolve => setTimeout(resolve, 100)); // Wait for initialization
    });

    test('should force refresh price data', async () => {
      await service.forceRefresh();

      expect(mockLogger.info).toHaveBeenLastCalledWith(
        'PriceIntegrationService: Price data force refreshed',
        expect.objectContaining({
          historyLength: expect.any(Number)
        })
      );
    });

    test('should return price history', () => {
      const history = service.getPriceHistory();
      
      expect(Array.isArray(history)).toBe(true);
      // Should be a copy, not the original array
      expect(history).not.toBe((service as any).priceHistory);
    });

    test('should return cached analysis', async () => {
      // Generate analysis first
      await service.analyzePrices();
      
      const cachedAnalysis = service.getLastAnalysis();
      
      expect(cachedAnalysis).toBeDefined();
      expect(cachedAnalysis).toHaveProperty('current');
      expect(cachedAnalysis).toHaveProperty('trend');
      expect(cachedAnalysis).toHaveProperty('forecast');
      expect(cachedAnalysis).toHaveProperty('statistics');
    });

    test('should return service statistics', () => {
      const stats = service.getServiceStatistics();

      expect(stats).toHaveProperty('isEnabled');
      expect(stats).toHaveProperty('historyLength');
      expect(stats).toHaveProperty('lastUpdateTime');
      expect(stats).toHaveProperty('cacheAge');
      expect(stats).toHaveProperty('refreshInterval');
      expect(typeof stats.isEnabled).toBe('boolean');
      expect(typeof stats.historyLength).toBe('number');
      expect(typeof stats.cacheAge).toBe('number');
      expect(typeof stats.refreshInterval).toBe('number');
    });
  });

  describe('Error Handling', () => {
    test('should handle service initialization failures', async () => {
      mockConfigService.getConfig.mockRejectedValue(new Error('Service unavailable'));

      // Service construction should not throw, but async initialization will fail
      service = new PriceIntegrationService(mockConfigService, mockLogger);

      // Wait for async initialization and expect it to log an error
      await new Promise(resolve => setTimeout(resolve, 200));

      expect(mockLogger.error).toHaveBeenCalled();
    });

    test('should handle force refresh failures gracefully', async () => {
      service = new PriceIntegrationService(mockConfigService, mockLogger);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Mock a scenario that would cause refresh to fail
      const originalMethod = (service as any).updatePriceData;
      (service as any).updatePriceData = jest.fn().mockRejectedValue(new Error('API error'));

      await expect(service.forceRefresh()).rejects.toThrow();
      expect(mockLogger.error).toHaveBeenCalled();

      // Restore original method
      (service as any).updatePriceData = originalMethod;
    });
  });

  describe('Edge Cases', () => {
    beforeEach(async () => {
      service = new PriceIntegrationService(mockConfigService, mockLogger);
      await new Promise(resolve => setTimeout(resolve, 100)); // Wait for initialization
    });

    test('should handle empty price history gracefully', () => {
      // Clear price history
      (service as any).priceHistory = [];

      expect(() => service.getPriceHistory()).not.toThrow();
      expect(service.getPriceHistory()).toEqual([]);
    });

    test('should handle analysis with minimal data', async () => {
      // Set minimal price history
      (service as any).priceHistory = [{
        total: 1.0,
        energy: 0.8,
        tax: 0.2,
        startsAt: new Date().toISOString()
      }];

      const analysis = await service.analyzePrices();
      
      expect(analysis.trend.direction).toBe('stable');
      expect(analysis.trend.confidence).toBeLessThan(0.5);
    });

    test('should handle shutdown gracefully', async () => {
      await service.shutdown();

      expect(mockLogger.info).toHaveBeenCalledWith(
        'PriceIntegrationService: Price integration service shutdown completed',
        undefined
      );
    });
  });

  describe('Performance', () => {
    beforeEach(async () => {
      service = new PriceIntegrationService(mockConfigService, mockLogger);
      await new Promise(resolve => setTimeout(resolve, 100)); // Wait for initialization
    });

    test('should complete analysis within reasonable time', async () => {
      const startTime = Date.now();
      
      await service.analyzePrices();
      
      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
    });

    test('should maintain price history within limits', async () => {
      // Add many price entries
      const manyPrices = Array.from({ length: 200 }, (_, i) => ({
        total: 1.0 + (i % 10) * 0.1,
        energy: 0.8,
        tax: 0.2,
        startsAt: new Date(Date.now() - i * 60 * 60 * 1000).toISOString() // Hourly entries going back
      }));

      (service as any).priceHistory = manyPrices;
      (service as any).maintainHistorySize();

      const historyLength = service.getPriceHistory().length;
      expect(historyLength).toBeLessThanOrEqual(168); // Should not exceed 7 days (168 hours)
    });
  });
});
