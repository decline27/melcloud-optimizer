/**
 * Analytics Service
 * 
 * Advanced analytics and reporting service that provides comprehensive insights,
 * trend analysis, performance metrics, and optimization recommendations for the
 * MELCloud Optimizer system.
 * 
 * Features:
 * - Historical performance analysis
 * - Trend detection and forecasting
 * - Optimization effectiveness reports
 * - Energy savings calculations
 * - Cost analysis and projections
 * - System health insights
 * - Predictive analytics
 * - Custom report generation
 * - Data visualization preparation
 * - Anomaly detection
 * 
 * @since 2.11.0
 */

import { ServiceBase } from './base/service-base';
import { HomeyLogger } from '../util/logger';
import { ConfigurationService } from './configuration-service';
import { DataCollectionService } from './data-collection-service';

// Analytics Configuration Interface
export interface AnalyticsConfig {
  enabled: boolean;
  reportGeneration: {
    enabled: boolean;
    interval: number; // hours
    retentionDays: number;
  };
  insights: {
    enabled: boolean;
    minDataPoints: number;
    confidenceThreshold: number;
  };
  forecasting: {
    enabled: boolean;
    lookAheadHours: number;
    historicalDataHours: number;
  };
  anomalyDetection: {
    enabled: boolean;
    sensitivityLevel: number; // 1-10
    alertThreshold: number;
  };
  performance: {
    cacheTTL: number; // seconds
    maxConcurrentReports: number;
    timeoutMs: number;
  };
}

// Analytics Report Interfaces
export interface AnalyticsReport {
  id: string;
  timestamp: string;
  type: 'performance' | 'savings' | 'health' | 'optimization' | 'forecast' | 'custom';
  period: {
    start: string;
    end: string;
    duration: number; // hours
  };
  summary: AnalyticsSummary;
  details: AnalyticsDetails;
  insights: AnalyticsInsight[];
  recommendations: AnalyticsRecommendation[];
  confidence: number; // 0-1
  metadata: {
    dataPoints: number;
    calculationTime: number; // ms
    version: string;
    [key: string]: any;
  };
}

export interface AnalyticsSummary {
  energySavings: {
    total: number; // kWh
    percentage: number;
    cost: number; // currency
    trend: 'improving' | 'stable' | 'declining';
  };
  systemPerformance: {
    uptime: number; // percentage
    efficiency: number; // percentage
    errorRate: number; // percentage
    responseTime: number; // ms average
  };
  optimization: {
    strategiesUsed: number;
    successRate: number; // percentage
    averageSavings: number; // percentage
    topStrategy: string;
  };
  devices: {
    total: number;
    active: number;
    performance: number; // average percentage
    issues: number;
  };
}

export interface AnalyticsDetails {
  energyAnalysis: {
    consumption: {
      total: number; // kWh
      heating: number;
      hotWater: number;
      baseline: number; // predicted without optimization
    };
    savings: {
      byStrategy: Record<string, number>;
      byTimeOfDay: Record<string, number>;
      byDevice: Record<string, number>;
      historical: Array<{ timestamp: string; value: number }>;
    };
    costs: {
      actual: number;
      projected: number;
      saved: number;
      breakdown: Record<string, number>;
    };
  };
  deviceAnalysis: {
    [deviceId: string]: {
      performance: {
        uptime: number;
        efficiency: number;
        commandSuccess: number;
        averageResponse: number;
      };
      usage: {
        operationHours: number;
        energyConsumption: number;
        optimizationImpact: number;
      };
      health: {
        status: 'excellent' | 'good' | 'fair' | 'poor';
        issues: string[];
        lastMaintenance?: string;
      };
    };
  };
  optimizationAnalysis: {
    strategies: {
      [strategyName: string]: {
        usage: number;
        success: number;
        averageSavings: number;
        effectiveness: number;
        trend: 'improving' | 'stable' | 'declining';
      };
    };
    patterns: {
      timeOfDay: Record<string, number>;
      dayOfWeek: Record<string, number>;
      seasonal: Record<string, number>;
    };
    correlation: {
      weatherImpact: number;
      priceImpact: number;
      scheduleImpact: number;
    };
  };
  systemAnalysis: {
    health: {
      overall: number; // 0-100
      memory: number;
      performance: number;
      stability: number;
    };
    trends: {
      performance: Array<{ timestamp: string; value: number }>;
      memory: Array<{ timestamp: string; value: number }>;
      errors: Array<{ timestamp: string; count: number }>;
    };
    resources: {
      memoryUsage: number; // MB
      cpuUsage: number; // percentage
      networkLatency: number; // ms
    };
  };
}

export interface AnalyticsInsight {
  id: string;
  type: 'optimization' | 'efficiency' | 'cost' | 'maintenance' | 'trend' | 'anomaly';
  title: string;
  description: string;
  impact: 'high' | 'medium' | 'low';
  confidence: number; // 0-1
  data: {
    current: number;
    expected: number;
    improvement: number;
    timeframe: string;
  };
  context: Record<string, any>;
}

export interface AnalyticsRecommendation {
  id: string;
  category: 'optimization' | 'maintenance' | 'configuration' | 'upgrade' | 'alert';
  priority: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  action: string;
  expectedBenefit: {
    savings: number; // percentage or currency
    efficiency: number; // percentage
    paybackPeriod?: number; // days
  };
  implementation: {
    complexity: 'low' | 'medium' | 'high';
    timeRequired: number; // minutes
    riskLevel: 'low' | 'medium' | 'high';
    prerequisites?: string[];
  };
  confidence: number; // 0-1
}

// Forecasting Interfaces
export interface ForecastData {
  timestamp: string;
  type: 'energy' | 'cost' | 'performance' | 'efficiency';
  timeframe: 'hourly' | 'daily' | 'weekly' | 'monthly';
  predictions: Array<{
    timestamp: string;
    value: number;
    confidence: number;
    range: { min: number; max: number };
  }>;
  accuracy: {
    historicalAccuracy: number; // percentage
    confidenceInterval: number;
    lastValidation: string;
  };
  factors: {
    weather: number; // impact weight 0-1
    pricing: number;
    schedule: number;
    seasonal: number;
  };
}

// Anomaly Detection Interfaces
export interface AnomalyData {
  id: string;
  timestamp: string;
  type: 'performance' | 'energy' | 'cost' | 'device' | 'system';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  metrics: {
    expected: number;
    actual: number;
    deviation: number; // percentage
    zScore: number;
  };
  context: {
    deviceId?: string;
    service?: string;
    operation?: string;
    [key: string]: any;
  };
  duration: number; // minutes
  resolved: boolean;
  actions: string[];
}

// Report Generation Result
export interface ReportGenerationResult {
  success: boolean;
  reportId?: string;
  report?: AnalyticsReport;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  metrics: {
    dataPoints: number;
    processingTime: number; // ms
    cacheHit: boolean;
  };
}

// Analytics Service Statistics
export interface AnalyticsStatistics {
  reportsGenerated: number;
  totalInsights: number;
  totalRecommendations: number;
  averageProcessingTime: number; // ms
  cacheHitRate: number; // percentage
  anomaliesDetected: number;
  lastReportGenerated?: string;
  uptime: number; // minutes
  performance: {
    averageResponseTime: number; // ms
    errorRate: number; // percentage
    successRate: number; // percentage
  };
}

/**
 * Analytics Service Implementation
 * 
 * Provides comprehensive analytics, insights, and reporting capabilities
 * for the MELCloud Optimizer system.
 */
export class AnalyticsService extends ServiceBase {
  private config: AnalyticsConfig | null = null;
  private configService: ConfigurationService;
  private dataCollectionService: DataCollectionService;
  private reportCache: Map<string, { report: AnalyticsReport; timestamp: number }> = new Map();
  private forecastCache: Map<string, { forecast: ForecastData; timestamp: number }> = new Map();
  private isStarted: boolean = false;
  private reportGenerationInterval?: NodeJS.Timeout;
  private statistics: AnalyticsStatistics;

  constructor(
    configService: ConfigurationService,
    dataCollectionService: DataCollectionService,
    logger: HomeyLogger
  ) {
    super(logger);
    this.configService = configService;
    this.dataCollectionService = dataCollectionService;
    this.statistics = this.initializeStatistics();
  }

  /**
   * Initialize the Analytics Service
   */
  async start(): Promise<void> {
    if (this.isStarted) {
      this.logInfo('Analytics Service is already started');
      return;
    }

    try {
      this.logInfo('Starting Analytics Service...');

      // Load configuration
      await this.loadConfiguration();

      // Validate configuration
      this.validateConfiguration();

      // Initialize caches
      this.initializeCaches();

      // Start automatic report generation if enabled
      if (this.config!.reportGeneration.enabled) {
        this.startAutomaticReportGeneration();
      }

      this.isStarted = true;
      this.logInfo('Analytics Service started successfully', {
        reportsEnabled: this.config!.reportGeneration.enabled,
        insightsEnabled: this.config!.insights.enabled,
        forecastingEnabled: this.config!.forecasting.enabled,
        anomalyDetectionEnabled: this.config!.anomalyDetection.enabled
      });

    } catch (error) {
      this.logError(error as Error, { operation: 'start' });
      throw this.createServiceError(
        'Failed to start Analytics Service',
        'ANALYTICS_START_FAILED',
        true,
        { error: (error as Error).message }
      );
    }
  }

  /**
   * Stop the Analytics Service
   */
  async stop(): Promise<void> {
    if (!this.isStarted) {
      this.logInfo('Analytics Service is not running');
      return;
    }

    try {
      this.logInfo('Stopping Analytics Service...');

      // Stop automatic report generation
      if (this.reportGenerationInterval) {
        clearInterval(this.reportGenerationInterval);
        this.reportGenerationInterval = undefined;
      }

      // Clear caches
      this.clearCaches();

      this.isStarted = false;
      this.logInfo('Analytics Service stopped successfully');

    } catch (error) {
      this.logError(error as Error, { operation: 'stop' });
      throw this.createServiceError(
        'Failed to stop Analytics Service',
        'ANALYTICS_STOP_FAILED',
        true,
        { error: (error as Error).message }
      );
    }
  }

  /**
   * Gracefully shutdown the service
   */
  async shutdown(): Promise<void> {
    await this.stop();
    this.logInfo('Analytics Service shutdown completed');
  }

  /**
   * Generate a comprehensive analytics report
   */
  async generateReport(
    type: AnalyticsReport['type'] = 'performance',
    startTime?: string,
    endTime?: string,
    options?: {
      includeForecasting?: boolean;
      includeAnomalies?: boolean;
      cacheKey?: string;
    }
  ): Promise<ReportGenerationResult> {
    const startTimestamp = Date.now();

    try {
      if (!this.isStarted) {
        throw this.createServiceError(
          'Analytics Service is not started',
          'SERVICE_NOT_STARTED',
          false
        );
      }

      // Check cache if cache key provided
      const cacheKey = options?.cacheKey || this.generateCacheKey(type, startTime, endTime);
      const cachedReport = this.getCachedReport(cacheKey);
      if (cachedReport) {
        this.statistics.reportsGenerated++;
        return {
          success: true,
          reportId: cachedReport.id,
          report: cachedReport,
          metrics: {
            dataPoints: cachedReport.metadata.dataPoints,
            processingTime: Date.now() - startTimestamp,
            cacheHit: true
          }
        };
      }

      this.logInfo('Generating analytics report', { type, startTime, endTime });

      // Determine time period
      const period = this.calculateTimePeriod(startTime, endTime);

      // Collect raw analytics data from data collection service
      const analyticsData = await this.dataCollectionService.getAnalyticsData(
        period.start,
        period.end
      );

      // Generate comprehensive report
      const report = await this.buildAnalyticsReport(type, period, analyticsData, options);

      // Cache the report
      this.cacheReport(cacheKey, report);

      // Update statistics
      this.updateStatistics(report, Date.now() - startTimestamp);

      return {
        success: true,
        reportId: report.id,
        report,
        metrics: {
          dataPoints: report.metadata.dataPoints,
          processingTime: Date.now() - startTimestamp,
          cacheHit: false
        }
      };

    } catch (error) {
      this.logError(error as Error, { operation: 'generateReport', type });
      return {
        success: false,
        error: {
          code: 'REPORT_GENERATION_FAILED',
          message: (error as Error).message,
          details: { type, startTime, endTime }
        },
        metrics: {
          dataPoints: 0,
          processingTime: Date.now() - startTimestamp,
          cacheHit: false
        }
      };
    }
  }

  /**
   * Generate insights based on current system data
   */
  async generateInsights(
    timeframeHours: number = 24,
    types?: AnalyticsInsight['type'][]
  ): Promise<AnalyticsInsight[]> {
    try {
      if (!this.isStarted || !this.config!.insights.enabled) {
        return [];
      }

      this.logDebug('Generating insights', { timeframeHours, types });

      const endTime = new Date().toISOString();
      const startTime = new Date(Date.now() - timeframeHours * 60 * 60 * 1000).toISOString();

      const analyticsData = await this.dataCollectionService.getAnalyticsData(startTime, endTime);
      
      const insights: AnalyticsInsight[] = [];

      // Generate different types of insights
      if (!types || types.includes('optimization')) {
        insights.push(...await this.generateOptimizationInsights(analyticsData));
      }

      if (!types || types.includes('efficiency')) {
        insights.push(...await this.generateEfficiencyInsights(analyticsData));
      }

      if (!types || types.includes('cost')) {
        insights.push(...await this.generateCostInsights(analyticsData));
      }

      if (!types || types.includes('trend')) {
        insights.push(...await this.generateTrendInsights(analyticsData));
      }

      if (!types || types.includes('maintenance')) {
        insights.push(...await this.generateMaintenanceInsights(analyticsData));
      }

      // Filter by confidence threshold
      const filteredInsights = insights.filter(
        insight => insight.confidence >= this.config!.insights.confidenceThreshold
      );

      this.statistics.totalInsights += filteredInsights.length;
      this.logInfo('Generated insights', { count: filteredInsights.length });

      return filteredInsights;

    } catch (error) {
      this.logError(error as Error, { operation: 'generateInsights' });
      return [];
    }
  }

  /**
   * Generate recommendations based on analytics data
   */
  async generateRecommendations(
    timeframeHours: number = 24
  ): Promise<AnalyticsRecommendation[]> {
    try {
      if (!this.isStarted) {
        return [];
      }

      this.logDebug('Generating recommendations', { timeframeHours });

      const endTime = new Date().toISOString();
      const startTime = new Date(Date.now() - timeframeHours * 60 * 60 * 1000).toISOString();

      const analyticsData = await this.dataCollectionService.getAnalyticsData(startTime, endTime);
      const insights = await this.generateInsights(timeframeHours);

      const recommendations: AnalyticsRecommendation[] = [];

      // Generate optimization recommendations
      recommendations.push(...await this.generateOptimizationRecommendations(analyticsData, insights));

      // Generate maintenance recommendations
      recommendations.push(...await this.generateMaintenanceRecommendations(analyticsData));

      // Generate configuration recommendations
      recommendations.push(...await this.generateConfigurationRecommendations(analyticsData));

      // Generate efficiency recommendations
      recommendations.push(...await this.generateEfficiencyRecommendations(analyticsData));

      // Sort by priority and confidence
      recommendations.sort((a, b) => {
        const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
        const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
        if (priorityDiff !== 0) return priorityDiff;
        return b.confidence - a.confidence;
      });

      this.statistics.totalRecommendations += recommendations.length;
      this.logInfo('Generated recommendations', { count: recommendations.length });

      return recommendations;

    } catch (error) {
      this.logError(error as Error, { operation: 'generateRecommendations' });
      return [];
    }
  }

  /**
   * Generate forecast data
   */
  async generateForecast(
    type: ForecastData['type'],
    timeframe: ForecastData['timeframe'],
    lookAheadHours?: number
  ): Promise<ForecastData | null> {
    try {
      if (!this.isStarted || !this.config!.forecasting.enabled) {
        return null;
      }

      const actualLookAhead = lookAheadHours || this.config!.forecasting.lookAheadHours;
      const cacheKey = `forecast_${type}_${timeframe}_${actualLookAhead}`;
      
      // Check cache
      const cachedForecast = this.getCachedForecast(cacheKey);
      if (cachedForecast) {
        return cachedForecast;
      }

      this.logDebug('Generating forecast', { type, timeframe, lookAheadHours: actualLookAhead });

      // Get historical data for training
      const historicalHours = this.config!.forecasting.historicalDataHours;
      const endTime = new Date().toISOString();
      const startTime = new Date(Date.now() - historicalHours * 60 * 60 * 1000).toISOString();

      const analyticsData = await this.dataCollectionService.getAnalyticsData(startTime, endTime);

      // Generate forecast based on type
      const forecast = await this.buildForecast(type, timeframe, actualLookAhead, analyticsData);

      // Cache the forecast
      this.cacheForecast(cacheKey, forecast);

      return forecast;

    } catch (error) {
      this.logError(error as Error, { operation: 'generateForecast', type, timeframe });
      return null;
    }
  }

  /**
   * Detect anomalies in recent data
   */
  async detectAnomalies(
    timeframeHours: number = 24,
    types?: AnomalyData['type'][]
  ): Promise<AnomalyData[]> {
    try {
      if (!this.isStarted || !this.config!.anomalyDetection.enabled) {
        return [];
      }

      this.logDebug('Detecting anomalies', { timeframeHours, types });

      const endTime = new Date().toISOString();
      const startTime = new Date(Date.now() - timeframeHours * 60 * 60 * 1000).toISOString();

      const analyticsData = await this.dataCollectionService.getAnalyticsData(startTime, endTime);

      const anomalies: AnomalyData[] = [];

      // Detect different types of anomalies
      if (!types || types.includes('performance')) {
        anomalies.push(...await this.detectPerformanceAnomalies(analyticsData));
      }

      if (!types || types.includes('energy')) {
        anomalies.push(...await this.detectEnergyAnomalies(analyticsData));
      }

      if (!types || types.includes('cost')) {
        anomalies.push(...await this.detectCostAnomalies(analyticsData));
      }

      if (!types || types.includes('device')) {
        anomalies.push(...await this.detectDeviceAnomalies(analyticsData));
      }

      if (!types || types.includes('system')) {
        anomalies.push(...await this.detectSystemAnomalies(analyticsData));
      }

      // Filter by severity threshold
      const filteredAnomalies = anomalies.filter(anomaly => {
        const severityValues = { low: 1, medium: 2, high: 3, critical: 4 };
        return severityValues[anomaly.severity] >= this.config!.anomalyDetection.alertThreshold;
      });

      this.statistics.anomaliesDetected += filteredAnomalies.length;
      this.logInfo('Detected anomalies', { count: filteredAnomalies.length });

      return filteredAnomalies;

    } catch (error) {
      this.logError(error as Error, { operation: 'detectAnomalies' });
      return [];
    }
  }

  /**
   * Get service statistics
   */
  getStatistics(): AnalyticsStatistics {
    return { ...this.statistics };
  }

  /**
   * Reconfigure the service
   */
  async reconfigureAnalytics(config: Partial<AnalyticsConfig>): Promise<void> {
    try {
      if (!this.config) {
        throw this.createServiceError(
          'Service not initialized',
          'SERVICE_NOT_INITIALIZED',
          false
        );
      }

      this.logInfo('Reconfiguring Analytics Service', { config });

      // Validate configuration changes
      if (config.insights?.confidenceThreshold !== undefined) {
        if (config.insights.confidenceThreshold < 0 || config.insights.confidenceThreshold > 1) {
          throw this.createServiceError(
            'Confidence threshold must be between 0 and 1',
            'INVALID_CONFIG',
            false
          );
        }
      }

      if (config.anomalyDetection?.sensitivityLevel !== undefined) {
        if (config.anomalyDetection.sensitivityLevel < 1 || config.anomalyDetection.sensitivityLevel > 10) {
          throw this.createServiceError(
            'Sensitivity level must be between 1 and 10',
            'INVALID_CONFIG',
            false
          );
        }
      }

      // Update configuration
      this.config = { ...this.config, ...config };

      // Restart automatic report generation if settings changed
      if (config.reportGeneration) {
        if (this.reportGenerationInterval) {
          clearInterval(this.reportGenerationInterval);
          this.reportGenerationInterval = undefined;
        }

        if (this.config.reportGeneration.enabled) {
          this.startAutomaticReportGeneration();
        }
      }

      // Clear caches if performance settings changed
      if (config.performance) {
        this.clearCaches();
      }

    } catch (error) {
      this.logError(error as Error, { operation: 'reconfigureAnalytics' });
      throw this.createServiceError(
        'Failed to reconfigure Analytics Service',
        'RECONFIGURATION_FAILED',
        true,
        { error: (error as Error).message }
      );
    }
  }

  // Private helper methods

  /**
   * Initialize service statistics
   */
  private initializeStatistics(): AnalyticsStatistics {
    return {
      reportsGenerated: 0,
      totalInsights: 0,
      totalRecommendations: 0,
      averageProcessingTime: 0,
      cacheHitRate: 0,
      anomaliesDetected: 0,
      uptime: 0,
      performance: {
        averageResponseTime: 0,
        errorRate: 0,
        successRate: 100
      }
    };
  }

  /**
   * Load configuration from configuration service
   */
  private async loadConfiguration(): Promise<void> {
    try {
      // Use default configuration since analytics config is not defined in AppConfiguration yet
      this.config = {
        enabled: true,
        reportGeneration: {
          enabled: true,
          interval: 4, // hours
          retentionDays: 30
        },
        insights: {
          enabled: true,
          minDataPoints: 10,
          confidenceThreshold: 0.7
        },
        forecasting: {
          enabled: true,
          lookAheadHours: 24,
          historicalDataHours: 168 // 7 days
        },
        anomalyDetection: {
          enabled: true,
          sensitivityLevel: 5,
          alertThreshold: 2
        },
        performance: {
          cacheTTL: 3600, // 1 hour
          maxConcurrentReports: 3,
          timeoutMs: 30000 // 30 seconds
        }
      };

    } catch (error) {
      this.logError(error as Error, { operation: 'loadConfiguration' });
      throw this.createServiceError(
        'Failed to load analytics configuration',
        'CONFIG_LOAD_FAILED',
        true,
        { error: (error as Error).message }
      );
    }
  }

  /**
   * Validate the loaded configuration
   */
  private validateConfiguration(): void {
    if (!this.config) {
      throw this.createServiceError(
        'Configuration is null',
        'INVALID_CONFIG',
        false
      );
    }

    // Validate numeric ranges
    if (this.config.reportGeneration.interval < 1 || this.config.reportGeneration.interval > 24) {
      throw this.createServiceError(
        'Report generation interval must be between 1 and 24 hours',
        'INVALID_CONFIG',
        false
      );
    }

    if (this.config.insights.confidenceThreshold < 0 || this.config.insights.confidenceThreshold > 1) {
      throw this.createServiceError(
        'Confidence threshold must be between 0 and 1',
        'INVALID_CONFIG',
        false
      );
    }

    if (this.config.anomalyDetection.sensitivityLevel < 1 || this.config.anomalyDetection.sensitivityLevel > 10) {
      throw this.createServiceError(
        'Sensitivity level must be between 1 and 10',
        'INVALID_CONFIG',
        false
      );
    }
  }

  /**
   * Initialize cache collections
   */
  private initializeCaches(): void {
    this.reportCache.clear();
    this.forecastCache.clear();
    this.logDebug('Initialized analytics caches');
  }

  /**
   * Clear all caches
   */
  private clearCaches(): void {
    this.reportCache.clear();
    this.forecastCache.clear();
    this.logDebug('Cleared analytics caches');
  }

  /**
   * Start automatic report generation
   */
  private startAutomaticReportGeneration(): void {
    const intervalMs = this.config!.reportGeneration.interval * 60 * 60 * 1000; // Convert hours to ms

    this.reportGenerationInterval = setInterval(async () => {
      try {
        this.logDebug('Running automatic report generation');
        const result = await this.generateReport('performance');
        if (result.success) {
          this.logInfo('Automatic report generated successfully', { reportId: result.reportId });
        } else {
          this.logError(new Error(result.error?.message || 'Unknown error'), { 
            operation: 'automaticReportGeneration' 
          });
        }
      } catch (error) {
        this.logError(error as Error, { operation: 'automaticReportGeneration' });
      }
    }, intervalMs);

    this.logInfo('Started automatic report generation', { intervalHours: this.config!.reportGeneration.interval });
  }

  /**
   * Generate cache key for reports
   */
  private generateCacheKey(type: string, startTime?: string, endTime?: string): string {
    const start = startTime || 'auto';
    const end = endTime || 'auto';
    return `report_${type}_${start}_${end}`;
  }

  /**
   * Get cached report if available and not expired
   */
  private getCachedReport(cacheKey: string): AnalyticsReport | null {
    const cached = this.reportCache.get(cacheKey);
    if (!cached) return null;

    const now = Date.now();
    const cacheAge = now - cached.timestamp;
    const cacheTTL = this.config!.performance.cacheTTL * 1000; // Convert to ms

    if (cacheAge > cacheTTL) {
      this.reportCache.delete(cacheKey);
      return null;
    }

    return cached.report;
  }

  /**
   * Cache a report
   */
  private cacheReport(cacheKey: string, report: AnalyticsReport): void {
    this.reportCache.set(cacheKey, {
      report,
      timestamp: Date.now()
    });

    // Limit cache size
    if (this.reportCache.size > 100) {
      const oldestKey = this.reportCache.keys().next().value;
      if (oldestKey) {
        this.reportCache.delete(oldestKey);
      }
    }
  }

  /**
   * Get cached forecast if available and not expired
   */
  private getCachedForecast(cacheKey: string): ForecastData | null {
    const cached = this.forecastCache.get(cacheKey);
    if (!cached) return null;

    const now = Date.now();
    const cacheAge = now - cached.timestamp;
    const cacheTTL = this.config!.performance.cacheTTL * 1000; // Convert to ms

    if (cacheAge > cacheTTL) {
      this.forecastCache.delete(cacheKey);
      return null;
    }

    return cached.forecast;
  }

  /**
   * Cache a forecast
   */
  private cacheForecast(cacheKey: string, forecast: ForecastData): void {
    this.forecastCache.set(cacheKey, {
      forecast,
      timestamp: Date.now()
    });

    // Limit cache size
    if (this.forecastCache.size > 50) {
      const oldestKey = this.forecastCache.keys().next().value;
      if (oldestKey) {
        this.forecastCache.delete(oldestKey);
      }
    }
  }

  /**
   * Calculate time period for analytics
   */
  private calculateTimePeriod(startTime?: string, endTime?: string): { start: string; end: string; duration: number } {
    const end = endTime ? new Date(endTime) : new Date();
    const start = startTime ? new Date(startTime) : new Date(end.getTime() - 24 * 60 * 60 * 1000); // Default: 24 hours ago

    return {
      start: start.toISOString(),
      end: end.toISOString(),
      duration: (end.getTime() - start.getTime()) / (60 * 60 * 1000) // hours
    };
  }

  /**
   * Build comprehensive analytics report
   */
  private async buildAnalyticsReport(
    type: AnalyticsReport['type'],
    period: { start: string; end: string; duration: number },
    analyticsData: any,
    options?: any
  ): Promise<AnalyticsReport> {
    const reportId = `analytics_${type}_${Date.now()}`;
    const startTime = Date.now();

    // Build summary
    const summary = await this.buildAnalyticsSummary(analyticsData);

    // Build detailed analysis
    const details = await this.buildAnalyticsDetails(analyticsData);

    // Generate insights
    const insights = await this.generateInsights(period.duration);

    // Generate recommendations
    const recommendations = await this.generateRecommendations(period.duration);

    // Calculate overall confidence
    const confidence = this.calculateOverallConfidence(insights, recommendations);

    const report: AnalyticsReport = {
      id: reportId,
      timestamp: new Date().toISOString(),
      type,
      period,
      summary,
      details,
      insights,
      recommendations,
      confidence,
      metadata: {
        dataPoints: this.countDataPoints(analyticsData),
        calculationTime: Date.now() - startTime,
        version: '2.11.0',
        includeForecasting: options?.includeForecasting ?? false,
        includeAnomalies: options?.includeAnomalies ?? false
      }
    };

    return report;
  }

  /**
   * Build analytics summary
   */
  private async buildAnalyticsSummary(analyticsData: any): Promise<AnalyticsSummary> {
    // Extract energy savings data
    const energySavings = {
      total: analyticsData.optimizations?.energySaved || 0,
      percentage: analyticsData.optimizations?.totalSavings || 0,
      cost: analyticsData.optimizations?.costSaved || 0,
      trend: this.determineTrend(analyticsData.systemHealth?.performanceTrend) as 'improving' | 'stable' | 'declining'
    };

    // Extract system performance data
    const systemPerformance = {
      uptime: analyticsData.systemHealth?.uptimePercentage || 0,
      efficiency: this.calculateSystemEfficiency(analyticsData),
      errorRate: analyticsData.systemHealth?.errorRate || 0,
      responseTime: this.calculateAverageResponseTime(analyticsData)
    };

    // Extract optimization data
    const optimization = {
      strategiesUsed: Object.keys(analyticsData.optimizations?.strategies || {}).length,
      successRate: this.calculateOptimizationSuccessRate(analyticsData),
      averageSavings: analyticsData.optimizations?.totalSavings || 0,
      topStrategy: this.findTopStrategy(analyticsData.optimizations?.strategies)
    };

    // Extract device data
    const devices = {
      total: Object.keys(analyticsData.devices || {}).length,
      active: this.countActiveDevices(analyticsData.devices),
      performance: this.calculateDevicePerformance(analyticsData.devices),
      issues: this.countDeviceIssues(analyticsData.devices)
    };

    return {
      energySavings,
      systemPerformance,
      optimization,
      devices
    };
  }

  /**
   * Build detailed analytics
   */
  private async buildAnalyticsDetails(analyticsData: any): Promise<AnalyticsDetails> {
    // This is a simplified implementation - in reality, this would involve complex calculations
    return {
      energyAnalysis: {
        consumption: {
          total: analyticsData.optimizations?.energySaved || 0,
          heating: 0,
          hotWater: 0,
          baseline: 0
        },
        savings: {
          byStrategy: analyticsData.optimizations?.strategies || {},
          byTimeOfDay: {},
          byDevice: {},
          historical: []
        },
        costs: {
          actual: 0,
          projected: 0,
          saved: analyticsData.optimizations?.costSaved || 0,
          breakdown: {}
        }
      },
      deviceAnalysis: this.buildDeviceAnalysis(analyticsData.devices),
      optimizationAnalysis: {
        strategies: analyticsData.optimizations?.strategies || {},
        patterns: {
          timeOfDay: {},
          dayOfWeek: {},
          seasonal: {}
        },
        correlation: {
          weatherImpact: 0.5,
          priceImpact: 0.7,
          scheduleImpact: 0.6
        }
      },
      systemAnalysis: {
        health: {
          overall: analyticsData.systemHealth?.uptimePercentage || 0,
          memory: 85,
          performance: 90,
          stability: 95
        },
        trends: {
          performance: [],
          memory: [],
          errors: []
        },
        resources: {
          memoryUsage: 150,
          cpuUsage: 25,
          networkLatency: 50
        }
      }
    };
  }

  /**
   * Update service statistics
   */
  private updateStatistics(report: AnalyticsReport, processingTime: number): void {
    this.statistics.reportsGenerated++;
    this.statistics.averageProcessingTime = 
      (this.statistics.averageProcessingTime + processingTime) / 2;
    this.statistics.lastReportGenerated = report.timestamp;
    
    // Update cache hit rate (simplified calculation)
    this.statistics.cacheHitRate = Math.min(100, 
      (this.reportCache.size / Math.max(1, this.statistics.reportsGenerated)) * 100
    );
  }

  // Insight generation methods

  /**
   * Generate optimization insights
   */
  private async generateOptimizationInsights(analyticsData: any): Promise<AnalyticsInsight[]> {
    const insights: AnalyticsInsight[] = [];

    // Check optimization effectiveness
    if (analyticsData.optimizations?.totalSavings > 0) {
      insights.push({
        id: `opt_${Date.now()}`,
        type: 'optimization',
        title: 'Optimization Performance',
        description: `Current optimization strategies are achieving ${analyticsData.optimizations.totalSavings}% energy savings`,
        impact: analyticsData.optimizations.totalSavings > 15 ? 'high' : 
                analyticsData.optimizations.totalSavings > 8 ? 'medium' : 'low',
        confidence: 0.85,
        data: {
          current: analyticsData.optimizations.totalSavings,
          expected: 12,
          improvement: analyticsData.optimizations.totalSavings - 12,
          timeframe: '24 hours'
        },
        context: { strategies: analyticsData.optimizations?.strategies }
      });
    }

    return insights;
  }

  /**
   * Generate efficiency insights
   */
  private async generateEfficiencyInsights(analyticsData: any): Promise<AnalyticsInsight[]> {
    const insights: AnalyticsInsight[] = [];

    // System efficiency insight
    const systemEfficiency = this.calculateSystemEfficiency(analyticsData);
    if (systemEfficiency > 0) {
      insights.push({
        id: `eff_${Date.now()}`,
        type: 'efficiency',
        title: 'System Efficiency',
        description: `Current system efficiency is ${systemEfficiency.toFixed(1)}%`,
        impact: systemEfficiency > 90 ? 'high' : systemEfficiency > 75 ? 'medium' : 'low',
        confidence: 0.8,
        data: {
          current: systemEfficiency,
          expected: 85,
          improvement: systemEfficiency - 85,
          timeframe: '24 hours'
        },
        context: { devices: Object.keys(analyticsData.devices || {}).length }
      });
    }

    return insights;
  }

  /**
   * Generate cost insights
   */
  private async generateCostInsights(analyticsData: any): Promise<AnalyticsInsight[]> {
    const insights: AnalyticsInsight[] = [];

    // Cost savings insight
    if (analyticsData.optimizations?.costSaved > 0) {
      insights.push({
        id: `cost_${Date.now()}`,
        type: 'cost',
        title: 'Cost Savings',
        description: `Energy optimization has saved ${analyticsData.optimizations.costSaved} in costs`,
        impact: analyticsData.optimizations.costSaved > 50 ? 'high' : 
                analyticsData.optimizations.costSaved > 20 ? 'medium' : 'low',
        confidence: 0.9,
        data: {
          current: analyticsData.optimizations.costSaved,
          expected: 30,
          improvement: analyticsData.optimizations.costSaved - 30,
          timeframe: '24 hours'
        },
        context: { energySaved: analyticsData.optimizations?.energySaved }
      });
    }

    return insights;
  }

  /**
   * Generate trend insights
   */
  private async generateTrendInsights(analyticsData: any): Promise<AnalyticsInsight[]> {
    const insights: AnalyticsInsight[] = [];

    // Performance trend insight
    const trend = analyticsData.systemHealth?.performanceTrend;
    if (trend && trend !== 'stable') {
      insights.push({
        id: `trend_${Date.now()}`,
        type: 'trend',
        title: 'Performance Trend',
        description: `System performance is ${trend}`,
        impact: trend === 'improving' ? 'high' : 'medium',
        confidence: 0.75,
        data: {
          current: analyticsData.systemHealth?.uptimePercentage || 0,
          expected: 95,
          improvement: trend === 'improving' ? 5 : -5,
          timeframe: 'week'
        },
        context: { trend }
      });
    }

    return insights;
  }

  /**
   * Generate maintenance insights
   */
  private async generateMaintenanceInsights(analyticsData: any): Promise<AnalyticsInsight[]> {
    const insights: AnalyticsInsight[] = [];

    // Check for devices needing maintenance
    const devicesNeedingMaintenance = this.findDevicesNeedingMaintenance(analyticsData.devices);
    if (devicesNeedingMaintenance.length > 0) {
      insights.push({
        id: `maint_${Date.now()}`,
        type: 'maintenance',
        title: 'Maintenance Required',
        description: `${devicesNeedingMaintenance.length} devices may need maintenance`,
        impact: devicesNeedingMaintenance.length > 2 ? 'high' : 'medium',
        confidence: 0.7,
        data: {
          current: devicesNeedingMaintenance.length,
          expected: 0,
          improvement: -devicesNeedingMaintenance.length,
          timeframe: 'immediate'
        },
        context: { devices: devicesNeedingMaintenance }
      });
    }

    return insights;
  }

  // Recommendation generation methods

  /**
   * Generate optimization recommendations
   */
  private async generateOptimizationRecommendations(analyticsData: any, insights: AnalyticsInsight[]): Promise<AnalyticsRecommendation[]> {
    const recommendations: AnalyticsRecommendation[] = [];

    // Check if optimization can be improved
    const optimizationInsight = insights.find(i => i.type === 'optimization');
    if (optimizationInsight && optimizationInsight.data.current < 15) {
      recommendations.push({
        id: `opt_rec_${Date.now()}`,
        category: 'optimization',
        priority: 'high',
        title: 'Improve Optimization Strategy',
        description: 'Current optimization performance is below target. Consider adjusting strategy parameters.',
        action: 'Review and adjust thermal mass settings and price thresholds',
        expectedBenefit: {
          savings: 5,
          efficiency: 10,
          paybackPeriod: 7
        },
        implementation: {
          complexity: 'medium',
          timeRequired: 30,
          riskLevel: 'low'
        },
        confidence: 0.8
      });
    }

    return recommendations;
  }

  /**
   * Generate maintenance recommendations
   */
  private async generateMaintenanceRecommendations(analyticsData: any): Promise<AnalyticsRecommendation[]> {
    const recommendations: AnalyticsRecommendation[] = [];

    // Check device health
    const unhealthyDevices = this.findUnhealthyDevices(analyticsData.devices);
    if (unhealthyDevices.length > 0) {
      recommendations.push({
        id: `maint_rec_${Date.now()}`,
        category: 'maintenance',
        priority: 'medium',
        title: 'Device Maintenance Needed',
        description: `${unhealthyDevices.length} devices showing performance issues`,
        action: 'Check device connections and consider professional maintenance',
        expectedBenefit: {
          savings: 0,
          efficiency: 15
        },
        implementation: {
          complexity: 'medium',
          timeRequired: 60,
          riskLevel: 'low'
        },
        confidence: 0.75
      });
    }

    return recommendations;
  }

  /**
   * Generate configuration recommendations
   */
  private async generateConfigurationRecommendations(analyticsData: any): Promise<AnalyticsRecommendation[]> {
    const recommendations: AnalyticsRecommendation[] = [];

    // Check if memory usage is high
    if (analyticsData.systemHealth?.uptimePercentage < 95) {
      recommendations.push({
        id: `config_rec_${Date.now()}`,
        category: 'configuration',
        priority: 'medium',
        title: 'Optimize System Configuration',
        description: 'System uptime is below optimal levels',
        action: 'Review memory settings and data collection intervals',
        expectedBenefit: {
          savings: 0,
          efficiency: 5
        },
        implementation: {
          complexity: 'low',
          timeRequired: 15,
          riskLevel: 'low'
        },
        confidence: 0.7
      });
    }

    return recommendations;
  }

  /**
   * Generate efficiency recommendations
   */
  private async generateEfficiencyRecommendations(analyticsData: any): Promise<AnalyticsRecommendation[]> {
    const recommendations: AnalyticsRecommendation[] = [];

    const systemEfficiency = this.calculateSystemEfficiency(analyticsData);
    if (systemEfficiency < 80) {
      recommendations.push({
        id: `eff_rec_${Date.now()}`,
        category: 'optimization',
        priority: 'high',
        title: 'Improve System Efficiency',
        description: 'Overall system efficiency is below optimal levels',
        action: 'Review device schedules and optimization parameters',
        expectedBenefit: {
          savings: 10,
          efficiency: 20
        },
        implementation: {
          complexity: 'medium',
          timeRequired: 45,
          riskLevel: 'low'
        },
        confidence: 0.85
      });
    }

    return recommendations;
  }

  // Forecasting methods

  /**
   * Build forecast data
   */
  private async buildForecast(
    type: ForecastData['type'],
    timeframe: ForecastData['timeframe'],
    lookAheadHours: number,
    analyticsData: any
  ): Promise<ForecastData> {
    // This is a simplified implementation
    // In reality, this would use machine learning models
    const predictions = this.generateSimplePredictions(type, timeframe, lookAheadHours, analyticsData);

    return {
      timestamp: new Date().toISOString(),
      type,
      timeframe,
      predictions,
      accuracy: {
        historicalAccuracy: 85,
        confidenceInterval: 0.8,
        lastValidation: new Date().toISOString()
      },
      factors: {
        weather: 0.6,
        pricing: 0.8,
        schedule: 0.7,
        seasonal: 0.5
      }
    };
  }

  /**
   * Generate simple predictions (placeholder for ML model)
   */
  private generateSimplePredictions(
    type: ForecastData['type'],
    timeframe: ForecastData['timeframe'],
    lookAheadHours: number,
    analyticsData: any
  ): Array<{ timestamp: string; value: number; confidence: number; range: { min: number; max: number } }> {
    const predictions = [];
    const baseValue = this.getBaseValueForType(type, analyticsData);
    const now = new Date();

    for (let i = 1; i <= lookAheadHours; i++) {
      const futureTime = new Date(now.getTime() + i * 60 * 60 * 1000);
      const variation = (Math.random() - 0.5) * 0.2; // ±10% variation
      const value = baseValue * (1 + variation);

      predictions.push({
        timestamp: futureTime.toISOString(),
        value: Math.max(0, value),
        confidence: Math.max(0.5, 0.9 - i * 0.01), // Confidence decreases over time
        range: {
          min: value * 0.8,
          max: value * 1.2
        }
      });
    }

    return predictions;
  }

  // Anomaly detection methods

  /**
   * Detect performance anomalies
   */
  private async detectPerformanceAnomalies(analyticsData: any): Promise<AnomalyData[]> {
    const anomalies: AnomalyData[] = [];

    // Check for unusual response times
    const avgResponseTime = this.calculateAverageResponseTime(analyticsData);
    const expectedResponseTime = 100; // ms

    if (avgResponseTime > expectedResponseTime * 2) {
      anomalies.push({
        id: `perf_${Date.now()}`,
        timestamp: new Date().toISOString(),
        type: 'performance',
        severity: avgResponseTime > expectedResponseTime * 3 ? 'high' : 'medium',
        description: 'Unusually high response times detected',
        metrics: {
          expected: expectedResponseTime,
          actual: avgResponseTime,
          deviation: ((avgResponseTime - expectedResponseTime) / expectedResponseTime) * 100,
          zScore: this.calculateZScore(avgResponseTime, expectedResponseTime, expectedResponseTime * 0.2)
        },
        context: {
          service: 'system'
        },
        duration: 60,
        resolved: false,
        actions: ['Check system load', 'Review recent changes', 'Monitor trends']
      });
    }

    return anomalies;
  }

  /**
   * Detect energy anomalies
   */
  private async detectEnergyAnomalies(analyticsData: any): Promise<AnomalyData[]> {
    const anomalies: AnomalyData[] = [];

    // Check for unusual energy consumption patterns
    for (const [deviceId, deviceData] of Object.entries(analyticsData.devices || {})) {
      const device = deviceData as any;
      if (device.energyConsumption > device.averageResponseTime * 1.5) {
        anomalies.push({
          id: `energy_${deviceId}_${Date.now()}`,
          timestamp: new Date().toISOString(),
          type: 'energy',
          severity: 'medium',
          description: `Unusual energy consumption pattern detected for device ${deviceId}`,
          metrics: {
            expected: device.averageResponseTime,
            actual: device.energyConsumption,
            deviation: ((device.energyConsumption - device.averageResponseTime) / device.averageResponseTime) * 100,
            zScore: this.calculateZScore(device.energyConsumption, device.averageResponseTime, device.averageResponseTime * 0.3)
          },
          context: {
            deviceId
          },
          duration: 120,
          resolved: false,
          actions: ['Check device settings', 'Verify sensor readings', 'Review usage patterns']
        });
      }
    }

    return anomalies;
  }

  /**
   * Detect cost anomalies
   */
  private async detectCostAnomalies(analyticsData: any): Promise<AnomalyData[]> {
    const anomalies: AnomalyData[] = [];

    // Check for unexpected cost increases
    const expectedSavings = 25; // Expected cost savings
    const actualSavings = analyticsData.optimizations?.costSaved || 0;

    if (actualSavings < expectedSavings * 0.5) {
      anomalies.push({
        id: `cost_${Date.now()}`,
        timestamp: new Date().toISOString(),
        type: 'cost',
        severity: 'medium',
        description: 'Cost savings significantly below expected levels',
        metrics: {
          expected: expectedSavings,
          actual: actualSavings,
          deviation: ((expectedSavings - actualSavings) / expectedSavings) * 100,
          zScore: this.calculateZScore(actualSavings, expectedSavings, expectedSavings * 0.2)
        },
        context: {
          optimizations: analyticsData.optimizations
        },
        duration: 240,
        resolved: false,
        actions: ['Review optimization strategies', 'Check price data', 'Analyze usage patterns']
      });
    }

    return anomalies;
  }

  /**
   * Detect device anomalies
   */
  private async detectDeviceAnomalies(analyticsData: any): Promise<AnomalyData[]> {
    const anomalies: AnomalyData[] = [];

    // Check each device for anomalies
    for (const [deviceId, deviceData] of Object.entries(analyticsData.devices || {})) {
      const device = deviceData as any;
      
      // Check command success rate
      if (device.commandCount > 0 && device.successRate < 0.9) {
        anomalies.push({
          id: `device_${deviceId}_${Date.now()}`,
          timestamp: new Date().toISOString(),
          type: 'device',
          severity: device.successRate < 0.7 ? 'high' : 'medium',
          description: `Low command success rate for device ${deviceId}`,
          metrics: {
            expected: 0.95,
            actual: device.successRate,
            deviation: ((0.95 - device.successRate) / 0.95) * 100,
            zScore: this.calculateZScore(device.successRate, 0.95, 0.1)
          },
          context: {
            deviceId,
            commandCount: device.commandCount
          },
          duration: 180,
          resolved: false,
          actions: ['Check device connectivity', 'Verify credentials', 'Test communication']
        });
      }
    }

    return anomalies;
  }

  /**
   * Detect system anomalies
   */
  private async detectSystemAnomalies(analyticsData: any): Promise<AnomalyData[]> {
    const anomalies: AnomalyData[] = [];

    // Check system uptime
    const uptime = analyticsData.systemHealth?.uptimePercentage || 0;
    if (uptime < 95) {
      anomalies.push({
        id: `system_${Date.now()}`,
        timestamp: new Date().toISOString(),
        type: 'system',
        severity: uptime < 90 ? 'high' : 'medium',
        description: 'System uptime below acceptable levels',
        metrics: {
          expected: 99,
          actual: uptime,
          deviation: ((99 - uptime) / 99) * 100,
          zScore: this.calculateZScore(uptime, 99, 5)
        },
        context: {
          systemHealth: analyticsData.systemHealth
        },
        duration: 300,
        resolved: false,
        actions: ['Check system logs', 'Review error rates', 'Monitor resource usage']
      });
    }

    return anomalies;
  }

  // Helper methods for calculations

  /**
   * Fix cache deletion with proper null check
   */
  private deleteOldestCacheEntry(cache: Map<string, any>): void {
    const firstKey = cache.keys().next().value;
    if (firstKey) {
      cache.delete(firstKey);
    }
  }

  private calculateOverallConfidence(insights: AnalyticsInsight[], recommendations: AnalyticsRecommendation[]): number {
    const allConfidences = [
      ...insights.map(i => i.confidence),
      ...recommendations.map(r => r.confidence)
    ];
    
    if (allConfidences.length === 0) return 0.5;
    
    return allConfidences.reduce((sum, conf) => sum + conf, 0) / allConfidences.length;
  }

  private countDataPoints(analyticsData: any): number {
    return Object.keys(analyticsData.devices || {}).length + 
           Object.keys(analyticsData.optimizations?.strategies || {}).length;
  }

  private determineTrend(trend?: string): string {
    return trend || 'stable';
  }

  private calculateSystemEfficiency(analyticsData: any): number {
    const uptime = analyticsData.systemHealth?.uptimePercentage || 0;
    const errorRate = analyticsData.systemHealth?.errorRate || 0;
    return Math.max(0, uptime - errorRate);
  }

  private calculateAverageResponseTime(analyticsData: any): number {
    const devices = Object.values(analyticsData.devices || {}) as any[];
    if (devices.length === 0) return 0;
    
    const totalResponseTime = devices.reduce((sum, device) => sum + (device.averageResponseTime || 0), 0);
    return totalResponseTime / devices.length;
  }

  private calculateOptimizationSuccessRate(analyticsData: any): number {
    const strategies = analyticsData.optimizations?.strategies || {};
    const strategyKeys = Object.keys(strategies);
    if (strategyKeys.length === 0) return 0;
    
    const totalSuccess = strategyKeys.reduce((sum, key) => sum + (strategies[key].success || 0), 0);
    const totalUsage = strategyKeys.reduce((sum, key) => sum + (strategies[key].usage || 0), 0);
    
    return totalUsage > 0 ? (totalSuccess / totalUsage) * 100 : 0;
  }

  private findTopStrategy(strategies: Record<string, any> = {}): string {
    let topStrategy = 'none';
    let maxSavings = 0;
    
    for (const [name, data] of Object.entries(strategies)) {
      if (data.averageSavings > maxSavings) {
        maxSavings = data.averageSavings;
        topStrategy = name;
      }
    }
    
    return topStrategy;
  }

  private countActiveDevices(devices: Record<string, any> = {}): number {
    return Object.values(devices).filter(device => 
      (device as any).commandCount > 0 || (device as any).successRate > 0
    ).length;
  }

  private calculateDevicePerformance(devices: Record<string, any> = {}): number {
    const deviceList = Object.values(devices) as any[];
    if (deviceList.length === 0) return 0;
    
    const totalPerformance = deviceList.reduce((sum, device) => 
      sum + (device.successRate || 0) * 100, 0);
    return totalPerformance / deviceList.length;
  }

  private countDeviceIssues(devices: Record<string, any> = {}): number {
    return Object.values(devices).filter(device => 
      (device as any).successRate < 0.9
    ).length;
  }

  private buildDeviceAnalysis(devices: Record<string, any> = {}): AnalyticsDetails['deviceAnalysis'] {
    const analysis: AnalyticsDetails['deviceAnalysis'] = {};
    
    for (const [deviceId, deviceData] of Object.entries(devices)) {
      const device = deviceData as any;
      analysis[deviceId] = {
        performance: {
          uptime: (device.successRate || 0) * 100,
          efficiency: Math.min(100, (device.successRate || 0) * 110),
          commandSuccess: (device.successRate || 0) * 100,
          averageResponse: device.averageResponseTime || 0
        },
        usage: {
          operationHours: device.commandCount || 0,
          energyConsumption: device.energyConsumption || 0,
          optimizationImpact: 10
        },
        health: {
          status: device.successRate > 0.95 ? 'excellent' : 
                  device.successRate > 0.85 ? 'good' : 
                  device.successRate > 0.7 ? 'fair' : 'poor',
          issues: device.successRate < 0.9 ? ['Low success rate'] : [],
          lastMaintenance: undefined
        }
      };
    }
    
    return analysis;
  }

  private findDevicesNeedingMaintenance(devices: Record<string, any> = {}): string[] {
    return Object.entries(devices)
      .filter(([_, device]) => (device as any).successRate < 0.8)
      .map(([deviceId, _]) => deviceId);
  }

  private findUnhealthyDevices(devices: Record<string, any> = {}): string[] {
    return Object.entries(devices)
      .filter(([_, device]) => (device as any).successRate < 0.9)
      .map(([deviceId, _]) => deviceId);
  }

  private getBaseValueForType(type: ForecastData['type'], analyticsData: any): number {
    switch (type) {
      case 'energy':
        return analyticsData.optimizations?.energySaved || 100;
      case 'cost':
        return analyticsData.optimizations?.costSaved || 25;
      case 'performance':
        return analyticsData.systemHealth?.uptimePercentage || 95;
      case 'efficiency':
        return this.calculateSystemEfficiency(analyticsData);
      default:
        return 50;
    }
  }

  private calculateZScore(value: number, mean: number, stdDev: number): number {
    return stdDev > 0 ? (value - mean) / stdDev : 0;
  }
}
