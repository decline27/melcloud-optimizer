# Batch 1: Code Quality and Error Handling Improvements

This document outlines the implementation steps, code examples, and testing procedures for improving error handling and code quality in the MELCloud Optimizer application.

## Overview

The current codebase has inconsistent error handling patterns, direct use of `console.error` instead of a unified logging approach, and redundant code for timeline entry creation. This batch of improvements focuses on:

1. Implementing a consistent error handling mechanism
2. Refactoring timeline entry creation to reduce code duplication
3. Improving the logging system for better debugging and production use

## 1.1 Implement Consistent Error Handling

### Current Issues

- Direct use of `console.error` in various services
- Inconsistent error propagation patterns
- Error messages often lack context
- No centralized error handling strategy

### Implementation Steps

1. Create a new utility class `ErrorHandler` in `src/util/error-handler.ts`
2. Implement methods for handling different types of errors
3. Replace direct console.error calls with the new error handler
4. Add context to error messages

### Code Example

```typescript
// src/util/error-handler.ts
export class ErrorHandler {
  constructor(private logger: any) {}

  /**
   * Handle an error with context
   * @param error The error object
   * @param context The context where the error occurred
   * @param additionalInfo Optional additional information
   */
  public handleError(error: Error, context: string, additionalInfo?: any): void {
    this.logger.error(`Error in ${context}: ${error.message}`, {
      error,
      additionalInfo,
      stack: error.stack
    });
  }

  /**
   * Handle an API error with context
   * @param error The error object
   * @param apiName The name of the API
   * @param endpoint The API endpoint
   * @param additionalInfo Optional additional information
   */
  public handleApiError(error: Error, apiName: string, endpoint: string, additionalInfo?: any): void {
    this.logger.error(`${apiName} API error (${endpoint}): ${error.message}`, {
      error,
      apiName,
      endpoint,
      additionalInfo,
      stack: error.stack
    });
  }

  /**
   * Create a contextual error
   * @param message The error message
   * @param context The context where the error occurred
   * @param originalError Optional original error
   */
  public createError(message: string, context: string, originalError?: Error): Error {
    const contextualMessage = `[${context}] ${message}`;
    const error = new Error(contextualMessage);
    
    if (originalError) {
      error.stack = `${error.stack}\nCaused by: ${originalError.stack}`;
    }
    
    return error;
  }
}
```

### Example Usage in MELCloud API

```typescript
// src/services/melcloud-api.ts
import { ErrorHandler } from '../util/error-handler';

export class MelCloudApi {
  private baseUrl = 'https://app.melcloud.com/Mitsubishi.Wifi.Client/';
  private contextKey: string | null = null;
  private devices: any[] = [];
  private errorHandler: ErrorHandler;

  constructor(private logger: any) {
    this.errorHandler = new ErrorHandler(logger);
  }

  async login(email: string, password: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}Login/ClientLogin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          Email: email,
          Password: password,
          Language: 0,
          AppVersion: '1.23.4.0',
          Persist: true,
          CaptchaResponse: null,
        }),
      });

      const data = await response.json() as any;

      if (data.ErrorId !== null) {
        throw this.errorHandler.createError(
          `MELCloud login failed: ${data.ErrorMessage}`,
          'MelCloudApi.login'
        );
      }

      this.contextKey = data.LoginData.ContextKey;
      return true;
    } catch (error) {
      this.errorHandler.handleApiError(
        error as Error,
        'MELCloud',
        'Login/ClientLogin',
        { email }
      );
      throw error;
    }
  }

  // Update other methods similarly...
}
```

## 1.2 Refactor Timeline Entry Creation

### Current Issues

- Duplicate code for creating timeline entries across multiple methods
- Inconsistent fallback mechanisms
- Redundant error handling

### Implementation Steps

1. Create a new utility class `TimelineHelper` in `src/util/timeline-helper.ts`
2. Implement methods for creating different types of timeline entries
3. Replace duplicate code with calls to the new helper
4. Ensure consistent fallback mechanisms

### Code Example

```typescript
// src/util/timeline-helper.ts
import { ErrorHandler } from './error-handler';

export class TimelineHelper {
  private errorHandler: ErrorHandler;

  constructor(private homey: any, logger: any) {
    this.errorHandler = new ErrorHandler(logger);
  }

  /**
   * Create a timeline entry with fallback mechanisms
   * @param title The title of the entry
   * @param body The body text of the entry
   * @param icon The icon to use (default: 'flow:device_changed')
   * @returns Promise resolving to success status
   */
  public async createTimelineEntry(
    title: string,
    body: string,
    icon: string = 'flow:device_changed'
  ): Promise<boolean> {
    try {
      // Try direct timeline API
      if (typeof this.homey.timeline === 'object' && 
          typeof this.homey.timeline.createEntry === 'function') {
        await this.homey.timeline.createEntry({ title, body, icon });
        return true;
      }
      
      // Try notifications API
      if (typeof this.homey.notifications === 'object' && 
          typeof this.homey.notifications.createNotification === 'function') {
        await this.homey.notifications.createNotification({ 
          excerpt: `${title}: ${body}` 
        });
        return true;
      }
      
      // Try flow API
      if (typeof this.homey.flow === 'object' && 
          typeof this.homey.flow.runFlowCardAction === 'function') {
        await this.homey.flow.runFlowCardAction({
          uri: 'homey:flowcardaction:homey:manager:notifications:create_notification',
          id: 'homey:manager:notifications:create_notification',
          args: { text: `${title}: ${body}` }
        });
        return true;
      }
      
      // No suitable API found
      return false;
    } catch (error) {
      this.errorHandler.handleError(
        error as Error,
        'TimelineHelper.createTimelineEntry',
        { title, body, icon }
      );
      return false;
    }
  }

  /**
   * Create an optimization timeline entry
   * @param isManual Whether this is a manual or automatic optimization
   * @returns Promise resolving to success status
   */
  public async createOptimizationEntry(isManual: boolean): Promise<boolean> {
    const title = 'MELCloud Optimizer';
    const emoji = isManual ? '🔄' : '🕒';
    const triggerType = isManual ? 'Manual' : 'Automatic';
    const body = `${emoji} ${triggerType} hourly optimization | Optimizing based on current prices and COP`;
    
    return this.createTimelineEntry(title, body);
  }

  /**
   * Create a calibration timeline entry
   * @param isManual Whether this is a manual or automatic calibration
   * @returns Promise resolving to success status
   */
  public async createCalibrationEntry(isManual: boolean): Promise<boolean> {
    const title = 'MELCloud Optimizer';
    const emoji = isManual ? '📊' : '📈';
    const triggerType = isManual ? 'Manual' : 'Automatic';
    const body = `${emoji} ${triggerType} weekly calibration | Analyzing thermal model based on collected data`;
    
    return this.createTimelineEntry(title, body);
  }
}
```

### Example Usage in App.ts

```typescript
// In app.ts, update the hourly job to use the TimelineHelper
import { TimelineHelper } from './util/timeline-helper';

// In the constructor or onInit
this.timelineHelper = new TimelineHelper(this.homey, this);

// Replace the timeline entry creation code
this.hourlyJob = new CronJob('0 5 * * * *', async () => {
  // ... existing code ...
  
  // Add a timeline entry for the automatic trigger
  try {
    this.log('Creating timeline entry for hourly job');
    const success = await this.timelineHelper.createOptimizationEntry(false);
    if (success) {
      this.log('Timeline entry created successfully');
    } else {
      this.log('No timeline API available, using log only');
    }
  } catch (err) {
    this.error('Failed to create timeline entry for automatic trigger', err as Error);
  }
  
  // ... rest of the existing code ...
});
```

## 1.3 Improve Logging System

### Current Issues

- Excessive logging, especially in production mode
- Inconsistent log formats
- No log level filtering
- Direct use of console.log in some places

### Implementation Steps

1. Enhance the existing logger in `src/util/logger.ts`
2. Add log level filtering based on environment
3. Implement structured logging for better analysis
4. Replace direct console.log calls with the enhanced logger

### Code Example

```typescript
// src/util/logger.ts
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

export interface LogOptions {
  timestamp?: boolean;
  level?: LogLevel;
  context?: string;
  data?: any;
}

export class Logger {
  private logLevel: LogLevel;
  private isProduction: boolean;

  constructor(private homey: any) {
    // Get log level from settings, default to INFO
    const settingsLevel = this.homey.settings.get('log_level');
    this.logLevel = settingsLevel !== undefined ? settingsLevel : LogLevel.INFO;
    
    // Determine if we're in production mode
    this.isProduction = process.env.NODE_ENV === 'production';
    
    // Log initial configuration
    this.info('Logger initialized', {
      logLevel: this.getLogLevelName(this.logLevel),
      isProduction: this.isProduction
    });
  }

  /**
   * Set the current log level
   * @param level The log level to set
   */
  public setLogLevel(level: LogLevel): void {
    this.logLevel = level;
    this.info(`Log level set to ${this.getLogLevelName(level)}`);
  }

  /**
   * Log a debug message
   * @param message The message to log
   * @param options Optional logging options
   */
  public debug(message: string, options?: Partial<LogOptions>): void {
    this.log(message, { ...options, level: LogLevel.DEBUG });
  }

  /**
   * Log an info message
   * @param message The message to log
   * @param options Optional logging options
   */
  public info(message: string, options?: Partial<LogOptions>): void {
    this.log(message, { ...options, level: LogLevel.INFO });
  }

  /**
   * Log a warning message
   * @param message The message to log
   * @param options Optional logging options
   */
  public warn(message: string, options?: Partial<LogOptions>): void {
    this.log(message, { ...options, level: LogLevel.WARN });
  }

  /**
   * Log an error message
   * @param message The message to log
   * @param error Optional error object
   * @param options Optional logging options
   */
  public error(message: string, error?: Error, options?: Partial<LogOptions>): void {
    const enhancedOptions: Partial<LogOptions> = {
      ...options,
      level: LogLevel.ERROR,
      data: {
        ...(options?.data || {}),
        error: error ? {
          message: error.message,
          stack: error.stack,
          name: error.name
        } : undefined
      }
    };
    
    this.log(message, enhancedOptions);
  }

  /**
   * Internal log method
   * @param message The message to log
   * @param options Logging options
   */
  private log(message: string, options: Partial<LogOptions> = {}): void {
    const level = options.level !== undefined ? options.level : LogLevel.INFO;
    
    // Skip if below current log level
    if (level < this.logLevel) {
      return;
    }
    
    // Skip debug logs in production unless explicitly enabled
    if (level === LogLevel.DEBUG && this.isProduction && this.logLevel !== LogLevel.DEBUG) {
      return;
    }
    
    const timestamp = options.timestamp !== false ? new Date().toISOString() : undefined;
    const context = options.context || '';
    const prefix = context ? `[${context}]` : '';
    
    // Format the log message
    const formattedMessage = timestamp 
      ? `${timestamp} ${this.getLogLevelName(level)} ${prefix} ${message}`
      : `${this.getLogLevelName(level)} ${prefix} ${message}`;
    
    // Log to Homey's logger
    switch (level) {
      case LogLevel.DEBUG:
        this.homey.log(formattedMessage);
        break;
      case LogLevel.INFO:
        this.homey.log(formattedMessage);
        break;
      case LogLevel.WARN:
        this.homey.log(`⚠️ ${formattedMessage}`);
        break;
      case LogLevel.ERROR:
        this.homey.error(`❌ ${formattedMessage}`);
        break;
    }
    
    // Log additional data if present
    if (options.data) {
      this.homey.log('Additional data:', JSON.stringify(options.data, null, 2));
    }
  }

  /**
   * Get the name of a log level
   * @param level The log level
   * @returns The name of the log level
   */
  private getLogLevelName(level: LogLevel): string {
    switch (level) {
      case LogLevel.DEBUG: return 'DEBUG';
      case LogLevel.INFO: return 'INFO';
      case LogLevel.WARN: return 'WARN';
      case LogLevel.ERROR: return 'ERROR';
      default: return 'UNKNOWN';
    }
  }
}
```

### Example Usage

```typescript
// In app.ts
import { Logger, LogLevel } from './util/logger';

// In onInit
this.logger = new Logger(this.homey);

// Set log level based on settings
const logLevelSetting = this.homey.settings.get('log_level');
if (logLevelSetting !== undefined) {
  this.logger.setLogLevel(logLevelSetting);
}

// Use the logger
this.logger.info('MELCloud Optimizer App Starting', { context: 'App.onInit' });
this.logger.debug('Debug information', { 
  context: 'App.onInit',
  data: {
    appId: this.id,
    version: this.manifest.version,
    homeyVersion: this.homey.version
  }
});

// In error scenarios
try {
  // Some operation
} catch (error) {
  this.logger.error('Operation failed', error as Error, { context: 'App.someMethod' });
}
```

## Testing Procedures

### 1. Unit Tests for Error Handler

Create a new test file `test/unit/error-handler.test.ts`:

```typescript
import { ErrorHandler } from '../../src/util/error-handler';

describe('ErrorHandler', () => {
  let mockLogger: any;
  let errorHandler: ErrorHandler;

  beforeEach(() => {
    mockLogger = {
      error: jest.fn()
    };
    errorHandler = new ErrorHandler(mockLogger);
  });

  test('handleError should log error with context', () => {
    const error = new Error('Test error');
    errorHandler.handleError(error, 'TestContext');
    
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Error in TestContext: Test error',
      expect.objectContaining({
        error,
        stack: error.stack
      })
    );
  });

  test('handleApiError should log API error with details', () => {
    const error = new Error('API failure');
    errorHandler.handleApiError(error, 'TestAPI', '/endpoint', { id: 123 });
    
    expect(mockLogger.error).toHaveBeenCalledWith(
      'TestAPI API error (/endpoint): API failure',
      expect.objectContaining({
        error,
        apiName: 'TestAPI',
        endpoint: '/endpoint',
        additionalInfo: { id: 123 },
        stack: error.stack
      })
    );
  });

  test('createError should create error with context', () => {
    const error = errorHandler.createError('Something went wrong', 'TestContext');
    
    expect(error.message).toBe('[TestContext] Something went wrong');
    expect(error instanceof Error).toBe(true);
  });

  test('createError should include original error stack', () => {
    const originalError = new Error('Original error');
    const error = errorHandler.createError('Wrapper error', 'TestContext', originalError);
    
    expect(error.message).toBe('[TestContext] Wrapper error');
    expect(error.stack).toContain('Original error');
  });
});
```

### 2. Unit Tests for Timeline Helper

Create a new test file `test/unit/timeline-helper.test.ts`:

```typescript
import { TimelineHelper } from '../../src/util/timeline-helper';

describe('TimelineHelper', () => {
  let mockHomey: any;
  let mockLogger: any;
  let timelineHelper: TimelineHelper;

  beforeEach(() => {
    mockLogger = {
      error: jest.fn(),
      log: jest.fn()
    };
    
    mockHomey = {
      timeline: {
        createEntry: jest.fn().mockResolvedValue(true)
      },
      notifications: {
        createNotification: jest.fn().mockResolvedValue(true)
      },
      flow: {
        runFlowCardAction: jest.fn().mockResolvedValue(true)
      }
    };
    
    timelineHelper = new TimelineHelper(mockHomey, mockLogger);
  });

  test('createTimelineEntry should use timeline API if available', async () => {
    const result = await timelineHelper.createTimelineEntry('Test Title', 'Test Body');
    
    expect(result).toBe(true);
    expect(mockHomey.timeline.createEntry).toHaveBeenCalledWith({
      title: 'Test Title',
      body: 'Test Body',
      icon: 'flow:device_changed'
    });
    expect(mockHomey.notifications.createNotification).not.toHaveBeenCalled();
    expect(mockHomey.flow.runFlowCardAction).not.toHaveBeenCalled();
  });

  test('createTimelineEntry should fall back to notifications API if timeline not available', async () => {
    mockHomey.timeline = undefined;
    
    const result = await timelineHelper.createTimelineEntry('Test Title', 'Test Body');
    
    expect(result).toBe(true);
    expect(mockHomey.notifications.createNotification).toHaveBeenCalledWith({
      excerpt: 'Test Title: Test Body'
    });
    expect(mockHomey.flow.runFlowCardAction).not.toHaveBeenCalled();
  });

  test('createTimelineEntry should fall back to flow API if timeline and notifications not available', async () => {
    mockHomey.timeline = undefined;
    mockHomey.notifications = undefined;
    
    const result = await timelineHelper.createTimelineEntry('Test Title', 'Test Body');
    
    expect(result).toBe(true);
    expect(mockHomey.flow.runFlowCardAction).toHaveBeenCalledWith({
      uri: 'homey:flowcardaction:homey:manager:notifications:create_notification',
      id: 'homey:manager:notifications:create_notification',
      args: { text: 'Test Title: Test Body' }
    });
  });

  test('createTimelineEntry should return false if no API is available', async () => {
    mockHomey.timeline = undefined;
    mockHomey.notifications = undefined;
    mockHomey.flow = undefined;
    
    const result = await timelineHelper.createTimelineEntry('Test Title', 'Test Body');
    
    expect(result).toBe(false);
  });

  test('createOptimizationEntry should create entry for automatic optimization', async () => {
    jest.spyOn(timelineHelper, 'createTimelineEntry').mockResolvedValue(true);
    
    const result = await timelineHelper.createOptimizationEntry(false);
    
    expect(result).toBe(true);
    expect(timelineHelper.createTimelineEntry).toHaveBeenCalledWith(
      'MELCloud Optimizer',
      '🕒 Automatic hourly optimization | Optimizing based on current prices and COP',
      undefined
    );
  });

  test('createOptimizationEntry should create entry for manual optimization', async () => {
    jest.spyOn(timelineHelper, 'createTimelineEntry').mockResolvedValue(true);
    
    const result = await timelineHelper.createOptimizationEntry(true);
    
    expect(result).toBe(true);
    expect(timelineHelper.createTimelineEntry).toHaveBeenCalledWith(
      'MELCloud Optimizer',
      '🔄 Manual hourly optimization | Optimizing based on current prices and COP',
      undefined
    );
  });
});
```

### 3. Unit Tests for Logger

Create a new test file `test/unit/logger.test.ts`:

```typescript
import { Logger, LogLevel } from '../../src/util/logger';

describe('Logger', () => {
  let mockHomey: any;
  let logger: Logger;

  beforeEach(() => {
    mockHomey = {
      settings: {
        get: jest.fn().mockReturnValue(LogLevel.INFO)
      },
      log: jest.fn(),
      error: jest.fn()
    };
    
    logger = new Logger(mockHomey);
  });

  test('debug should call homey.log with DEBUG prefix', () => {
    logger.setLogLevel(LogLevel.DEBUG);
    logger.debug('Test debug message');
    
    expect(mockHomey.log).toHaveBeenCalledWith(
      expect.stringContaining('DEBUG Test debug message')
    );
  });

  test('info should call homey.log with INFO prefix', () => {
    logger.info('Test info message');
    
    expect(mockHomey.log).toHaveBeenCalledWith(
      expect.stringContaining('INFO Test info message')
    );
  });

  test('warn should call homey.log with WARN prefix', () => {
    logger.warn('Test warning message');
    
    expect(mockHomey.log).toHaveBeenCalledWith(
      expect.stringContaining('⚠️ WARN Test warning message')
    );
  });

  test('error should call homey.error with ERROR prefix', () => {
    logger.error('Test error message');
    
    expect(mockHomey.error).toHaveBeenCalledWith(
      expect.stringContaining('❌ ERROR Test error message')
    );
  });

  test('error with Error object should include error details', () => {
    const error = new Error('Test error');
    logger.error('Something went wrong', error);
    
    expect(mockHomey.error).toHaveBeenCalledWith(
      expect.stringContaining('❌ ERROR Something went wrong')
    );
    expect(mockHomey.log).toHaveBeenCalledWith(
      'Additional data:',
      expect.stringContaining('"message": "Test error"')
    );
  });

  test('logs below current level should be filtered out', () => {
    logger.setLogLevel(LogLevel.WARN);
    
    logger.debug('Debug message');
    logger.info('Info message');
    logger.warn('Warning message');
    
    expect(mockHomey.log).not.toHaveBeenCalledWith(
      expect.stringContaining('DEBUG Debug message')
    );
    expect(mockHomey.log).not.toHaveBeenCalledWith(
      expect.stringContaining('INFO Info message')
    );
    expect(mockHomey.log).toHaveBeenCalledWith(
      expect.stringContaining('⚠️ WARN Warning message')
    );
  });

  test('context should be included in log message', () => {
    logger.info('Test message', { context: 'TestContext' });
    
    expect(mockHomey.log).toHaveBeenCalledWith(
      expect.stringContaining('INFO [TestContext] Test message')
    );
  });
});
```

### 4. Integration Testing

1. Update one service (e.g., MelCloudApi) to use the new error handling and logging
2. Run the application in development mode
3. Verify that errors are properly logged with context
4. Check that timeline entries are created correctly
5. Verify that log levels are respected

### 5. Manual Testing Checklist

- [ ] Verify error handling in edge cases (network errors, API failures)
- [ ] Test timeline entries with different Homey API availability scenarios
- [ ] Check log output format and content in both development and production modes
- [ ] Verify that debug logs are suppressed in production mode
- [ ] Test error recovery scenarios

## Implementation Order

1. Implement the Logger class first
2. Implement the ErrorHandler class
3. Implement the TimelineHelper class
4. Update the MelCloudApi class to use the new utilities
5. Update the App class to use the new utilities
6. Update other services as needed

## Conclusion

These improvements will significantly enhance the code quality, error handling, and logging capabilities of the MELCloud Optimizer application. By implementing a consistent approach to error handling and logging, the application will be more maintainable and easier to debug. The refactored timeline entry creation will reduce code duplication and ensure consistent behavior across the application.
