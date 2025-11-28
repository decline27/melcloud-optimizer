/**
 * COP Normalizer Service
 *
 * Provides adaptive COP (Coefficient of Performance) normalization using learned ranges.
 * Maintains a rolling history of observed COP values and uses percentile-based bounds
 * to filter outliers and provide stable 0-1 normalized values.
 *
 * Features:
 * - Outlier rejection (values outside 0.5-6.0 range)
 * - Percentile-based range learning (5th-95th percentile)
 * - Persistence to Homey settings for recovery across restarts
 * - Memory-efficient rolling history (max 100 samples)
 *
 * @module services/cop-normalizer
 */

import { HomeyApp } from '../types';

/**
 * Configurable constants for COP normalization
 */
export const COP_NORMALIZER_CONFIG = {
  /** Absolute minimum valid COP value */
  MIN_VALID_COP: 0.5,
  /** Absolute maximum valid COP value */
  MAX_VALID_COP: 6.0,
  /** Maximum history samples to retain */
  MAX_HISTORY_SIZE: 100,
  /** Minimum samples required for percentile calculation */
  MIN_SAMPLES_FOR_PERCENTILE: 5,
  /** Lower percentile for range calculation (5th) */
  LOWER_PERCENTILE: 0.05,
  /** Upper percentile for range calculation (95th) */
  UPPER_PERCENTILE: 0.95,
  /** Settings key for persisting COP guards */
  SETTINGS_KEY: 'cop_guards_v1',
  /** Log every N updates */
  LOG_INTERVAL: 50,
  /** Default min observed COP when no data */
  DEFAULT_MIN: 1.0,
  /** Default max observed COP when no data */
  DEFAULT_MAX: 5.0,
} as const;

/**
 * State structure for COP range tracking
 */
export interface COPRangeState {
  /** Minimum observed COP (5th percentile) */
  minObserved: number;
  /** Maximum observed COP (95th percentile) */
  maxObserved: number;
  /** Total number of updates */
  updateCount: number;
  /** Rolling history of COP values */
  history: number[];
}

/**
 * Persisted COP guards structure (stored in Homey settings)
 */
export interface PersistedCOPGuards {
  minObserved: number;
  maxObserved: number;
  updateCount: number;
  history: number[];
}

/**
 * Logger interface for dependency injection
 */
export interface COPNormalizerLogger {
  log(message: string): void;
  warn(message: string): void;
}

/**
 * COP Normalizer Service
 *
 * Normalizes COP values to a 0-1 range using adaptive bounds learned from observed data.
 * Filters outliers using percentile-based ranges and persists state across restarts.
 *
 * @example
 * ```typescript
 * const normalizer = new CopNormalizer(homey, logger);
 *
 * // Add observations
 * normalizer.updateRange(3.5);
 * normalizer.updateRange(4.2);
 *
 * // Get normalized value
 * const normalized = normalizer.normalize(3.8); // Returns 0-1
 * ```
 */
export class CopNormalizer {
  private readonly homey?: HomeyApp;
  private readonly logger?: COPNormalizerLogger;
  private state: COPRangeState;

  /**
   * Create a new COP Normalizer instance
   *
   * @param homey - Homey instance for settings persistence (optional)
   * @param logger - Logger for diagnostic output (optional)
   */
  constructor(homey?: HomeyApp, logger?: COPNormalizerLogger) {
    this.homey = homey;
    this.logger = logger;

    // Initialize with defaults
    this.state = {
      minObserved: COP_NORMALIZER_CONFIG.DEFAULT_MIN,
      maxObserved: COP_NORMALIZER_CONFIG.DEFAULT_MAX,
      updateCount: 0,
      history: [],
    };

    // Restore from persisted state if available
    this.restoreFromSettings();
  }

  /**
   * Restore COP range state from Homey settings
   */
  private restoreFromSettings(): void {
    if (!this.homey) return;

    try {
      const persisted = this.homey.settings.get(COP_NORMALIZER_CONFIG.SETTINGS_KEY) as PersistedCOPGuards | null;

      if (persisted && this.isValidPersistedState(persisted)) {
        this.state.history = persisted.history.slice(-COP_NORMALIZER_CONFIG.MAX_HISTORY_SIZE);

        if (typeof persisted.minObserved === 'number' && Number.isFinite(persisted.minObserved)) {
          this.state.minObserved = persisted.minObserved;
        }

        if (typeof persisted.maxObserved === 'number' && Number.isFinite(persisted.maxObserved)) {
          this.state.maxObserved = persisted.maxObserved;
        }

        if (typeof persisted.updateCount === 'number' && Number.isFinite(persisted.updateCount)) {
          this.state.updateCount = persisted.updateCount;
        }

        this.logger?.log(
          `COP guards restored - Range: ${this.state.minObserved.toFixed(2)} - ${this.state.maxObserved.toFixed(2)}, ${this.state.history.length} samples`
        );
      }
    } catch (error) {
      this.logger?.warn(`Failed to restore COP guards: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Validate persisted state structure
   */
  private isValidPersistedState(state: unknown): state is PersistedCOPGuards {
    if (!state || typeof state !== 'object') return false;
    const s = state as Record<string, unknown>;
    return Array.isArray(s.history);
  }

  /**
   * Persist COP range state to Homey settings
   */
  private persistToSettings(): void {
    if (!this.homey) return;

    try {
      this.homey.settings.set(COP_NORMALIZER_CONFIG.SETTINGS_KEY, {
        minObserved: this.state.minObserved,
        maxObserved: this.state.maxObserved,
        updateCount: this.state.updateCount,
        history: this.state.history,
      } as PersistedCOPGuards);
    } catch (error) {
      this.logger?.warn(`Failed to persist COP guards: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Update COP range based on an observed value with outlier filtering
   *
   * @param cop - Observed COP value
   * @returns true if the value was accepted, false if rejected as outlier
   */
  updateRange(cop: number): boolean {
    // Guard: reject non-finite, out-of-bounds values
    if (!Number.isFinite(cop) ||
        cop < COP_NORMALIZER_CONFIG.MIN_VALID_COP ||
        cop > COP_NORMALIZER_CONFIG.MAX_VALID_COP) {
      this.logger?.warn(
        `COP outlier rejected: ${cop} (valid range: ${COP_NORMALIZER_CONFIG.MIN_VALID_COP} - ${COP_NORMALIZER_CONFIG.MAX_VALID_COP})`
      );
      return false;
    }

    // Add to rolling history (max entries)
    this.state.history.push(cop);
    if (this.state.history.length > COP_NORMALIZER_CONFIG.MAX_HISTORY_SIZE) {
      this.state.history.shift();
    }
    this.state.updateCount++;

    // Recompute min/max using percentiles
    if (this.state.history.length >= COP_NORMALIZER_CONFIG.MIN_SAMPLES_FOR_PERCENTILE) {
      const sorted = [...this.state.history].sort((a, b) => a - b);
      const lowerIndex = Math.floor(sorted.length * COP_NORMALIZER_CONFIG.LOWER_PERCENTILE);
      const upperIndex = Math.floor(sorted.length * COP_NORMALIZER_CONFIG.UPPER_PERCENTILE);
      this.state.minObserved = sorted[lowerIndex];
      this.state.maxObserved = sorted[upperIndex];
    }

    // Persist to settings
    this.persistToSettings();

    // Log range updates periodically
    if (this.state.updateCount % COP_NORMALIZER_CONFIG.LOG_INTERVAL === 0) {
      this.logger?.log(
        `COP range updated after ${this.state.updateCount} observations: ${this.state.minObserved.toFixed(2)} - ${this.state.maxObserved.toFixed(2)} (${this.state.history.length} samples)`
      );
    }

    return true;
  }

  /**
   * Normalize a COP value using the adaptive learned range
   *
   * @param cop - COP value to normalize
   * @returns Normalized COP value between 0 and 1
   */
  normalize(cop: number): number {
    const range = this.state.maxObserved - this.state.minObserved;

    // Default if no range established
    if (range <= 0) {
      return 0.5;
    }

    // Clamp input COP to learned range, then normalize to 0-1
    const clampedCOP = Math.min(
      Math.max(cop, this.state.minObserved),
      this.state.maxObserved
    );

    return Math.min(
      Math.max((clampedCOP - this.state.minObserved) / range, 0),
      1
    );
  }

  /**
   * Get a rough normalization without learned range (for fallback usage)
   *
   * Uses a simple linear normalization with configurable assumed max COP.
   * Useful when the CopNormalizer instance is not available or not initialized.
   *
   * @param cop - COP value to normalize
   * @param assumedMax - Assumed maximum COP for normalization (default: 5.0)
   * @returns Normalized COP value between 0 and 1
   */
  static roughNormalize(cop: number, assumedMax: number = 5.0): number {
    return Math.min(Math.max(cop / assumedMax, 0), 1);
  }

  /**
   * Get current COP range state (for diagnostics/testing)
   *
   * @returns Current COP range state (deep copy for immutability)
   */
  getState(): Readonly<COPRangeState> {
    return {
      ...this.state,
      history: [...this.state.history],
    };
  }

  /**
   * Get current range bounds
   *
   * @returns Object with min and max observed COP values
   */
  getRange(): { min: number; max: number } {
    return {
      min: this.state.minObserved,
      max: this.state.maxObserved,
    };
  }

  /**
   * Get the number of samples in history
   *
   * @returns Number of COP samples in history
   */
  getSampleCount(): number {
    return this.state.history.length;
  }

  /**
   * Get total update count
   *
   * @returns Total number of COP updates processed
   */
  getUpdateCount(): number {
    return this.state.updateCount;
  }

  /**
   * Check if normalizer has enough data for reliable normalization
   *
   * @returns true if at least MIN_SAMPLES_FOR_PERCENTILE samples are available
   */
  hasReliableData(): boolean {
    return this.state.history.length >= COP_NORMALIZER_CONFIG.MIN_SAMPLES_FOR_PERCENTILE;
  }

  /**
   * Reset the normalizer to default state
   *
   * Clears history and resets bounds to defaults. Does not persist the reset
   * until the next updateRange() call.
   */
  reset(): void {
    this.state = {
      minObserved: COP_NORMALIZER_CONFIG.DEFAULT_MIN,
      maxObserved: COP_NORMALIZER_CONFIG.DEFAULT_MAX,
      updateCount: 0,
      history: [],
    };

    // Persist the reset
    this.persistToSettings();

    this.logger?.log('COP normalizer reset to defaults');
  }
}
