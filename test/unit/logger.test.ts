import { App } from 'homey';
import { Logger, LogLevel } from '../../src/util/logger';

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
    logger = new Logger(mockApp, {
      level: LogLevel.DEBUG,
      logToTimeline: true,
      prefix: 'TEST',
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
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
    it('should log debug messages when level is DEBUG', () => {
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
      logger.setLogLevel(LogLevel.WARN);
      logger.info('Test info message');
      expect(mockApp.log).not.toHaveBeenCalled();
    });

    it('should send to timeline when logToTimeline is true', () => {
      logger.setLogLevel(LogLevel.INFO);
      logger.info('Test info message');
      expect(mockApp.homey.flow.runFlowCardAction).toHaveBeenCalledWith({
        uri: 'homey:flowcardaction:homey:manager:timeline:log',
        args: { text: 'ℹ️ Test info message' },
      });
    });

    it('should handle errors when sending to timeline', async () => {
      // Mock a failure in the timeline action
      const error = new Error('Timeline error');
      mockApp.homey.flow.runFlowCardAction.mockRejectedValueOnce(error);

      // Call a method that will trigger timeline logging
      logger.info('Test message with timeline error');

      // Wait for the async operation to complete
      await new Promise(resolve => setTimeout(resolve, 10));

      // Check that the error was logged
      expect(mockApp.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to send to timeline'),
        error
      );
    });
  });

  describe('warn', () => {
    it('should log warning messages when level is WARN or lower', () => {
      logger.setLogLevel(LogLevel.WARN);
      logger.warn('Test warning message');
      expect(mockApp.log).toHaveBeenCalledWith(expect.stringContaining('Test warning message'));
    });

    it('should not log warning messages when level is higher than WARN', () => {
      logger.setLogLevel(LogLevel.ERROR);
      logger.warn('Test warning message');
      expect(mockApp.log).not.toHaveBeenCalled();
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
    it('should enable timeline logging', () => {
      logger.setTimelineLogging(true);
      logger.info('Test message');
      expect(mockApp.homey.flow.runFlowCardAction).toHaveBeenCalled();
    });

    it('should disable timeline logging', () => {
      logger.setTimelineLogging(false);
      logger.info('Test message');
      expect(mockApp.homey.flow.runFlowCardAction).not.toHaveBeenCalled();
    });
  });
});
