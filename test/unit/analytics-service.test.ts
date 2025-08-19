/**
 * Analytics Service Tests
 * 
 * Comprehensive test suite for the Analytics Service covering all major functionality
 * including report generation, insights, recommendations, forecasting, and anomaly detection.
 */

import { AnalyticsService } from '../../src/services/analytics-service';
import { ConfigurationService } from '../../src/services/configuration-service';
import { DataCollectionService } from '../../src/services/data-collection-service';
import { HomeyLogger } from '../../src/util/logger';

// Mock dependencies
jest.mock('../../src/services/configuration-service');
jest.mock('../../src/services/data-collection-service');
jest.mock('../../src/util/logger');

describe('AnalyticsService', () => {
  let analyticsService: AnalyticsService;
  let mockConfigService: jest.Mocked<ConfigurationService>;
  let mockDataCollectionService: jest.Mocked<DataCollectionService>;
  let mockLogger: jest.Mocked<HomeyLogger>;

  // Sample analytics data for testing
  const sampleAnalyticsData = {
    period: {
      start: '2025-08-18T00:00:00Z',
      end: '2025-08-19T00:00:00Z',
      duration: 24
    },
    devices: {
      'device-1': {
        commandCount: 100,
        successRate: 0.95,
        averageResponseTime: 150,
        energyConsumption: 25,
        temperatureHistory: [
          { timestamp: '2025-08-18T12:00:00Z', value: 22.5 }
        ],
        efficiencyMetrics: {
          cop: 3.5,
          energyUsage: 25,
          cost: 12.5
        }
      },
      'device-2': {
        commandCount: 80,
        successRate: 0.88,
        averageResponseTime: 200,
        energyConsumption: 30,
        temperatureHistory: [
          { timestamp: '2025-08-18T12:00:00Z', value: 21.0 }
        ],
        efficiencyMetrics: {
          cop: 3.2,
          energyUsage: 30,
          cost: 15.0
        }
      }
    },
    optimizations: {
      totalSavings: 12.5,
      energySaved: 45,
      costSaved: 22.5,
      strategies: {
        'thermal_preheat': {
          usage: 25,
          success: 23,
          averageSavings: 15.2
        },
        'hot_water_schedule': {
          usage: 18,
          success: 17,
          averageSavings: 8.7
        }
      }
    },
    systemHealth: {
      uptimePercentage: 98.5,
      errorRate: 1.2,
      memoryUsageTrend: 'stable' as const,
      performanceTrend: 'improving' as const
    }
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock instances
    mockConfigService = {
      getAllConfigurations: jest.fn().mockResolvedValue({}),
      getOptimizationConfiguration: jest.fn(),
      getMelcloudConfiguration: jest.fn(),
      getThermalConfiguration: jest.fn(),
      getHotWaterConfiguration: jest.fn(),
      getTibberConfiguration: jest.fn(),
      updateConfiguration: jest.fn(),
      validateConfiguration: jest.fn()
    } as any;
    
    mockDataCollectionService = {
      getAnalyticsData: jest.fn().mockResolvedValue(sampleAnalyticsData),
      start: jest.fn(),
      stop: jest.fn(),
      shutdown: jest.fn()
    } as any;
    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    } as any;

    // Setup default mock behaviors
    mockDataCollectionService.getAnalyticsData = jest.fn().mockResolvedValue(sampleAnalyticsData);

    // Create service instance
    analyticsService = new AnalyticsService(
      mockConfigService,
      mockDataCollectionService,
      mockLogger
    );
  });

  describe('Service Creation', () => {
    test('should create analytics service instance', () => {
      expect(analyticsService).toBeInstanceOf(AnalyticsService);
    });

    test('should initialize with correct dependencies', () => {
      expect(analyticsService).toBeDefined();
      expect(mockLogger.info).not.toHaveBeenCalled(); // Not started yet
    });
  });

  describe('Service Lifecycle', () => {
    test('should start service successfully', async () => {
      await analyticsService.start();
      
      // Check that info was called with strings containing the expected content
      const infoCalls = mockLogger.info.mock.calls;
      const startingCall = infoCalls.find(call => call[0].includes('Starting Analytics Service'));
      const startedCall = infoCalls.find(call => call[0].includes('started successfully'));
      
      expect(startingCall).toBeDefined();
      expect(startedCall).toBeDefined();
      if (startedCall) {
        expect(startedCall[1]).toMatchObject({
          reportsEnabled: true,
          insightsEnabled: true,
          forecastingEnabled: true,
          anomalyDetectionEnabled: true
        });
      }
    });

    test('should not start service twice', async () => {
      await analyticsService.start();
      
      // Clear previous calls
      jest.clearAllMocks();
      
      await analyticsService.start();
      
      const infoCalls = mockLogger.info.mock.calls;
      const alreadyStartedCall = infoCalls.find(call => call[0].includes('already started'));
      expect(alreadyStartedCall).toBeDefined();
    });

    test('should stop service successfully', async () => {
      await analyticsService.start();
      
      // Clear previous start calls
      jest.clearAllMocks();
      
      await analyticsService.stop();
      
      const infoCalls = mockLogger.info.mock.calls;
      const stoppingCall = infoCalls.find(call => call[0].includes('Stopping Analytics Service'));
      const stoppedCall = infoCalls.find(call => call[0].includes('stopped successfully'));
      
      expect(stoppingCall).toBeDefined();
      expect(stoppedCall).toBeDefined();
    });

    test('should handle stop when not started', async () => {
      await analyticsService.stop();
      
      const infoCalls = mockLogger.info.mock.calls;
      const notRunningCall = infoCalls.find(call => call[0].includes('not running'));
      expect(notRunningCall).toBeDefined();
    });

    test('should shutdown gracefully', async () => {
      await analyticsService.start();
      
      // Clear previous start calls
      jest.clearAllMocks();
      
      await analyticsService.shutdown();
      
      const infoCalls = mockLogger.info.mock.calls;
      const shutdownCall = infoCalls.find(call => call[0].includes('shutdown completed'));
      expect(shutdownCall).toBeDefined();
    });
  });

  describe('Report Generation', () => {
    beforeEach(async () => {
      await analyticsService.start();
    });

    test('should generate performance report successfully', async () => {
      const result = await analyticsService.generateReport('performance');
      
      expect(result.success).toBe(true);
      expect(result.report).toBeDefined();
      expect(result.report!.type).toBe('performance');
      expect(result.report!.summary).toBeDefined();
      expect(result.report!.details).toBeDefined();
      expect(result.report!.insights).toBeDefined();
      expect(result.report!.recommendations).toBeDefined();
      expect(result.metrics.cacheHit).toBe(false);
    });

    test('should generate savings report', async () => {
      const result = await analyticsService.generateReport('savings');
      
      expect(result.success).toBe(true);
      expect(result.report!.type).toBe('savings');
      expect(result.report!.summary.energySavings.total).toBeGreaterThan(0);
    });

    test('should generate health report', async () => {
      const result = await analyticsService.generateReport('health');
      
      expect(result.success).toBe(true);
      expect(result.report!.type).toBe('health');
      expect(result.report!.summary.systemPerformance.uptime).toBeGreaterThan(0);
    });

    test('should generate optimization report', async () => {
      const result = await analyticsService.generateReport('optimization');
      
      expect(result.success).toBe(true);
      expect(result.report!.type).toBe('optimization');
      expect(result.report!.summary.optimization.strategiesUsed).toBeGreaterThan(0);
    });

    test('should generate forecast report', async () => {
      const result = await analyticsService.generateReport('forecast');
      
      expect(result.success).toBe(true);
      expect(result.report!.type).toBe('forecast');
    });

    test('should use cached report when available', async () => {
      const cacheKey = 'test_cache_key';
      
      // First call - should generate new report
      const result1 = await analyticsService.generateReport('performance', undefined, undefined, { cacheKey });
      expect(result1.metrics.cacheHit).toBe(false);
      
      // Second call - should use cache
      const result2 = await analyticsService.generateReport('performance', undefined, undefined, { cacheKey });
      expect(result2.metrics.cacheHit).toBe(true);
      expect(result2.report!.id).toBe(result1.report!.id);
    });

    test('should handle custom time period', async () => {
      const startTime = '2025-08-18T00:00:00Z';
      const endTime = '2025-08-19T00:00:00Z';
      
      const result = await analyticsService.generateReport('performance', startTime, endTime);
      
      expect(result.success).toBe(true);
      expect(result.report!.period.start).toBe('2025-08-18T00:00:00.000Z');
      expect(result.report!.period.end).toBe('2025-08-19T00:00:00.000Z');
    });

    test('should handle data collection service errors', async () => {
      mockDataCollectionService.getAnalyticsData.mockRejectedValue(new Error('Data collection failed'));
      
      const result = await analyticsService.generateReport('performance');
      
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error!.code).toBe('REPORT_GENERATION_FAILED');
    });

    test('should fail when service not started', async () => {
      await analyticsService.stop();
      
      const result = await analyticsService.generateReport('performance');
      
      expect(result.success).toBe(false);
      expect(result.error!.message).toContain('not started');
    });
  });

  describe('Insights Generation', () => {
    beforeEach(async () => {
      await analyticsService.start();
    });

    test('should generate insights for default timeframe', async () => {
      const insights = await analyticsService.generateInsights();
      
      expect(Array.isArray(insights)).toBe(true);
      expect(insights.length).toBeGreaterThan(0);
      
      // Check insight structure
      const insight = insights[0];
      expect(insight).toHaveProperty('id');
      expect(insight).toHaveProperty('type');
      expect(insight).toHaveProperty('title');
      expect(insight).toHaveProperty('description');
      expect(insight).toHaveProperty('impact');
      expect(insight).toHaveProperty('confidence');
      expect(insight).toHaveProperty('data');
    });

    test('should generate optimization insights', async () => {
      const insights = await analyticsService.generateInsights(24, ['optimization']);
      
      const optimizationInsights = insights.filter(i => i.type === 'optimization');
      expect(optimizationInsights.length).toBeGreaterThan(0);
      expect(optimizationInsights[0].title).toContain('Optimization');
    });

    test('should generate efficiency insights', async () => {
      const insights = await analyticsService.generateInsights(24, ['efficiency']);
      
      const efficiencyInsights = insights.filter(i => i.type === 'efficiency');
      expect(efficiencyInsights.length).toBeGreaterThan(0);
      expect(efficiencyInsights[0].title).toContain('Efficiency');
    });

    test('should generate cost insights', async () => {
      const insights = await analyticsService.generateInsights(24, ['cost']);
      
      const costInsights = insights.filter(i => i.type === 'cost');
      expect(costInsights.length).toBeGreaterThan(0);
      expect(costInsights[0].title).toContain('Cost');
    });

    test('should generate trend insights', async () => {
      const insights = await analyticsService.generateInsights(24, ['trend']);
      
      const trendInsights = insights.filter(i => i.type === 'trend');
      expect(trendInsights.length).toBeGreaterThan(0);
      expect(trendInsights[0].title).toContain('Trend');
    });

    test('should generate maintenance insights', async () => {
      // Modify sample data to trigger maintenance insights
      const modifiedData = {
        ...sampleAnalyticsData,
        devices: {
          'device-1': {
            ...sampleAnalyticsData.devices['device-1'],
            successRate: 0.75 // Low success rate
          }
        }
      };
      mockDataCollectionService.getAnalyticsData.mockResolvedValue(modifiedData);
      
      const insights = await analyticsService.generateInsights(24, ['maintenance']);
      
      const maintenanceInsights = insights.filter(i => i.type === 'maintenance');
      expect(maintenanceInsights.length).toBeGreaterThan(0);
      expect(maintenanceInsights[0].title).toContain('Maintenance');
    });

    test('should filter insights by confidence threshold', async () => {
      const insights = await analyticsService.generateInsights();
      
      // All insights should meet the confidence threshold (0.7)
      insights.forEach(insight => {
        expect(insight.confidence).toBeGreaterThanOrEqual(0.7);
      });
    });

    test('should return empty array when service not started', async () => {
      await analyticsService.stop();
      
      const insights = await analyticsService.generateInsights();
      expect(insights).toEqual([]);
    });

    test('should handle data collection errors gracefully', async () => {
      mockDataCollectionService.getAnalyticsData.mockRejectedValue(new Error('Collection failed'));
      
      const insights = await analyticsService.generateInsights();
      expect(insights).toEqual([]);
    });
  });

  describe('Recommendations Generation', () => {
    beforeEach(async () => {
      await analyticsService.start();
    });

    test('should generate recommendations successfully', async () => {
      const recommendations = await analyticsService.generateRecommendations();
      
      expect(Array.isArray(recommendations)).toBe(true);
      expect(recommendations.length).toBeGreaterThan(0);
      
      // Check recommendation structure
      const recommendation = recommendations[0];
      expect(recommendation).toHaveProperty('id');
      expect(recommendation).toHaveProperty('category');
      expect(recommendation).toHaveProperty('priority');
      expect(recommendation).toHaveProperty('title');
      expect(recommendation).toHaveProperty('description');
      expect(recommendation).toHaveProperty('action');
      expect(recommendation).toHaveProperty('expectedBenefit');
      expect(recommendation).toHaveProperty('implementation');
      expect(recommendation).toHaveProperty('confidence');
    });

    test('should sort recommendations by priority and confidence', async () => {
      const recommendations = await analyticsService.generateRecommendations();
      
      // Check if recommendations are sorted (critical > high > medium > low)
      // and by confidence within same priority
      for (let i = 1; i < recommendations.length; i++) {
        const prev = recommendations[i - 1];
        const curr = recommendations[i];
        
        const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
        const prevPriority = priorityOrder[prev.priority];
        const currPriority = priorityOrder[curr.priority];
        
        if (prevPriority === currPriority) {
          expect(prev.confidence).toBeGreaterThanOrEqual(curr.confidence);
        } else {
          expect(prevPriority).toBeGreaterThanOrEqual(currPriority);
        }
      }
    });

    test('should generate optimization recommendations for poor performance', async () => {
      // Modify data to trigger optimization recommendations
      const poorPerformanceData = {
        ...sampleAnalyticsData,
        optimizations: {
          ...sampleAnalyticsData.optimizations,
          totalSavings: 5 // Low savings
        }
      };
      mockDataCollectionService.getAnalyticsData.mockResolvedValue(poorPerformanceData);
      
      const recommendations = await analyticsService.generateRecommendations();
      
      const optimizationRecs = recommendations.filter(r => r.category === 'optimization');
      expect(optimizationRecs.length).toBeGreaterThan(0);
      expect(optimizationRecs[0].title).toContain('Optimization');
    });

    test('should generate maintenance recommendations for unhealthy devices', async () => {
      // Modify data to trigger maintenance recommendations
      const unhealthyDeviceData = {
        ...sampleAnalyticsData,
        devices: {
          'device-1': {
            ...sampleAnalyticsData.devices['device-1'],
            successRate: 0.7 // Unhealthy device
          }
        }
      };
      mockDataCollectionService.getAnalyticsData.mockResolvedValue(unhealthyDeviceData);
      
      const recommendations = await analyticsService.generateRecommendations();
      
      const maintenanceRecs = recommendations.filter(r => r.category === 'maintenance');
      expect(maintenanceRecs.length).toBeGreaterThan(0);
      expect(maintenanceRecs[0].title).toContain('Maintenance');
    });

    test('should generate configuration recommendations for low uptime', async () => {
      // Modify data to trigger configuration recommendations
      const lowUptimeData = {
        ...sampleAnalyticsData,
        systemHealth: {
          ...sampleAnalyticsData.systemHealth,
          uptimePercentage: 90 // Low uptime
        }
      };
      mockDataCollectionService.getAnalyticsData.mockResolvedValue(lowUptimeData);
      
      const recommendations = await analyticsService.generateRecommendations();
      
      const configRecs = recommendations.filter(r => r.category === 'configuration');
      expect(configRecs.length).toBeGreaterThan(0);
      expect(configRecs[0].title).toContain('Configuration');
    });

    test('should return empty array when service not started', async () => {
      await analyticsService.stop();
      
      const recommendations = await analyticsService.generateRecommendations();
      expect(recommendations).toEqual([]);
    });
  });

  describe('Forecasting', () => {
    beforeEach(async () => {
      await analyticsService.start();
    });

    test('should generate energy forecast', async () => {
      const forecast = await analyticsService.generateForecast('energy', 'hourly');
      
      expect(forecast).toBeDefined();
      expect(forecast!.type).toBe('energy');
      expect(forecast!.timeframe).toBe('hourly');
      expect(forecast!.predictions).toBeDefined();
      expect(forecast!.predictions.length).toBeGreaterThan(0);
      
      // Check prediction structure
      const prediction = forecast!.predictions[0];
      expect(prediction).toHaveProperty('timestamp');
      expect(prediction).toHaveProperty('value');
      expect(prediction).toHaveProperty('confidence');
      expect(prediction).toHaveProperty('range');
    });

    test('should generate cost forecast', async () => {
      const forecast = await analyticsService.generateForecast('cost', 'daily');
      
      expect(forecast).toBeDefined();
      expect(forecast!.type).toBe('cost');
      expect(forecast!.timeframe).toBe('daily');
    });

    test('should generate performance forecast', async () => {
      const forecast = await analyticsService.generateForecast('performance', 'weekly');
      
      expect(forecast).toBeDefined();
      expect(forecast!.type).toBe('performance');
      expect(forecast!.timeframe).toBe('weekly');
    });

    test('should generate efficiency forecast', async () => {
      const forecast = await analyticsService.generateForecast('efficiency', 'monthly');
      
      expect(forecast).toBeDefined();
      expect(forecast!.type).toBe('efficiency');
      expect(forecast!.timeframe).toBe('monthly');
    });

    test('should use cached forecast when available', async () => {
      // First call
      const forecast1 = await analyticsService.generateForecast('energy', 'hourly');
      
      // Second call should use cache
      const forecast2 = await analyticsService.generateForecast('energy', 'hourly');
      
      expect(forecast2!.timestamp).toBe(forecast1!.timestamp);
    });

    test('should respect custom look-ahead hours', async () => {
      const lookAheadHours = 48;
      const forecast = await analyticsService.generateForecast('energy', 'hourly', lookAheadHours);
      
      expect(forecast!.predictions.length).toBe(lookAheadHours);
    });

    test('should return null when forecasting disabled', async () => {
      await analyticsService.reconfigureAnalytics({
        forecasting: { 
          enabled: false,
          lookAheadHours: 24,
          historicalDataHours: 168
        }
      });
      
      const forecast = await analyticsService.generateForecast('energy', 'hourly');
      expect(forecast).toBeNull();
    });

    test('should return null when service not started', async () => {
      await analyticsService.stop();
      
      const forecast = await analyticsService.generateForecast('energy', 'hourly');
      expect(forecast).toBeNull();
    });
  });

  describe('Anomaly Detection', () => {
    beforeEach(async () => {
      await analyticsService.start();
    });

    test('should detect performance anomalies', async () => {
      // Modify data to create performance anomaly
      const slowPerformanceData = {
        ...sampleAnalyticsData,
        devices: {
          'device-1': {
            ...sampleAnalyticsData.devices['device-1'],
            averageResponseTime: 500 // Very slow
          }
        }
      };
      mockDataCollectionService.getAnalyticsData.mockResolvedValue(slowPerformanceData);
      
      const anomalies = await analyticsService.detectAnomalies(24, ['performance']);
      
      expect(Array.isArray(anomalies)).toBe(true);
      expect(anomalies.length).toBeGreaterThan(0);
      
      const performanceAnomaly = anomalies.find(a => a.type === 'performance');
      expect(performanceAnomaly).toBeDefined();
      expect(performanceAnomaly!.description).toContain('response time');
    });

    test('should detect energy anomalies', async () => {
      // Modify data to create energy anomaly
      const highEnergyData = {
        ...sampleAnalyticsData,
        devices: {
          'device-1': {
            ...sampleAnalyticsData.devices['device-1'],
            energyConsumption: 300 // Very high
          }
        }
      };
      mockDataCollectionService.getAnalyticsData.mockResolvedValue(highEnergyData);
      
      const anomalies = await analyticsService.detectAnomalies(24, ['energy']);
      
      const energyAnomaly = anomalies.find(a => a.type === 'energy');
      expect(energyAnomaly).toBeDefined();
      expect(energyAnomaly!.description).toContain('energy consumption');
    });

    test('should detect cost anomalies', async () => {
      // Modify data to create cost anomaly
      const lowSavingsData = {
        ...sampleAnalyticsData,
        optimizations: {
          ...sampleAnalyticsData.optimizations,
          costSaved: 2 // Very low savings
        }
      };
      mockDataCollectionService.getAnalyticsData.mockResolvedValue(lowSavingsData);
      
      const anomalies = await analyticsService.detectAnomalies(24, ['cost']);
      
      const costAnomaly = anomalies.find(a => a.type === 'cost');
      expect(costAnomaly).toBeDefined();
      expect(costAnomaly!.description).toContain('Cost savings');
    });

    test('should detect device anomalies', async () => {
      // Modify data to create device anomaly
      const failingDeviceData = {
        ...sampleAnalyticsData,
        devices: {
          'device-1': {
            ...sampleAnalyticsData.devices['device-1'],
            successRate: 0.6 // Very low success rate
          }
        }
      };
      mockDataCollectionService.getAnalyticsData.mockResolvedValue(failingDeviceData);
      
      const anomalies = await analyticsService.detectAnomalies(24, ['device']);
      
      const deviceAnomaly = anomalies.find(a => a.type === 'device');
      expect(deviceAnomaly).toBeDefined();
      expect(deviceAnomaly!.description).toContain('success rate');
    });

    test('should detect system anomalies', async () => {
      // Modify data to create system anomaly
      const lowUptimeData = {
        ...sampleAnalyticsData,
        systemHealth: {
          ...sampleAnalyticsData.systemHealth,
          uptimePercentage: 85 // Low uptime
        }
      };
      mockDataCollectionService.getAnalyticsData.mockResolvedValue(lowUptimeData);
      
      const anomalies = await analyticsService.detectAnomalies(24, ['system']);
      
      const systemAnomaly = anomalies.find(a => a.type === 'system');
      expect(systemAnomaly).toBeDefined();
      expect(systemAnomaly!.description).toContain('uptime');
    });

    test('should filter anomalies by severity threshold', async () => {
      // Create data with multiple anomalies of different severities
      const multiAnomalyData = {
        ...sampleAnalyticsData,
        devices: {
          'device-1': {
            ...sampleAnalyticsData.devices['device-1'],
            successRate: 0.6 // High severity
          },
          'device-2': {
            ...sampleAnalyticsData.devices['device-2'],
            successRate: 0.85 // Medium severity
          }
        }
      };
      mockDataCollectionService.getAnalyticsData.mockResolvedValue(multiAnomalyData);
      
      const anomalies = await analyticsService.detectAnomalies();
      
      // Should filter based on alert threshold (configured as 2 = medium and above)
      anomalies.forEach(anomaly => {
        const severityValues = { low: 1, medium: 2, high: 3, critical: 4 };
        expect(severityValues[anomaly.severity]).toBeGreaterThanOrEqual(2);
      });
    });

    test('should return empty array when anomaly detection disabled', async () => {
      await analyticsService.reconfigureAnalytics({
        anomalyDetection: { 
          enabled: false,
          sensitivityLevel: 5,
          alertThreshold: 2
        }
      });
      
      const anomalies = await analyticsService.detectAnomalies();
      expect(anomalies).toEqual([]);
    });

    test('should return empty array when service not started', async () => {
      await analyticsService.stop();
      
      const anomalies = await analyticsService.detectAnomalies();
      expect(anomalies).toEqual([]);
    });
  });

  describe('Service Statistics', () => {
    beforeEach(async () => {
      await analyticsService.start();
    });

    test('should provide service statistics', () => {
      const stats = analyticsService.getStatistics();
      
      expect(stats).toHaveProperty('reportsGenerated');
      expect(stats).toHaveProperty('totalInsights');
      expect(stats).toHaveProperty('totalRecommendations');
      expect(stats).toHaveProperty('averageProcessingTime');
      expect(stats).toHaveProperty('cacheHitRate');
      expect(stats).toHaveProperty('anomaliesDetected');
      expect(stats).toHaveProperty('uptime');
      expect(stats).toHaveProperty('performance');
      
      expect(typeof stats.reportsGenerated).toBe('number');
      expect(typeof stats.totalInsights).toBe('number');
      expect(typeof stats.totalRecommendations).toBe('number');
      expect(typeof stats.averageProcessingTime).toBe('number');
      expect(typeof stats.cacheHitRate).toBe('number');
      expect(typeof stats.anomaliesDetected).toBe('number');
    });

    test('should update statistics after operations', async () => {
      const initialStats = analyticsService.getStatistics();
      
      // Generate some reports and insights
      await analyticsService.generateReport('performance');
      await analyticsService.generateInsights();
      await analyticsService.generateRecommendations();
      
      const updatedStats = analyticsService.getStatistics();
      
      expect(updatedStats.reportsGenerated).toBeGreaterThan(initialStats.reportsGenerated);
      expect(updatedStats.totalInsights).toBeGreaterThan(initialStats.totalInsights);
      expect(updatedStats.totalRecommendations).toBeGreaterThan(initialStats.totalRecommendations);
    });
  });

  describe('Service Reconfiguration', () => {
    beforeEach(async () => {
      await analyticsService.start();
    });

    test('should reconfigure service successfully', async () => {
      const newConfig = {
        insights: {
          enabled: false,
          minDataPoints: 10,
          confidenceThreshold: 0.9
        },
        forecasting: {
          enabled: false,
          lookAheadHours: 24,
          historicalDataHours: 168
        }
      };
      
      await analyticsService.reconfigureAnalytics(newConfig);
      
      // Test that new configuration is applied
      const insights = await analyticsService.generateInsights();
      expect(insights).toEqual([]); // Should be empty due to disabled insights
      
      const forecast = await analyticsService.generateForecast('energy', 'hourly');
      expect(forecast).toBeNull(); // Should be null due to disabled forecasting
    });

    test('should handle invalid reconfiguration', async () => {
      await analyticsService.start();
      
      await expect(
        analyticsService.reconfigureAnalytics({
          insights: {
            enabled: true,
            minDataPoints: 10,
            confidenceThreshold: 1.5 // Invalid value
          }
        })
      ).rejects.toThrow('Failed to reconfigure Analytics Service');
    });
  });

  describe('Error Handling', () => {
    test('should handle service start failure gracefully', async () => {
      // Mock configuration loading failure
      jest.spyOn(analyticsService as any, 'loadConfiguration').mockRejectedValue(new Error('Config failed'));
      
      await expect(analyticsService.start()).rejects.toThrow('Failed to start Analytics Service');
    });

    test('should handle data collection service failures', async () => {
      await analyticsService.start();
      
      mockDataCollectionService.getAnalyticsData.mockRejectedValue(new Error('Data unavailable'));
      
      const result = await analyticsService.generateReport('performance');
      expect(result.success).toBe(false);
      expect(result.error!.code).toBe('REPORT_GENERATION_FAILED');
    });

    test('should handle reconfiguration failure', async () => {
      // Try to reconfigure with null service (not started)
      await expect(
        analyticsService.reconfigureAnalytics({})
      ).rejects.toThrow('Failed to reconfigure Analytics Service');
    });
  });
});
