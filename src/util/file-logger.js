'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Enhanced file logger for Homey apps
 * This logger ensures output is visible in the terminal and saved to log files
 */
class FileLogger {
  constructor(options = {}) {
    this.prefix = options.prefix ? `[${options.prefix}] ` : '';
    this.logLevel = options.level || 'info';
    this.levels = { debug: 0, info: 1, warn: 2, error: 3 };
    
    // ANSI colors for console output
    this.colors = {
      debug: '\x1b[36m', // Cyan
      info: '\x1b[32m',  // Green
      warn: '\x1b[33m',  // Yellow
      error: '\x1b[31m', // Red
      reset: '\x1b[0m'
    };
    
    // Set up log directory and files
    this.logDir = options.logDir || path.join(process.cwd(), 'logs');
    this.fileLoggingEnabled = true;
    
    // Set up log file paths
    this.setupLogFiles();
    
    // Initialize log files
    this.initializeLogFiles();
    
    console.log(`${this.colors.info}[LOGGER] File logger initialized${this.colors.reset}`);
    console.log(`${this.colors.info}[LOGGER] Log files will be stored in: ${this.logDir}${this.colors.reset}`);
  }
  
  setupLogFiles() {
    // Set up log file paths
    this.logFiles = {
      all: path.join(this.logDir, 'app.log'),
      debug: path.join(this.logDir, 'debug.log'),
      info: path.join(this.logDir, 'info.log'),
      warn: path.join(this.logDir, 'warnings.log'),
      error: path.join(this.logDir, 'exceptions.log')
    };
  }
  
  initializeLogFiles() {
    try {
      // Create log directory if it doesn't exist
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
      
      // Log session start
      const sessionHeader = `====== MELCloud Optimizer Session Started at ${new Date().toISOString()} ======`;
      
      // Write session header to all log files
      Object.values(this.logFiles).forEach(file => {
        fs.appendFileSync(file, sessionHeader + os.EOL);
      });
      
      // Register shutdown handler
      process.on('beforeExit', () => this.shutdown());
    } catch (error) {
      console.error('Failed to initialize log files:', error);
      this.fileLoggingEnabled = false;
    }
  }
  
  appendToLogFile(level, message) {
    if (!this.fileLoggingEnabled) return;
    
    try {
      // Always append to all logs
      fs.appendFileSync(this.logFiles.all, message + os.EOL);
      
      // Append to specific log file based on level
      let logFile;
      if (level === 'debug') {
        logFile = this.logFiles.debug;
      } else if (level === 'info') {
        logFile = this.logFiles.info;
      } else if (level === 'warn') {
        logFile = this.logFiles.warn;
      } else {
        logFile = this.logFiles.error;
      }
      
      fs.appendFileSync(logFile, message + os.EOL);
    } catch (error) {
      console.error('Failed to write to log file:', error);
    }
  }
  
  setLogLevel(level) {
    if (this.levels[level] !== undefined) {
      this.logLevel = level;
    }
  }
  
  shouldLog(level) {
    return this.levels[level] >= this.levels[this.logLevel];
  }
  
  formatMessage(level, message, data) {
    const timestamp = new Date().toISOString();
    let formattedMessage = `[${timestamp}] ${this.prefix}[${level.toUpperCase()}] ${message}`;
    
    if (data) {
      try {
        // Handle circular references
        const seen = new WeakSet();
        const formattedData = JSON.stringify(data, (key, value) => {
          if (typeof value === 'object' && value !== null) {
            if (seen.has(value)) {
              return '[Circular]';
            }
            seen.add(value);
          }
          // Handle function values
          if (typeof value === 'function') {
            return '[Function]';
          }
          return value;
        }, 2);
        
        formattedMessage += ` ${formattedData}`;
      } catch (error) {
        formattedMessage += ` [Object could not be stringified: ${error.message}]`;
      }
    }
    
    return formattedMessage;
  }
  
  debug(message, data) {
    if (this.shouldLog('debug')) {
      const formattedMessage = this.formatMessage('debug', message, data);
      
      // Log to console
      console.log(this.colors.debug + formattedMessage + this.colors.reset);
      
      // Log to file
      this.appendToLogFile('debug', formattedMessage);
    }
  }
  
  info(message, data) {
    if (this.shouldLog('info')) {
      const formattedMessage = this.formatMessage('info', message, data);
      
      // Log to console
      console.log(this.colors.info + formattedMessage + this.colors.reset);
      
      // Log to file
      this.appendToLogFile('info', formattedMessage);
    }
  }
  
  warn(message, data) {
    if (this.shouldLog('warn')) {
      const formattedMessage = this.formatMessage('warn', message, data);
      
      // Log to console
      console.warn(this.colors.warn + formattedMessage + this.colors.reset);
      
      // Log to file
      this.appendToLogFile('warn', formattedMessage);
    }
  }
  
  error(message, error, data) {
    if (this.shouldLog('error')) {
      const formattedMessage = this.formatMessage('error', message, data);
      
      // Log to console
      console.error(this.colors.error + formattedMessage + this.colors.reset);
      
      // Log to file
      this.appendToLogFile('error', formattedMessage);
      
      // If error is an Error object, log the stack trace separately
      if (error instanceof Error) {
        const stackMessage = `[${new Date().toISOString()}] ${this.prefix}[ERROR_STACK] ${error.stack}`;
        console.error(this.colors.error + stackMessage + this.colors.reset);
        this.appendToLogFile('error', stackMessage);
      }
    }
  }
  
  marker(message) {
    const line = '='.repeat(10);
    const markerMessage = `${line} ${message} ${line}`;
    const formattedMessage = this.formatMessage('marker', markerMessage);
    
    // Log to console
    console.log(this.colors.info + formattedMessage + this.colors.reset);
    
    // Log to file
    this.appendToLogFile('info', formattedMessage);
  }
  
  shutdown() {
    if (!this.fileLoggingEnabled) return;
    
    try {
      const sessionFooter = `====== MELCloud Optimizer Session Ended at ${new Date().toISOString()} ======`;
      
      // Write footer to all log files
      Object.values(this.logFiles).forEach(file => {
        fs.appendFileSync(file, sessionFooter + os.EOL);
      });
      
      console.log('Logger session ended.');
    } catch (error) {
      console.error('Failed to write session footer:', error);
    }
  }
}

module.exports = FileLogger;
