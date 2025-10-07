import { App } from 'homey';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  NONE = 99
}

/**
 * Log categories for filtering logs
 */
export enum LogCategory {
  GENERAL = 'general',
  API = 'api',
  OPTIMIZATION = 'optimization',
  THERMAL_MODEL = 'thermal_model',
  TIMELINE = 'timeline',
  SYSTEM = 'system'
}

/**
 * Logger configuration options
 */
export interface LoggerConfig {
  level?: LogLevel;
  logToTimeline?: boolean;
  prefix?: string;
  enabledCategories?: LogCategory[];
  includeTimestamps?: boolean;
  includeSourceModule?: boolean;
  verboseMode?: boolean;
}

/**
 * Logger interface for standardized logging across the application
 */
export interface Logger {
  log(message: string, ...args: any[]): void;
  info(message: string, ...args: any[]): void;
  error(message: string, error?: Error | unknown, context?: Record<string, any>): void;
  debug(message: string, ...args: any[]): void;
  warn(message: string, context?: Record<string, any>): void;
  api(message: string, context?: Record<string, any>): void;
  optimization(message: string, context?: Record<string, any>): void;
  notify(message: string): Promise<void>;
  marker(message: string): void;
  sendToTimeline(message: string, type?: 'info' | 'warning' | 'error'): Promise<void>;
  setLogLevel(level: LogLevel): void;
  setTimelineLogging(enabled: boolean): void;
  getLogLevel(): LogLevel;
  enableCategory(category: LogCategory): void;
  disableCategory(category: LogCategory): void;
  isCategoryEnabled(category: LogCategory): boolean;
  formatValue(value: any): string;
}

/**
 * Detect if running in development mode via Homey CLI
 * @returns True if running in development mode
 */
export function isRunningInDevMode(): boolean {
  // Check for NODE_ENV environment variable
  if (process.env.NODE_ENV === 'development') {
    return true;
  }

  // Check for Homey CLI specific environment variables or conditions
  // This is a simplified check - Homey might have other indicators
  if (process.env.HOMEY_CLI || process.env.HOMEY_APP_ID) {
    return true;
  }

  return false;
}

/**
 * Format a timestamp in a human-readable format
 * @returns Formatted timestamp
 */
function getFormattedTimestamp(): string {
  const now = new Date();
  return now.toISOString().replace('T', ' ').substring(0, 23);
}

/**
 * Format a value for logging based on its type
 * @param value Value to format
 * @returns Formatted string representation
 */
function formatValue(value: any): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';

  if (typeof value === 'object') {
    if (value instanceof Error) {
      return `Error: ${value.message}${value.stack ? `\n${value.stack}` : ''}`;
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    if (Array.isArray(value)) {
      if (value.length > 10) {
        return `Array(${value.length}) [${value.slice(0, 3).map(formatValue).join(', ')}, ... ${value.length - 6} more ..., ${value.slice(-3).map(formatValue).join(', ')}]`;
      }
      return `[${value.map(formatValue).join(', ')}]`;
    }
    try {
      return JSON.stringify(value, null, 2);
    } catch (e) {
      return `[Object: circular or too complex to stringify]`;
    }
  }

  return String(value);
}

export class HomeyLogger implements Logger {
  private app: any;
  private logLevel: LogLevel;
  private logToTimeline: boolean;
  private logPrefix: string;
  private enabledCategories: Set<LogCategory>;
  private includeTimestamps: boolean;
  private includeSourceModule: boolean;
  private verboseMode: boolean;
  private sourceModule: string;

  constructor(app: any, options: LoggerConfig = {}) {
    this.app = app;
    this.logLevel = options.level ?? LogLevel.INFO;
    this.logToTimeline = options.logToTimeline ?? false;
    this.logPrefix = options.prefix ? `[${options.prefix}] ` : '';
    this.sourceModule = options.prefix || 'App';
    this.includeTimestamps = options.includeTimestamps ?? true;
    this.includeSourceModule = options.includeSourceModule ?? true;

    // Detect if we're running in development mode (via Homey CLI)
    this.verboseMode = options.verboseMode ?? isRunningInDevMode();

    // Initialize enabled categories
    this.enabledCategories = new Set<LogCategory>(
      options.enabledCategories || Object.values(LogCategory)
    );

    // Log initialization using Homey's built-in logging
    this.app.log(`${this.getLogPrefix()}Logger initialized with level: ${LogLevel[this.logLevel]}, verbose mode: ${this.verboseMode}`);
  }

  /**
   * Get the log prefix including timestamp and source module if enabled
   */
  private getLogPrefix(): string {
    let prefix = '';

    if (this.includeTimestamps) {
      prefix += `[${getFormattedTimestamp()}] `;
    }

    if (this.includeSourceModule && this.sourceModule) {
      prefix += `[${this.sourceModule}] `;
    }

    return prefix + this.logPrefix;
  }

  /**
   * Format a value for logging
   */
  public formatValue(value: any): string {
    return formatValue(value);
  }

  /**
   * Set the log level
   */
  public setLogLevel(level: LogLevel): void {
    this.logLevel = level;
    this.info(`Log level set to ${LogLevel[level]}`);
  }

  /**
   * Enable or disable timeline logging
   */
  public setTimelineLogging(enabled: boolean): void {
    this.logToTimeline = enabled;
    this.info(`Timeline logging ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Get the current log level
   * @returns Current log level
   */
  public getLogLevel(): LogLevel {
    return this.logLevel;
  }

  /**
   * Enable a log category
   */
  public enableCategory(category: LogCategory): void {
    this.enabledCategories.add(category);
    this.debug(`Enabled log category: ${category}`);
  }

  /**
   * Disable a log category
   */
  public disableCategory(category: LogCategory): void {
    this.enabledCategories.delete(category);
    this.debug(`Disabled log category: ${category}`);
  }

  /**
   * Check if a category is enabled
   */
  public isCategoryEnabled(category: LogCategory): boolean {
    return this.enabledCategories.has(category);
  }

  /**
   * Log a debug message
   */
  public debug(message: string, ...args: any[]): void {
    if (this.logLevel <= LogLevel.DEBUG && this.isCategoryEnabled(LogCategory.GENERAL)) {
      // Only log debug messages in verbose mode
      if (this.verboseMode) {
        // Use Homey's built-in logging - this will appear in the terminal with 'homey app run'
        this.app.log(`DEBUG: ${this.getLogPrefix()}${message}`, ...args);
      }
    }
  }

  /**
   * Log a message (standard log level)
   */
  public log(message: string, ...args: any[]): void {
    if (this.logLevel <= LogLevel.INFO && this.isCategoryEnabled(LogCategory.GENERAL)) {
      // Use Homey's built-in logging - this will appear in the terminal with 'homey app run'
      this.app.log(`${this.getLogPrefix()}${message}`, ...args);
    }
  }

  /**
   * Log an info message
   */
  public info(message: string, ...args: any[]): void {
    if (this.logLevel <= LogLevel.INFO && this.isCategoryEnabled(LogCategory.GENERAL)) {
      // Use Homey's built-in logging - this will appear in the terminal with 'homey app run'
      this.app.log(`INFO: ${this.getLogPrefix()}${message}`, ...args);
    }
  }

  /**
   * Log an API-related message
   */
  public api(message: string, context?: Record<string, any>): void {
    if (this.logLevel <= LogLevel.INFO && this.isCategoryEnabled(LogCategory.API)) {
      const contextStr = context ? this.formatValue(context) : '';
      this.app.log(`API: ${this.getLogPrefix()}${message}${contextStr ? ' ' + contextStr : ''}`);
    }
  }

  /**
   * Log an optimization-related message
   */
  public optimization(message: string, context?: Record<string, any>): void {
    if (this.logLevel <= LogLevel.INFO && this.isCategoryEnabled(LogCategory.OPTIMIZATION)) {
      const contextStr = context ? this.formatValue(context) : '';
      this.app.log(`OPTIMIZATION: ${this.getLogPrefix()}${message}${contextStr ? ' ' + contextStr : ''}`);
    }
  }

  /**
   * Log a warning message
   * @param message Warning message
   * @param context Optional context object
   */
  public warn(message: string, context?: Record<string, any>): void {
    if (this.logLevel <= LogLevel.WARN && this.isCategoryEnabled(LogCategory.GENERAL)) {
      // Use Homey's built-in logging - this will appear in the terminal with 'homey app run'
      if (context) {
        this.app.log(`WARN: ${this.getLogPrefix()}⚠️ ${message}`, this.formatValue(context));
      } else {
        this.app.log(`WARN: ${this.getLogPrefix()}⚠️ ${message}`);
      }
    }
  }

  /**
   * Log an error message
   * @param message Error message
   * @param error Optional error object
   * @param context Optional context object
   */
  public error(message: string, error?: Error | unknown, context?: Record<string, any>): void {
    if (this.logLevel <= LogLevel.ERROR && this.isCategoryEnabled(LogCategory.GENERAL)) {
      // Use Homey's built-in error logging - this will appear in the terminal with 'homey app run'
      if (error instanceof Error) {
        if (context) {
          this.app.error(`ERROR: ${this.getLogPrefix()}🔴 ${message}`, error, this.formatValue(context));
        } else {
          this.app.error(`ERROR: ${this.getLogPrefix()}🔴 ${message}`, error);
        }
      } else if (context) {
        this.app.error(`ERROR: ${this.getLogPrefix()}🔴 ${message}`, this.formatValue(context));
      } else {
        this.app.error(`ERROR: ${this.getLogPrefix()}🔴 ${message}`);
      }
    }
  }

  /**
   * Send a notification to the user
   */
  public async notify(message: string): Promise<void> {
    try {
      // Log notification using Homey's logging
      this.app.log(`${this.getLogPrefix()}NOTIFICATION: ${message}`);

      // Send notification to Homey
      await this.app.homey.notifications.createNotification({ excerpt: message });
    } catch (err) {
      this.error(`Failed to send notification: ${message}`, err as Error);
    }
  }

  /**
   * Log a special marker or important message
   */
  public marker(message: string): void {
    // Use Homey's built-in logging with a special format
    this.app.log(`${this.getLogPrefix()}===== ${message} =====`);
  }

  /**
   * Send a message to the Homey timeline
   * @param message Message to send to the timeline
   * @param type Optional message type (info, warning, error)
   */
  public async sendToTimeline(message: string, type: 'info' | 'warning' | 'error' = 'info'): Promise<void> {
    if (!this.isCategoryEnabled(LogCategory.TIMELINE)) {
      return;
    }

    try {
      // Log timeline message using Homey's logging
      this.app.log(`${this.getLogPrefix()}TIMELINE: ${message}`);

      // Check if we have access to the TimelineHelper
      if (this.app.timelineHelper) {
        // Use the appropriate method based on the message type
        switch (type) {
          case 'warning':
            await this.app.timelineHelper.createWarningEntry('MELCloud Optimizer', message, false);
            break;
          case 'error':
            await this.app.timelineHelper.createErrorEntry('MELCloud Optimizer', message, false);
            break;
          case 'info':
          default:
            await this.app.timelineHelper.createInfoEntry('MELCloud Optimizer', message, false);
            break;
        }
      } else {
        // Fallback to direct flow API if TimelineHelper is not available
        await this.app.homey.flow.runFlowCardAction({
          uri: 'homey:flowcardaction:homey:manager:timeline:log',
          args: { text: message }
        });
      }
    } catch (err) {
      // Don't log timeline errors to timeline to avoid loops
      this.app.error(`Failed to send to timeline: ${message}`, err as Error);
    }
  }
}

/**
 * Create a fallback logger that uses console when Homey logger is not available
 */
export function createFallbackLogger(prefix: string = 'MELCloud'): Logger {
  let currentLogLevel = LogLevel.INFO;
  const enabledCategories = new Set<LogCategory>(Object.values(LogCategory));

  const fallbackLogger: Logger = {
    log: (message: string, ...args: any[]) => console.log(`[${prefix}] ${message}`, ...args),
    info: (message: string, ...args: any[]) => console.log(`[${prefix}] INFO: ${message}`, ...args),
    error: (message: string, error?: Error | unknown, context?: Record<string, any>) => {
      console.error(`[${prefix}] ERROR: ${message}`, error, context);
    },
    debug: (message: string, ...args: any[]) => {
      if (currentLogLevel <= LogLevel.DEBUG) {
        console.log(`[${prefix}] DEBUG: ${message}`, ...args);
      }
    },
    warn: (message: string, context?: Record<string, any>) => console.warn(`[${prefix}] WARN: ${message}`, context),
    api: (message: string, context?: Record<string, any>) => console.log(`[${prefix}] API: ${message}`, context),
    optimization: (message: string, context?: Record<string, any>) => console.log(`[${prefix}] OPT: ${message}`, context),
    notify: async (message: string) => { console.log(`[${prefix}] NOTIFY: ${message}`); },
    marker: (message: string) => console.log(`[${prefix}] MARKER: ${message}`),
    sendToTimeline: async (message: string, type?: 'info' | 'warning' | 'error') => { 
      console.log(`[${prefix}] TIMELINE: ${message} (${type || 'info'})`); 
    },
    setLogLevel: (level: LogLevel) => { 
      currentLogLevel = level;
      console.log(`[${prefix}] Log level set to ${LogLevel[level]}`); 
    },
    setTimelineLogging: (enabled: boolean) => {
      console.log(`[${prefix}] Timeline logging ${enabled ? 'enabled' : 'disabled'}`);
    },
    getLogLevel: () => currentLogLevel,
    enableCategory: (category: LogCategory) => {
      enabledCategories.add(category);
      console.log(`[${prefix}] Enabled category: ${category}`);
    },
    disableCategory: (category: LogCategory) => {
      enabledCategories.delete(category);
      console.log(`[${prefix}] Disabled category: ${category}`);
    },
    isCategoryEnabled: (category: LogCategory) => enabledCategories.has(category),
    formatValue: (value: any) => formatValue(value)
  };
  
  return fallbackLogger;
}
