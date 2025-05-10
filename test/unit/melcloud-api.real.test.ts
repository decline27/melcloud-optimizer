import { MelCloudApi } from '../../src/services/melcloud-api';
import fetch from 'node-fetch';

// Mock fetch globally
jest.mock('node-fetch');
const mockedFetch = fetch as jest.MockedFunction<typeof fetch>;

describe('MelCloudApi', () => {
  let melCloudApi: MelCloudApi;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Create a new instance of MelCloudApi
    melCloudApi = new MelCloudApi();
  });

  describe('login', () => {
    it('should login successfully', async () => {
      // Mock successful login response
      mockedFetch.mockResolvedValueOnce({
        json: jest.fn().mockResolvedValueOnce({
          ErrorId: null,
          LoginData: {
            ContextKey: 'test-context-key'
          }
        }),
        ok: true
      } as any);

      const result = await melCloudApi.login('test@example.com', 'password');

      // Verify the result
      expect(result).toBe(true);

      // Verify fetch was called with correct parameters
      expect(mockedFetch).toHaveBeenCalledWith(
        'https://app.melcloud.com/Mitsubishi.Wifi.Client/Login/ClientLogin',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            Email: 'test@example.com',
            Password: 'password',
            Language: 0,
            AppVersion: '1.23.4.0',
            Persist: true,
            CaptchaResponse: null,
          }),
        })
      );
    });

    it('should throw error when login fails', async () => {
      // Mock failed login response
      mockedFetch.mockResolvedValueOnce({
        json: jest.fn().mockResolvedValueOnce({
          ErrorId: 1,
          ErrorMessage: 'Invalid credentials'
        }),
        ok: true
      } as any);

      // Expect the login to throw an error
      await expect(melCloudApi.login('test@example.com', 'wrong-password'))
        .rejects.toThrow('MELCloud login failed: Invalid credentials');

      // Verify fetch was called
      expect(mockedFetch).toHaveBeenCalledTimes(1);
    });

    it('should handle network errors', async () => {
      // Mock network error
      mockedFetch.mockRejectedValueOnce(new Error('Network error'));

      // Expect the login to throw an error
      await expect(melCloudApi.login('test@example.com', 'password'))
        .rejects.toThrow('Network error');

      // Verify fetch was called
      expect(mockedFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('getDevices', () => {
    beforeEach(() => {
      // Set contextKey for authenticated requests
      (melCloudApi as any).contextKey = 'test-context-key';
    });

    it('should get devices successfully', async () => {
      // Mock successful devices response
      mockedFetch.mockResolvedValueOnce({
        json: jest.fn().mockResolvedValueOnce([
          {
            ID: 123,
            Structure: {
              Devices: [
                {
                  DeviceID: 456,
                  DeviceName: 'Test Device',
                }
              ]
            }
          }
        ]),
        ok: true
      } as any);

      const devices = await melCloudApi.getDevices();

      // Verify the result
      expect(devices).toHaveLength(1);
      expect(devices[0].id).toBe(456);
      expect(devices[0].name).toBe('Test Device');
      expect(devices[0].buildingId).toBe(123);

      // Verify fetch was called with correct parameters
      expect(mockedFetch).toHaveBeenCalledWith(
        'https://app.melcloud.com/Mitsubishi.Wifi.Client/User/ListDevices',
        expect.objectContaining({
          method: 'GET',
          headers: {
            'X-MitsContextKey': 'test-context-key',
          },
        })
      );
    });

    it('should throw error when not logged in', async () => {
      // Reset contextKey to simulate not being logged in
      (melCloudApi as any).contextKey = null;

      // Expect getDevices to throw an error
      await expect(melCloudApi.getDevices())
        .rejects.toThrow('Not logged in to MELCloud');

      // Verify fetch was not called
      expect(mockedFetch).not.toHaveBeenCalled();
    });

    it('should handle API errors', async () => {
      // Mock API error
      mockedFetch.mockRejectedValueOnce(new Error('API error'));

      // Expect getDevices to throw an error
      await expect(melCloudApi.getDevices())
        .rejects.toThrow('API error');

      // Verify fetch was called
      expect(mockedFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('getDeviceById', () => {
    beforeEach(() => {
      // Set devices for lookup
      (melCloudApi as any).devices = [
        {
          id: '123',
          name: 'Device 1',
          buildingId: 456
        },
        {
          id: '789',
          name: 'Device 2',
          buildingId: 456
        }
      ];
    });

    it('should return device when found', () => {
      const device = melCloudApi.getDeviceById('123');

      expect(device).not.toBeNull();
      expect(device.id).toBe('123');
      expect(device.name).toBe('Device 1');
    });

    it('should return null when device not found', () => {
      const device = melCloudApi.getDeviceById('999');

      expect(device).toBeNull();
    });
  });

  describe('getDeviceState', () => {
    beforeEach(() => {
      // Set contextKey for authenticated requests
      (melCloudApi as any).contextKey = 'test-context-key';
    });

    it('should get device state successfully', async () => {
      // Mock successful device state response
      mockedFetch.mockResolvedValueOnce({
        json: jest.fn().mockResolvedValueOnce({
          DeviceID: '123',
          BuildingID: 456,
          RoomTemperatureZone1: 21.5,
          SetTemperatureZone1: 22.0
        }),
        ok: true
      } as any);

      const state = await melCloudApi.getDeviceState('123', 456);

      // Verify the result
      expect(state).toBeDefined();
      expect(state.DeviceID).toBe('123');
      expect(state.RoomTemperatureZone1).toBe(21.5);

      // Verify fetch was called with correct parameters
      expect(mockedFetch).toHaveBeenCalledWith(
        'https://app.melcloud.com/Mitsubishi.Wifi.Client/Device/Get?id=123&buildingID=456',
        expect.objectContaining({
          method: 'GET',
          headers: {
            'X-MitsContextKey': 'test-context-key',
          },
        })
      );
    });

    it('should throw error when not logged in', async () => {
      // Reset contextKey to simulate not being logged in
      (melCloudApi as any).contextKey = null;

      // Expect getDeviceState to throw an error
      await expect(melCloudApi.getDeviceState('123', 456))
        .rejects.toThrow('Not logged in to MELCloud');

      // Verify fetch was not called
      expect(mockedFetch).not.toHaveBeenCalled();
    });

    it('should handle API errors', async () => {
      // Mock API error
      mockedFetch.mockRejectedValueOnce(new Error('API error'));

      // Expect getDeviceState to throw an error
      await expect(melCloudApi.getDeviceState('123', 456))
        .rejects.toThrow('API error');

      // Verify fetch was called
      expect(mockedFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('setDeviceTemperature', () => {
    beforeEach(() => {
      // Set contextKey for authenticated requests
      (melCloudApi as any).contextKey = 'test-context-key';
    });

    it('should set device temperature successfully', async () => {
      // Mock successful device state response for the first call (getDeviceState)
      mockedFetch.mockResolvedValueOnce({
        json: jest.fn().mockResolvedValueOnce({
          DeviceID: '123',
          BuildingID: 456,
          SetTemperature: 21.0
        }),
        ok: true
      } as any);

      // Mock successful response for the second call (setDeviceTemperature)
      mockedFetch.mockResolvedValueOnce({
        json: jest.fn().mockResolvedValueOnce({}),
        ok: true
      } as any);

      const result = await melCloudApi.setDeviceTemperature('123', 456, 22.0);

      // Verify the result
      expect(result).toBe(true);

      // Verify fetch was called twice (get state and set temperature)
      expect(mockedFetch).toHaveBeenCalledTimes(2);

      // Verify the second call was to set temperature
      expect(mockedFetch.mock.calls[1][0]).toBe('https://app.melcloud.com/Mitsubishi.Wifi.Client/Device/SetAta');

      // Check if the second call exists and has a body property
      if (mockedFetch.mock.calls[1] && mockedFetch.mock.calls[1][1] && mockedFetch.mock.calls[1][1].body) {
        expect(JSON.parse(mockedFetch.mock.calls[1][1].body as string).SetTemperature).toBe(22.0);
      }
    });

    it('should throw error when not logged in', async () => {
      // Reset contextKey to simulate not being logged in
      (melCloudApi as any).contextKey = null;

      // Expect setDeviceTemperature to throw an error
      await expect(melCloudApi.setDeviceTemperature('123', 456, 22.0))
        .rejects.toThrow('Not logged in to MELCloud');

      // Verify fetch was not called
      expect(mockedFetch).not.toHaveBeenCalled();
    });

    it('should handle API errors', async () => {
      // Mock API error
      mockedFetch.mockRejectedValueOnce(new Error('API error'));

      // Expect setDeviceTemperature to throw an error
      await expect(melCloudApi.setDeviceTemperature('123', 456, 22.0))
        .rejects.toThrow('API error');

      // Verify fetch was called
      expect(mockedFetch).toHaveBeenCalledTimes(1);
    });
  });
});
