/**
 * Error Handler Utility
 *
 * Provides standardized error handling across the application.
 * This includes error categorization, logging, and recovery mechanisms.
 */

import { Logger } from './logger';

/**
 * Error categories for better error handling
 */
export enum ErrorCategory {
  NETWORK = 'NETWORK',
  AUTHENTICATION = 'AUTHENTICATION',
  VALIDATION = 'VALIDATION',
  API = 'API',
  DATA = 'DATA',
  INTERNAL = 'INTERNAL',
  UNKNOWN = 'UNKNOWN'
}

/**
 * Extended Error class with additional properties
 */
export class AppError extends Error {
  category: ErrorCategory;
  originalError?: Error | unknown;
  context?: Record<string, any>;
  recoverable: boolean;

  constructor(
    message: string,
    category: ErrorCategory = ErrorCategory.UNKNOWN,
    originalError?: Error | unknown,
    context?: Record<string, any>,
    recoverable: boolean = true
  ) {
    super(message);
    this.name = 'AppError';
    this.category = category;
    this.originalError = originalError;
    this.context = context;
    this.recoverable = recoverable;

    // Maintain proper stack trace for where our error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AppError);
    }
  }
}

/**
 * Type guard to check if a value is an Error
 */
export function isError(value: unknown): value is Error {
  return value instanceof Error;
}

/**
 * Type guard to check if a value is an AppError
 */
export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/**
 * Error handler utility class
 */
export class ErrorHandler {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Categorize an error based on its message or type
   * @param error The error to categorize
   * @returns The error category
   */
  categorizeError(error: unknown): ErrorCategory {
    if (!isError(error)) {
      return ErrorCategory.UNKNOWN;
    }

    const errorMessage = error.message.toLowerCase();

    // Network errors
    if (
      errorMessage.includes('network') ||
      errorMessage.includes('timeout') ||
      errorMessage.includes('connection') ||
      errorMessage.includes('enotfound') ||
      errorMessage.includes('etimedout') ||
      errorMessage.includes('socket') ||
      errorMessage.includes('dns')
    ) {
      return ErrorCategory.NETWORK;
    }

    // Authentication errors
    if (
      errorMessage.includes('auth') ||
      errorMessage.includes('token') ||
      errorMessage.includes('unauthorized') ||
      errorMessage.includes('authentication') ||
      errorMessage.includes('permission') ||
      errorMessage.includes('login') ||
      errorMessage.includes('credentials')
    ) {
      return ErrorCategory.AUTHENTICATION;
    }

    // Validation errors
    if (
      errorMessage.includes('validation') ||
      errorMessage.includes('invalid') ||
      errorMessage.includes('required') ||
      errorMessage.includes('missing') ||
      errorMessage.includes('format')
    ) {
      return ErrorCategory.VALIDATION;
    }

    // API errors
    if (
      errorMessage.includes('api') ||
      errorMessage.includes('http') ||
      errorMessage.includes('status') ||
      errorMessage.includes('response')
    ) {
      return ErrorCategory.API;
    }

    // Data errors
    if (
      errorMessage.includes('data') ||
      errorMessage.includes('parse') ||
      errorMessage.includes('json') ||
      errorMessage.includes('format')
    ) {
      return ErrorCategory.DATA;
    }

    return ErrorCategory.INTERNAL;
  }

  /**
   * Create a standardized AppError from any error
   * @param error Original error
   * @param context Additional context information
   * @param message Optional custom message
   * @returns AppError instance
   */
  createAppError(
    error: unknown,
    context?: Record<string, any>,
    message?: string
  ): AppError {
    // If it's already an AppError, just add context if provided
    if (isAppError(error)) {
      if (context) {
        error.context = { ...error.context, ...context };
      }
      return error;
    }

    // Create a new AppError
    const category = this.categorizeError(error);
    const errorMessage = isError(error)
      ? message || error.message
      : message || String(error);

    return new AppError(
      errorMessage,
      category,
      error,
      context,
      category !== ErrorCategory.AUTHENTICATION // Auth errors are not recoverable by default
    );
  }

  /**
   * Log an error with standardized format
   * @param error The error to log
   * @param context Additional context information
   * @param message Optional custom message
   * @returns The AppError that was logged
   */
  logError(
    error: unknown,
    context?: Record<string, any>,
    message?: string
  ): AppError {
    const appError = this.createAppError(error, context, message);

    // Create a structured log message
    const logContext = {
      category: appError.category,
      recoverable: appError.recoverable,
      ...(appError.context || {}),
      originalError: appError.originalError
    };

    // Log with appropriate level based on category
    switch (appError.category) {
      case ErrorCategory.NETWORK:
        this.logger.warn(`Network Error: ${appError.message}`, logContext);
        break;
      case ErrorCategory.AUTHENTICATION:
        this.logger.error(`Authentication Error: ${appError.message}`, appError.originalError as Error);
        break;
      case ErrorCategory.VALIDATION:
        this.logger.warn(`Validation Error: ${appError.message}`, logContext);
        break;
      default:
        this.logger.error(`${appError.category} Error: ${appError.message}`, appError.originalError as Error);
    }

    return appError;
  }

  /**
   * Handle an error with standardized approach
   * @param error The error to handle
   * @param context Additional context information
   * @param message Optional custom message
   * @param rethrow Whether to rethrow the error after handling
   * @returns AppError instance
   */
  handleError(
    error: unknown,
    context?: Record<string, any>,
    message?: string,
    rethrow: boolean = true
  ): AppError {
    const appError = this.createAppError(error, context, message);

    // Log the error
    this.logError(appError);

    // Rethrow if requested
    if (rethrow) {
      throw appError;
    }

    return appError;
  }

  /**
   * Check if an error is recoverable
   * @param error The error to check
   * @returns True if the error is recoverable
   */
  isRecoverable(error: unknown): boolean {
    if (isAppError(error)) {
      return error.recoverable;
    }

    // Default to true for unknown errors
    return true;
  }
}
