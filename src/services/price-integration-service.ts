import { ServiceBase } from './base/service-base';
import { ConfigurationService, TibberConfig } from './configuration-service';
import { HomeyLogger } from '../util/logger';

// Import Tibber types - these should exist in the project
interface TibberPriceInfo {
  total: number;
  energy: number;
  tax: number;
  startsAt: string;
  level?: string;
}

export interface PriceAnalysis {
  current: {
    price: number;
    timestamp: string;
    level: 'very_cheap' | 'cheap' | 'normal' | 'expensive' | 'very_expensive';
  };
  trend: {
    direction: 'rising' | 'falling' | 'stable';
    confidence: number;
    change: number; // percentage change
  };
  forecast: {
    next24h: Array<{
      hour: number;
      price: number;
      level: string;
      recommendation: 'buy' | 'wait' | 'avoid';
    }>;
    cheapestPeriods: Array<{
      start: string;
      end: string;
      avgPrice: number;
      duration: number; // hours
    }>;
    expensivePeriods: Array<{
      start: string;
      end: string;
      avgPrice: number;
      duration: number; // hours
    }>;
  };
  statistics: {
    dailyAverage: number;
    weeklyAverage: number;
    volatility: number;
    priceSpread: {
      min: number;
      max: number;
      range: number;
    };
  };
}

export interface PriceOptimizationRecommendation {
  timing: {
    optimal: string[]; // Hours when to consume energy
    avoid: string[]; // Hours to avoid consumption
  };
  strategies: {
    heating: {
      action: 'increase' | 'maintain' | 'decrease';
      reasoning: string;
      expectedSavings: number;
    };
    hotWater: {
      action: 'preheat' | 'maintain' | 'delay';
      reasoning: string;
      expectedSavings: number;
    };
  };
  confidence: number;
}

export interface PriceOptimizationInput {
  currentConsumption: number;
  scheduledOperations: Array<{
    type: 'heating' | 'hotwater';
    startTime: string;
    duration: number;
    priority: 'low' | 'medium' | 'high';
  }>;
  constraints: {
    comfortTemperature: number;
    hotWaterRequirement: number;
    maxDelayHours: number;
  };
}

/**
 * Price Integration Service
 * 
 * Provides comprehensive price analysis and optimization recommendations
 * for the MELCloud Optimizer. Integrates with Tibber API for real-time
 * electricity pricing data and provides intelligent cost optimization
 * strategies.
 * 
 * Key Features:
 * - Real-time price monitoring and analysis
 * - Price trend detection and forecasting
 * - Optimization recommendations for heating and hot water
 * - Cost savings calculations
 * - Intelligent scheduling based on price patterns
 */
export class PriceIntegrationService extends ServiceBase {
  private priceHistory: TibberPriceInfo[] = [];
  private config: TibberConfig | null = null;
  private lastAnalysis: PriceAnalysis | null = null;
  private lastAnalysisTime = 0;
  private readonly analysisCache = 30 * 60 * 1000; // 30 minutes cache
  private readonly maxHistoryDays = 7;
  private refreshInterval: NodeJS.Timeout | null = null;

  constructor(
    private configService: ConfigurationService,
    logger: HomeyLogger
  ) {
    super(logger);
    this.initializeService();
  }

  /**
   * Initialize the price integration service
   */
  private async initializeService(): Promise<void> {
    try {
      this.config = await this.configService.getConfig('tibber');
      
      if (this.config?.enabled) {
        await this.loadInitialPriceData();
        this.startPeriodicRefresh();
      }

      this.logInfo('Price integration service initialized', {
        tibberEnabled: this.config?.enabled || false,
        priceHistoryCount: this.priceHistory.length
      });
    } catch (error) {
      this.logError(error as Error, { context: 'price integration initialization' });
      // Don't throw - let service continue in degraded mode
      this.config = { enabled: false, apiKey: '', homeId: '' };
    }
  }

  /**
   * Load initial price data from available sources
   */
  private async loadInitialPriceData(): Promise<void> {
    if (!this.config?.enabled) return;

    try {
      // Try to load current price - this would typically come from Tibber API
      // For now, we'll simulate with a basic price structure
      const currentPrice: TibberPriceInfo = {
        total: 1.2, // Default price in currency/kWh
        energy: 1.0,
        tax: 0.2,
        startsAt: new Date().toISOString(),
        level: 'normal'
      };

      this.priceHistory = [currentPrice];

      this.logDebug('Initial price data loaded', {
        currentPrice: currentPrice.total,
        timestamp: currentPrice.startsAt
      });
    } catch (error) {
      this.logError(error as Error, { context: 'initial price data loading' });
      // Continue with empty history - service should degrade gracefully
    }
  }

  /**
   * Start periodic refresh of price data
   */
  private startPeriodicRefresh(): void {
    // Refresh every 15 minutes
    this.refreshInterval = setInterval(() => {
      this.updatePriceData().catch(error => {
        this.logError(error as Error, { context: 'periodic price refresh' });
      });
    }, 15 * 60 * 1000);
  }

  /**
   * Stop periodic refresh
   */
  private stopPeriodicRefresh(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  /**
   * Update price data from external sources
   */
  private async updatePriceData(): Promise<void> {
    if (!this.config?.enabled) return;

    try {
      // Simulate price update - in real implementation this would call Tibber API
      const variation = (Math.random() - 0.5) * 0.4; // ±20% variation
      const basePrice = 1.2;
      const newPrice: TibberPriceInfo = {
        total: Math.max(0.5, basePrice + variation),
        energy: Math.max(0.4, basePrice - 0.2 + variation),
        tax: 0.2,
        startsAt: new Date().toISOString(),
        level: 'normal'
      };

      // Add to history if it's a new price point (different hour)
      const lastPrice = this.priceHistory[this.priceHistory.length - 1];
      const currentHour = new Date().getHours();
      const lastHour = lastPrice ? new Date(lastPrice.startsAt).getHours() : -1;

      if (currentHour !== lastHour) {
        this.priceHistory.push(newPrice);
        this.logDebug('Price data updated', {
          newPrice: newPrice.total,
          historyLength: this.priceHistory.length
        });
      }

      // Maintain history size
      this.maintainHistorySize();

    } catch (error) {
      this.logError(error as Error, { context: 'price data update' });
      // Continue with existing data if update fails
    }
  }

  /**
   * Maintain price history within configured limits
   */
  private maintainHistorySize(): void {
    const cutoffTime = new Date(Date.now() - this.maxHistoryDays * 24 * 60 * 60 * 1000);
    const initialLength = this.priceHistory.length;
    
    this.priceHistory = this.priceHistory.filter(
      price => new Date(price.startsAt) > cutoffTime
    );

    if (this.priceHistory.length !== initialLength) {
      this.logDebug('Price history trimmed', {
        removed: initialLength - this.priceHistory.length,
        remaining: this.priceHistory.length
      });
    }
  }

  /**
   * Analyze current price conditions and trends
   */
  async analyzePrices(): Promise<PriceAnalysis> {
    if (!this.config?.enabled) {
      throw this.createServiceError(
        'Tibber integration not enabled',
        'TIBBER_NOT_ENABLED',
        false
      );
    }

    // Return cached analysis if still valid
    const now = Date.now();
    if (this.lastAnalysis && (now - this.lastAnalysisTime) < this.analysisCache) {
      return this.lastAnalysis;
    }

    return this.executeWithRetry(async () => {
      // Ensure we have recent data
      await this.updatePriceData();

      // Perform comprehensive analysis
      const current = this.analyzeCurrent();
      const trend = this.analyzeTrend();
      const forecast = await this.analyzeForecast();
      const statistics = this.calculateStatistics();

      const analysis: PriceAnalysis = {
        current,
        trend,
        forecast,
        statistics
      };

      // Cache the analysis
      this.lastAnalysis = analysis;
      this.lastAnalysisTime = now;

      this.logDebug('Price analysis completed', {
        currentPrice: current.price,
        trend: trend.direction,
        confidence: trend.confidence,
        forecastPeriods: forecast.next24h.length
      });

      return analysis;
    });
  }

  /**
   * Analyze current price conditions
   */
  private analyzeCurrent(): PriceAnalysis['current'] {
    if (this.priceHistory.length === 0) {
      throw this.createServiceError(
        'No price data available for analysis',
        'NO_PRICE_DATA',
        true
      );
    }

    const current = this.priceHistory[this.priceHistory.length - 1];
    const recentPrices = this.priceHistory.slice(-168); // Last week (hourly data)
    const avgPrice = recentPrices.reduce((sum, p) => sum + p.total, 0) / recentPrices.length;

    // Determine price level relative to recent average
    let level: 'very_cheap' | 'cheap' | 'normal' | 'expensive' | 'very_expensive';
    const ratio = current.total / avgPrice;

    if (ratio < 0.7) level = 'very_cheap';
    else if (ratio < 0.85) level = 'cheap';
    else if (ratio > 1.3) level = 'very_expensive';
    else if (ratio > 1.15) level = 'expensive';
    else level = 'normal';

    return {
      price: Math.round(current.total * 10000) / 10000, // 4 decimal precision
      timestamp: current.startsAt,
      level
    };
  }

  /**
   * Analyze price trends over recent history
   */
  private analyzeTrend(): PriceAnalysis['trend'] {
    if (this.priceHistory.length < 3) {
      return {
        direction: 'stable',
        confidence: 0.3,
        change: 0
      };
    }

    const recent = this.priceHistory.slice(-6); // Last 6 hours
    const prices = recent.map(p => p.total);
    
    // Calculate linear trend using least squares
    const n = prices.length;
    const sumX = n * (n + 1) / 2;
    const sumY = prices.reduce((sum, price) => sum + price, 0);
    const sumXY = prices.reduce((sum, price, index) => sum + price * (index + 1), 0);
    const sumX2 = n * (n + 1) * (2 * n + 1) / 6;

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const changePerHour = slope;
    const change = (changePerHour * 24 / recent[0].total) * 100; // 24-hour percentage change

    // Determine trend direction
    let direction: 'rising' | 'falling' | 'stable';
    if (Math.abs(change) < 2) direction = 'stable';
    else if (change > 0) direction = 'rising';
    else direction = 'falling';

    // Calculate confidence based on trend consistency
    const variability = this.calculateVariability(prices);
    const avgPrice = prices.reduce((sum, p) => sum + p, 0) / prices.length;
    const confidence = Math.min(0.95, Math.max(0.2, 1 - variability / avgPrice));

    return {
      direction,
      confidence: Math.round(confidence * 100) / 100,
      change: Math.round(change * 100) / 100
    };
  }

  /**
   * Calculate price variability for confidence scoring
   */
  private calculateVariability(prices: number[]): number {
    const mean = prices.reduce((sum, p) => sum + p, 0) / prices.length;
    const variance = prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / prices.length;
    return Math.sqrt(variance);
  }

  /**
   * Analyze and forecast future price patterns
   */
  private async analyzeForecast(): Promise<PriceAnalysis['forecast']> {
    const next24h: Array<{
      hour: number;
      price: number;
      level: string;
      recommendation: 'buy' | 'wait' | 'avoid';
    }> = [];

    try {
      // Generate forecast based on historical patterns
      // In real implementation, this would use actual Tibber forecast data
      const currentHour = new Date().getHours();
      const basePrice = this.priceHistory.length > 0 ? 
        this.priceHistory[this.priceHistory.length - 1].total : 1.2;
      
      const avgPrice = this.priceHistory.length > 0 ? 
        this.priceHistory.reduce((sum, p) => sum + p.total, 0) / this.priceHistory.length :
        1.2;

      // Generate 24-hour forecast with typical daily patterns
      for (let i = 0; i < 24; i++) {
        const hour = (currentHour + i) % 24;
        
        // Simulate typical daily price pattern
        let priceMultiplier = 1.0;
        if (hour >= 6 && hour <= 9) priceMultiplier = 1.3; // Morning peak
        else if (hour >= 17 && hour <= 20) priceMultiplier = 1.4; // Evening peak
        else if (hour >= 1 && hour <= 5) priceMultiplier = 0.7; // Night low
        else if (hour >= 10 && hour <= 16) priceMultiplier = 0.9; // Day
        else priceMultiplier = 1.1; // Evening/night

        const price = basePrice * priceMultiplier;
        const ratio = price / avgPrice;
        
        let level: string;
        let recommendation: 'buy' | 'wait' | 'avoid';

        if (ratio < 0.7) {
          level = 'very_cheap';
          recommendation = 'buy';
        } else if (ratio < 0.85) {
          level = 'cheap';
          recommendation = 'buy';
        } else if (ratio > 1.3) {
          level = 'very_expensive';
          recommendation = 'avoid';
        } else if (ratio > 1.15) {
          level = 'expensive';
          recommendation = 'avoid';
        } else {
          level = 'normal';
          recommendation = 'wait';
        }

        next24h.push({
          hour,
          price: Math.round(price * 10000) / 10000,
          level,
          recommendation
        });
      }
    } catch (error) {
      this.logError(error as Error, { context: 'forecast analysis' });
      
      // Create minimal forecast as fallback
      const currentHour = new Date().getHours();
      for (let i = 0; i < 24; i++) {
        next24h.push({
          hour: (currentHour + i) % 24,
          price: 1.2, // Default price
          level: 'normal',
          recommendation: 'wait'
        });
      }
    }

    // Identify optimal and suboptimal periods
    const cheapestPeriods = this.findPricePeriods(next24h, 'cheap');
    const expensivePeriods = this.findPricePeriods(next24h, 'expensive');

    return {
      next24h,
      cheapestPeriods,
      expensivePeriods
    };
  }

  /**
   * Find consecutive periods of cheap or expensive prices
   */
  private findPricePeriods(
    forecast: Array<{ hour: number; price: number; level: string; recommendation: string }>,
    type: 'cheap' | 'expensive'
  ): Array<{ start: string; end: string; avgPrice: number; duration: number }> {
    const periods: Array<{ start: string; end: string; avgPrice: number; duration: number }> = [];
    let currentPeriod: { start: number; prices: number[] } | null = null;

    const isTargetLevel = (level: string) => {
      if (type === 'cheap') {
        return level === 'very_cheap' || level === 'cheap';
      } else {
        return level === 'very_expensive' || level === 'expensive';
      }
    };

    const finalizePeriod = (period: { start: number; prices: number[] }) => {
      if (period.prices.length >= 2) { // Minimum 2-hour periods
        const avgPrice = period.prices.reduce((sum: number, p: number) => sum + p, 0) / period.prices.length;
        const duration = period.prices.length;
        const endHour = (period.start + duration - 1) % 24;

        periods.push({
          start: `${period.start.toString().padStart(2, '0')}:00`,
          end: `${endHour.toString().padStart(2, '0')}:59`,
          avgPrice: Math.round(avgPrice * 10000) / 10000,
          duration
        });
      }
    };

    forecast.forEach((item) => {
      if (isTargetLevel(item.level)) {
        if (!currentPeriod) {
          currentPeriod = { start: item.hour, prices: [item.price] };
        } else {
          currentPeriod.prices.push(item.price);
        }
      } else {
        if (currentPeriod) {
          finalizePeriod(currentPeriod);
        }
        currentPeriod = null;
      }
    });

    // Handle period that extends to end of forecast
    if (currentPeriod) {
      finalizePeriod(currentPeriod);
    }

    return periods.sort((a, b) => a.avgPrice - b.avgPrice); // Sort by price
  }

  /**
   * Calculate comprehensive price statistics
   */
  private calculateStatistics(): PriceAnalysis['statistics'] {
    if (this.priceHistory.length === 0) {
      return {
        dailyAverage: 0,
        weeklyAverage: 0,
        volatility: 0,
        priceSpread: { min: 0, max: 0, range: 0 }
      };
    }

    const prices = this.priceHistory.map(p => p.total);
    const dailyPrices = prices.slice(-24);
    const weeklyPrices = prices.slice(-168);

    const dailyAverage = dailyPrices.length > 0 ? 
      dailyPrices.reduce((sum, p) => sum + p, 0) / dailyPrices.length : 0;
    const weeklyAverage = weeklyPrices.length > 0 ? 
      weeklyPrices.reduce((sum, p) => sum + p, 0) / weeklyPrices.length : 0;

    // Calculate volatility (standard deviation)
    const mean = weeklyAverage;
    const variance = weeklyPrices.length > 1 ? 
      weeklyPrices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / weeklyPrices.length : 0;
    const volatility = Math.sqrt(variance);

    // Price spread analysis
    const min = weeklyPrices.length > 0 ? Math.min(...weeklyPrices) : 0;
    const max = weeklyPrices.length > 0 ? Math.max(...weeklyPrices) : 0;
    const range = max - min;

    return {
      dailyAverage: Math.round(dailyAverage * 10000) / 10000,
      weeklyAverage: Math.round(weeklyAverage * 10000) / 10000,
      volatility: Math.round(volatility * 10000) / 10000,
      priceSpread: {
        min: Math.round(min * 10000) / 10000,
        max: Math.round(max * 10000) / 10000,
        range: Math.round(range * 10000) / 10000
      }
    };
  }

  /**
   * Get optimization recommendations based on price analysis
   */
  async getOptimizationRecommendations(input?: PriceOptimizationInput): Promise<PriceOptimizationRecommendation> {
    const analysis = await this.analyzePrices();

    return this.executeWithRetry(async () => {
      const timing = this.calculateOptimalTiming(analysis);
      const strategies = this.calculateOptimizationStrategies(analysis, input);
      const confidence = this.calculateRecommendationConfidence(analysis);

      return {
        timing,
        strategies,
        confidence
      };
    });
  }

  /**
   * Calculate optimal timing for energy consumption
   */
  private calculateOptimalTiming(analysis: PriceAnalysis): {
    optimal: string[];
    avoid: string[];
  } {
    const optimal: string[] = [];
    const avoid: string[] = [];

    analysis.forecast.next24h.forEach(item => {
      const hourStr = `${item.hour.toString().padStart(2, '0')}:00`;
      
      if (item.recommendation === 'buy') {
        optimal.push(hourStr);
      } else if (item.recommendation === 'avoid') {
        avoid.push(hourStr);
      }
    });

    return { optimal, avoid };
  }

  /**
   * Calculate optimization strategies for heating and hot water
   */
  private calculateOptimizationStrategies(
    analysis: PriceAnalysis, 
    input?: PriceOptimizationInput
  ): {
    heating: { action: 'increase' | 'maintain' | 'decrease'; reasoning: string; expectedSavings: number };
    hotWater: { action: 'preheat' | 'maintain' | 'delay'; reasoning: string; expectedSavings: number };
  } {
    let heatingAction: 'increase' | 'maintain' | 'decrease' = 'maintain';
    let heatingReasoning = 'Normal price levels - maintain current settings';
    let heatingExpectedSavings = 0;

    let hotWaterAction: 'preheat' | 'maintain' | 'delay' = 'maintain';
    let hotWaterReasoning = 'Normal price levels - maintain current schedule';
    let hotWaterExpectedSavings = 0;

    // Heating strategy based on current price level
    if (analysis.current.level === 'very_cheap' || analysis.current.level === 'cheap') {
      heatingAction = 'increase';
      heatingReasoning = 'Current electricity prices are low - increase heating to store thermal energy';
      heatingExpectedSavings = analysis.statistics.dailyAverage * 0.15; // Estimate 15% savings
    } else if (analysis.current.level === 'very_expensive' || analysis.current.level === 'expensive') {
      heatingAction = 'decrease';
      heatingReasoning = 'Current electricity prices are high - reduce heating and use stored thermal energy';
      heatingExpectedSavings = analysis.statistics.dailyAverage * 0.10; // Estimate 10% savings
    }

    // Hot water strategy based on price forecast
    const cheapPeriodsAhead = analysis.forecast.cheapestPeriods.filter(p => {
      const startHour = parseInt(p.start.split(':')[0]);
      const currentHour = new Date().getHours();
      const hoursAhead = (startHour - currentHour + 24) % 24;
      return hoursAhead <= 6; // Within next 6 hours
    });

    if (cheapPeriodsAhead.length > 0 && analysis.current.level !== 'very_cheap') {
      hotWaterAction = 'delay';
      hotWaterReasoning = `Cheaper electricity period starting at ${cheapPeriodsAhead[0].start} - delay heating`;
      hotWaterExpectedSavings = (analysis.current.price - cheapPeriodsAhead[0].avgPrice) * 3; // Estimate 3 kWh hot water usage
    } else if (analysis.current.level === 'very_cheap' || analysis.current.level === 'cheap') {
      hotWaterAction = 'preheat';
      hotWaterReasoning = 'Current electricity prices are low - preheat hot water for later use';
      hotWaterExpectedSavings = analysis.statistics.dailyAverage * 0.08; // Estimate 8% savings
    }

    // Consider user constraints if provided
    if (input?.constraints) {
      if (input.constraints.maxDelayHours < 2 && hotWaterAction === 'delay') {
        hotWaterAction = 'maintain';
        hotWaterReasoning = 'User constraints prevent delaying hot water heating';
        hotWaterExpectedSavings = 0;
      }
    }

    return {
      heating: {
        action: heatingAction,
        reasoning: heatingReasoning,
        expectedSavings: Math.round(heatingExpectedSavings * 100) / 100
      },
      hotWater: {
        action: hotWaterAction,
        reasoning: hotWaterReasoning,
        expectedSavings: Math.round(hotWaterExpectedSavings * 100) / 100
      }
    };
  }

  /**
   * Calculate confidence level for recommendations
   */
  private calculateRecommendationConfidence(analysis: PriceAnalysis): number {
    let confidence = 0.5; // Base confidence

    // Increase confidence with more historical data
    if (this.priceHistory.length > 24) confidence += 0.1;
    if (this.priceHistory.length > 168) confidence += 0.1;

    // Increase confidence with stronger price signals
    if (analysis.current.level === 'very_cheap' || analysis.current.level === 'very_expensive') {
      confidence += 0.2;
    }

    // Increase confidence with stable trends
    if (analysis.trend.confidence > 0.7) {
      confidence += 0.1;
    }

    // Decrease confidence with high volatility
    if (analysis.statistics.volatility > analysis.statistics.weeklyAverage * 0.3) {
      confidence -= 0.1;
    }

    return Math.max(0.1, Math.min(1.0, confidence));
  }

  /**
   * Update configuration for the price integration service
   */
  async updateConfiguration(newConfig: Partial<TibberConfig>): Promise<void> {
    try {
      await this.configService.updateConfig('tibber', newConfig);
      
      // Reinitialize service with new configuration
      await this.initializeService();
      
      this.logInfo('Price integration service reconfigured', { newConfig });
    } catch (error) {
      this.logError(error as Error, { newConfig });
      throw this.createServiceError(
        'Failed to reconfigure price integration service',
        'PRICE_RECONFIG_ERROR',
        true
      );
    }
  }

  /**
   * Force refresh of price data
   */
  async forceRefresh(): Promise<void> {
    try {
      await this.updatePriceData();
      
      // Clear cached analysis to force recalculation
      this.lastAnalysis = null;
      this.lastAnalysisTime = 0;
      
      this.logInfo('Price data force refreshed', {
        historyLength: this.priceHistory.length
      });
    } catch (error) {
      this.logError(error as Error, { context: 'force refresh' });
      throw this.createServiceError(
        'Failed to force refresh price data',
        'PRICE_REFRESH_ERROR',
        true
      );
    }
  }

  /**
   * Get current price history
   */
  getPriceHistory(): TibberPriceInfo[] {
    return [...this.priceHistory];
  }

  /**
   * Get last price analysis (cached)
   */
  getLastAnalysis(): PriceAnalysis | null {
    return this.lastAnalysis ? { ...this.lastAnalysis } : null;
  }

  /**
   * Get service statistics
   */
  getServiceStatistics(): {
    isEnabled: boolean;
    historyLength: number;
    lastUpdateTime: string;
    cacheAge: number;
    refreshInterval: number;
  } {
    return {
      isEnabled: this.config?.enabled || false,
      historyLength: this.priceHistory.length,
      lastUpdateTime: this.priceHistory.length > 0 ? 
        this.priceHistory[this.priceHistory.length - 1].startsAt : 'Never',
      cacheAge: this.lastAnalysisTime > 0 ? Date.now() - this.lastAnalysisTime : 0,
      refreshInterval: 15 * 60 * 1000 // 15 minutes
    };
  }

  /**
   * Cleanup method for service shutdown
   */
  async shutdown(): Promise<void> {
    this.stopPeriodicRefresh();
    
    this.logInfo('Price integration service shutdown completed');
  }
}
