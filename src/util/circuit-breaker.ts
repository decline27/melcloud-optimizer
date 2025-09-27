/**
 * Circuit Breaker Pattern Implementation with Adaptive Behavior
 * 
 * Enhanced implementation with exponential backoff, adaptive thresholds,
 * and better resilience against intermittent failures.
 */

import { Logger } from './logger';

/**
 * Circuit breaker states
 */
export enum CircuitState {
  CLOSED = 'CLOSED',   // Normal operation, requests pass through
  OPEN = 'OPEN',       // Circuit is open, requests fail fast
  HALF_OPEN = 'HALF_OPEN' // Testing if service is back online
}

/**
 * Circuit breaker options with adaptive features
 */
export interface CircuitBreakerOptions {
  failureThreshold: number;     // Number of failures before opening circuit
  resetTimeout: number;         // Base time in ms to wait before trying again (half-open)
  halfOpenSuccessThreshold: number; // Number of successes in half-open state to close circuit
  timeout?: number;             // Request timeout in ms
  monitorInterval?: number;     // Interval to log circuit state
  maxResetTimeout?: number;     // Maximum reset timeout (for exponential backoff)
  backoffMultiplier?: number;   // Multiplier for exponential backoff
  adaptiveThresholds?: boolean; // Enable adaptive threshold adjustment
  successRateWindow?: number;   // Time window for success rate calculation (ms)
}

/**
 * Default circuit breaker options with improved resilience
 */
const DEFAULT_OPTIONS: CircuitBreakerOptions = {
  failureThreshold: 5,          // Increased from 3 to 5
  resetTimeout: 120000,         // Increased from 30000 to 120000 (2 minutes)
  halfOpenSuccessThreshold: 3,  // Increased from 1-2 to 3 for more stability
  timeout: 30000,               // Increased from 10000-15000 to 30000 (30 seconds)
  monitorInterval: 300000,      // 5 minutes (reduced logging frequency)
  maxResetTimeout: 1800000,     // Maximum 30 minutes for exponential backoff
  backoffMultiplier: 2,         // Double the timeout on each consecutive failure
  adaptiveThresholds: true,     // Enable adaptive behavior
  successRateWindow: 3600000    // 1 hour window for success rate tracking
};

/**
 * Circuit breaker implementation with adaptive features
 */
export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failures: number = 0;
  private successes: number = 0;
  private lastFailureTime: number = 0;
  private resetTimer: NodeJS.Timeout | null = null;
  private monitorTimer: NodeJS.Timeout | null = null;
  private options: CircuitBreakerOptions;
  private logger: Logger;
  
  // Adaptive behavior tracking
  private consecutiveFailures: number = 0;
  private currentResetTimeout: number;
  private successHistory: Array<{timestamp: number, success: boolean}> = [];
  private adaptiveFailureThreshold: number;

  /**
   * Constructor
   * @param name Circuit breaker name (for logging)
   * @param logger Logger instance
   * @param options Circuit breaker options
   */
  constructor(
    private readonly name: string,
    logger: Logger,
    options: Partial<CircuitBreakerOptions> = {}
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.logger = logger;
    this.currentResetTimeout = this.options.resetTimeout;
    this.adaptiveFailureThreshold = this.options.failureThreshold;

    // Start monitoring if interval is set
    if (this.options.monitorInterval && this.options.monitorInterval > 0) {
      this.startMonitoring();
    }
  }

  /**
   * Execute a function with circuit breaker protection
   * @param fn Function to execute
   * @returns Promise resolving to function result
   * @throws Error if circuit is open or function fails
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if circuit is open
      if (this.state === CircuitState.OPEN) {
      // Check if it's time to try again
      if (Date.now() - this.lastFailureTime >= this.currentResetTimeout) {
        this.halfOpen();
      } else {
        // Defensive logging - handle undefined logger gracefully
        if (this.logger && typeof this.logger.warn === 'function') {
          this.logger.warn(`Circuit ${this.name} is OPEN - failing fast`);
        }
        throw new Error(`Service unavailable (circuit ${this.name} is open)`);
      }
    }    try {
      // Execute the function
      const result = await this.executeWithTimeout(fn);

      // Record success
      this.onSuccess();
      return result;
    } catch (error) {
      // Record failure
      this.onFailure(error);
      throw error;
    }
  }

  /**
   * Execute a function with timeout
   * @param fn Function to execute
   * @returns Promise resolving to function result
   */
  private async executeWithTimeout<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.options.timeout) {
      return fn();
    }

    return Promise.race([
      fn(),
      new Promise<T>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Request timeout after ${this.options.timeout}ms`));
        }, this.options.timeout);
      })
    ]);
  }

  /**
   * Handle successful execution with adaptive behavior
   */
  private onSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      this.successes++;
      
      // Defensive logging - handle undefined logger gracefully
      if (this.logger && typeof this.logger.debug === 'function') {
        this.logger.debug(`Circuit ${this.name} success in HALF_OPEN state (${this.successes}/${this.options.halfOpenSuccessThreshold})`);
      }

      if (this.successes >= (this.options.halfOpenSuccessThreshold || 3)) {
        this.close();
      }
    } else {
      // Reset failure tracking in closed state
      this.consecutiveFailures = 0;
      this.currentResetTimeout = this.options.resetTimeout;
      this.failures = 0;
    }

    // Track success for adaptive behavior
    this.updateSuccessHistory(true);
  }

  /**
   * Handle failed execution with adaptive behavior
   * @param error Error that occurred
   */
  private onFailure(error: unknown): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    const errorMessage = error instanceof Error ? error.message : String(error);
    
    // Defensive logging - handle undefined logger gracefully
    if (this.logger && typeof this.logger.warn === 'function') {
      this.logger.warn(`Circuit ${this.name} failure: ${errorMessage} (${this.failures}/${this.adaptiveFailureThreshold})`);
    } else {
      // Fallback to console if logger is unavailable during first-time setup
      console.warn(`[CircuitBreaker] ${this.name} failure: ${errorMessage} (${this.failures}/${this.adaptiveFailureThreshold})`);
    }

    // Track failure for adaptive behavior
    this.updateSuccessHistory(false);

    if (this.state === CircuitState.CLOSED && this.failures >= this.adaptiveFailureThreshold) {
      this.open();
    } else if (this.state === CircuitState.HALF_OPEN) {
      this.open();
    }
  }

  /**
   * Open the circuit with exponential backoff
   */
  private open(): void {
    this.state = CircuitState.OPEN;
    this.failures = 0;
    this.successes = 0;
    this.lastFailureTime = Date.now();
    this.consecutiveFailures++;
    
    // Implement exponential backoff
    this.currentResetTimeout = Math.min(
      this.currentResetTimeout * (this.options.backoffMultiplier || 2), 
      this.options.maxResetTimeout || 1800000
    );
    
    // Defensive logging - handle undefined logger gracefully
    if (this.logger && typeof this.logger.warn === 'function') {
      this.logger.warn(`Circuit ${this.name} OPENED (attempt ${this.consecutiveFailures}, reset in ${this.currentResetTimeout}ms)`);
    } else {
      console.warn(`[CircuitBreaker] ${this.name} OPENED (attempt ${this.consecutiveFailures}, reset in ${this.currentResetTimeout}ms)`);
    }
    
    // Schedule reset
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
    }
    
    this.resetTimer = setTimeout(() => {
      this.halfOpen();
    }, this.currentResetTimeout);
  }

  /**
   * Set circuit to half-open state
   */
  private halfOpen(): void {
    this.state = CircuitState.HALF_OPEN;
    this.failures = 0;
    this.successes = 0;
    
    // Defensive logging - handle undefined logger gracefully
    if (this.logger && typeof this.logger.info === 'function') {
      this.logger.info(`Circuit ${this.name} HALF-OPEN - testing service availability`);
    }
  }

  /**
   * Close the circuit
   */
  private close(): void {
    this.state = CircuitState.CLOSED;
    this.failures = 0;
    this.successes = 0;
    this.currentResetTimeout = this.options.resetTimeout; // Reset to base timeout
    
    // Defensive logging - handle undefined logger gracefully
    if (this.logger && typeof this.logger.info === 'function') {
      this.logger.info(`Circuit ${this.name} CLOSED - service is operational`);
    }
  }

  /**
   * Start monitoring circuit state
   */
  private startMonitoring(): void {
    this.monitorTimer = setInterval(() => {
      // Defensive logging - handle undefined logger gracefully
      if (this.logger && typeof this.logger.debug === 'function') {
        this.logger.debug(`Circuit ${this.name} state: ${this.state}`);
      }
    }, this.options.monitorInterval);
  }

  /**
   * Get current circuit state
   * @returns Current circuit state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Clean up resources
   */
  cleanup(): void {
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
      this.resetTimer = null;
    }
    
    if (this.monitorTimer) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = null;
    }
  }

  /**
   * Update success/failure history for adaptive behavior
   * @param success Whether the operation was successful
   */
  private updateSuccessHistory(success: boolean): void {
    const now = Date.now();
    this.successHistory.push({ timestamp: now, success });

    // Remove outdated entries
    const windowStart = now - (this.options.successRateWindow || 3600000);
    this.successHistory = this.successHistory.filter(entry => entry.timestamp >= windowStart);

    // Adjust failure threshold adaptively
    if (this.options.adaptiveThresholds) {
      const successCount = this.successHistory.filter(entry => entry.success).length;
      const totalCount = this.successHistory.length;
      
      if (totalCount >= 10) { // Need minimum sample size
        const successRate = successCount / totalCount;
        
        // Adjust threshold based on success rate
        if (successRate > 0.95) {
          // Very reliable service - can be more tolerant of failures
          this.adaptiveFailureThreshold = Math.max(7, this.options.failureThreshold);
        } else if (successRate > 0.85) {
          // Reliable service - use base threshold
          this.adaptiveFailureThreshold = this.options.failureThreshold;
        } else if (successRate > 0.70) {
          // Moderately reliable - be slightly more sensitive
          this.adaptiveFailureThreshold = Math.max(3, this.options.failureThreshold - 1);
        } else {
          // Unreliable service - be more sensitive
          this.adaptiveFailureThreshold = Math.max(2, Math.floor(this.options.failureThreshold / 2));
        }
        
        // Defensive logging - handle undefined logger gracefully
        if (this.logger && typeof this.logger.debug === 'function') {
          this.logger.debug(`Circuit ${this.name} adaptive threshold: ${this.adaptiveFailureThreshold} (success rate: ${(successRate * 100).toFixed(1)}%)`);
        }
      }
    }
  }
}
