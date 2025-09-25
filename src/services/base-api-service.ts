import { Logger } from '../util/logger';
import { ErrorHandler, AppError, ErrorCategory } from '../util/error-handler';
import { CircuitBreaker, CircuitBreakerOptions } from '../util/circuit-breaker';

/**
 * Error thrown when an API responds with a rate-limit signal.
 */
export class RateLimitError extends Error {
  constructor(
    message: string,
    public readonly retryAfterMs: number | null
  ) {
    super(message);
    this.name = 'RateLimitError';
  }
}

/**
 * Base API Service
 * Provides common functionality for API services
 */
export abstract class BaseApiService {
  protected logger: Logger;
  protected errorHandler: ErrorHandler;
  protected circuitBreaker: CircuitBreaker;
  protected lastApiCallTime: number = 0;
  protected minApiCallInterval: number = 2000; // 2 seconds minimum between calls
  protected rateLimitResetTime: number = 0;
  protected cache: Map<string, { data: any; timestamp: number }> = new Map();
  protected cacheTTL: number = 5 * 60 * 1000; // 5 minutes default TTL

  /**
   * Constructor
   * @param serviceName Name of the service for logging
   * @param logger Logger instance
   * @param circuitBreakerOptions Circuit breaker options
   */
  constructor(
    protected readonly serviceName: string,
    logger: Logger,
    circuitBreakerOptions?: Partial<CircuitBreakerOptions>
  ) {
    this.logger = logger;
    this.errorHandler = new ErrorHandler(this.logger);
    
    // Initialize circuit breaker with improved default options
    this.circuitBreaker = new CircuitBreaker(serviceName, this.logger, {
      failureThreshold: 5,        // More tolerant than before
      resetTimeout: 120000,       // 2 minutes base timeout
      halfOpenSuccessThreshold: 3, // Require 3 successes to close
      timeout: 30000,             // 30 second request timeout
      maxResetTimeout: 1800000,   // Max 30 minutes for exponential backoff
      backoffMultiplier: 2,       // Double timeout on each failure
      adaptiveThresholds: true,   // Enable adaptive behavior
      successRateWindow: 3600000, // 1 hour success rate window
      ...circuitBreakerOptions
    });
  }

  /**
   * Log API call details
   * @param method HTTP method
   * @param endpoint API endpoint
   * @param params Optional parameters
   */
  protected logApiCall(method: string, endpoint: string, params?: any): void {
    this.logger.api(`${method} ${endpoint}`, {
      method,
      endpoint,
      params: params || null,
      timestamp: new Date().toISOString(),
      service: this.serviceName
    });
  }

  /**
   * Create a standardized API error
   * @param error Original error
   * @param context Additional context information
   * @returns AppError instance
   */
  protected createApiError(error: unknown, context?: Record<string, any>): AppError {
    return this.errorHandler.createAppError(error, {
      service: this.serviceName,
      ...context
    });
  }

  /**
   * Get cached data
   * @param key Cache key
   * @returns Cached data or null if not found or expired
   */
  protected getCachedData<T>(key: string): T | null {
    const cached = this.cache.get(key);
    if (!cached) return null;

    const now = Date.now();
    if (now - cached.timestamp > this.cacheTTL) {
      this.cache.delete(key);
      return null;
    }

    return cached.data as T;
  }

  /**
   * Set cached data
   * @param key Cache key
   * @param data Data to cache
   */
  protected setCachedData(key: string, data: any): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  /**
   * Ensure minimum time between API calls
   * @param waitTime Optional override for wait time
   * @returns Promise that resolves when it's safe to make the next API call
   */
  protected async throttle(waitTime?: number): Promise<void> {
    const now = Date.now();
    const timeSinceLastCall = now - this.lastApiCallTime;
    const minInterval = waitTime || this.minApiCallInterval;
    const enforcedDelay = this.rateLimitResetTime > now
      ? this.rateLimitResetTime - now
      : 0;

    if (timeSinceLastCall < minInterval || enforcedDelay > 0) {
      const delay = Math.max(minInterval - timeSinceLastCall, enforcedDelay);
      if (delay > 0) {
        this.logger.debug(`Throttling API call to ${this.serviceName}, waiting ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    this.lastApiCallTime = Date.now();
  }

  /**
   * Update throttling state after a rate limit response.
   * @param waitMs Milliseconds suggested by the remote API before retrying
   */
  protected applyRateLimit(waitMs: number): void {
    const now = Date.now();
    const safeWait = Math.max(waitMs, this.minApiCallInterval);
    this.rateLimitResetTime = Math.max(this.rateLimitResetTime, now + safeWait);
    this.minApiCallInterval = Math.max(this.minApiCallInterval, Math.min(safeWait, 60000));
    this.logger.warn(`Rate limit encountered on ${this.serviceName}, deferring requests for ${safeWait}ms`);
  }

  /**
   * Execute a function with retries
   * @param fn Function to execute
   * @param maxRetries Maximum number of retries
   * @param initialDelay Initial delay in ms
   * @returns Promise resolving to function result
   */
  protected async retryableRequest<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3,
    initialDelay: number = 1000
  ): Promise<T> {
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        if (attempt <= maxRetries) {
          const rateLimitedError = lastError instanceof RateLimitError ? lastError : null;
          const retryDelay = rateLimitedError
            ? (rateLimitedError.retryAfterMs ?? initialDelay * Math.pow(2, attempt - 1))
            : initialDelay * Math.pow(2, attempt - 1);

          this.logger.warn(`API call failed, retrying in ${retryDelay}ms (attempt ${attempt}/${maxRetries})`, {
            error: lastError.message,
            service: this.serviceName,
            rateLimited: Boolean(rateLimitedError)
          });

          await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
      }
    }
    
    throw lastError || new Error(`Request to ${this.serviceName} failed for unknown reason`);
  }

  /**
   * Clean up resources
   */
  public cleanup(): void {
    // Clear cache
    this.cache.clear();
    
    // Clean up circuit breaker
    this.circuitBreaker.cleanup();
    
    this.logger.log(`${this.serviceName} API resources cleaned up`);
  }
}
