import { describe, it, expect, beforeEach, jest } from '@jest/globals';

describe('validateAndStartCron API endpoint', () => {
  let mockHomey: any;
  let api: any;

  beforeEach(() => {
    // Mock homey object
    mockHomey = {
      app: {
        log: jest.fn(),
        error: jest.fn(),
      },
      settings: {
        get: jest.fn(),
      },
      drivers: {
        getDriver: jest.fn(),
      },
    };

    // Import API after setting up mocks
    api = require('../../api.ts');
  });

  it('should return cronRunning: true when all settings are valid', async () => {
    // Mock all required settings as present (defaulting to ENTSO-E)
    mockHomey.settings.get.mockImplementation((key: string) => {
      switch (key) {
        case 'melcloud_user':
          return 'test@example.com';
        case 'melcloud_pass':
          return 'password123';
        case 'device_id':
          return 'device_123';
        case 'price_data_source':
          return 'entsoe';
        default:
          return undefined;
      }
    });

    // Mock driver with restart method
    const mockDriver = {
      restartCronJobs: jest.fn(),
    };
    mockHomey.drivers.getDriver.mockReturnValue(mockDriver);

    const result = await api.validateAndStartCron({ homey: mockHomey });

    expect(result).toEqual({
      success: true,
      cronRunning: true,
      message: 'Settings validated successfully, optimization started',
    });
    expect(mockDriver.restartCronJobs).toHaveBeenCalled();
  });

  it('should return cronRunning: false when settings are missing', async () => {
    // Mock missing settings
    mockHomey.settings.get.mockImplementation((key: string) => {
      switch (key) {
        case 'melcloud_user':
          return 'test@example.com';
        case 'melcloud_pass':
          return undefined; // Missing password
        case 'device_id':
          return 'device_123';
        default:
          return undefined;
      }
    });

    const result = await api.validateAndStartCron({ homey: mockHomey });

    expect(result).toEqual({
      success: true,
      cronRunning: false,
      message: 'Please complete required settings: MELCloud password',
    });
  });

  it('should handle driver not available gracefully', async () => {
    // Mock all required settings as present
    mockHomey.settings.get.mockImplementation((key: string) => {
      switch (key) {
        case 'melcloud_user':
          return 'test@example.com';
        case 'melcloud_pass':
          return 'password123';
        case 'device_id':
          return 'device_123';
        case 'price_data_source':
          return 'entsoe';
        default:
          return undefined;
      }
    });

    // Mock driver as not available
    mockHomey.drivers.getDriver.mockReturnValue(null);

    const result = await api.validateAndStartCron({ homey: mockHomey });

    expect(result).toEqual({
      success: true,
      cronRunning: true,
      message: 'Settings validated successfully, optimization started',
    });
    expect(mockHomey.app.log).toHaveBeenCalledWith('✅ Settings valid, but driver restart not available');
  });
});
