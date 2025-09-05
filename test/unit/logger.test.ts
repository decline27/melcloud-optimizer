import { App } from 'homey';
import { HomeyLogger, LogLevel, Logger, LogCategory, isRunningInDevMode } from '../../src/util/logger';

// Mock the process.env
jest.mock('process', () => ({
  env: {
    NODE_ENV: 'test'
  }
}));

describe('Logger', () => {
  let mockApp: any;
  let logger: Logger;

  beforeEach(() => {
    // Create a mock app instance
    mockApp = {
      log: jest.fn(),
      error: jest.fn(),
      homey: {
        notifications: {
          createNotification: jest.fn().mockResolvedValue(undefined),
        },
        flow: {
          runFlowCardAction: jest.fn().mockResolvedValue(undefined),
        },
      },
    };

    // Create a new logger instance with the mock app
    logger = new HomeyLogger(mockApp, {
      level: LogLevel.DEBUG,
      logToTimeline: true,
      prefix: 'TEST',
      verboseMode: true, // Force verbose mode for testing
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('isRunningInDevMode', () => {
    it('should detect development mode', () => {
      // Mock NODE_ENV as development
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      expect(isRunningInDevMode()).toBe(true);

      // Restore original env
      process.env.NODE_ENV = originalEnv;
    });

    it('should detect Homey CLI environment', () => {
      // Mock HOMEY_CLI env var
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'test';
      process.env.HOMEY_CLI = 'true';

      expect(isRunningInDevMode()).toBe(true);

      // Restore original env
      process.env.NODE_ENV = originalEnv;
      delete process.env.HOMEY_CLI;
    });

    it('should return false for production environment', () => {
      // Ensure no development indicators
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      delete process.env.HOMEY_CLI;
      delete process.env.HOMEY_APP_ID;

      expect(isRunningInDevMode()).toBe(false);

      // Restore original env
      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('formatValue', () => {
    it('should format primitive values', () => {
      expect(logger.formatValue('test')).toBe('test');
      expect(logger.formatValue(123)).toBe('123');
      expect(logger.formatValue(true)).toBe('true');
      expect(logger.formatValue(null)).toBe('null');
      expect(logger.formatValue(undefined)).toBe('undefined');
    });

    it('should format Error objects', () => {
      const error = new Error('Test error');
      expect(logger.formatValue(error)).toContain('Error: Test error');
    });

    it('should format Date objects', () => {
      const date = new Date('2023-01-01T12:00:00Z');
      expect(logger.formatValue(date)).toBe('2023-01-01T12:00:00.000Z');
    });

    it('should format arrays', () => {
      expect(logger.formatValue([1, 2, 3])).toBe('[1, 2, 3]');
    });

    it('should format large arrays with truncation', () => {
      const largeArray = Array.from({ length: 20 }, (_, i) => i);
      const formatted = logger.formatValue(largeArray);
      expect(formatted).toContain('Array(20)');
      expect(formatted).toContain('more');
    });

    it('should format objects', () => {
      const obj = { a: 1, b: 'test' };
      expect(logger.formatValue(obj)).toContain('"a": 1');
      expect(logger.formatValue(obj)).toContain('"b": "test"');
    });
  });

  describe('setLogLevel', () => {
    it('should set the log level', () => {
      logger.setLogLevel(LogLevel.ERROR);

      // Log an info message which should not be logged due to ERROR level
      logger.info('This should not be logged');
      expect(mockApp.log).not.toHaveBeenCalledWith(expect.stringContaining('This should not be logged'));

      // Log an error message which should be logged
      logger.error('This should be logged');
      expect(mockApp.error).toHaveBeenCalledWith(expect.stringContaining('This should be logged'));
    });
  });

  describe('debug', () => {
    it('should log debug messages when level is DEBUG and verbose mode is on', () => {
      logger.setLogLevel(LogLevel.DEBUG);
      logger.debug('Test debug message');
      expect(mockApp.log).toHaveBeenCalledWith(expect.stringContaining('Test debug message'));
    });

    it('should not log debug messages when level is higher than DEBUG', () => {
      // Clear previous calls
      mockApp.log.mockClear();

      logger.setLogLevel(LogLevel.INFO);
      logger.debug('Test debug message');

      // Check that debug message was not logged
      expect(mockApp.log).not.toHaveBeenCalledWith(expect.stringContaining('Test debug message'));
    });
  });

  describe('info', () => {
    it('should log info messages when level is INFO or lower', () => {
      logger.setLogLevel(LogLevel.INFO);
      logger.info('Test info message');
      expect(mockApp.log).toHaveBeenCalledWith(expect.stringContaining('Test info message'));
    });

    it('should not log info messages when level is higher than INFO', () => {
      // Clear previous calls
      mockApp.log.mockClear();

      logger.setLogLevel(LogLevel.WARN);
      logger.info('Test info message');
      expect(mockApp.log).not.toHaveBeenCalled();
    });

    it('should not auto-post info messages to timeline', () => {
      logger.setLogLevel(LogLevel.INFO);
      logger.info('Test info message');
      expect(mockApp.log).toHaveBeenCalledWith(expect.stringContaining('Test info message'));
      expect(mockApp.homey.flow.runFlowCardAction).not.toHaveBeenCalled();
    });

    it('should handle errors when sending to timeline', async () => {
      // Mock a failure in the timeline action
      const error = new Error('Timeline error');
      mockApp.homey.flow.runFlowCardAction.mockRejectedValueOnce(error);

  // Directly call sendToTimeline and await so the error handling runs inside this test
  await (logger as any).sendToTimeline('Test message with timeline error');

      // Check that the error was logged
      expect(mockApp.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to send to timeline'),
        error
      );
    });
  });

  describe('api', () => {
    it('should log API messages when API category is enabled', () => {
      logger.api('Test API message', { endpoint: '/test', method: 'GET' });
      expect(mockApp.log).toHaveBeenCalledWith(expect.stringContaining('API: '));
      expect(mockApp.log).toHaveBeenCalledWith(expect.stringContaining('Test API message'));
      expect(mockApp.log).toHaveBeenCalledWith(expect.stringContaining('endpoint'));
    });

    it('should not log API messages when API category is disabled', () => {
      logger.disableCategory(LogCategory.API);
      logger.api('Test API message');
      expect(mockApp.log).not.toHaveBeenCalledWith(expect.stringContaining('API: '));
    });
  });

  describe('optimization', () => {
    it('should log optimization messages when OPTIMIZATION category is enabled', () => {
      logger.optimization('Test optimization message', { factor: 0.5 });
      expect(mockApp.log).toHaveBeenCalledWith(expect.stringContaining('OPTIMIZATION: '));
      expect(mockApp.log).toHaveBeenCalledWith(expect.stringContaining('Test optimization message'));
      expect(mockApp.log).toHaveBeenCalledWith(expect.stringContaining('factor'));
    });

    it('should not log optimization messages when OPTIMIZATION category is disabled', () => {
      logger.disableCategory(LogCategory.OPTIMIZATION);
      logger.optimization('Test optimization message');
      expect(mockApp.log).not.toHaveBeenCalledWith(expect.stringContaining('OPTIMIZATION: '));
    });
  });

  describe('warn', () => {
    it('should log warning messages when level is WARN or lower', () => {
      logger.setLogLevel(LogLevel.WARN);
      logger.warn('Test warning message');
      expect(mockApp.log).toHaveBeenCalledWith(expect.stringContaining('Test warning message'));
    });

    it('should not log warning messages when level is higher than WARN', () => {
      // Clear previous calls
      mockApp.log.mockClear();

      logger.setLogLevel(LogLevel.ERROR);
      logger.warn('Test warning message');
      expect(mockApp.log).not.toHaveBeenCalled();
    });

    it('should format context objects in warnings', () => {
      logger.warn('Test warning with context', { details: 'test details' });
      expect(mockApp.log).toHaveBeenCalledWith(
        expect.stringContaining('Test warning with context'),
        expect.stringContaining('details')
      );
    });
  });

  describe('error', () => {
    it('should log error messages when level is ERROR or lower', () => {
      logger.setLogLevel(LogLevel.ERROR);
      logger.error('Test error message');
      expect(mockApp.error).toHaveBeenCalledWith(expect.stringContaining('Test error message'));
    });

    it('should log error messages with Error object', () => {
      const error = new Error('Test error');
      logger.error('Test error message', error);
      expect(mockApp.error).toHaveBeenCalledWith(expect.stringContaining('Test error message'), error);
    });

    it('should not log error messages when level is higher than ERROR', () => {
      logger.setLogLevel(LogLevel.NONE);
      logger.error('Test error message');
      expect(mockApp.error).not.toHaveBeenCalled();
    });

    it('should format context objects in errors', () => {
      logger.error('Test error with context', new Error('Test error'), { details: 'test details' });
      expect(mockApp.error).toHaveBeenCalledWith(
        expect.stringContaining('Test error with context'),
        expect.any(Error),
        expect.stringContaining('details')
      );
    });
  });

  describe('notify', () => {
    it('should create a notification', async () => {
      await logger.notify('Test notification');
      expect(mockApp.homey.notifications.createNotification).toHaveBeenCalledWith({
        excerpt: 'Test notification',
      });
    });

    it('should handle errors when creating notifications', async () => {
      const error = new Error('Notification error');
      mockApp.homey.notifications.createNotification.mockRejectedValueOnce(error);

      await logger.notify('Test notification');
      expect(mockApp.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to send notification'),
        error
      );
    });
  });

  describe('setTimelineLogging', () => {
    it('enables flag but does not auto-post info', () => {
      logger.setTimelineLogging(true);
      logger.info('Test message');
      expect(mockApp.log).toHaveBeenCalledWith(expect.stringContaining('Test message'));
      expect(mockApp.homey.flow.runFlowCardAction).not.toHaveBeenCalled();
    });

    it('disables flag and still does not auto-post info', () => {
      logger.setTimelineLogging(false);
      logger.info('Test message');
      expect(mockApp.homey.flow.runFlowCardAction).not.toHaveBeenCalled();
    });
  });

  describe('category management', () => {
    it('should enable and disable categories', () => {
      // Disable a category
      logger.disableCategory(LogCategory.API);
      expect(logger.isCategoryEnabled(LogCategory.API)).toBe(false);

      // Re-enable the category
      logger.enableCategory(LogCategory.API);
      expect(logger.isCategoryEnabled(LogCategory.API)).toBe(true);
    });

    it('should not log messages for disabled categories', () => {
      // Disable the TIMELINE category
      logger.disableCategory(LogCategory.TIMELINE);

      // Send a message to timeline
      logger.sendToTimeline('This should not be sent');

      // Verify no timeline action was called
      expect(mockApp.homey.flow.runFlowCardAction).not.toHaveBeenCalled();
    });
  });
});
