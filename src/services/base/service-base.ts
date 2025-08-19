import { HomeyLogger } from '../../util/logger';
import { CircuitBreaker } from '../../util/circuit-breaker';

export interface RetryOptions {
  maxRetries: number;
  delayMs: number;
  backoffMultiplier: number;
  maxDelayMs: number;
}

export interface ServiceError extends Error {
  code: string;
  retryable: boolean;
  context?: Record<string, any>;
}

export abstract class ServiceBase {
  protected readonly logger: HomeyLogger;
  protected readonly circuitBreaker: CircuitBreaker;

  constructor(logger: HomeyLogger, circuitBreakerOptions?: any) {
    this.logger = logger;
    
    // Disable monitoring for tests
    const options = {
      monitorInterval: 0, // Disable monitoring
      timeout: 1000,      // Short timeout for tests
      ...circuitBreakerOptions
    };
    
    this.circuitBreaker = new CircuitBreaker(
      this.constructor.name, 
      logger, 
      options
    );
  }

  protected async executeWithRetry<T>(
    operation: () => Promise<T>,
    options: RetryOptions = {
      maxRetries: 3,
      delayMs: 1000,
      backoffMultiplier: 2,
      maxDelayMs: 10000
    }
  ): Promise<T> {
    return this.circuitBreaker.execute(async () => {
      return this.retryableRequest(operation, options);
    });
  }

  private async retryableRequest<T>(
    operation: () => Promise<T>,
    options: RetryOptions
  ): Promise<T> {
    let lastError: Error = new Error('Unknown error');
    
    for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        
        if (attempt === options.maxRetries) {
          break;
        }

        const delay = Math.min(
          options.delayMs * Math.pow(options.backoffMultiplier, attempt),
          options.maxDelayMs
        );

        this.logger.warn(`Operation failed (attempt ${attempt + 1}), retrying in ${delay}ms`, {
          error: error instanceof Error ? error.message : String(error),
          attempt: attempt + 1,
          maxRetries: options.maxRetries
        });

        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw this.createServiceError(
      `Operation failed after ${options.maxRetries + 1} attempts`,
      'OPERATION_FAILED',
      false,
      { lastError: lastError.message }
    );
  }

  protected createServiceError(
    message: string,
    code: string,
    retryable: boolean,
    context?: Record<string, any>
  ): ServiceError {
    const error = new Error(message) as ServiceError;
    error.code = code;
    error.retryable = retryable;
    error.context = context;
    return error;
  }

  protected logError(error: Error, context?: Record<string, any>): void {
    this.logger.error(`${this.constructor.name} error`, {
      error: error.message,
      stack: error.stack,
      ...context
    });
  }

  protected logInfo(message: string, data?: Record<string, any>): void {
    this.logger.info(`${this.constructor.name}: ${message}`, data);
  }

  protected logDebug(message: string, data?: Record<string, any>): void {
    this.logger.debug(`${this.constructor.name}: ${message}`, data);
  }

  protected logWarn(message: string, data?: Record<string, any>): void {
    this.logger.warn(`${this.constructor.name}: ${message}`, data);
  }
}
