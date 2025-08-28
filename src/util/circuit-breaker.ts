/**
 * Circuit Breaker Pattern Implementation
 * 
 * This utility implements the circuit breaker pattern to prevent cascading failures
 * when external services are unavailable. It tracks failures and temporarily disables
 * calls to a service if it's failing consistently.
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
 * Circuit breaker options
 */
export interface CircuitBreakerOptions {
  failureThreshold: number;     // Number of failures before opening circuit
  resetTimeout: number;         // Time in ms to wait before trying again (half-open)
  halfOpenSuccessThreshold: number; // Number of successes in half-open state to close circuit
  timeout?: number;             // Request timeout in ms
  monitorInterval?: number;     // Interval to log circuit state
}

/**
 * Default circuit breaker options
 */
const DEFAULT_OPTIONS: CircuitBreakerOptions = {
  failureThreshold: 5,
  resetTimeout: 30000, // 30 seconds
  halfOpenSuccessThreshold: 2,
  timeout: 10000, // 10 seconds
  monitorInterval: 60000 // 1 minute
};

/**
 * Circuit breaker implementation
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

    // Start monitoring if interval is set
    const isTestEnv = process.env.NODE_ENV === 'test' || typeof (global as any).jest !== 'undefined' || typeof (process as any).env?.JEST_WORKER_ID !== 'undefined';
    if (isTestEnv) {
      // Disable periodic monitoring in test to avoid open handles
      this.options.monitorInterval = 0;
    }
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
      if (Date.now() - this.lastFailureTime >= this.options.resetTimeout) {
        this.halfOpen();
      } else {
        this.logger.warn(`Circuit ${this.name} is OPEN - failing fast`);
        throw new Error(`Service unavailable (circuit ${this.name} is open)`);
      }
    }

    try {
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
   * Handle successful execution
   */
  private onSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      this.successes++;
      const dbg: any = (this.logger as any).debug || (this.logger as any).log || (this.logger as any).info;
      if (typeof dbg === 'function') {
        dbg.call(this.logger, `Circuit ${this.name} success in HALF_OPEN state (${this.successes}/${this.options.halfOpenSuccessThreshold})`);
      }

      if (this.successes >= this.options.halfOpenSuccessThreshold) {
        this.close();
      }
    } else {
      // Reset failures in closed state
      this.failures = 0;
    }
  }

  /**
   * Handle failed execution
   * @param error Error that occurred
   */
  private onFailure(error: unknown): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    const errorMessage = error instanceof Error ? error.message : String(error);
    this.logger.warn(`Circuit ${this.name} failure: ${errorMessage} (${this.failures}/${this.options.failureThreshold})`);

    if (this.state === CircuitState.CLOSED && this.failures >= this.options.failureThreshold) {
      this.open();
    } else if (this.state === CircuitState.HALF_OPEN) {
      this.open();
    }
  }

  /**
   * Open the circuit
   */
  private open(): void {
    this.state = CircuitState.OPEN;
    this.failures = 0;
    this.successes = 0;
    this.lastFailureTime = Date.now();
    
    this.logger.warn(`Circuit ${this.name} OPENED`);
    
    // Schedule reset
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
    }
    
    this.resetTimer = setTimeout(() => {
      this.halfOpen();
    }, this.options.resetTimeout);
  }

  /**
   * Set circuit to half-open state
   */
  private halfOpen(): void {
    this.state = CircuitState.HALF_OPEN;
    this.failures = 0;
    this.successes = 0;
    
    this.logger.info(`Circuit ${this.name} HALF-OPEN - testing service availability`);
  }

  /**
   * Close the circuit
   */
  private close(): void {
    this.state = CircuitState.CLOSED;
    this.failures = 0;
    this.successes = 0;
    
    this.logger.info(`Circuit ${this.name} CLOSED - service is operational`);
  }

  /**
   * Start monitoring circuit state
   */
  private startMonitoring(): void {
    this.monitorTimer = setInterval(() => {
      const dbg: any = (this.logger as any).debug || (this.logger as any).log || (this.logger as any).info;
      if (typeof dbg === 'function') {
        dbg.call(this.logger, `Circuit ${this.name} state: ${this.state}`);
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
}
