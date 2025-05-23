import { Logger, LogLevel, LogCategory } from '../../src/util/logger';

/**
 * Create a mock logger for testing
 * @returns Mock logger instance
 */
export class MockLogger implements Logger {
  log = jest.fn();
  info = jest.fn();
  error = jest.fn();
  debug = jest.fn();
  warn = jest.fn();
  api = jest.fn();
  optimization = jest.fn();
  notify = jest.fn().mockResolvedValue(undefined);
  marker = jest.fn();
  sendToTimeline = jest.fn().mockResolvedValue(undefined);
  setLogLevel = jest.fn();
  setTimelineLogging = jest.fn();
  getLogLevel = jest.fn().mockReturnValue(LogLevel.INFO);
  enableCategory = jest.fn();
  disableCategory = jest.fn();
  isCategoryEnabled = jest.fn().mockReturnValue(true);
  formatValue = jest.fn(value => typeof value === 'object' ? JSON.stringify(value) : String(value));
}

/**
 * Create a new mock logger instance
 * @returns Mock logger instance
 */
export function createMockLogger(): Logger {
  return new MockLogger();
}
