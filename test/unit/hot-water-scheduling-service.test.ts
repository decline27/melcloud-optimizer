import { HotWaterSchedulingService, HotWaterOptimizationInput, HotWaterUsagePattern } from '../../src/services/hot-water-scheduling-service';
import { ConfigurationService } from '../../src/services/configuration-service';
import { COPCalculationService } from '../../src/services/cop-calculation-service';
import { HomeyLogger } from '../../src/util/logger';

// Mock dependencies
const mockConfigService = {
  getConfig: jest.fn()
} as unknown as ConfigurationService;

const mockCOPService = {
  calculateCOP: jest.fn()
} as unknown as COPCalculationService;

const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
} as unknown as HomeyLogger;

describe('HotWaterSchedulingService', () => {
  let service: HotWaterSchedulingService;

  const mockHotWaterConfig = {
    scheduling: {
      enabled: true,
      smartMode: true,
      minTemperature: 40,
      maxTemperature: 65
    },
    usage: {
      learnPattern: true,
      defaultPeaks: ['07:00', '19:00'],
      efficiency: 0.85
    }
  };

  beforeEach(() => {
    jest.clearAllMocks();
    
    (mockConfigService.getConfig as jest.Mock).mockResolvedValue(mockHotWaterConfig);
    (mockCOPService.calculateCOP as jest.Mock).mockResolvedValue({ 
      cop: 3.5, 
      efficiency: 0.85,
      confidence: 0.9 
    });

    service = new HotWaterSchedulingService(mockConfigService, mockCOPService, mockLogger);
  });

  describe('Initialization', () => {
    it('should initialize with default usage pattern', async () => {
      const input: HotWaterOptimizationInput = {
        currentTemp: 50,
        currentPrice: 100,
        futureHourPrices: new Array(24).fill(100),
        seasonalMode: 'winter'
      };

      const result = await service.optimizeHotWaterSchedule(input);

      expect(result.usagePattern.peakHours).toEqual(['07:00', '19:00']);
      expect(result.usagePattern.averageDaily).toBe(200);
      expect(result.usagePattern.efficiency).toBe(0.85);
    });

    it('should handle initialization errors', async () => {
      (mockConfigService.getConfig as jest.Mock).mockRejectedValue(new Error('Config error'));
      
      const service2 = new HotWaterSchedulingService(mockConfigService, mockCOPService, mockLogger);
      
      const input: HotWaterOptimizationInput = {
        currentTemp: 50,
        currentPrice: 100,
        futureHourPrices: new Array(24).fill(100),
        seasonalMode: 'winter'
      };

      await expect(service2.optimizeHotWaterSchedule(input)).rejects.toThrow();
    });
  });

  describe('Schedule Optimization', () => {
    it('should create optimized schedule with immediate action', async () => {
      const input: HotWaterOptimizationInput = {
        currentTemp: 35, // Below minimum
        currentPrice: 80,
        futureHourPrices: new Array(24).fill(100),
        seasonalMode: 'winter'
      };

      const result = await service.optimizeHotWaterSchedule(input);

      expect(result.schedule.immediate.action).toBe('heat');
      expect(result.schedule.immediate.targetTemp).toBeGreaterThan(40);
      expect(result.schedule.hourly).toHaveLength(24);
      expect(result.schedule.daily.totalEnergy).toBeGreaterThan(0);
    });

    it('should optimize for cheap electricity periods', async () => {
      const cheapPrices = new Array(24).fill(100);
      cheapPrices[2] = 30; // Very cheap at 2 AM
      cheapPrices[3] = 40; // Cheap at 3 AM

      const input: HotWaterOptimizationInput = {
        currentTemp: 50,
        currentPrice: 100,
        futureHourPrices: cheapPrices,
        seasonalMode: 'winter'
      };

      const result = await service.optimizeHotWaterSchedule(input);

      // Should find preheating opportunities during cheap periods
      const preheatingHours = result.schedule.hourly.filter(h => h.action === 'preheat');
      expect(preheatingHours.length).toBeGreaterThan(0);
    });

    it('should plan around peak usage hours', async () => {
      const input: HotWaterOptimizationInput = {
        currentTemp: 50,
        currentPrice: 100,
        futureHourPrices: new Array(24).fill(100),
        seasonalMode: 'winter'
      };

      const result = await service.optimizeHotWaterSchedule(input);

      // Check that peak hours (7:00 and 19:00) have appropriate scheduling
      const hour7 = result.schedule.hourly.find(h => h.hour === 7);
      const hour19 = result.schedule.hourly.find(h => h.hour === 19);

      expect(hour7?.priority).toBeGreaterThanOrEqual(8);
      expect(hour19?.priority).toBeGreaterThanOrEqual(8);
    });

    it('should handle high temperature correctly', async () => {
      const input: HotWaterOptimizationInput = {
        currentTemp: 70, // Above maximum
        currentPrice: 100,
        futureHourPrices: new Array(24).fill(100),
        seasonalMode: 'summer'
      };

      const result = await service.optimizeHotWaterSchedule(input);

      expect(result.schedule.immediate.action).toBe('off');
    });
  });

  describe('Usage Pattern Learning', () => {
    it('should learn from usage history', async () => {
      const usageHistory = [
        { timestamp: '2025-08-19T06:00:00Z', amount: 50 },
        { timestamp: '2025-08-19T06:30:00Z', amount: 30 },
        { timestamp: '2025-08-19T07:00:00Z', amount: 80 },
        { timestamp: '2025-08-19T18:00:00Z', amount: 60 },
        { timestamp: '2025-08-19T19:00:00Z', amount: 90 }
      ];

      const input: HotWaterOptimizationInput = {
        currentTemp: 50,
        currentPrice: 100,
        futureHourPrices: new Array(24).fill(100),
        seasonalMode: 'winter',
        usageHistory
      };

      const result = await service.optimizeHotWaterSchedule(input);

      expect(result.usagePattern.userLearningData.length).toBe(24);
      
      // Should identify hours with actual usage data
      const hour6Data = result.usagePattern.userLearningData.find(d => d.hour === 6);
      const hour7Data = result.usagePattern.userLearningData.find(d => d.hour === 7);
      const hour18Data = result.usagePattern.userLearningData.find(d => d.hour === 18);
      const hour19Data = result.usagePattern.userLearningData.find(d => d.hour === 19);
      
      // Only hours with data should have usage > 0
      expect(hour6Data?.usage).toBeGreaterThan(0);
      expect(hour7Data?.usage).toBeGreaterThan(0);
      expect(hour18Data?.usage).toBeGreaterThan(0);
      expect(hour19Data?.usage).toBeGreaterThan(0);
      
      // Total daily should equal sum of all usage
      const expectedDaily = usageHistory.reduce((sum, entry) => sum + entry.amount, 0);
      expect(result.usagePattern.averageDaily).toBe(expectedDaily);
    });

    it('should process usage history and update learning data', async () => {
      // Simple test to verify learning algorithm processes data
      const usageHistory = [
        { timestamp: '2025-08-19T22:00:00.000Z', amount: 100 },
        { timestamp: '2025-08-19T22:15:00.000Z', amount: 150 },
        { timestamp: '2025-08-19T08:00:00.000Z', amount: 50 }
      ];

      const input: HotWaterOptimizationInput = {
        currentTemp: 50,
        currentPrice: 100,
        futureHourPrices: new Array(24).fill(100),
        seasonalMode: 'winter',
        usageHistory
      };

      const result = await service.optimizeHotWaterSchedule(input);

      // Verify that learning data array is populated
      expect(result.usagePattern.userLearningData).toHaveLength(24);
      
      // Verify some hours have confidence > 0 (indicating data was processed)
      const hoursWithData = result.usagePattern.userLearningData.filter(d => d.confidence > 0);
      expect(hoursWithData.length).toBeGreaterThan(0);
      
      // Verify total daily usage is sum of all entries
      expect(result.usagePattern.averageDaily).toBe(300); // 100 + 150 + 50
    });
  });

  describe('Savings Calculations', () => {
    it('should calculate projected savings', async () => {
      const input: HotWaterOptimizationInput = {
        currentTemp: 50,
        currentPrice: 120, // High price
        futureHourPrices: new Array(24).fill(80), // Lower future prices
        seasonalMode: 'winter'
      };

      const result = await service.optimizeHotWaterSchedule(input);

      expect(result.projectedSavings.hourly).toBeGreaterThanOrEqual(0);
      expect(result.projectedSavings.daily).toBeGreaterThanOrEqual(0);
      expect(result.projectedSavings.weekly).toBeGreaterThanOrEqual(0);
      expect(result.projectedSavings.confidence).toBeGreaterThan(0);
      expect(result.projectedSavings.confidence).toBeLessThanOrEqual(1);
    });

    it('should have higher confidence with learning data', async () => {
      const usageHistory = Array.from({ length: 200 }, (_, i) => ({
        timestamp: new Date(2025, 7, Math.floor(i / 24), i % 24).toISOString(),
        amount: 50 + Math.random() * 50
      }));

      const input: HotWaterOptimizationInput = {
        currentTemp: 50,
        currentPrice: 100,
        futureHourPrices: new Array(24).fill(100),
        seasonalMode: 'winter',
        usageHistory
      };

      const result = await service.optimizeHotWaterSchedule(input);

      expect(result.projectedSavings.confidence).toBeGreaterThan(0.5);
    });
  });

  describe('Recommendations', () => {
    it('should generate appropriate recommendations', async () => {
      const input: HotWaterOptimizationInput = {
        currentTemp: 75, // Too high
        currentPrice: 50,
        futureHourPrices: new Array(6).fill(30).concat(new Array(18).fill(100)), // 6 cheap hours at start
        seasonalMode: 'winter',
        outdoorTemp: -5 // Cold weather
      };

      const result = await service.optimizeHotWaterSchedule(input);

      expect(result.recommendations.length).toBeGreaterThan(0);
      expect(result.recommendations.some(r => r.includes('temperature'))).toBe(true);
      expect(result.recommendations.some(r => r.includes('cheap electricity'))).toBe(true);
      expect(result.recommendations.some(r => r.includes('Cold weather'))).toBe(true);
    });

    it('should recommend smart mode when disabled', async () => {
      (mockConfigService.getConfig as jest.Mock).mockResolvedValue({
        ...mockHotWaterConfig,
        scheduling: {
          ...mockHotWaterConfig.scheduling,
          smartMode: false
        }
      });

      const service2 = new HotWaterSchedulingService(mockConfigService, mockCOPService, mockLogger);

      const input: HotWaterOptimizationInput = {
        currentTemp: 50,
        currentPrice: 100,
        futureHourPrices: new Array(24).fill(100),
        seasonalMode: 'winter'
      };

      const result = await service2.optimizeHotWaterSchedule(input);

      expect(result.recommendations.some(r => r.includes('smart mode'))).toBe(true);
    });
  });

  describe('Utility Methods', () => {
    it('should provide usage pattern access', async () => {
      const input: HotWaterOptimizationInput = {
        currentTemp: 50,
        currentPrice: 100,
        futureHourPrices: new Array(24).fill(100),
        seasonalMode: 'winter'
      };

      await service.optimizeHotWaterSchedule(input);
      const pattern = service.getUsagePattern();

      expect(pattern.peakHours).toEqual(['07:00', '19:00']);
      expect(pattern.averageDaily).toBe(200);
    });

    it('should maintain schedule history', async () => {
      const input: HotWaterOptimizationInput = {
        currentTemp: 50,
        currentPrice: 100,
        futureHourPrices: new Array(24).fill(100),
        seasonalMode: 'winter'
      };

      await service.optimizeHotWaterSchedule(input);
      await service.optimizeHotWaterSchedule(input);
      
      const history = service.getScheduleHistory();
      expect(history.length).toBe(2);
    });

    it('should allow manual usage pattern updates', async () => {
      const input: HotWaterOptimizationInput = {
        currentTemp: 50,
        currentPrice: 100,
        futureHourPrices: new Array(24).fill(100),
        seasonalMode: 'winter'
      };

      await service.optimizeHotWaterSchedule(input);

      service.updateUsagePattern({ averageDaily: 300 });
      const pattern = service.getUsagePattern();

      expect(pattern.averageDaily).toBe(300);
    });

    it('should reset learning data', async () => {
      const input: HotWaterOptimizationInput = {
        currentTemp: 50,
        currentPrice: 100,
        futureHourPrices: new Array(24).fill(100),
        seasonalMode: 'winter',
        usageHistory: [
          { timestamp: '2025-08-19T07:00:00Z', amount: 80 }
        ]
      };

      await service.optimizeHotWaterSchedule(input);
      
      // Should have learning data
      expect(service.getUsagePattern().userLearningData.length).toBeGreaterThan(0);

      service.resetLearningData();
      
      const pattern = service.getUsagePattern();
      expect(pattern.userLearningData.length).toBe(0);
      expect(pattern.peakHours).toEqual(['07:00', '19:00']);
    });

    it('should limit schedule history to one week', async () => {
      const input: HotWaterOptimizationInput = {
        currentTemp: 50,
        currentPrice: 100,
        futureHourPrices: new Array(24).fill(100),
        seasonalMode: 'winter'
      };

      // Add more than 168 schedules (one week of hourly schedules)
      for (let i = 0; i < 170; i++) {
        await service.optimizeHotWaterSchedule(input);
      }

      const history = service.getScheduleHistory();
      expect(history.length).toBe(168); // Should not exceed one week
    });
  });

  describe('COP Integration', () => {
    it('should use COP calculations in optimization', async () => {
      (mockCOPService.calculateCOP as jest.Mock).mockResolvedValue({ 
        cop: 5.0, // High COP
        efficiency: 0.95,
        confidence: 0.9 
      });

      const input: HotWaterOptimizationInput = {
        currentTemp: 50,
        currentPrice: 100,
        futureHourPrices: new Array(24).fill(100),
        seasonalMode: 'winter',
        outdoorTemp: 15
      };

      const result = await service.optimizeHotWaterSchedule(input);

      expect(mockCOPService.calculateCOP).toHaveBeenCalledWith({
        temperature: 50,
        outdoorTemp: 15,
        operationMode: 'hotwater',
        seasonalMode: 'winter'
      });

      // With high COP, should have lower energy consumption
      expect(result.schedule.daily.totalEnergy).toBeLessThan(50); // Reasonable for high COP
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty future prices array', async () => {
      const input: HotWaterOptimizationInput = {
        currentTemp: 50,
        currentPrice: 100,
        futureHourPrices: [],
        seasonalMode: 'winter'
      };

      const result = await service.optimizeHotWaterSchedule(input);

      expect(result.schedule.hourly).toHaveLength(24);
      expect(result.schedule.immediate.action).toBeDefined();
    });

    it('should handle missing outdoor temperature', async () => {
      const input: HotWaterOptimizationInput = {
        currentTemp: 50,
        currentPrice: 100,
        futureHourPrices: new Array(24).fill(100),
        seasonalMode: 'winter'
        // outdoorTemp not provided
      };

      const result = await service.optimizeHotWaterSchedule(input);

      expect(result.schedule).toBeDefined();
      expect(mockCOPService.calculateCOP).toHaveBeenCalledWith({
        temperature: 50,
        outdoorTemp: undefined,
        operationMode: 'hotwater',
        seasonalMode: 'winter'
      });
    });

    it('should handle extreme price variations', async () => {
      const extremePrices = new Array(24).fill(100); // Base price 100
      extremePrices[0] = 1000; // Extremely expensive at future hour 0 (maps to priceData[1])
      extremePrices[11] = 1; // Extremely cheap at future hour 11 (maps to priceData[12])

      const input: HotWaterOptimizationInput = {
        currentTemp: 50,
        currentPrice: 100,
        futureHourPrices: extremePrices,
        seasonalMode: 'winter'
      };

      const result = await service.optimizeHotWaterSchedule(input);

      // Should minimize heating during expensive period and maximize during cheap
      const currentHour = new Date().getHours();
      const expensiveHour = result.schedule.hourly.find(h => h.hour === (currentHour + 1) % 24);
      const cheapHour = result.schedule.hourly.find(h => h.hour === (currentHour + 12) % 24);

      expect(expensiveHour?.action).toBe('off');
      expect(cheapHour?.action).toBe('preheat');
    });
  });
});
