'use strict';

/**
 * Simple console logger for Homey apps
 * This logger ensures output is visible in the terminal when running with 'homey app run'
 */
class ConsoleLogger {
  constructor(prefix = '') {
    this.prefix = prefix ? `[${prefix}] ` : '';
    
    // ANSI colors for console output
    this.colors = {
      debug: '\x1b[36m', // Cyan
      info: '\x1b[32m',  // Green
      warn: '\x1b[33m',  // Yellow
      error: '\x1b[31m', // Red
      reset: '\x1b[0m'
    };
    
    console.log(`${this.colors.info}[LOGGER] Console logger initialized${this.colors.reset}`);
  }

  /**
   * Format a message with timestamp
   */
  formatMessage(level, message) {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] ${this.prefix}[${level}] ${message}`;
  }

  /**
   * Log a debug message
   */
  debug(message) {
    const formattedMessage = this.formatMessage('DEBUG', message);
    console.log(`${this.colors.debug}${formattedMessage}${this.colors.reset}`);
  }

  /**
   * Log an info message
   */
  info(message) {
    const formattedMessage = this.formatMessage('INFO', message);
    console.log(`${this.colors.info}${formattedMessage}${this.colors.reset}`);
  }

  /**
   * Log a warning message
   */
  warn(message) {
    const formattedMessage = this.formatMessage('WARN', message);
    console.warn(`${this.colors.warn}${formattedMessage}${this.colors.reset}`);
  }

  /**
   * Log an error message
   */
  error(message, error) {
    const formattedMessage = this.formatMessage('ERROR', message);
    console.error(`${this.colors.error}${formattedMessage}${this.colors.reset}`);
    
    if (error && error.stack) {
      console.error(`${this.colors.error}[ERROR_STACK] ${error.stack}${this.colors.reset}`);
    }
  }

  /**
   * Log a special marker message
   */
  marker(message) {
    const line = '='.repeat(10);
    const markerMessage = `${line} ${message} ${line}`;
    console.log(`${this.colors.info}${this.formatMessage('MARKER', markerMessage)}${this.colors.reset}`);
  }
}

module.exports = ConsoleLogger;
