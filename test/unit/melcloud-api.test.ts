import { MelCloudApi } from '../../src/services/melcloud-api';

// Mock fetch globally
global.fetch = jest.fn();

describe('MELCloud API', () => {
  let melCloudApi: MelCloudApi;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Create a new instance of MelCloudApi
    melCloudApi = new MelCloudApi('test@example.com', 'password');

    // Mock successful MELCloud API responses
    (global.fetch as jest.Mock).mockImplementation((url: string, options: any) => {
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
        // Check the effective flags in the request body
        const body = JSON.parse(options.body);
        let responseTemp = 21.0;

        if (body.EffectiveFlags === 8589934720) { // Zone1 flag
          responseTemp = body.SetTemperatureZone1;
        } else if (body.EffectiveFlags === 34359738880) { // Zone2 flag
          responseTemp = body.SetTemperatureZone2;
        } else if (body.EffectiveFlags === 17592186044448) { // Tank flag
          responseTemp = body.SetTankWaterTemperature;
        }

        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            DeviceID: 123,
            BuildingID: 456,
            RoomTemperatureZone1: 21.5,
            RoomTemperatureZone2: 22.0,
            SetTemperatureZone1: body.EffectiveFlags === 8589934720 ? responseTemp : 21.0,
            SetTemperatureZone2: body.EffectiveFlags === 34359738880 ? responseTemp : 22.0,
            SetTankWaterTemperature: body.EffectiveFlags === 17592186044448 ? responseTemp : 45.0,
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
  });

  describe('login', () => {
    it('should login successfully', async () => {
      const result = await melCloudApi.login();

      expect(result).toBe(true);
      expect(melCloudApi.contextKey).toBe('test-session-key');
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

      await expect(melCloudApi.login()).rejects.toThrow('MELCloud login failed: Invalid credentials');
    });
  });

  describe('getDevices', () => {
    it('should retrieve devices', async () => {
      // Login first
      await melCloudApi.login();

      const devices = await melCloudApi.getDevices();

      expect(devices).toHaveLength(1);
      expect(devices[0]).toHaveProperty('id', 123);
      expect(devices[0]).toHaveProperty('name', 'Boiler');
      expect(devices[0]).toHaveProperty('buildingId', 456);
      expect(devices[0]).toHaveProperty('hasZone2', true);
    });

    it('should throw error if not logged in', async () => {
      await expect(melCloudApi.getDevices()).rejects.toThrow('Not logged in to MELCloud');
    });
  });

  describe('getDeviceState', () => {
    it('should get device state', async () => {
      // Login first
      await melCloudApi.login();

      const state = await melCloudApi.getDeviceState(123, 456);

      expect(state).toHaveProperty('DeviceID', 123);
      expect(state).toHaveProperty('BuildingID', 456);
      expect(state).toHaveProperty('SetTemperatureZone1', 21.0);
      expect(state).toHaveProperty('SetTemperatureZone2', 22.0);
      expect(state).toHaveProperty('SetTankWaterTemperature', 45.0);
    });

    it('should throw error if not logged in', async () => {
      await expect(melCloudApi.getDeviceState(123, 456)).rejects.toThrow('Not logged in to MELCloud');
    });
  });

  describe('setDeviceTemperature', () => {
    it('should set Zone1 temperature with correct effective flag', async () => {
      // Login first
      await melCloudApi.login();

      const result = await melCloudApi.setDeviceTemperature(123, 456, 20.5, 1);

      expect(result).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://app.melcloud.com/Mitsubishi.Wifi.Client/Device/SetAtw',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"EffectiveFlags":8589934720')
        })
      );
    });

    it('should set Zone2 temperature with correct effective flag', async () => {
      // Login first
      await melCloudApi.login();

      const result = await melCloudApi.setDeviceTemperature(123, 456, 21.5, 2);

      expect(result).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://app.melcloud.com/Mitsubishi.Wifi.Client/Device/SetAtw',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"EffectiveFlags":34359738880')
        })
      );
    });

    it('should throw error if not logged in', async () => {
      await expect(melCloudApi.setDeviceTemperature(123, 456, 20.5, 1)).rejects.toThrow('Not logged in to MELCloud');
    });
  });

  describe('setDeviceTankTemperature', () => {
    it('should set tank temperature with correct effective flag', async () => {
      // Login first
      await melCloudApi.login();

      const result = await melCloudApi.setDeviceTankTemperature(123, 456, 42.0);

      expect(result).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://app.melcloud.com/Mitsubishi.Wifi.Client/Device/SetAtw',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"EffectiveFlags":17592186044448')
        })
      );
    });

    it('should throw error if not logged in', async () => {
      await expect(melCloudApi.setDeviceTankTemperature(123, 456, 42.0)).rejects.toThrow('Not logged in to MELCloud');
    });
  });
});
