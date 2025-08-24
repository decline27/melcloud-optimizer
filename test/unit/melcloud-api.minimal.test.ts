import { MelCloudApi } from '../../src/services/melcloud-api';

// Set a longer timeout for all tests in this file
jest.setTimeout(10000);

describe('MelCloudApi Minimal Tests', () => {
  let melCloudApi: MelCloudApi;
  let mockLogger: any;

  beforeEach(() => {
    // Create a mock logger
    mockLogger = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      api: jest.fn()
    };

    // Create a new instance of MelCloudApi with the mock logger
  melCloudApi = new MelCloudApi(mockLogger, { get: () => null, set: () => {} } as any);

    // Mock the errorHandler to prevent errors
    (melCloudApi as any).errorHandler = {
      logError: jest.fn(),
      createAppError: jest.fn().mockImplementation((error, context, message) => {
        const errorMessage = message || (error instanceof Error ? error.message : String(error));
        return new Error(errorMessage);
      })
    };

    // Disable the circuit breaker to prevent "Service unavailable" errors
    (melCloudApi as any).circuitBreaker = {
      execute: jest.fn().mockImplementation((fn) => fn()),
      cleanup: jest.fn()
    };

    // Mock the throttledApiCall method directly
    jest.spyOn(melCloudApi as any, 'throttledApiCall').mockImplementation(async (...args: any[]) => {
      const [method, endpoint] = args;
      if (endpoint === 'Login/ClientLogin') {
        return {
          ErrorId: null,
          LoginData: {
            ContextKey: 'test-context-key'
          }
        };
      } else if (endpoint === 'User/ListDevices') {
        return [
          {
            ID: 123,
            Structure: {
              Devices: [
                {
                  DeviceID: '123',
                  DeviceName: 'Test Device',
                  BuildingID: 456
                }
              ]
            }
          }
        ];
      } else if (endpoint.includes('Device/Get')) {
        return {
          DeviceID: '123',
          RoomTemperatureZone1: 21.5,
          SetTemperatureZone1: 22
        };
      } else {
        return { ErrorId: null };
      }
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('login', () => {
    it('should login successfully', async () => {
      const result = await melCloudApi.login('test@example.com', 'password');
      
      expect(result).toBe(true);
      expect((melCloudApi as any).contextKey).toBe('test-context-key');
    });

    it('should throw error when login fails', async () => {
      // Mock login failure
      jest.spyOn(melCloudApi as any, 'throttledApiCall').mockResolvedValueOnce({
        ErrorId: 1,
        ErrorMessage: 'Invalid credentials'
      });

      await expect(melCloudApi.login('test@example.com', 'wrong-password'))
        .rejects.toThrow('MELCloud login failed: Invalid credentials');
    });
  });

  describe('getDevices', () => {
    it('should get devices successfully', async () => {
      // Set contextKey for authenticated requests
      (melCloudApi as any).contextKey = 'test-context-key';

      const devices = await melCloudApi.getDevices();
      
      expect(devices).toHaveLength(1);
      expect(devices[0].id).toBe('123');
    });

    it('should throw error when not logged in', async () => {
      // Ensure no context key is set
      (melCloudApi as any).contextKey = null;

      await expect(melCloudApi.getDevices())
        .rejects.toThrow('Not logged in to MELCloud');
    });
  });

  describe('getDeviceState', () => {
    it('should get device state successfully', async () => {
      // Set contextKey for authenticated requests
      (melCloudApi as any).contextKey = 'test-context-key';

      const deviceState = await melCloudApi.getDeviceState('123', 456);
      
      expect(deviceState.DeviceID).toBe('123');
      expect(deviceState.RoomTemperatureZone1).toBe(21.5);
    });

    it('should throw error when not logged in', async () => {
      // Ensure no context key is set
      (melCloudApi as any).contextKey = null;

      await expect(melCloudApi.getDeviceState('123', 456))
        .rejects.toThrow('Not logged in to MELCloud');
    });
  });

  describe('setDeviceTemperature', () => {
    it('should set device temperature successfully', async () => {
      // Set contextKey for authenticated requests
      (melCloudApi as any).contextKey = 'test-context-key';

      const result = await melCloudApi.setDeviceTemperature('123', 456, 22);
      
      expect(result).toBe(true);
    });

    it('should throw error when not logged in', async () => {
      // Ensure no context key is set
      (melCloudApi as any).contextKey = null;

      await expect(melCloudApi.setDeviceTemperature('123', 456, 22))
        .rejects.toThrow('Not logged in to MELCloud');
    });
  });
});
