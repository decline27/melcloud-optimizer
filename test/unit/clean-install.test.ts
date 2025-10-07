import HeatOptimizerApp from '../../src/app';

describe('Clean Install Scenarios', () => {
  let app: HeatOptimizerApp;
  let mockSettings: any;
  let mockNotifications: any;
  let mockFlow: any;

  beforeEach(() => {
    // Create mock settings
    mockSettings = {
      get: jest.fn(),
      set: jest.fn(),
      unset: jest.fn(),
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

  describe('Clean Install with ENTSO-E (Default)', () => {
    it('should validate successfully with MELCloud credentials and ENTSO-E price source', () => {
      // Mock clean install with defaults (ENTSO-E as price source, no Tibber token)
      mockSettings.get.mockImplementation((key: string) => {
        switch (key) {
          case 'melcloud_user': return 'user@example.com';
          case 'melcloud_pass': return 'password123';
          case 'price_data_source': return 'entsoe'; // Default from HTML
          case 'tibber_token': return undefined; // No Tibber token needed
          case 'device_id': return 'Boiler'; // Default placeholder
          case 'log_level': return 1; // INFO level
          default: return undefined;
        }
      });

      // Call validateSettings
      const result = (app as any).validateSettings();

      // Should pass validation
      expect(result).toBe(true);
      expect((app as any).error).not.toHaveBeenCalled();
    });

    it('should fail validation if MELCloud credentials are missing even with ENTSO-E', () => {
      // Mock clean install missing MELCloud credentials
      mockSettings.get.mockImplementation((key: string) => {
        switch (key) {
          case 'melcloud_user': return undefined; // Missing!
          case 'melcloud_pass': return undefined; // Missing!
          case 'price_data_source': return 'entsoe';
          case 'tibber_token': return undefined; // Not needed for ENTSO-E
          case 'log_level': return 1;
          default: return undefined;
        }
      });

      // Call validateSettings
      const result = (app as any).validateSettings();

      // Should fail validation
      expect(result).toBe(false);
      expect((app as any).error).toHaveBeenCalledWith('MELCloud credentials are missing');
    });
  });

  describe('Clean Install with Tibber', () => {
    it('should require Tibber token when Tibber is selected as price source', () => {
      // Mock user selecting Tibber but forgetting token
      mockSettings.get.mockImplementation((key: string) => {
        switch (key) {
          case 'melcloud_user': return 'user@example.com';
          case 'melcloud_pass': return 'password123';
          case 'price_data_source': return 'tibber'; // User selected Tibber
          case 'tibber_token': return undefined; // But forgot token
          case 'log_level': return 1;
          default: return undefined;
        }
      });

      // Call validateSettings
      const result = (app as any).validateSettings();

      // Should fail validation
      expect(result).toBe(false);
      expect((app as any).error).toHaveBeenCalledWith('Tibber API token is missing');
    });

    it('should validate successfully with Tibber token when Tibber is selected', () => {
      // Mock user with complete Tibber setup
      mockSettings.get.mockImplementation((key: string) => {
        switch (key) {
          case 'melcloud_user': return 'user@example.com';
          case 'melcloud_pass': return 'password123';
          case 'price_data_source': return 'tibber';
          case 'tibber_token': return 'tibber_token_123';
          case 'log_level': return 1;
          default: return undefined;
        }
      });

      // Call validateSettings
      const result = (app as any).validateSettings();

      // Should pass validation
      expect(result).toBe(true);
      expect((app as any).error).not.toHaveBeenCalled();
    });
  });

  describe('Legacy Settings Compatibility', () => {
    it('should handle default price_data_source when not set', () => {
      // Mock scenario where price_data_source is not set (defaults to 'entsoe')
      mockSettings.get.mockImplementation((key: string) => {
        switch (key) {
          case 'melcloud_user': return 'user@example.com';
          case 'melcloud_pass': return 'password123';
          case 'price_data_source': return undefined; // Not set - should default to 'entsoe'
          case 'tibber_token': return undefined; // Not required because default is entsoe
          case 'log_level': return 1;
          default: return undefined;
        }
      });

      // Call validateSettings
      const result = (app as any).validateSettings();

      // Should pass validation
      expect(result).toBe(true);
      expect((app as any).error).not.toHaveBeenCalled();
    });
  });
});