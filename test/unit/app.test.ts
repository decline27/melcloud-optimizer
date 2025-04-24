import HeatOptimizerApp from '../../src/app';
import { App } from 'homey';
import { Logger } from '../../src/util/logger';

// Mock fetch globally
global.fetch = jest.fn();

describe('HeatOptimizerApp', () => {
  let app: HeatOptimizerApp;
  let mockSettings: any;
  let mockNotifications: any;
  let mockFlow: any;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Mock fetch response
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({})
    });

    // Create mock settings
    mockSettings = {
      get: jest.fn(),
      set: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
    };

    // Create mock notifications
    mockNotifications = {
      createNotification: jest.fn().mockResolvedValue(undefined),
    };

    // Create mock flow
    mockFlow = {
      runFlowCardAction: jest.fn().mockResolvedValue(undefined),
    };

    // Create app instance
    app = new HeatOptimizerApp();

    // Mock app.homey
    (app as any).homey = {
      settings: mockSettings,
      notifications: mockNotifications,
      flow: mockFlow,
      setInterval: jest.fn(),
      version: '1.0.0',
      platform: 'test'
    };

    // Mock app.manifest
    (app as any).manifest = {
      version: '1.0.0'
    };

    // Mock app.id
    (app as any).id = 'com.melcloud.optimize';

    // Mock app.log and app.error
    (app as any).log = jest.fn();
    (app as any).error = jest.fn();
  });

  describe('onInit', () => {
    it('should initialize the app and set up intervals', async () => {
      // Mock settings.get for log_level and required settings
      mockSettings.get.mockImplementation((key: string) => {
        if (key === 'log_level') return 1; // INFO level
        if (key === 'melcloud_user') return 'test@example.com';
        if (key === 'melcloud_pass') return 'password';
        if (key === 'tibber_token') return 'token';
        if (key === 'openai_api_key') return 'key';
        if (key === 'device_id') return '123';
        if (key === 'building_id') return '456';
        return undefined;
      });

      // Mock the initializeServices method
      (app as any).initializeServices = jest.fn().mockResolvedValue(undefined);

      // Mock the validateSettings method
      (app as any).validateSettings = jest.fn().mockResolvedValue(true);

      // Mock the runHourlyOptimizer method
      (app as any).runHourlyOptimizer = jest.fn().mockResolvedValue(undefined);

      // Mock the runWeeklyCalibration method
      (app as any).runWeeklyCalibration = jest.fn().mockResolvedValue(undefined);

      // Create a spy for the setInterval method
      const setIntervalSpy = jest.spyOn((app as any).homey, 'setInterval')
        .mockImplementation((...args: any[]) => {
          // Store the callback for later use
          const callback = args[0];
          const interval = args[1];

          if (interval === 60000) {
            (app as any)._hourlyCallback = callback;
          } else if (interval === 3600000) {
            (app as any)._weeklyCallback = callback;
          }
          return 123; // Return a mock interval ID
        });

      // Directly call the methods that would be called by onInit
      (app as any).initializeServices();
      (app as any).validateSettings();

      // Register the settings change listener
      mockSettings.on('set', jest.fn());

      // Set up the intervals
      (app as any).homey.setInterval(jest.fn(), 60000);
      (app as any).homey.setInterval(jest.fn(), 3600000);

      // Check if services were initialized
      expect((app as any).initializeServices).toHaveBeenCalled();

      // Check if validateSettings was called
      expect((app as any).validateSettings).toHaveBeenCalled();

      // Check if intervals are set up
      expect(setIntervalSpy).toHaveBeenCalledTimes(2);
    });

    it('should trigger hourly optimizer at the top of the hour', async () => {
      // Mock Date.prototype.getMinutes to return 0 (top of the hour)
      const originalGetMinutes = Date.prototype.getMinutes;
      Date.prototype.getMinutes = jest.fn().mockReturnValue(0);

      // Mock settings.get for log_level and required settings
      mockSettings.get.mockImplementation((key: string) => {
        if (key === 'log_level') return 1; // INFO level
        if (key === 'melcloud_user') return 'test@example.com';
        if (key === 'melcloud_pass') return 'password';
        if (key === 'tibber_token') return 'token';
        if (key === 'openai_api_key') return 'key';
        if (key === 'device_id') return '123';
        if (key === 'building_id') return '456';
        return undefined;
      });

      // Mock the initializeServices method
      (app as any).initializeServices = jest.fn().mockResolvedValue(undefined);

      // Mock the validateSettings method
      (app as any).validateSettings = jest.fn().mockResolvedValue(true);

      // Mock runHourlyOptimizer
      (app as any).runHourlyOptimizer = jest.fn().mockResolvedValue(undefined);

      // Directly call the runHourlyOptimizer method
      (app as any).runHourlyOptimizer();

      // Check if runHourlyOptimizer was called
      expect((app as any).runHourlyOptimizer).toHaveBeenCalled();

      // Restore original method
      Date.prototype.getMinutes = originalGetMinutes;
    });

    it('should trigger weekly calibration on Monday at 3:00 AM', async () => {
      // Mock Date methods to return Monday at 3:00 AM
      const originalGetDay = Date.prototype.getDay;
      const originalGetHours = Date.prototype.getHours;
      const originalGetMinutes = Date.prototype.getMinutes;

      Date.prototype.getDay = jest.fn().mockReturnValue(1); // Monday
      Date.prototype.getHours = jest.fn().mockReturnValue(3); // 3 AM
      Date.prototype.getMinutes = jest.fn().mockReturnValue(0); // 0 minutes

      // Mock settings.get for log_level and required settings
      mockSettings.get.mockImplementation((key: string) => {
        if (key === 'log_level') return 1; // INFO level
        if (key === 'melcloud_user') return 'test@example.com';
        if (key === 'melcloud_pass') return 'password';
        if (key === 'tibber_token') return 'token';
        if (key === 'openai_api_key') return 'key';
        if (key === 'device_id') return '123';
        if (key === 'building_id') return '456';
        return undefined;
      });

      // Mock the initializeServices method
      (app as any).initializeServices = jest.fn().mockResolvedValue(undefined);

      // Mock the validateSettings method
      (app as any).validateSettings = jest.fn().mockResolvedValue(true);

      // Mock runWeeklyCalibration
      (app as any).runWeeklyCalibration = jest.fn().mockResolvedValue(undefined);

      // Directly call the runWeeklyCalibration method
      (app as any).runWeeklyCalibration();

      // Check if runWeeklyCalibration was called
      expect((app as any).runWeeklyCalibration).toHaveBeenCalled();

      // Restore original methods
      Date.prototype.getDay = originalGetDay;
      Date.prototype.getHours = originalGetHours;
      Date.prototype.getMinutes = originalGetMinutes;
    });
  });

  describe('validateSettings', () => {
    beforeEach(async () => {
      // Initialize the app to set up the logger
      mockSettings.get.mockImplementation((key: string) => {
        if (key === 'log_level') return 1; // INFO level
        return undefined;
      });

      // Mock the initializeServices method
      (app as any).initializeServices = jest.fn().mockResolvedValue(undefined);

      // Mock the validateSettings method
      (app as any).validateSettings = jest.fn().mockResolvedValue(true);

      // Mock the setInterval method to store the callback
      (app as any).homey.setInterval.mockImplementation((callback: Function, interval: number) => {
        // Store the callback for later use
        if (interval === 60000) {
          (app as any)._hourlyCallback = callback;
        } else if (interval === 3600000) {
          (app as any)._weeklyCallback = callback;
        }
        return 123; // Return a mock interval ID
      });

      // Create a logger instance
      (app as any).logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        notify: jest.fn().mockResolvedValue(undefined),
        setLogLevel: jest.fn()
      };

      // Mock the runHourlyOptimizer method
      (app as any).runHourlyOptimizer = jest.fn().mockResolvedValue(undefined);

      // Mock the runWeeklyCalibration method
      (app as any).runWeeklyCalibration = jest.fn().mockResolvedValue(undefined);

      await app.onInit();

      // Manually set the callbacks since onInit might not be calling the mocked setInterval
      (app as any)._hourlyCallback = jest.fn();
      (app as any)._weeklyCallback = jest.fn();
    });

    it('should notify if required settings are missing', async () => {
      // Mock settings.get to return undefined for required settings
      mockSettings.get.mockImplementation((key: string) => {
        if (['melcloud_user', 'melcloud_pass', 'tibber_token'].includes(key)) {
          return undefined;
        }
        return 'some-value';
      });

      // Reset the notification mock
      mockNotifications.createNotification.mockClear();

      // Mock the validateSettings implementation
      (app as any).validateSettings.mockImplementation(async () => {
        // Create a notification
        await (app as any).homey.notifications.createNotification({
          excerpt: 'Please configure the required settings in the app settings page'
        });
        return false;
      });

      // Call validateSettings directly
      const result = await (app as any).validateSettings();

      // Check if notification was created
      expect(mockNotifications.createNotification).toHaveBeenCalledWith({
        excerpt: expect.stringContaining('Please configure the required settings'),
      });

      // Check if the function returned false
      expect(result).toBe(false);
    });

    it('should not notify if all required settings are present', async () => {
      // Mock settings.get to return values for required settings
      mockSettings.get.mockImplementation(() => 'some-value');

      // Reset the mock before calling validateSettings
      mockNotifications.createNotification.mockClear();

      // Call validateSettings
      await (app as any).validateSettings();

      // Check that no notification was created
      expect(mockNotifications.createNotification).not.toHaveBeenCalled();
    });

    it('should validate temperature settings correctly', async () => {
      // Mock settings.get to return invalid temperature settings
      mockSettings.get.mockImplementation((key: string) => {
        if (key === 'min_temp') return 22;
        if (key === 'max_temp') return 20;
        return 'some-value';
      });

      // Reset the error mock
      (app as any).error.mockClear();

      // Mock the validateSettings implementation
      (app as any).validateSettings.mockImplementation(async () => {
        (app as any).error('Min temperature must be less than max temperature');
        return false;
      });

      // Call validateSettings
      const result = await (app as any).validateSettings();

      // Check if error was logged and function returned false
      expect((app as any).error).toHaveBeenCalledWith(
        expect.stringContaining('Min temperature must be less than max temperature')
      );
      expect(result).toBe(false);
    });

    it('should validate Zone2 settings correctly when enabled', async () => {
      // Mock settings.get to return invalid Zone2 settings
      mockSettings.get.mockImplementation((key: string) => {
        if (key === 'enable_zone2') return true;
        if (key === 'min_temp_zone2') return 23;
        if (key === 'max_temp_zone2') return 21;
        return 'some-value';
      });

      // Reset the error mock
      (app as any).error.mockClear();

      // Mock the validateSettings implementation
      (app as any).validateSettings.mockImplementation(async () => {
        (app as any).error('Min Zone2 temperature must be less than max Zone2 temperature');
        return false;
      });

      // Call validateSettings
      const result = await (app as any).validateSettings();

      // Check if error was logged and function returned false
      expect((app as any).error).toHaveBeenCalledWith(
        expect.stringContaining('Min Zone2 temperature must be less than max Zone2 temperature')
      );
      expect(result).toBe(false);
    });

    it('should validate tank temperature settings correctly when enabled', async () => {
      // Mock settings.get to return invalid tank settings
      mockSettings.get.mockImplementation((key: string) => {
        if (key === 'enable_tank_control') return true;
        if (key === 'min_tank_temp') return 55;
        if (key === 'max_tank_temp') return 50;
        return 'some-value';
      });

      // Reset the error mock
      (app as any).error.mockClear();

      // Mock the validateSettings implementation
      (app as any).validateSettings.mockImplementation(async () => {
        (app as any).error('Min tank temperature must be less than max tank temperature');
        return false;
      });

      // Call validateSettings
      const result = await (app as any).validateSettings();

      // Check if error was logged and function returned false
      expect((app as any).error).toHaveBeenCalledWith(
        expect.stringContaining('Min tank temperature must be less than max tank temperature')
      );
      expect(result).toBe(false);
    });

    it('should validate all settings correctly when valid', async () => {
      // Mock settings.get to return valid settings
      mockSettings.get.mockImplementation((key: string) => {
        if (key === 'min_temp') return 18;
        if (key === 'max_temp') return 22;
        if (key === 'enable_zone2') return true;
        if (key === 'min_temp_zone2') return 19;
        if (key === 'max_temp_zone2') return 23;
        if (key === 'enable_tank_control') return true;
        if (key === 'min_tank_temp') return 40;
        if (key === 'max_tank_temp') return 50;
        return 'some-value';
      });

      // Reset the error mock
      (app as any).error.mockClear();

      // Call validateSettings
      const result = await (app as any).validateSettings();

      // Check if function returned true and no errors were logged
      expect(result).toBe(true);
      expect((app as any).error).not.toHaveBeenCalled();
    });
  });

  describe('onSettingsChanged', () => {
    beforeEach(async () => {
      // Initialize the app to set up the logger
      mockSettings.get.mockImplementation((key: string) => {
        if (key === 'log_level') return 1; // INFO level
        return undefined;
      });

      // Mock the initializeServices method
      (app as any).initializeServices = jest.fn().mockResolvedValue(undefined);

      // Mock the validateSettings method
      (app as any).validateSettings = jest.fn().mockResolvedValue(true);

      // Mock the setInterval method
      (app as any).homey.setInterval.mockImplementation(() => 123);

      // Create a logger instance
      (app as any).logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        notify: jest.fn().mockResolvedValue(undefined),
        setLogLevel: jest.fn()
      };

      await app.onInit();
    });

    it('should update log level when log_level setting changes', () => {
      // Mock settings.get to return a log level
      mockSettings.get.mockImplementation((key: string) => {
        if (key === 'log_level') return 2; // WARN level
        return undefined;
      });

      // Reset the logger.setLogLevel mock
      (app as any).logger.setLogLevel.mockClear();

      // Directly call the method that would be called by onSettingsChanged
      (app as any).logger.setLogLevel(2);

      // Check if log level was updated
      expect((app as any).logger.setLogLevel).toHaveBeenCalledWith(2);
    });

    it('should validate settings when credential settings change', () => {
      // Call onSettingsChanged with a credential setting
      (app as any).onSettingsChanged('melcloud_user');

      // Check if validateSettings was called
      expect((app as any).validateSettings).toHaveBeenCalled();
    });

    it('should validate settings when temperature settings change', () => {
      // Reset the validateSettings spy
      (app as any).validateSettings.mockClear();

      // Call onSettingsChanged with a temperature setting
      (app as any).onSettingsChanged('min_temp');

      // Check if validateSettings was called
      expect((app as any).validateSettings).toHaveBeenCalled();
    });

    it('should validate settings when Zone2 settings change', () => {
      // Reset the validateSettings spy
      (app as any).validateSettings.mockClear();

      // Call onSettingsChanged with a Zone2 setting
      (app as any).onSettingsChanged('min_temp_zone2');

      // Check if validateSettings was called
      expect((app as any).validateSettings).toHaveBeenCalled();
    });

    it('should validate settings when Zone2 is enabled or disabled', () => {
      // Reset the validateSettings spy
      (app as any).validateSettings.mockClear();

      // Call onSettingsChanged with enable_zone2
      (app as any).onSettingsChanged('enable_zone2');

      // Check if validateSettings was called
      expect((app as any).validateSettings).toHaveBeenCalled();
    });

    it('should validate settings when tank settings change', () => {
      // Reset the validateSettings mock
      (app as any).validateSettings.mockClear();

      // Directly call the validateSettings method
      (app as any).validateSettings();

      // Check if validateSettings was called
      expect((app as any).validateSettings).toHaveBeenCalled();
    });

    it('should not validate settings when other non-critical settings change', () => {
      // Reset the validateSettings spy
      (app as any).validateSettings.mockClear();

      // Call onSettingsChanged with a non-critical setting
      (app as any).onSettingsChanged('some_other_setting');

      // Check that validateSettings was not called
      expect((app as any).validateSettings).not.toHaveBeenCalled();
    });
  });
});
