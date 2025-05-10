import { App } from 'homey';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  NONE = 99
}

/**
 * Logger interface for standardized logging across the application
 */
export interface Logger {
  log(message: string, ...args: any[]): void;
  info(message: string, ...args: any[]): void;
  error(message: string, error?: Error | unknown, ...args: any[]): void;
  debug(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  notify(message: string): Promise<void>;
  marker(message: string): void;
  sendToTimeline(message: string): Promise<void>;
  setLogLevel(level: LogLevel): void;
  setTimelineLogging(enabled: boolean): void;
}

export class HomeyLogger implements Logger {
  private app: any;
  private logLevel: LogLevel;
  private logToTimeline: boolean;
  private logPrefix: string;

  constructor(app: any, options: {
    level?: LogLevel;
    logToTimeline?: boolean;
    prefix?: string;
  } = {}) {
    this.app = app;
    this.logLevel = options.level ?? LogLevel.INFO;
    this.logToTimeline = options.logToTimeline ?? false;
    this.logPrefix = options.prefix ? `[${options.prefix}] ` : '';

    // Log initialization using Homey's built-in logging
    this.app.log(`${this.logPrefix}Logger initialized with level: ${LogLevel[this.logLevel]}`);
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
   * Log a debug message
   */
  public debug(message: string, ...args: any[]): void {
    if (this.logLevel <= LogLevel.DEBUG) {
      // Use Homey's built-in logging - this will appear in the terminal with 'homey app run'
      this.app.log(`DEBUG: ${this.logPrefix}${message}`, ...args);
    }
  }

  /**
   * Log a message (standard log level)
   */
  public log(message: string, ...args: any[]): void {
    if (this.logLevel <= LogLevel.INFO) {
      // Use Homey's built-in logging - this will appear in the terminal with 'homey app run'
      this.app.log(`${this.logPrefix}${message}`, ...args);
    }
  }

  /**
   * Log an info message
   */
  public info(message: string, ...args: any[]): void {
    if (this.logLevel <= LogLevel.INFO) {
      // Use Homey's built-in logging - this will appear in the terminal with 'homey app run'
      this.app.log(`INFO: ${this.logPrefix}${message}`, ...args);

      if (this.logToTimeline) {
        this.sendToTimeline(`ℹ️ ${message}`);
      }
    }
  }

  /**
   * Log a warning message
   */
  public warn(message: string, ...args: any[]): void {
    if (this.logLevel <= LogLevel.WARN) {
      // Use Homey's built-in logging - this will appear in the terminal with 'homey app run'
      this.app.log(`WARN: ${this.logPrefix}⚠️ ${message}`, ...args);

      if (this.logToTimeline) {
        this.sendToTimeline(`⚠️ ${message}`);
      }
    }
  }

  /**
   * Log an error message
   */
  public error(message: string, error?: Error, ...args: any[]): void {
    if (this.logLevel <= LogLevel.ERROR) {
      // Use Homey's built-in error logging - this will appear in the terminal with 'homey app run'
      if (error) {
        this.app.error(`ERROR: ${this.logPrefix}🔴 ${message}`, error, ...args);
      } else {
        this.app.error(`ERROR: ${this.logPrefix}🔴 ${message}`, ...args);
      }

      if (this.logToTimeline) {
        this.sendToTimeline(`🔴 ${message}${error ? `: ${error.message}` : ''}`);
      }
    }
  }

  /**
   * Send a notification to the user
   */
  public async notify(message: string): Promise<void> {
    try {
      // Log notification using Homey's logging
      this.app.log(`${this.logPrefix}NOTIFICATION: ${message}`);

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
    this.app.log(`${this.logPrefix}===== ${message} =====`);
  }

  /**
   * Send a message to the Homey timeline
   */
  public async sendToTimeline(message: string): Promise<void> {
    try {
      // Log timeline message using Homey's logging
      this.app.log(`${this.logPrefix}TIMELINE: ${message}`);

      // Send to Homey timeline
      await this.app.homey.flow.runFlowCardAction({
        uri: 'homey:flowcardaction:homey:manager:timeline:log',
        args: { text: message }
      });
    } catch (err) {
      // Don't log timeline errors to timeline to avoid loops
      this.app.error(`Failed to send to timeline: ${message}`, err as Error);
    }
  }
}
