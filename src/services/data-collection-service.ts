import { ServiceBase } from './base/service-base';
import { ConfigurationService, DataCollectionConfig } from './configuration-service';
import { HomeyLogger } from '../util/logger';

/**
 * Generic data point structure for all collection types
 */
export interface DataPoint {
  id: string;
  timestamp: string;
  type: 'device' | 'memory' | 'performance' | 'optimization' | 'analytics';
  source: string; // device ID, service name, etc.
  category: string; // specific data category
  data: Record<string, any>;
  metadata?: {
    quality: number; // 0-1, data quality score
    confidence: number; // 0-1, confidence level
    tags?: string[];
    [key: string]: any;
  };
}

/**
 * Memory usage metrics
 */
export interface MemoryMetrics {
  timestamp: string;
  process: {
    rss: number; // MB
    heapTotal: number; // MB
    heapUsed: number; // MB
    external: number; // MB
  };
  services: {
    [serviceName: string]: {
      dataPoints: number;
      estimatedMemory: number; // KB
      lastCleanup?: string;
    };
  };
  systemHealth: {
    status: 'healthy' | 'warning' | 'critical';
    issues: string[];
    recommendations: string[];
  };
}

/**
 * Performance metrics for system monitoring
 */
export interface PerformanceMetrics {
  timestamp: string;
  deviceCommands: {
    total: number;
    successful: number;
    failed: number;
    averageResponseTime: number; // ms
    lastHour: number;
  };
  optimizations: {
    total: number;
    successful: number;
    failed: number;
    averageSavings: number; // percentage
    lastHour: number;
  };
  services: {
    [serviceName: string]: {
      status: 'active' | 'inactive' | 'error';
      lastResponse: number; // ms
      errorCount: number;
      uptime: number; // minutes
    };
  };
}

/**
 * Data cleanup operation result
 */
export interface DataCleanupResult {
  success: boolean;
  message: string;
  cleaned: {
    dataPoints: number;
    services: string[];
    memoryFreed: number; // KB
  };
  remaining: {
    dataPoints: number;
    estimatedMemory: number; // KB
  };
  duration: number; // ms
  timestamp: string;
}

/**
 * Collection history for tracking data collection operations
 */
export interface CollectionHistory {
  collections: Array<{
    timestamp: string;
    type: string;
    success: boolean;
    dataPointsCollected: number;
    duration: number; // ms
    error?: string;
  }>;
  statistics: {
    totalCollections: number;
    successRate: number; // percentage
    averageDuration: number; // ms
    lastSuccessful: string;
    lastFailed?: string;
  };
}

/**
 * Analytics data aggregation result
 */
export interface AnalyticsData {
  period: {
    start: string;
    end: string;
    duration: number; // hours
  };
  devices: {
    [deviceId: string]: {
      commandCount: number;
      successRate: number;
      averageResponseTime: number;
      temperatureHistory: Array<{ timestamp: string; value: number }>;
      efficiencyMetrics: {
        cop: number;
        energyUsage: number;
        cost: number;
      };
    };
  };
  optimizations: {
    totalSavings: number; // percentage
    energySaved: number; // kWh
    costSaved: number; // currency
    strategies: {
      [strategy: string]: {
        usage: number;
        success: number;
        averageSavings: number;
      };
    };
  };
  systemHealth: {
    uptimePercentage: number;
    errorRate: number;
    memoryUsageTrend: 'stable' | 'increasing' | 'decreasing';
    performanceTrend: 'stable' | 'improving' | 'degrading';
  };
}

/**
 * Data Collection Service
 * 
 * Centralizes all data collection functionality including:
 * - Device data collection and monitoring
 * - Memory usage tracking and optimization
 * - Performance metrics collection
 * - Analytics data aggregation
 * - Data cleanup and retention management
 */
export class DataCollectionService extends ServiceBase {
  private configService: ConfigurationService;
  private dataPoints: Map<string, DataPoint> = new Map();
  private collectionHistory: CollectionHistory;
  private memoryMonitorInterval?: NodeJS.Timeout;
  private cleanupInterval?: NodeJS.Timeout;
  private collectionInterval?: NodeJS.Timeout;
  private isCollecting: boolean = false;
  private lastCleanup?: string;

  constructor(configService: ConfigurationService, logger: HomeyLogger) {
    super(logger, {
      failureThreshold: 5,
      resetTimeout: 60000, // 1 minute
      monitorInterval: 30000 // 30 seconds
    });

    this.configService = configService;
    this.collectionHistory = {
      collections: [],
      statistics: {
        totalCollections: 0,
        successRate: 100,
        averageDuration: 0,
        lastSuccessful: new Date().toISOString()
      }
    };

    this.logger.info('Data Collection Service initialized');
  }

  /**
   * Start the data collection service
   */
  public async start(): Promise<void> {
    try {
      const config = await this.getConfiguration();
      
      if (!config.enabled) {
        this.logger.info('Data Collection Service disabled in configuration');
        return;
      }

      this.logger.info('Starting Data Collection Service');

      // Start memory monitoring if enabled
      if (config.memoryMonitoring.enabled) {
        this.startMemoryMonitoring(config.memoryMonitoring.interval);
      }

      // Start data cleanup interval
      this.startDataCleanup(config.dataRetention.cleanupInterval);

      // Start periodic data collection
      this.startPeriodicCollection(config.collectionInterval);

      this.logger.info('Data Collection Service started successfully');
    } catch (error) {
      this.logger.error('Failed to start Data Collection Service', error as Error);
      throw error;
    }
  }

  /**
   * Stop the data collection service
   */
  public async stop(): Promise<void> {
    try {
      this.logger.info('Stopping Data Collection Service');

      // Clear all intervals
      if (this.memoryMonitorInterval) {
        clearInterval(this.memoryMonitorInterval);
        this.memoryMonitorInterval = undefined;
      }

      if (this.cleanupInterval) {
        clearInterval(this.cleanupInterval);
        this.cleanupInterval = undefined;
      }

      if (this.collectionInterval) {
        clearInterval(this.collectionInterval);
        this.collectionInterval = undefined;
      }

      this.isCollecting = false;
      this.logger.info('Data Collection Service stopped');
    } catch (error) {
      this.logger.error('Error stopping Data Collection Service', error as Error);
      throw error;
    }
  }

  /**
   * Collect device data from a specific device
   */
  public async collectDeviceData(deviceId: string, deviceData: Record<string, any>): Promise<DataPoint> {
    return this.executeWithRetry(async () => {
      const startTime = Date.now();

      try {
        const dataPoint: DataPoint = {
          id: `device_${deviceId}_${Date.now()}`,
          timestamp: new Date().toISOString(),
          type: 'device',
          source: deviceId,
          category: 'device_state',
          data: {
            ...deviceData,
            collectionTime: new Date().toISOString()
          },
          metadata: {
            quality: this.calculateDataQuality(deviceData),
            confidence: this.calculateConfidence(deviceData, 'device'),
            tags: ['device', 'real-time']
          }
        };

        // Store the data point
        this.dataPoints.set(dataPoint.id, dataPoint);

        // Update collection history
        this.updateCollectionHistory('device', true, 1, Date.now() - startTime);

        this.logger.debug(`Device data collected for ${deviceId}`, {
          dataPointId: dataPoint.id,
          dataSize: Object.keys(deviceData).length
        });

        return dataPoint;
      } catch (error) {
        this.updateCollectionHistory('device', false, 0, Date.now() - startTime, (error as Error).message);
        throw error;
      }
    });
  }

  /**
   * Collect memory metrics from the system
   */
  public async collectMemoryMetrics(): Promise<MemoryMetrics> {
    return this.executeWithRetry(async () => {
      try {
        // Get process memory usage
        const memUsage = process.memoryUsage();
        const processMemory = {
          rss: Math.round(memUsage.rss / 1024 / 1024 * 100) / 100,
          heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024 * 100) / 100,
          heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024 * 100) / 100,
          external: Math.round(memUsage.external / 1024 / 1024 * 100) / 100
        };

        // Get service-specific memory usage
        const services = this.collectServiceMemoryUsage();

        // Analyze system health
        const systemHealth = this.analyzeSystemHealth(processMemory, services);

        const metrics: MemoryMetrics = {
          timestamp: new Date().toISOString(),
          process: processMemory,
          services,
          systemHealth
        };

        // Store as data point
        const dataPoint: DataPoint = {
          id: `memory_${Date.now()}`,
          timestamp: metrics.timestamp,
          type: 'memory',
          source: 'system',
          category: 'memory_usage',
          data: metrics,
          metadata: {
            quality: 1.0, // System metrics are always high quality
            confidence: 1.0,
            tags: ['memory', 'system', 'monitoring']
          }
        };

        this.dataPoints.set(dataPoint.id, dataPoint);

        this.logger.debug('Memory metrics collected', {
          heapUsed: processMemory.heapUsed,
          systemHealth: systemHealth.status
        });

        return metrics;
      } catch (error) {
        this.logger.error('Failed to collect memory metrics', error as Error);
        throw error;
      }
    });
  }

  /**
   * Collect performance metrics from the system
   */
  public async collectPerformanceMetrics(): Promise<PerformanceMetrics> {
    return this.executeWithRetry(async () => {
      try {
        // Collect device command metrics
        const deviceCommands = this.collectDeviceCommandMetrics();

        // Collect optimization metrics
        const optimizations = this.collectOptimizationMetrics();

        // Collect service status metrics
        const services = this.collectServiceStatusMetrics();

        const metrics: PerformanceMetrics = {
          timestamp: new Date().toISOString(),
          deviceCommands,
          optimizations,
          services
        };

        // Store as data point
        const dataPoint: DataPoint = {
          id: `performance_${Date.now()}`,
          timestamp: metrics.timestamp,
          type: 'performance',
          source: 'system',
          category: 'performance_metrics',
          data: metrics,
          metadata: {
            quality: 0.9, // Performance metrics are generally reliable
            confidence: 0.95,
            tags: ['performance', 'system', 'monitoring']
          }
        };

        this.dataPoints.set(dataPoint.id, dataPoint);

        this.logger.debug('Performance metrics collected', {
          deviceCommands: deviceCommands.total,
          optimizations: optimizations.total
        });

        return metrics;
      } catch (error) {
        this.logger.error('Failed to collect performance metrics', error as Error);
        throw error;
      }
    });
  }

  /**
   * Run data cleanup to manage memory usage and data retention
   */
  public async runDataCleanup(force: boolean = false): Promise<DataCleanupResult> {
    return this.executeWithRetry(async () => {
      const startTime = Date.now();

      try {
        const config = await this.getConfiguration();
        const beforeCount = this.dataPoints.size;
        const beforeMemory = this.estimateDataPointsMemory();

        let cleanedCount = 0;
        const cleanedServices: string[] = [];

        // Clean old data points based on age
        const maxAge = config.dataRetention.maxAge * 24 * 60 * 60 * 1000; // Convert days to ms
        const cutoffTime = Date.now() - maxAge;

        for (const [id, dataPoint] of this.dataPoints.entries()) {
          const pointTime = new Date(dataPoint.timestamp).getTime();
          if (pointTime < cutoffTime || (force && cleanedCount < beforeCount * 0.5)) {
            this.dataPoints.delete(id);
            cleanedCount++;

            // Track which services had data cleaned
            if (!cleanedServices.includes(dataPoint.source)) {
              cleanedServices.push(dataPoint.source);
            }
          }
        }

        // Clean based on maximum data points limit
        if (this.dataPoints.size > config.dataRetention.maxDataPoints) {
          const excess = this.dataPoints.size - config.dataRetention.maxDataPoints;
          const sortedDataPoints = Array.from(this.dataPoints.entries())
            .sort((a, b) => new Date(a[1].timestamp).getTime() - new Date(b[1].timestamp).getTime());

          for (let i = 0; i < excess; i++) {
            const [id, dataPoint] = sortedDataPoints[i];
            this.dataPoints.delete(id);
            cleanedCount++;

            if (!cleanedServices.includes(dataPoint.source)) {
              cleanedServices.push(dataPoint.source);
            }
          }
        }

        const afterMemory = this.estimateDataPointsMemory();
        const memoryFreed = beforeMemory - afterMemory;

        const result: DataCleanupResult = {
          success: true,
          message: `Cleaned ${cleanedCount} data points from ${cleanedServices.length} services`,
          cleaned: {
            dataPoints: cleanedCount,
            services: cleanedServices,
            memoryFreed: Math.round(memoryFreed)
          },
          remaining: {
            dataPoints: this.dataPoints.size,
            estimatedMemory: Math.round(afterMemory)
          },
          duration: Date.now() - startTime,
          timestamp: new Date().toISOString()
        };

        this.lastCleanup = result.timestamp;

        this.logger.info('Data cleanup completed', {
          cleaned: cleanedCount,
          remaining: this.dataPoints.size,
          memoryFreed: `${Math.round(memoryFreed)}KB`
        });

        return result;
      } catch (error) {
        const result: DataCleanupResult = {
          success: false,
          message: `Data cleanup failed: ${(error as Error).message}`,
          cleaned: { dataPoints: 0, services: [], memoryFreed: 0 },
          remaining: { dataPoints: this.dataPoints.size, estimatedMemory: this.estimateDataPointsMemory() },
          duration: Date.now() - startTime,
          timestamp: new Date().toISOString()
        };

        this.logger.error('Data cleanup failed', error as Error);
        return result;
      }
    });
  }

  /**
   * Get analytics data for a specified time period
   */
  public async getAnalyticsData(startTime?: string, endTime?: string): Promise<AnalyticsData> {
    return this.executeWithRetry(async () => {
      try {
        const start = startTime ? new Date(startTime) : new Date(Date.now() - 24 * 60 * 60 * 1000); // Default: last 24 hours
        const end = endTime ? new Date(endTime) : new Date();

        const filteredDataPoints = Array.from(this.dataPoints.values())
          .filter(dp => {
            const dpTime = new Date(dp.timestamp);
            return dpTime >= start && dpTime <= end;
          });

        // Aggregate device data
        const devices = this.aggregateDeviceData(filteredDataPoints);

        // Aggregate optimization data
        const optimizations = this.aggregateOptimizationData(filteredDataPoints);

        // Analyze system health trends
        const systemHealth = this.analyzeSystemHealthTrends(filteredDataPoints);

        const analytics: AnalyticsData = {
          period: {
            start: start.toISOString(),
            end: end.toISOString(),
            duration: Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60)) // hours
          },
          devices,
          optimizations,
          systemHealth
        };

        this.logger.debug('Analytics data generated', {
          period: analytics.period.duration,
          deviceCount: Object.keys(devices).length,
          dataPoints: filteredDataPoints.length
        });

        return analytics;
      } catch (error) {
        this.logger.error('Failed to generate analytics data', error as Error);
        throw error;
      }
    });
  }

  /**
   * Get collection history and statistics
   */
  public getCollectionHistory(): CollectionHistory {
    return { ...this.collectionHistory };
  }

  /**
   * Get current data collection statistics
   */
  public getCollectionStatistics(): {
    totalDataPoints: number;
    dataPointsByType: Record<string, number>;
    estimatedMemoryUsage: number; // KB
    oldestDataPoint?: string;
    newestDataPoint?: string;
    lastCleanup?: string;
  } {
    const dataPointsByType: Record<string, number> = {};
    let oldestTimestamp: string | undefined;
    let newestTimestamp: string | undefined;

    for (const dataPoint of this.dataPoints.values()) {
      // Count by type
      dataPointsByType[dataPoint.type] = (dataPointsByType[dataPoint.type] || 0) + 1;

      // Track oldest and newest
      if (!oldestTimestamp || dataPoint.timestamp < oldestTimestamp) {
        oldestTimestamp = dataPoint.timestamp;
      }
      if (!newestTimestamp || dataPoint.timestamp > newestTimestamp) {
        newestTimestamp = dataPoint.timestamp;
      }
    }

    return {
      totalDataPoints: this.dataPoints.size,
      dataPointsByType,
      estimatedMemoryUsage: Math.round(this.estimateDataPointsMemory()),
      oldestDataPoint: oldestTimestamp,
      newestDataPoint: newestTimestamp,
      lastCleanup: this.lastCleanup
    };
  }

  /**
   * Force immediate data collection for all available sources
   */
  public async forceDataCollection(): Promise<{
    success: boolean;
    collected: { type: string; count: number }[];
    duration: number;
    timestamp: string;
  }> {
    const startTime = Date.now();
    const collected: { type: string; count: number }[] = [];

    try {
      this.logger.info('Starting forced data collection');

      // Collect memory metrics
      await this.collectMemoryMetrics();
      collected.push({ type: 'memory', count: 1 });

      // Collect performance metrics
      await this.collectPerformanceMetrics();
      collected.push({ type: 'performance', count: 1 });

      const result = {
        success: true,
        collected,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString()
      };

      this.logger.info('Forced data collection completed', {
        types: collected.length,
        duration: result.duration
      });

      return result;
    } catch (error) {
      this.logger.error('Forced data collection failed', error as Error);
      return {
        success: false,
        collected,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Get configuration for the data collection service
   */
  private async getConfiguration(): Promise<DataCollectionConfig> {
    try {
      const config = await this.configService.getDataCollectionConfig();
      return config || this.getDefaultConfiguration();
    } catch (error) {
      this.logger.warn('Failed to get data collection configuration, using defaults', error as Error);
      return this.getDefaultConfiguration();
    }
  }

  /**
   * Get default configuration
   */
  private getDefaultConfiguration(): DataCollectionConfig {
    return {
      enabled: true,
      collectionInterval: 15, // 15 minutes
      memoryMonitoring: {
        enabled: true,
        warningThreshold: 100, // 100MB
        criticalThreshold: 200, // 200MB
        interval: 60 // 60 minutes
      },
      dataRetention: {
        maxDataPoints: 10000,
        maxAge: 7, // 7 days
        cleanupInterval: 4 // 4 hours
      },
      analytics: {
        enabled: true,
        aggregationInterval: 1, // 1 hour
        historicalDataPoints: 1000
      },
      performance: {
        trackDeviceCommands: true,
        trackOptimizations: true,
        trackErrors: true,
        maxHistoryEntries: 500
      }
    };
  }

  /**
   * Start memory monitoring
   */
  private startMemoryMonitoring(intervalMinutes: number): void {
    this.memoryMonitorInterval = setInterval(async () => {
      try {
        await this.collectMemoryMetrics();
      } catch (error) {
        this.logger.error('Memory monitoring failed', error as Error);
      }
    }, intervalMinutes * 60 * 1000);

    this.logger.info(`Memory monitoring started (${intervalMinutes} minute intervals)`);
  }

  /**
   * Start data cleanup intervals
   */
  private startDataCleanup(intervalHours: number): void {
    this.cleanupInterval = setInterval(async () => {
      try {
        await this.runDataCleanup();
      } catch (error) {
        this.logger.error('Scheduled data cleanup failed', error as Error);
      }
    }, intervalHours * 60 * 60 * 1000);

    this.logger.info(`Data cleanup scheduled (${intervalHours} hour intervals)`);
  }

  /**
   * Start periodic data collection
   */
  private startPeriodicCollection(intervalMinutes: number): void {
    this.collectionInterval = setInterval(async () => {
      if (!this.isCollecting) {
        this.isCollecting = true;
        try {
          await this.collectMemoryMetrics();
          await this.collectPerformanceMetrics();
        } catch (error) {
          this.logger.error('Periodic data collection failed', error as Error);
        } finally {
          this.isCollecting = false;
        }
      }
    }, intervalMinutes * 60 * 1000);

    this.logger.info(`Periodic data collection started (${intervalMinutes} minute intervals)`);
  }

  /**
   * Calculate data quality score based on completeness and consistency
   */
  private calculateDataQuality(data: Record<string, any>): number {
    let quality = 1.0;

    // Check for missing critical fields
    const criticalFields = ['timestamp', 'id'];
    for (const field of criticalFields) {
      if (!(field in data) || data[field] === null || data[field] === undefined) {
        quality -= 0.2;
      }
    }

    // Check for data consistency
    if (data.timestamp && isNaN(new Date(data.timestamp).getTime())) {
      quality -= 0.1;
    }

    // Check for reasonable ranges
    if (data.temperature && (data.temperature < -50 || data.temperature > 100)) {
      quality -= 0.1;
    }

    return Math.max(0, Math.min(1, quality));
  }

  /**
   * Calculate confidence level for data based on source and context
   */
  private calculateConfidence(data: Record<string, any>, type: string): number {
    let confidence = 0.8; // Base confidence

    // Higher confidence for system-generated data
    if (type === 'memory' || type === 'performance') {
      confidence = 0.95;
    }

    // Lower confidence for device data (can have communication issues)
    if (type === 'device') {
      confidence = 0.7;
    }

    // Adjust based on data completeness
    const dataFields = Object.keys(data).length;
    if (dataFields > 10) {
      confidence += 0.1;
    } else if (dataFields < 3) {
      confidence -= 0.2;
    }

    return Math.max(0, Math.min(1, confidence));
  }

  /**
   * Update collection history
   */
  private updateCollectionHistory(
    type: string,
    success: boolean,
    dataPointsCollected: number,
    duration: number,
    error?: string
  ): void {
    const collection = {
      timestamp: new Date().toISOString(),
      type,
      success,
      dataPointsCollected,
      duration,
      ...(error && { error })
    };

    this.collectionHistory.collections.push(collection);

    // Keep only last 100 collections
    if (this.collectionHistory.collections.length > 100) {
      this.collectionHistory.collections = this.collectionHistory.collections.slice(-100);
    }

    // Update statistics
    this.collectionHistory.statistics.totalCollections++;
    
    const successfulCollections = this.collectionHistory.collections.filter(c => c.success).length;
    this.collectionHistory.statistics.successRate = 
      (successfulCollections / this.collectionHistory.collections.length) * 100;

    const totalDuration = this.collectionHistory.collections.reduce((sum, c) => sum + c.duration, 0);
    this.collectionHistory.statistics.averageDuration = 
      totalDuration / this.collectionHistory.collections.length;

    if (success) {
      this.collectionHistory.statistics.lastSuccessful = collection.timestamp;
    } else {
      this.collectionHistory.statistics.lastFailed = collection.timestamp;
    }
  }

  /**
   * Collect memory usage from individual services
   */
  private collectServiceMemoryUsage(): Record<string, any> {
    const services: Record<string, any> = {};

    // Estimate memory usage for our data collection
    services['data-collection'] = {
      dataPoints: this.dataPoints.size,
      estimatedMemory: this.estimateDataPointsMemory(),
      lastCleanup: this.lastCleanup
    };

    // Add other service estimates (placeholder for now)
    services['thermal-optimization'] = {
      dataPoints: 0,
      estimatedMemory: 0,
      lastCleanup: undefined
    };

    services['device-communication'] = {
      dataPoints: 0,
      estimatedMemory: 0,
      lastCleanup: undefined
    };

    return services;
  }

  /**
   * Analyze system health based on memory usage and service status
   */
  private analyzeSystemHealth(
    processMemory: any,
    services: Record<string, any>
  ): { status: 'healthy' | 'warning' | 'critical'; issues: string[]; recommendations: string[] } {
    const issues: string[] = [];
    const recommendations: string[] = [];
    let status: 'healthy' | 'warning' | 'critical' = 'healthy';

    // Check heap usage
    if (processMemory.heapUsed > 150) {
      status = 'critical';
      issues.push(`High heap usage: ${processMemory.heapUsed}MB`);
      recommendations.push('Consider running data cleanup');
    } else if (processMemory.heapUsed > 100) {
      status = status === 'healthy' ? 'warning' : status;
      issues.push(`Elevated heap usage: ${processMemory.heapUsed}MB`);
      recommendations.push('Monitor memory usage closely');
    }

    // Check data collection size
    const totalDataPoints = Object.values(services).reduce((sum: number, service: any) => 
      sum + (service.dataPoints || 0), 0);
    
    if (totalDataPoints > 50000) {
      status = 'critical';
      issues.push(`Excessive data points: ${totalDataPoints}`);
      recommendations.push('Run immediate data cleanup');
    } else if (totalDataPoints > 25000) {
      status = status === 'healthy' ? 'warning' : status;
      issues.push(`High data point count: ${totalDataPoints}`);
      recommendations.push('Schedule more frequent data cleanup');
    }

    return { status, issues, recommendations };
  }

  /**
   * Estimate memory usage of stored data points
   */
  private estimateDataPointsMemory(): number {
    let totalMemory = 0;

    for (const dataPoint of this.dataPoints.values()) {
      // Rough estimate: JSON size + object overhead
      const jsonSize = JSON.stringify(dataPoint).length;
      totalMemory += jsonSize + 100; // Add overhead for object structure
    }

    return totalMemory / 1024; // Convert to KB
  }

  /**
   * Collect device command metrics
   */
  private collectDeviceCommandMetrics(): any {
    // Get device command data from data points
    const deviceDataPoints = Array.from(this.dataPoints.values())
      .filter(dp => dp.type === 'device' && dp.category === 'command_result');

    const lastHour = Date.now() - (60 * 60 * 1000);
    const recentCommands = deviceDataPoints.filter(dp => 
      new Date(dp.timestamp).getTime() > lastHour);

    const successful = deviceDataPoints.filter(dp => dp.data.success === true).length;
    const failed = deviceDataPoints.length - successful;

    const totalResponseTime = deviceDataPoints.reduce((sum, dp) => 
      sum + (dp.data.responseTime || 0), 0);
    const averageResponseTime = deviceDataPoints.length > 0 ? 
      totalResponseTime / deviceDataPoints.length : 0;

    return {
      total: deviceDataPoints.length,
      successful,
      failed,
      averageResponseTime: Math.round(averageResponseTime),
      lastHour: recentCommands.length
    };
  }

  /**
   * Collect optimization metrics
   */
  private collectOptimizationMetrics(): any {
    // Get optimization data from data points
    const optimizationDataPoints = Array.from(this.dataPoints.values())
      .filter(dp => dp.type === 'optimization');

    const lastHour = Date.now() - (60 * 60 * 1000);
    const recentOptimizations = optimizationDataPoints.filter(dp => 
      new Date(dp.timestamp).getTime() > lastHour);

    const successful = optimizationDataPoints.filter(dp => dp.data.success === true).length;
    const failed = optimizationDataPoints.length - successful;

    const totalSavings = optimizationDataPoints.reduce((sum, dp) => 
      sum + (dp.data.savings || 0), 0);
    const averageSavings = optimizationDataPoints.length > 0 ? 
      totalSavings / optimizationDataPoints.length : 0;

    return {
      total: optimizationDataPoints.length,
      successful,
      failed,
      averageSavings: Math.round(averageSavings * 100) / 100,
      lastHour: recentOptimizations.length
    };
  }

  /**
   * Collect service status metrics
   */
  private collectServiceStatusMetrics(): any {
    const services: Record<string, any> = {};

    // Basic service status (placeholder - would integrate with actual services)
    const serviceNames = ['thermal-optimization', 'device-communication', 'cop-calculation', 
                         'weather-integration', 'price-integration'];

    for (const serviceName of serviceNames) {
      services[serviceName] = {
        status: 'active', // Would check actual service status
        lastResponse: Math.random() * 1000, // Would get actual response time
        errorCount: 0, // Would get actual error count
        uptime: Math.random() * 10000 // Would get actual uptime
      };
    }

    return services;
  }

  /**
   * Aggregate device data for analytics
   */
  private aggregateDeviceData(dataPoints: DataPoint[]): Record<string, any> {
    const devices: Record<string, any> = {};

    const deviceDataPoints = dataPoints.filter(dp => dp.type === 'device');

    for (const dataPoint of deviceDataPoints) {
      const deviceId = dataPoint.source;
      
      if (!devices[deviceId]) {
        devices[deviceId] = {
          commandCount: 0,
          successRate: 0,
          averageResponseTime: 0,
          temperatureHistory: [],
          efficiencyMetrics: {
            cop: 0,
            energyUsage: 0,
            cost: 0
          }
        };
      }

      const device = devices[deviceId];
      
      if (dataPoint.category === 'command_result') {
        device.commandCount++;
        if (dataPoint.data.success) {
          device.successRate++;
        }
        if (dataPoint.data.responseTime) {
          device.averageResponseTime += dataPoint.data.responseTime;
        }
      }

      if (dataPoint.category === 'device_state' && dataPoint.data.temperature) {
        device.temperatureHistory.push({
          timestamp: dataPoint.timestamp,
          value: dataPoint.data.temperature
        });
      }

      if (dataPoint.data.cop) {
        device.efficiencyMetrics.cop = Math.max(device.efficiencyMetrics.cop, dataPoint.data.cop);
      }
    }

    // Calculate final metrics
    for (const device of Object.values(devices)) {
      const d = device as any;
      if (d.commandCount > 0) {
        d.successRate = (d.successRate / d.commandCount) * 100;
        d.averageResponseTime = d.averageResponseTime / d.commandCount;
      }
    }

    return devices;
  }

  /**
   * Aggregate optimization data for analytics
   */
  private aggregateOptimizationData(dataPoints: DataPoint[]): any {
    const optimizationDataPoints = dataPoints.filter(dp => dp.type === 'optimization');

    let totalSavings = 0;
    let energySaved = 0;
    let costSaved = 0;
    const strategies: Record<string, any> = {};

    for (const dataPoint of optimizationDataPoints) {
      if (dataPoint.data.savings) {
        totalSavings += dataPoint.data.savings;
      }
      if (dataPoint.data.energySaved) {
        energySaved += dataPoint.data.energySaved;
      }
      if (dataPoint.data.costSaved) {
        costSaved += dataPoint.data.costSaved;
      }

      const strategy = dataPoint.data.strategy || 'unknown';
      if (!strategies[strategy]) {
        strategies[strategy] = { usage: 0, success: 0, averageSavings: 0 };
      }
      
      strategies[strategy].usage++;
      if (dataPoint.data.success) {
        strategies[strategy].success++;
      }
      if (dataPoint.data.savings) {
        strategies[strategy].averageSavings += dataPoint.data.savings;
      }
    }

    // Calculate average savings for strategies
    for (const strategy of Object.values(strategies)) {
      const s = strategy as any;
      if (s.usage > 0) {
        s.averageSavings = s.averageSavings / s.usage;
      }
    }

    return {
      totalSavings: Math.round(totalSavings * 100) / 100,
      energySaved: Math.round(energySaved * 100) / 100,
      costSaved: Math.round(costSaved * 100) / 100,
      strategies
    };
  }

  /**
   * Analyze system health trends from historical data
   */
  private analyzeSystemHealthTrends(dataPoints: DataPoint[]): any {
    const memoryDataPoints = dataPoints.filter(dp => dp.type === 'memory');
    const performanceDataPoints = dataPoints.filter(dp => dp.type === 'performance');

    // Calculate uptime percentage
    const totalTime = dataPoints.length > 0 ? 
      new Date().getTime() - new Date(dataPoints[0].timestamp).getTime() : 0;
    const errorDataPoints = dataPoints.filter(dp => 
      dp.data.success === false || dp.metadata?.tags?.includes('error'));
    const uptimePercentage = dataPoints.length > 0 ? 
      ((dataPoints.length - errorDataPoints.length) / dataPoints.length) * 100 : 100;

    // Calculate error rate
    const errorRate = dataPoints.length > 0 ? 
      (errorDataPoints.length / dataPoints.length) * 100 : 0;

    // Analyze memory usage trend
    let memoryUsageTrend: 'stable' | 'increasing' | 'decreasing' = 'stable';
    if (memoryDataPoints.length > 1) {
      const recent = memoryDataPoints.slice(-5);
      const older = memoryDataPoints.slice(-10, -5);
      
      if (recent.length > 0 && older.length > 0) {
        const recentAvg = recent.reduce((sum, dp) => sum + (dp.data.process?.heapUsed || 0), 0) / recent.length;
        const olderAvg = older.reduce((sum, dp) => sum + (dp.data.process?.heapUsed || 0), 0) / older.length;
        
        if (recentAvg > olderAvg * 1.1) {
          memoryUsageTrend = 'increasing';
        } else if (recentAvg < olderAvg * 0.9) {
          memoryUsageTrend = 'decreasing';
        }
      }
    }

    // Analyze performance trend
    let performanceTrend: 'stable' | 'improving' | 'degrading' = 'stable';
    if (performanceDataPoints.length > 1) {
      const recent = performanceDataPoints.slice(-5);
      const older = performanceDataPoints.slice(-10, -5);
      
      if (recent.length > 0 && older.length > 0) {
        const recentResponseTime = recent.reduce((sum, dp) => 
          sum + (dp.data.deviceCommands?.averageResponseTime || 0), 0) / recent.length;
        const olderResponseTime = older.reduce((sum, dp) => 
          sum + (dp.data.deviceCommands?.averageResponseTime || 0), 0) / older.length;
        
        if (recentResponseTime > olderResponseTime * 1.2) {
          performanceTrend = 'degrading';
        } else if (recentResponseTime < olderResponseTime * 0.8) {
          performanceTrend = 'improving';
        }
      }
    }

    return {
      uptimePercentage: Math.round(uptimePercentage * 100) / 100,
      errorRate: Math.round(errorRate * 100) / 100,
      memoryUsageTrend,
      performanceTrend
    };
  }

  /**
   * Reconfigure the data collection service
   */
  public async reconfigureDataCollection(newConfig: Partial<DataCollectionConfig>): Promise<void> {
    try {
      this.logger.info('Reconfiguring Data Collection Service');

      // Stop current intervals
      await this.stop();

      // Update configuration through the config service
      await this.configService.updateDataCollectionConfig(newConfig);

      // Restart with new configuration
      await this.start();

      this.logger.info('Data Collection Service reconfigured successfully');
    } catch (error) {
      this.logger.error('Failed to reconfigure Data Collection Service', error as Error);
      throw error;
    }
  }

  /**
   * Shutdown the service gracefully
   */
  public async shutdown(): Promise<void> {
    try {
      this.logger.info('Shutting down Data Collection Service');

      // Stop all operations
      await this.stop();

      // Run final cleanup if needed
      if (this.dataPoints.size > 10000) {
        await this.runDataCleanup(true);
      }

      // Clear data structures
      this.dataPoints.clear();

      this.logger.info('Data Collection Service shutdown complete');
    } catch (error) {
      this.logger.error('Error during Data Collection Service shutdown', error as Error);
      throw error;
    }
  }
}
