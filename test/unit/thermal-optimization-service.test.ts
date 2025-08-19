import { ThermalOptimizationService } from '../../src/services/thermal-optimization-service';
import { ConfigurationService } from '../../src/services/configuration-service';
import { COPCalculationService } from '../../src/services/cop-calculation-service';

// Mock dependencies
jest.mock('../../src/services/configuration-service');
jest.mock('../../src/services/cop-calculation-service');

// Mock homey
const mockHomey = {
  log: jest.fn(),
  error: jest.fn()
};

// Mock logger
const mockLogger = {
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
};

describe('ThermalOptimizationService', () => {
  let service: ThermalOptimizationService;
  let mockConfigService: jest.Mocked<ConfigurationService>;
  let mockCopService: jest.Mocked<COPCalculationService>;

  beforeEach(() => {
    // Create proper mocks
    mockConfigService = {
      getConfig: jest.fn(),
      updateConfig: jest.fn(),
      validateConfig: jest.fn(),
      configCache: new Map(),
      cacheTimeout: 300000,
      lastCacheUpdate: new Date(),
      clearCache: jest.fn(),
      getValidationSchema: jest.fn(),
      validateConfigSection: jest.fn(),
      getOptimizationConfig: jest.fn(),
      getMelCloudConfig: jest.fn(),
      getTibberConfig: jest.fn(),
      getThermalConfig: jest.fn(),
      getHotWaterConfig: jest.fn(),
      updateThermalConfig: jest.fn(),
      updateOptimizationConfig: jest.fn()
    } as any;
    
    mockCopService = {
      calculateCOP: jest.fn(),
      normalizeCOP: jest.fn(),
      getHistoricalCOPData: jest.fn(),
      reconfigureCOP: jest.fn(),
      applyCOPCorrection: jest.fn(),
      calculateSeasonalAdjustment: jest.fn(),
      validateCOPData: jest.fn(),
      triggerCOPCalculation: jest.fn()
    } as any;
    
    // Mock thermal config
    mockConfigService.getConfig.mockImplementation((type: string) => {
      if (type === 'thermal') {
        return Promise.resolve({
          strategy: 'adaptive',
          thermalMass: {
            capacity: 1000,
            conductance: 0.5,
            timeConstant: 2.0
          }
        });
      }
      if (type === 'optimization') {
        return Promise.resolve({
          enabled: true,
          strategy: 'balanced'
        });
      }
      return Promise.resolve({});
    });

    // Mock COP calculation  
    mockCopService.calculateCOP.mockResolvedValue({
      normalizedCOP: 3.5,
      confidence: 0.9,
      factors: {
        temperature: 1.0,
        seasonal: 1.0,
        weather: 1.0
      }
    });

    service = new ThermalOptimizationService(
      mockHomey,
      mockConfigService,
      mockCopService,
      mockLogger
    );
  });

  describe('optimizeThermalStrategy', () => {
    it('should return a thermal optimization result', async () => {
      const result = await service.optimizeThermalStrategy({
        currentTemp: 20,
        targetTemp: 21,
        outdoorTemp: -5,
        currentPrice: 50,
        futureHourPrices: [80, 90, 100, 110, 120],
        operationMode: 'heating',
        timeOfDay: new Date().toISOString()
      });

      expect(result).toHaveProperty('strategy');
      expect(result).toHaveProperty('thermalMassState');
      expect(result).toHaveProperty('projectedSavings');
      expect(result.strategy).toHaveProperty('action');
      expect(result.strategy).toHaveProperty('targetTemperature');
      expect(result.strategy).toHaveProperty('confidence');
    });

    it('should handle normal operation mode', async () => {
      const result = await service.optimizeThermalStrategy({
        currentTemp: 21,
        targetTemp: 21,
        outdoorTemp: 15,
        currentPrice: 90,
        futureHourPrices: [85, 90, 95, 90, 85],
        operationMode: 'heating',
        timeOfDay: new Date().toISOString()
      });

      expect(result.strategy.action).toBeDefined();
      expect(result.strategy.targetTemperature).toBeDefined();
      expect(result.strategy.confidence).toBeGreaterThan(0);
    });
  });

  describe('Error handling', () => {
    it('should handle configuration errors gracefully', async () => {
      mockConfigService.getConfig.mockRejectedValueOnce(new Error('Config error'));
      
      // Should not throw but handle gracefully
      const result = await service.optimizeThermalStrategy({
        currentTemp: 20,
        targetTemp: 21,
        outdoorTemp: 10,
        currentPrice: 80,
        futureHourPrices: [75, 80, 85],
        operationMode: 'heating',
        timeOfDay: new Date().toISOString()
      });

      expect(result).toBeDefined();
    });

    it('should handle invalid temperature inputs', async () => {
      await expect(service.optimizeThermalStrategy({
        currentTemp: NaN,
        targetTemp: 21,
        outdoorTemp: 10,
        currentPrice: 80,
        futureHourPrices: [75, 80, 85],
        operationMode: 'heating',
        timeOfDay: new Date().toISOString()
      })).rejects.toThrow();
    });
  });
});
