/**
 * Hot Water Usage Learner Service
 *
 * Provides a unified interface for hot water usage pattern learning.
 * Acts as an adapter between the optimizer and the existing HotWaterService,
 * converting between data formats and providing fallback behavior.
 *
 * Features:
 * - Converts HotWaterService patterns to optimizer's HotWaterUsagePattern format
 * - Provides default peak hours when service is unavailable
 * - Handles pattern refresh and updates
 * - Backward compatible with legacy inline learning
 *
 * @module services/hot-water-usage-learner
 */

import { HotWaterUsagePattern, HotWaterService } from '../types';
import { HotWaterAnalyzer } from './hot-water/hot-water-analyzer';

/**
 * Default peak hours for hot water usage when no learned data is available
 * Morning hours (6-8 AM) are typical for most households
 */
export const DEFAULT_HOT_WATER_PEAK_HOURS: readonly number[] = [6, 7, 8];

/**
 * Configuration constants for hot water usage learning
 */
export const HOT_WATER_LEARNER_CONFIG = {
  /** Minimum data points required for learning */
  MIN_DATA_POINTS_FOR_LEARNING: 7,
  /** Minimum data points for high confidence patterns */
  MIN_DATA_POINTS_FOR_CONFIDENCE: 14,
  /** Buffer multiplier for minimum hot water energy (120% of peak) */
  BUFFER_MULTIPLIER: 1.2,
  /** Percentage of top hours to consider as peak (20%) */
  PEAK_HOUR_PERCENTILE: 0.2,
  /** Default minimum buffer if no data available */
  DEFAULT_MINIMUM_BUFFER: 0,
} as const;

/**
 * Logger interface for dependency injection
 */
export interface HotWaterLearnerLogger {
  log(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, error?: unknown): void;
}

/**
 * Usage history entry from external sources (e.g., MELCloud API)
 */
export interface UsageHistoryEntry {
  timestamp: string;
  amount: number;
}

/**
 * Hot Water Usage Learner Service
 *
 * Coordinates hot water usage pattern learning from multiple sources:
 * 1. Dedicated HotWaterService (preferred)
 * 2. Historical usage data from MELCloud API
 * 3. Default patterns as fallback
 *
 * @example
 * ```typescript
 * const learner = new HotWaterUsageLearner(logger);
 *
 * // Learn from historical data
 * learner.learnFromHistory(usageHistory);
 *
 * // Or refresh from HotWaterService
 * learner.refreshFromService(hotWaterService);
 *
 * // Get current pattern
 * const pattern = learner.getPattern();
 * ```
 */
export class HotWaterUsageLearner {
  private readonly logger?: HotWaterLearnerLogger;
  private pattern: HotWaterUsagePattern;

  /**
   * Create a new Hot Water Usage Learner instance
   *
   * @param logger - Logger for diagnostic output (optional)
   * @param initialPattern - Initial pattern to use (optional)
   */
  constructor(logger?: HotWaterLearnerLogger, initialPattern?: HotWaterUsagePattern) {
    this.logger = logger;
    this.pattern = initialPattern ?? this.createDefaultPattern();
  }

  /**
   * Create default hot water usage pattern
   */
  private createDefaultPattern(): HotWaterUsagePattern {
    return {
      hourlyDemand: new Array(24).fill(0),
      peakHours: [...DEFAULT_HOT_WATER_PEAK_HOURS],
      minimumBuffer: HOT_WATER_LEARNER_CONFIG.DEFAULT_MINIMUM_BUFFER,
      lastLearningUpdate: new Date(),
      dataPoints: 0,
    };
  }

  /**
   * Learn hot water usage patterns from historical data
   * @deprecated Not supported in adapter mode. Use HotWaterAnalyzer persistence.
   */
  learnFromHistory(usageHistory: UsageHistoryEntry[]): boolean {
    this.logger?.warn('learnFromHistory is deprecated and has no effect in adapter mode');
    return false;
  }

  /**
   * Refresh pattern from HotWaterService
   *
   * @param service - HotWaterService instance
   * @param daysToAnalyze - Number of days to analyze (default: 14)
   * @returns true if refresh was successful
   */
  refreshFromService(service: HotWaterService | undefined, daysToAnalyze: number = 14): boolean {
    try {
      if (!service) {
        return false;
      }

      const stats = service.getUsageStatistics(daysToAnalyze);
      
      // Use patterns from analyzer if available
      if (stats && stats.patterns) {
        const patterns = stats.patterns;
        
        this.pattern = {
            hourlyDemand: patterns.hourlyUsagePattern,
            peakHours: this.derivePeakHours(patterns.hourlyUsagePattern),
            minimumBuffer: this.pattern.minimumBuffer, // Preserve existing or default
            lastLearningUpdate: new Date(patterns.lastUpdated),
            dataPoints: patterns.confidence * 1.68 // Approx conversion
        };
        return true;
      }

      // Fallback to legacy statistics if patterns not available
      const usageByHour = stats?.statistics?.usageByHourOfDay;
      const dataPointCount = Number(stats?.statistics?.dataPointCount) || 0;

      if (!Array.isArray(usageByHour) || usageByHour.length !== 24 ||
          dataPointCount < HOT_WATER_LEARNER_CONFIG.MIN_DATA_POINTS_FOR_LEARNING) {
        return false;
      }

      const hourlyDemand = usageByHour.map((value: unknown) => Number(value) || 0);
      const peakHours = this.derivePeakHours(hourlyDemand);

      const maxDemand = Math.max(...hourlyDemand, 0);
      const minimumBuffer = maxDemand > 0
        ? maxDemand * HOT_WATER_LEARNER_CONFIG.BUFFER_MULTIPLIER
        : this.pattern.minimumBuffer;

      this.pattern = {
        hourlyDemand,
        peakHours,
        minimumBuffer,
        lastLearningUpdate: new Date(),
        dataPoints: Math.max(dataPointCount, this.pattern.dataPoints),
      };

      return true;
    } catch (error) {
      this.logger?.warn('Failed to refresh hot water usage pattern from service', { error });
      return false;
    }
  }

  /**
   * Derive peak hours from hourly demand
   */
  private derivePeakHours(hourlyDemand: number[]): number[] {
    const ranked = hourlyDemand
      .map((demand, hour) => ({ demand, hour }))
      .filter(({ demand }) => demand > 0)
      .sort((a, b) => b.demand - a.demand);

    if (ranked.length === 0) {
      return [...DEFAULT_HOT_WATER_PEAK_HOURS];
    }

    const topCount = Math.max(1, Math.round(ranked.length * HOT_WATER_LEARNER_CONFIG.PEAK_HOUR_PERCENTILE));
    const peakHours = ranked.slice(0, topCount).map(item => item.hour);

    return peakHours.length > 0 ? peakHours : [...DEFAULT_HOT_WATER_PEAK_HOURS];
  }

  /**
   * Get current hot water usage pattern
   */
  getPattern(): Readonly<HotWaterUsagePattern> {
    return { ...this.pattern };
  }

  /**
   * Get peak hours (convenience method)
   */
  getPeakHours(): readonly number[] {
    return [...this.pattern.peakHours];
  }

  /**
   * Get minimum buffer (convenience method)
   */
  getMinimumBuffer(): number {
    return this.pattern.minimumBuffer;
  }

  /**
   * Get number of data points used for learning
   */
  getDataPointCount(): number {
    return this.pattern.dataPoints;
  }

  /**
   * Check if pattern has sufficient data for confident predictions
   */
  hasConfidentPattern(): boolean {
    return this.pattern.dataPoints >= HOT_WATER_LEARNER_CONFIG.MIN_DATA_POINTS_FOR_CONFIDENCE;
  }

  /**
   * Check if pattern has any learned data
   */
  hasLearnedData(): boolean {
    return this.pattern.dataPoints >= HOT_WATER_LEARNER_CONFIG.MIN_DATA_POINTS_FOR_LEARNING;
  }

  /**
   * Get estimated daily hot water energy consumption
   */
  getEstimatedDailyConsumption(): number {
    return this.pattern.hourlyDemand.reduce((sum, val) => sum + Math.max(val, 0), 0);
  }

  /**
   * Reset pattern to defaults
   */
  reset(): void {
    this.pattern = this.createDefaultPattern();
    this.logger?.log('Hot water usage pattern reset to defaults');
  }

  /**
   * Set pattern directly (for migration/restoration)
   */
  setPattern(pattern: HotWaterUsagePattern): void {
    this.pattern = { ...pattern };
  }
}
