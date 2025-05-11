import { MelCloudApi } from '../../src/services/melcloud-api';
import { createMockLogger } from '../mocks';

// Mock fetch globally
global.fetch = jest.fn();

describe('MelCloudApi', () => {
  let api: MelCloudApi;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Mock fetch
    global.fetch = jest.fn().mockImplementation((url, options) => {
      if (url.includes('Login/ClientLogin')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ErrorId: null,
            LoginData: {
              ContextKey: 'test-context-key'
            }
          })
        });
      } else if (url.includes('User/ListDevices')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([
            {
              ID: 1,
              Structure: {
                Devices: [
                  {
                    DeviceID: 'device-1',
                    DeviceName: 'Test Device',
                    BuildingID: 1
                  }
                ]
              }
            }
          ])
        });
      } else if (url.includes('Device/Get')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            DeviceID: 'device-1',
            DeviceName: 'Test Device',
            RoomTemperature: 21,
            SetTemperature: 22,
            OutdoorTemperature: 5,
            DailyHeatingEnergyProduced: 10,
            DailyHeatingEnergyConsumed: 3,
            DailyHotWaterEnergyProduced: 5,
            DailyHotWaterEnergyConsumed: 2
          })
        });
      } else if (url.includes('Device/SetAta') || url.includes('Device/SetAtw')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({})
        });
      }

      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });

    // Mock logger
    mockLogger = createMockLogger();

    // Create API instance
    api = new MelCloudApi(mockLogger);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('login', () => {
    test('should authenticate with MELCloud', async () => {
      const result = await api.login('test@example.com', 'password');

      expect(result).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://app.melcloud.com/Mitsubishi.Wifi.Client/Login/ClientLogin',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('test@example.com')
        })
      );
      expect(mockLogger.log).toHaveBeenCalled();
    });

    test('should handle authentication errors', async () => {
      // Mock fetch to return an error
      global.fetch = jest.fn().mockImplementation(() => {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ErrorId: 1,
            ErrorMessage: 'Invalid credentials'
          })
        });
      });

      await expect(api.login('test@example.com', 'wrong-password')).rejects.toThrow('MELCloud login failed');
      expect(mockLogger.error).toHaveBeenCalled();
    });

    test('should handle network errors', async () => {
      // Mock fetch to throw a network error
      global.fetch = jest.fn().mockImplementation(() => {
        return Promise.reject(new Error('Network error'));
      });

      await expect(api.login('test@example.com', 'password')).rejects.toThrow('Network error');
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('getDevices', () => {
    test('should return devices list', async () => {
      // First login to set context key
      await api.login('test@example.com', 'password');

      const devices = await api.getDevices();

      expect(devices).toHaveLength(1);
      expect(devices[0].id).toBe('device-1');
      expect(devices[0].name).toBe('Test Device');
      expect(devices[0].buildingId).toBe(1);
      expect(mockLogger.log).toHaveBeenCalled();
    });

    test('should handle errors when not logged in', async () => {
      await expect(api.getDevices()).rejects.toThrow('Not logged in to MELCloud');
      expect(mockLogger.error).toHaveBeenCalled();
    });

    test('should handle API errors', async () => {
      // First login to set context key
      await api.login('test@example.com', 'password');

      // Mock fetch to return an error
      global.fetch = jest.fn().mockImplementation(() => {
        return Promise.reject(new Error('API error'));
      });

      await expect(api.getDevices()).rejects.toThrow('API error');
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('getDeviceState', () => {
    test('should return device state', async () => {
      // First login to set context key
      await api.login('test@example.com', 'password');

      const state = await api.getDeviceState('device-1', 1);

      expect(state.DeviceID).toBe('device-1');
      expect(state.RoomTemperature).toBe(21);
      expect(state.SetTemperature).toBe(22);
      expect(state.OutdoorTemperature).toBe(5);
      expect(mockLogger.log).toHaveBeenCalled();
    });

    test('should handle errors when not logged in', async () => {
      await expect(api.getDeviceState('device-1', 1)).rejects.toThrow('Not logged in to MELCloud');
      expect(mockLogger.error).toHaveBeenCalled();
    });

    test('should handle API errors', async () => {
      // First login to set context key
      await api.login('test@example.com', 'password');

      // Mock fetch to return an error
      global.fetch = jest.fn().mockImplementation(() => {
        return Promise.reject(new Error('API error'));
      });

      await expect(api.getDeviceState('device-1', 1)).rejects.toThrow('API error');
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('setDeviceTemperature', () => {
    test('should update temperature', async () => {
      // First login to set context key
      await api.login('test@example.com', 'password');

      const result = await api.setDeviceTemperature('device-1', 1, 23);

      expect(result).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://app.melcloud.com/Mitsubishi.Wifi.Client/Device/SetAta',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('23')
        })
      );
      expect(mockLogger.log).toHaveBeenCalled();
    });

    test('should handle errors when not logged in', async () => {
      await expect(api.setDeviceTemperature('device-1', 1, 23)).rejects.toThrow('Not logged in to MELCloud');
      expect(mockLogger.error).toHaveBeenCalled();
    });

    test('should handle API errors', async () => {
      // First login to set context key
      await api.login('test@example.com', 'password');

      // Mock fetch to return an error
      global.fetch = jest.fn().mockImplementation(() => {
        return Promise.reject(new Error('API error'));
      });

      await expect(api.setDeviceTemperature('device-1', 1, 23)).rejects.toThrow('API error');
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('getWeeklyAverageCOP', () => {
    test('should calculate weekly average COP', async () => {
      // First login to set context key
      await api.login('test@example.com', 'password');

      // Mock device state with energy data
      global.fetch = jest.fn().mockImplementation(() => {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            DeviceID: 'device-1',
            DailyHeatingEnergyProduced: 10,
            DailyHeatingEnergyConsumed: 3,
            DailyHotWaterEnergyProduced: 5,
            DailyHotWaterEnergyConsumed: 2
          })
        });
      });

      const result = await api.getWeeklyAverageCOP('device-1', 1);

      expect(result).toHaveProperty('heating');
      expect(result).toHaveProperty('hotWater');
      expect(result.heating).toBeGreaterThan(0);
      expect(result.hotWater).toBeGreaterThan(0);
      expect(mockLogger.log).toHaveBeenCalled();
    });

    test('should handle missing energy data', async () => {
      // First login to set context key
      await api.login('test@example.com', 'password');

      // Mock device state without energy data
      global.fetch = jest.fn().mockImplementation(() => {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            DeviceID: 'device-1',
            // No energy data
          })
        });
      });

      const result = await api.getWeeklyAverageCOP('device-1', 1);

      // Should return default values
      expect(result).toHaveProperty('heating');
      expect(result).toHaveProperty('hotWater');
      expect(result.heating).toBe(0);
      expect(result.hotWater).toBe(0);
      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });
});
