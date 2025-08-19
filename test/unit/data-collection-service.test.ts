import { DataCollectionService, DataPoint, MemoryMetrics, PerformanceMetrics } from '../../src/services/data-collection-service';
import { ConfigurationService } from '../../src/services/configuration-service';
import { HomeyLogger } from '../../src/util/logger';

// Mock HomeyLogger
jest.mock('../../src/util/logger');

// Mock ConfigurationService
jest.mock('../../src/services/configuration-service');

describe('DataCollectionService', () => {
  let dataCollectionService: DataCollectionService;
  let mockConfigService: jest.Mocked<ConfigurationService>;
  let mockLogger: jest.Mocked<HomeyLogger>;

  const mockDataCollectionConfig = {
    enabled: true,
    collectionInterval: 15,
    memoryMonitoring: {
      enabled: true,
      warningThreshold: 100,
      criticalThreshold: 200,
      interval: 60
    },
    dataRetention: {
      maxDataPoints: 10000,
      maxAge: 7,
      cleanupInterval: 4
    },
    analytics: {
      enabled: true,
      aggregationInterval: 1,
      historicalDataPoints: 1000
    },
    performance: {
      trackDeviceCommands: true,
      trackOptimizations: true,
      trackErrors: true,
      maxHistoryEntries: 500
    }
  };

  beforeAll(() => {
    jest.useFakeTimers();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create mock instances
    mockLogger = new HomeyLogger({} as any, {}) as jest.Mocked<HomeyLogger>;
    mockConfigService = new ConfigurationService({} as any, mockLogger) as jest.Mocked<ConfigurationService>;

    // Setup default mocks
    mockLogger.info = jest.fn();
    mockLogger.debug = jest.fn();
    mockLogger.error = jest.fn();
    mockLogger.warn = jest.fn();

    mockConfigService.getDataCollectionConfig = jest.fn().mockResolvedValue(mockDataCollectionConfig);
    mockConfigService.updateDataCollectionConfig = jest.fn().mockResolvedValue(undefined);

    // Create service instance
    dataCollectionService = new DataCollectionService(mockConfigService, mockLogger);
  });

  afterEach(async () => {
    // Clean up any running intervals
    try {
      await dataCollectionService.stop();
      await dataCollectionService.shutdown();
      // Clear any intervals from circuit breaker
      const circuitBreaker = (dataCollectionService as any).circuitBreaker;
      if (circuitBreaker && circuitBreaker.shutdown) {
        circuitBreaker.shutdown();
      }
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  afterAll(() => {
    // Clear all timers that might be hanging around
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe('Service Creation', () => {
    test('should create service instance successfully', () => {
      expect(dataCollectionService).toBeInstanceOf(DataCollectionService);
      expect(mockLogger.info).toHaveBeenCalledWith('Data Collection Service initialized');
    });

    test('should initialize with empty data structures', () => {
      const stats = dataCollectionService.getCollectionStatistics();
      expect(stats.totalDataPoints).toBe(0);
      expect(stats.dataPointsByType).toEqual({});
      expect(stats.estimatedMemoryUsage).toBe(0);
    });
  });

  describe('Configuration Management', () => {
    test('should load configuration successfully', async () => {
      await dataCollectionService.start();
      expect(mockConfigService.getDataCollectionConfig).toHaveBeenCalled();
    });

    test('should handle configuration load failure gracefully', async () => {
      mockConfigService.getDataCollectionConfig.mockRejectedValue(new Error('Config load failed'));
      
      // Should not throw, should use defaults
      await dataCollectionService.start();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Failed to get data collection configuration, using defaults',
        expect.any(Error)
      );
    });

    test('should reconfigure service successfully', async () => {
      const newConfig = { enabled: false, collectionInterval: 30 };
      
      await dataCollectionService.reconfigureDataCollection(newConfig);
      
      expect(mockConfigService.updateDataCollectionConfig).toHaveBeenCalledWith(newConfig);
      expect(mockLogger.info).toHaveBeenCalledWith('Data Collection Service reconfigured successfully');
    });
  });

  describe('Service Lifecycle', () => {
    test('should start service when enabled', async () => {
      await dataCollectionService.start();
      
      expect(mockLogger.info).toHaveBeenCalledWith('Starting Data Collection Service');
      expect(mockLogger.info).toHaveBeenCalledWith('Data Collection Service started successfully');
    });

    test('should not start monitoring when disabled', async () => {
      mockConfigService.getDataCollectionConfig.mockResolvedValue({
        ...mockDataCollectionConfig,
        enabled: false
      });

      await dataCollectionService.start();
      
      expect(mockLogger.info).toHaveBeenCalledWith('Data Collection Service disabled in configuration');
    });

    test('should stop service gracefully', async () => {
      await dataCollectionService.start();
      await dataCollectionService.stop();
      
      expect(mockLogger.info).toHaveBeenCalledWith('Stopping Data Collection Service');
      expect(mockLogger.info).toHaveBeenCalledWith('Data Collection Service stopped');
    });

    test('should shutdown service and cleanup resources', async () => {
      await dataCollectionService.start();
      await dataCollectionService.shutdown();
      
      expect(mockLogger.info).toHaveBeenCalledWith('Shutting down Data Collection Service');
      expect(mockLogger.info).toHaveBeenCalledWith('Data Collection Service shutdown complete');
    });
  });

  describe('Device Data Collection', () => {
    const deviceId = 'test-device-123';
    const deviceData = {
      temperature: 22.5,
      power: true,
      operationMode: 1,
      timestamp: new Date().toISOString()
    };

    test('should collect device data successfully', async () => {
      const dataPoint = await dataCollectionService.collectDeviceData(deviceId, deviceData);
      
      expect(dataPoint).toBeDefined();
      expect(dataPoint.type).toBe('device');
      expect(dataPoint.source).toBe(deviceId);
      expect(dataPoint.category).toBe('device_state');
      expect(dataPoint.data).toEqual(expect.objectContaining(deviceData));
      expect(dataPoint.metadata?.quality).toBeGreaterThan(0);
      expect(dataPoint.metadata?.confidence).toBeGreaterThan(0);
    });

    test('should store collected data points', async () => {
      await dataCollectionService.collectDeviceData(deviceId, deviceData);
      
      const stats = dataCollectionService.getCollectionStatistics();
      expect(stats.totalDataPoints).toBe(1);
      expect(stats.dataPointsByType.device).toBe(1);
    });

    test('should update collection history on success', async () => {
      await dataCollectionService.collectDeviceData(deviceId, deviceData);
      
      const history = dataCollectionService.getCollectionHistory();
      expect(history.collections).toHaveLength(1);
      expect(history.collections[0].success).toBe(true);
      expect(history.collections[0].type).toBe('device');
      expect(history.statistics.totalCollections).toBe(1);
      expect(history.statistics.successRate).toBe(100);
    });
  });

  describe('Memory Metrics Collection', () => {
    test('should collect memory metrics successfully', async () => {
      const metrics = await dataCollectionService.collectMemoryMetrics();
      
      expect(metrics).toBeDefined();
      expect(metrics.timestamp).toBeDefined();
      expect(metrics.process).toBeDefined();
      expect(metrics.process.rss).toBeGreaterThan(0);
      expect(metrics.process.heapUsed).toBeGreaterThan(0);
      expect(metrics.services).toBeDefined();
      expect(metrics.systemHealth).toBeDefined();
      expect(['healthy', 'warning', 'critical']).toContain(metrics.systemHealth.status);
    });

    test('should store memory metrics as data points', async () => {
      await dataCollectionService.collectMemoryMetrics();
      
      const stats = dataCollectionService.getCollectionStatistics();
      expect(stats.totalDataPoints).toBe(1);
      expect(stats.dataPointsByType.memory).toBe(1);
    });

    test('should analyze system health correctly', async () => {
      const metrics = await dataCollectionService.collectMemoryMetrics();
      
      expect(metrics.systemHealth.status).toBeDefined();
      expect(Array.isArray(metrics.systemHealth.issues)).toBe(true);
      expect(Array.isArray(metrics.systemHealth.recommendations)).toBe(true);
    });
  });

  describe('Performance Metrics Collection', () => {
    test('should collect performance metrics successfully', async () => {
      const metrics = await dataCollectionService.collectPerformanceMetrics();
      
      expect(metrics).toBeDefined();
      expect(metrics.timestamp).toBeDefined();
      expect(metrics.deviceCommands).toBeDefined();
      expect(metrics.optimizations).toBeDefined();
      expect(metrics.services).toBeDefined();
      
      expect(typeof metrics.deviceCommands.total).toBe('number');
      expect(typeof metrics.deviceCommands.successful).toBe('number');
      expect(typeof metrics.deviceCommands.failed).toBe('number');
      expect(typeof metrics.optimizations.total).toBe('number');
    });

    test('should store performance metrics as data points', async () => {
      await dataCollectionService.collectPerformanceMetrics();
      
      const stats = dataCollectionService.getCollectionStatistics();
      expect(stats.totalDataPoints).toBe(1);
      expect(stats.dataPointsByType.performance).toBe(1);
    });
  });

  describe('Data Cleanup', () => {
    beforeEach(async () => {
      // Add some test data points
      for (let i = 0; i < 5; i++) {
        await dataCollectionService.collectDeviceData(`device-${i}`, {
          temperature: 20 + i,
          timestamp: new Date(Date.now() - i * 60000).toISOString()
        });
      }
    });

    test('should run data cleanup successfully', async () => {
      const result = await dataCollectionService.runDataCleanup();
      
      expect(result.success).toBe(true);
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.timestamp).toBeDefined();
      expect(typeof result.cleaned.dataPoints).toBe('number');
      expect(typeof result.remaining.dataPoints).toBe('number');
    });

    test('should clean old data points based on age', async () => {
      // Mock a very old data point
      const oldTimestamp = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(); // 10 days ago
      await dataCollectionService.collectDeviceData('old-device', {
        temperature: 15,
        timestamp: oldTimestamp
      });

      const beforeStats = dataCollectionService.getCollectionStatistics();
      const result = await dataCollectionService.runDataCleanup();
      const afterStats = dataCollectionService.getCollectionStatistics();

      expect(result.success).toBe(true);
      expect(afterStats.totalDataPoints).toBeLessThanOrEqual(beforeStats.totalDataPoints);
    });

    test('should force cleanup when requested', async () => {
      const beforeStats = dataCollectionService.getCollectionStatistics();
      const result = await dataCollectionService.runDataCleanup(true);
      const afterStats = dataCollectionService.getCollectionStatistics();

      expect(result.success).toBe(true);
      // Force cleanup should reduce data points significantly
      expect(afterStats.totalDataPoints).toBeLessThan(beforeStats.totalDataPoints);
    });
  });

  describe('Analytics Data Generation', () => {
    beforeEach(async () => {
      // Add some test optimization data
      const optimizationData = {
        success: true,
        savings: 15.5,
        energySaved: 2.3,
        costSaved: 0.45,
        strategy: 'preheat'
      };
      
      // Manually add optimization data point
      const dataPoint: DataPoint = {
        id: 'opt_test_' + Date.now(),
        timestamp: new Date().toISOString(),
        type: 'optimization',
        source: 'thermal-optimizer',
        category: 'optimization_result',
        data: optimizationData,
        metadata: {
          quality: 1.0,
          confidence: 0.95,
          tags: ['optimization', 'thermal']
        }
      };
      
      // Access private dataPoints for testing
      (dataCollectionService as any).dataPoints.set(dataPoint.id, dataPoint);
    });

    test('should generate analytics data successfully', async () => {
      const analytics = await dataCollectionService.getAnalyticsData();
      
      expect(analytics).toBeDefined();
      expect(analytics.period).toBeDefined();
      expect(analytics.period.start).toBeDefined();
      expect(analytics.period.end).toBeDefined();
      expect(analytics.devices).toBeDefined();
      expect(analytics.optimizations).toBeDefined();
      expect(analytics.systemHealth).toBeDefined();
    });

    test('should filter data by time period', async () => {
      const endTime = new Date().toISOString();
      const startTime = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1 hour ago
      
      const analytics = await dataCollectionService.getAnalyticsData(startTime, endTime);
      
      expect(analytics.period.start).toBe(startTime);
      expect(analytics.period.end).toBe(endTime);
      expect(analytics.period.duration).toBe(1); // 1 hour
    });

    test('should aggregate optimization data correctly', async () => {
      const analytics = await dataCollectionService.getAnalyticsData();
      
      expect(analytics.optimizations.totalSavings).toBeGreaterThan(0);
      expect(analytics.optimizations.strategies).toBeDefined();
      expect(analytics.optimizations.strategies.preheat).toBeDefined();
    });
  });

  describe('Collection Statistics', () => {
    test('should return accurate collection statistics', async () => {
      // Add some test data
      await dataCollectionService.collectDeviceData('device1', { temp: 20 });
      await dataCollectionService.collectMemoryMetrics();
      
      const stats = dataCollectionService.getCollectionStatistics();
      
      expect(stats.totalDataPoints).toBe(2);
      expect(stats.dataPointsByType.device).toBe(1);
      expect(stats.dataPointsByType.memory).toBe(1);
      expect(stats.estimatedMemoryUsage).toBeGreaterThan(0);
      expect(stats.newestDataPoint).toBeDefined();
      expect(stats.oldestDataPoint).toBeDefined();
    });

    test('should track collection history correctly', async () => {
      await dataCollectionService.collectDeviceData('device1', { temp: 20 });
      
      const history = dataCollectionService.getCollectionHistory();
      
      expect(history.statistics.totalCollections).toBe(1);
      expect(history.statistics.successRate).toBe(100);
      expect(history.statistics.averageDuration).toBeGreaterThanOrEqual(0);
      expect(history.statistics.lastSuccessful).toBeDefined();
    });
  });

  describe('Forced Data Collection', () => {
    test('should perform forced collection successfully', async () => {
      const result = await dataCollectionService.forceDataCollection();
      
      expect(result.success).toBe(true);
      expect(result.collected).toHaveLength(2); // memory + performance
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.timestamp).toBeDefined();
      
      const memoryCollection = result.collected.find(c => c.type === 'memory');
      const performanceCollection = result.collected.find(c => c.type === 'performance');
      
      expect(memoryCollection).toBeDefined();
      expect(performanceCollection).toBeDefined();
      expect(memoryCollection!.count).toBe(1);
      expect(performanceCollection!.count).toBe(1);
    });

    test('should update data points after forced collection', async () => {
      const beforeStats = dataCollectionService.getCollectionStatistics();
      await dataCollectionService.forceDataCollection();
      const afterStats = dataCollectionService.getCollectionStatistics();
      
      expect(afterStats.totalDataPoints).toBeGreaterThan(beforeStats.totalDataPoints);
      expect(afterStats.dataPointsByType.memory).toBe(1);
      expect(afterStats.dataPointsByType.performance).toBe(1);
    });
  });

  describe('Error Handling', () => {
    test('should handle service start errors gracefully', async () => {
      mockConfigService.getDataCollectionConfig.mockRejectedValue(new Error('Config error'));
      
      // Service should start with defaults when config fails, not throw
      await dataCollectionService.start();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Failed to get data collection configuration, using defaults',
        expect.any(Error)
      );
    });

    test('should handle reconfiguration errors gracefully', async () => {
      mockConfigService.updateDataCollectionConfig.mockRejectedValue(new Error('Update failed'));
      
      await expect(dataCollectionService.reconfigureDataCollection({})).rejects.toThrow('Update failed');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to reconfigure Data Collection Service',
        expect.any(Error)
      );
    });

    test('should handle shutdown errors gracefully', async () => {
      // Mock an error during shutdown
      const originalStop = dataCollectionService.stop;
      dataCollectionService.stop = jest.fn().mockRejectedValue(new Error('Stop failed'));
      
      await expect(dataCollectionService.shutdown()).rejects.toThrow('Stop failed');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error during Data Collection Service shutdown',
        expect.any(Error)
      );
      
      // Restore original method
      dataCollectionService.stop = originalStop;
    });
  });
});
