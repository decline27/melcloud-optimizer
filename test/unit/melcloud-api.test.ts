import { MelCloudApi } from '../../src/services/melcloud-api';

// Mock console.error to avoid polluting test output
console.error = jest.fn();

// Mock fetch globally
global.fetch = jest.fn();

describe('MELCloud API', () => {
  let melCloudApi: MelCloudApi;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Create a new instance of MelCloudApi
    melCloudApi = new MelCloudApi();

    // Mock successful MELCloud API responses
    (global.fetch as jest.Mock).mockImplementation((url: string, options: any) => {
      if (url.includes('melcloud.com/Mitsubishi.Wifi.Client/Login/ClientLogin')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ErrorId: null,
            ErrorMessage: null,
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
                Devices: [{
                  DeviceID: 123,
                  DeviceName: 'Boiler'
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
            SetTemperature: 21.0
          })
        });
      } else if (url.includes('melcloud.com/Mitsubishi.Wifi.Client/Device/SetAta')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            DeviceID: 123,
            BuildingID: 456,
            SetTemperature: options.body ? JSON.parse(options.body).SetTemperature : 21.0
          })
        });
      }
      return Promise.reject(new Error('Unknown URL'));
    });
  });

  describe('login', () => {
    it('should login successfully', async () => {
      const result = await melCloudApi.login('test@example.com', 'password');

      expect(result).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://app.melcloud.com/Mitsubishi.Wifi.Client/Login/ClientLogin',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('test@example.com')
        })
      );
    });

    it('should handle login errors', async () => {
      // Mock a failed login
      (global.fetch as jest.Mock).mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ErrorId: 1,
            ErrorMessage: 'Invalid credentials'
          })
        })
      );

      await expect(melCloudApi.login('test@example.com', 'wrong-password')).rejects.toThrow('MELCloud login failed: Invalid credentials');
    });
  });

  describe('getDevices', () => {
    it('should retrieve devices', async () => {
      // Login first
      await melCloudApi.login('test@example.com', 'password');

      const devices = await melCloudApi.getDevices();

      expect(devices).toHaveLength(1);
      expect(devices[0]).toHaveProperty('id', 123);
      expect(devices[0]).toHaveProperty('name', 'Boiler');
      expect(devices[0]).toHaveProperty('buildingId', 456);
    });

    it('should throw error if not logged in', async () => {
      await expect(melCloudApi.getDevices()).rejects.toThrow('Not logged in to MELCloud');
    });
  });

  describe('getDeviceState', () => {
    it('should get device state', async () => {
      // Login first
      await melCloudApi.login('test@example.com', 'password');

      const state = await melCloudApi.getDeviceState('123', 456);

      expect(state).toHaveProperty('DeviceID', 123);
      expect(state).toHaveProperty('BuildingID', 456);
      expect(state).toHaveProperty('SetTemperature', 21.0);
    });

    it('should throw error if not logged in', async () => {
      await expect(melCloudApi.getDeviceState('123', 456)).rejects.toThrow('Not logged in to MELCloud');
    });
  });

  describe('setDeviceTemperature', () => {
    it('should set temperature', async () => {
      // Login first
      await melCloudApi.login('test@example.com', 'password');

      const result = await melCloudApi.setDeviceTemperature('123', 456, 20.5);

      expect(result).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://app.melcloud.com/Mitsubishi.Wifi.Client/Device/SetAta',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"SetTemperature":20.5')
        })
      );
    });

    it('should throw error if not logged in', async () => {
      await expect(melCloudApi.setDeviceTemperature('123', 456, 20.5)).rejects.toThrow('Not logged in to MELCloud');
    });
  });
});
