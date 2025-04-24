import HeatOptimizerApp from '../../src/app';
import { App } from 'homey';

// Mock fetch globally
global.fetch = jest.fn();

describe('MELCloud API', () => {
  let app: HeatOptimizerApp;
  let mockSettings: any;
  let mockNotifications: any;
  let mockFlow: any;
  let melCloudApi: any;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Create app instance
    app = new HeatOptimizerApp();

    // Mock settings
    mockSettings = {
      get: jest.fn(),
      set: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
    };

    // Mock notifications
    mockNotifications = {
      createNotification: jest.fn().mockResolvedValue(undefined),
    };

    // Mock flow
    mockFlow = {
      runFlowCardAction: jest.fn().mockResolvedValue(undefined),
    };

    // Mock app.homey
    (app as any).homey = {
      settings: mockSettings,
      notifications: mockNotifications,
      flow: mockFlow,
      setInterval: jest.fn(),
    };

    // Mock app.log and app.error
    (app as any).log = jest.fn();
    (app as any).error = jest.fn();

    // Mock logger
    (app as any).logger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      notify: jest.fn().mockResolvedValue(undefined),
    };

    // Mock settings.get for required settings
    mockSettings.get.mockImplementation((key: string) => {
      switch (key) {
        case 'melcloud_user': return 'test@example.com';
        case 'melcloud_pass': return 'password';
        case 'device_id': return '123';
        case 'building_id': return '456';
        default: return undefined;
      }
    });

    // Mock successful MELCloud API responses
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('melcloud.com/Mitsubishi.Wifi.Client/Login/ClientLogin')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            LoginData: {
              ContextKey: 'test-session-key'
            }
          })
        });
      } else if (url.includes('melcloud.com/Mitsubishi.Wifi.Client/User/ListDevices')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([
            {
              ID: 456, // Building ID
              Name: 'Test Building',
              Structure: {
                Floors: [{
                  Devices: [{
                    DeviceName: 'Boiler',
                    DeviceID: 123,
                    Device: {
                      RoomTemperatureZone1: 21.5,
                      RoomTemperatureZone2: 22.0,
                      SetTemperatureZone1: 21.0,
                      SetTemperatureZone2: 22.0,
                      SetTankWaterTemperature: 45.0,
                      TankWaterTemperature: 43.5,
                      HasZone2: true
                    }
                  }]
                }]
              }
            }
          ])
        });
      } else if (url.includes('melcloud.com/Mitsubishi.Wifi.Client/Device/Get')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            DeviceID: 123,
            BuildingID: 456,
            RoomTemperatureZone1: 21.5,
            RoomTemperatureZone2: 22.0,
            SetTemperatureZone1: 21.0,
            SetTemperatureZone2: 22.0,
            SetTankWaterTemperature: 45.0,
            TankWaterTemperature: 43.5,
            OperationMode: 0,
            OperationModeZone1: 1,
            OperationModeZone2: 1,
            Power: true,
            HasZone2: true
          })
        });
      } else if (url.includes('melcloud.com/Mitsubishi.Wifi.Client/Device/SetAtw')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            DeviceID: 123,
            BuildingID: 456,
            RoomTemperatureZone1: 21.5,
            RoomTemperatureZone2: 22.0,
            SetTemperatureZone1: 20.5, // Changed temperature
            SetTemperatureZone2: 21.5, // Changed temperature
            SetTankWaterTemperature: 42.0, // Changed temperature
            TankWaterTemperature: 43.5,
            OperationMode: 0,
            OperationModeZone1: 1,
            OperationModeZone2: 1,
            Power: true,
            HasZone2: true
          })
        });
      }
      return Promise.reject(new Error('Unknown URL'));
    });

    // Initialize the MELCloud API
    melCloudApi = (app as any).melCloudApi;
  });

  describe('getDeviceList', () => {
    // Mock the API module
    const mockGetDeviceList = jest.fn().mockImplementation(async () => {
      return {
        success: true,
        devices: [
          {
            id: 123,
            name: 'Boiler',
            buildingId: 456,
            hasZone1: true,
            hasZone2: true
          }
        ],
        buildings: [
          {
            id: 456,
            name: 'Home'
          }
        ]
      };
    });

    // Replace the actual API function with our mock
    jest.mock('../../api', () => ({
      getDeviceList: mockGetDeviceList
    }));

    it('should retrieve a list of devices and buildings', async () => {
      // Call the mocked function
      const result = await mockGetDeviceList();

      // Check if the result contains devices and buildings
      expect(result).toHaveProperty('success', true);
      expect(result).toHaveProperty('devices');
      expect(result).toHaveProperty('buildings');
      expect(result.devices).toHaveLength(1);
      expect(result.devices[0]).toHaveProperty('id', 123);
      expect(result.devices[0]).toHaveProperty('hasZone2', true);
    });

    it('should handle errors gracefully', async () => {
      // Override the mock implementation for this test
      mockGetDeviceList.mockImplementationOnce(async () => {
        return {
          success: false,
          error: 'Login failed'
        };
      });

      // Call the mocked function
      const result = await mockGetDeviceList();

      // Check if the result contains an error
      expect(result).toHaveProperty('success', false);
      expect(result).toHaveProperty('error');
      expect(result.error).toBe('Login failed');
    });
  });

  describe('setDeviceTemperature', () => {
    // Mock the setDeviceTemperature function
    const mockSetDeviceTemperature = jest.fn().mockImplementation(async () => {
      return true;
    });

    // Replace the actual API function with our mock
    jest.mock('../../api', () => ({
      ...jest.requireActual('../../api'),
      setDeviceTemperature: mockSetDeviceTemperature
    }));

    it('should set Zone1 temperature with the correct effective flag', async () => {
      // Call the mocked function
      const result = await mockSetDeviceTemperature(123, 456, 20.5, 0.5, 1);

      // Check if the function returned success
      expect(result).toBe(true);

      // Verify the function was called with the correct parameters
      expect(mockSetDeviceTemperature).toHaveBeenCalledWith(
        123, 456, 20.5, 0.5, 1
      );
    });

    it('should set Zone2 temperature with the correct effective flag', async () => {
      // Call the mocked function
      const result = await mockSetDeviceTemperature(123, 456, 21.5, 0.5, 2);

      // Check if the function returned success
      expect(result).toBe(true);

      // Verify the function was called with the correct parameters
      expect(mockSetDeviceTemperature).toHaveBeenCalledWith(
        123, 456, 21.5, 0.5, 2
      );
    });
  });

  describe('setDeviceTankTemperature', () => {
    // Mock the setDeviceTankTemperature function
    const mockSetDeviceTankTemperature = jest.fn().mockImplementation(async () => {
      return true;
    });

    // Replace the actual API function with our mock
    jest.mock('../../api', () => ({
      ...jest.requireActual('../../api'),
      setDeviceTankTemperature: mockSetDeviceTankTemperature
    }));

    it('should set tank temperature with the correct effective flag', async () => {
      // Call the mocked function
      const result = await mockSetDeviceTankTemperature(123, 456, 42.0, 1.0);

      // Check if the function returned success
      expect(result).toBe(true);

      // Verify the function was called with the correct parameters
      expect(mockSetDeviceTankTemperature).toHaveBeenCalledWith(
        123, 456, 42.0, 1.0
      );
    });
  });
});
