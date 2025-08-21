import { MelCloudApi } from '../../src/services/melcloud-api';

// Set a reasonable timeout (5 seconds)
jest.setTimeout(5000);

// Set a longer timeout for all tests in this file
jest.setTimeout(10000);

describe('MelCloudApi HTTPS Tests', () => {
  let melCloudApi: MelCloudApi;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Create a mock logger first
    const mockLogger = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      api: jest.fn()
    };

    // Create a new instance of MelCloudApi with the mock logger
    melCloudApi = new MelCloudApi(mockLogger as any);

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
    // Clean up any pending timers
    if (melCloudApi && typeof melCloudApi.cleanup === 'function') {
      melCloudApi.cleanup();
    }
    jest.clearAllTimers();
    jest.restoreAllMocks();
  });

  describe('login', () => {
    it('should login successfully', async () => {
      const result = await melCloudApi.login('test@example.com', 'password');
      
      expect(result).toBe(true);
      expect((melCloudApi as any).contextKey).toBe('test-context-key');
    });

    it('should throw error when login fails', async () => {
      // Reset the spy and mock login failure
      jest.restoreAllMocks();
      jest.spyOn(melCloudApi as any, 'throttledApiCall').mockResolvedValue({
        ErrorId: 1,
        ErrorMessage: 'Invalid credentials'
      });

      await expect(melCloudApi.login('test@example.com', 'wrong-password'))
        .rejects.toThrow('MELCloud login failed: Invalid credentials');
    });

    it('should handle network errors', async () => {
      // Reset the spy and mock network error
      jest.restoreAllMocks();
      jest.spyOn(melCloudApi as any, 'throttledApiCall').mockRejectedValue(new Error('Network error'));

      await expect(melCloudApi.login('test@example.com', 'password'))
        .rejects.toThrow('Network error');
    });
  });

  describe('getDevices', () => {
    beforeEach(async () => {
      // Set contextKey for authenticated requests
      (melCloudApi as any).contextKey = 'test-context-key';
    });

    it('should get devices successfully', async () => {
      const devices = await melCloudApi.getDevices();
      
      expect(devices).toHaveLength(1);
      expect(devices[0].id).toBe('123');
      expect(devices[0].name).toBe('Test Device');
      expect(devices[0].buildingId).toBe(123);
    });

    it('should throw error when not logged in', async () => {
      // Reset contextKey to simulate not being logged in
      (melCloudApi as any).contextKey = null;

      await expect(melCloudApi.getDevices()).rejects.toThrow('Not logged in to MELCloud');
    });

    it('should handle API errors', async () => {
      // Reset the spy and mock API error
      jest.restoreAllMocks();
      jest.spyOn(melCloudApi as any, 'throttledApiCall').mockRejectedValue(new Error('API error'));

      await expect(melCloudApi.getDevices()).rejects.toThrow('API error');
    });
  });
});
