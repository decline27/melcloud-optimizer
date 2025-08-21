import { MelCloudApi } from '../../src/services/melcloud-api';
import * as https from 'https';

// Mock the https module
jest.mock('https');
const mockedHttps = https as jest.Mocked<typeof https>;

// Set a longer timeout for all tests in this file
jest.setTimeout(10000);

describe('MelCloudApi Simple Tests', () => {
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

    // Mock https.request
    const mockResponse = {
      statusCode: 200,
      statusMessage: 'OK',
      on: jest.fn().mockImplementation((event, callback) => {
        if (event === 'data') {
          // Store the callback to be called later
          mockResponse._dataCallback = callback;
        } else if (event === 'end') {
          // Store the callback to be called later
          mockResponse._endCallback = callback;
        }
      }),
      _dataCallback: null as any,
      _endCallback: null as any
    };

    const mockRequest = {
      write: jest.fn(),
      end: jest.fn(),
      on: jest.fn()
    };

    (mockedHttps.request as jest.Mock).mockImplementation((options: any, callback?: any) => {
      // Simulate successful request
      setTimeout(() => {
        if (callback) {
          callback(mockResponse);
          
          // Simulate different responses based on the path
          let responseData: any;
          
          if (options.path && options.path.includes('Login/ClientLogin')) {
            responseData = {
              ErrorId: null,
              LoginData: {
                ContextKey: 'test-context-key'
              }
            };
          } else if (options.path && options.path.includes('User/ListDevices')) {
            responseData = [
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
          } else if (options.path && options.path.includes('Device/Get')) {
            responseData = {
              DeviceID: '123',
              RoomTemperatureZone1: 21.5,
              SetTemperatureZone1: 22,
              EffectiveFlags: 0x02,
              OperationModeZone1: 1
            };
          } else if (options.path && options.path.includes('Device/SetAta')) {
            responseData = {
              ErrorId: null
            };
          } else {
            responseData = { ErrorId: null };
          }
          
          // Trigger data and end events
          if (mockResponse._dataCallback) {
            mockResponse._dataCallback(JSON.stringify(responseData));
          }
          if (mockResponse._endCallback) {
            mockResponse._endCallback();
          }
        }
      }, 0);
      
      return mockRequest as any;
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
      expect(mockedHttps.request).toHaveBeenCalledWith(
        expect.objectContaining({
          hostname: 'app.melcloud.com',
          path: '/Mitsubishi.Wifi.Client/Login/ClientLogin',
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json'
          })
        }),
        expect.any(Function)
      );
    });

    it('should throw error when login fails', async () => {
      // Mock a failed login response
      const mockResponse = {
        statusCode: 200,
        statusMessage: 'OK',
        on: jest.fn().mockImplementation((event, callback) => {
          if (event === 'data') {
            callback(JSON.stringify({
              ErrorId: 1,
              ErrorMessage: 'Invalid credentials'
            }));
          } else if (event === 'end') {
            callback();
          }
        })
      };

      const mockRequest = {
        write: jest.fn(),
        end: jest.fn(),
        on: jest.fn()
      };

      (mockedHttps.request as jest.Mock).mockImplementationOnce((options: any, callback?: any) => {
        setTimeout(() => {
          if (callback) {
            callback(mockResponse);
          }
        }, 0);
        return mockRequest as any;
      });

      await expect(melCloudApi.login('test@example.com', 'wrong-password'))
        .rejects.toThrow('MELCloud login failed');
    });

    it('should handle network errors', async () => {
      // Reset the mock to simulate error condition
      jest.clearAllMocks();
      
      // Mock a network error
      const mockRequest = {
        write: jest.fn(),
        end: jest.fn(),
        on: jest.fn().mockImplementation((event, callback) => {
          if (event === 'error') {
            setTimeout(() => callback(new Error('Network error')), 0);
          }
        })
      };

      (mockedHttps.request as jest.Mock).mockImplementation(() => {
        return mockRequest as any;
      });

      await expect(melCloudApi.login('test@example.com', 'password'))
        .rejects.toThrow();
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
      expect(devices[0].buildingId).toBe(123); // This should be 123, not 456, based on the mock response
    });

    it('should throw error when not logged in', async () => {
      // Reset contextKey to simulate not being logged in
      (melCloudApi as any).contextKey = null;

      await expect(melCloudApi.getDevices()).rejects.toThrow('Not logged in to MELCloud');
    });

    it('should handle API errors', async () => {
      // Reset the mock to simulate error condition
      jest.clearAllMocks();
      
      // Mock a network error for getDevices
      const mockRequest = {
        write: jest.fn(),
        end: jest.fn(),
        on: jest.fn().mockImplementation((event, callback) => {
          if (event === 'error') {
            setTimeout(() => callback(new Error('API error')), 0);
          }
        })
      };

      (mockedHttps.request as jest.Mock).mockImplementation(() => {
        return mockRequest as any;
      });

      await expect(melCloudApi.getDevices()).rejects.toThrow();
    });
  });

  describe('getDeviceById', () => {
    beforeEach(() => {
      // Mock devices list
      (melCloudApi as any).devices = [
        {
          id: '123',
          name: 'Test Device',
          buildingId: 456
        }
      ];
    });

    it('should return device when found', () => {
      const device = melCloudApi.getDeviceById('123');
      expect(device).toBeDefined();
      expect(device?.id).toBe('123');
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
      const state = await melCloudApi.getDeviceState('123', 456);
      
      expect(state).toBeDefined();
      expect(state.DeviceID).toBe('123');
      expect(state.RoomTemperatureZone1).toBe(21.5);
    });

    it('should throw error when not logged in', async () => {
      (melCloudApi as any).contextKey = null;

      await expect(melCloudApi.getDeviceState('123', 456))
        .rejects.toThrow('Not logged in to MELCloud');
    });

    it('should handle API errors', async () => {
      // Reset the mock to simulate error condition
      jest.clearAllMocks();
      
      // Mock a network error for getDeviceState
      const mockRequest = {
        write: jest.fn(),
        end: jest.fn(),
        on: jest.fn().mockImplementation((event, callback) => {
          if (event === 'error') {
            setTimeout(() => callback(new Error('API error')), 0);
          }
        })
      };

      (mockedHttps.request as jest.Mock).mockImplementation(() => {
        return mockRequest as any;
      });

      await expect(melCloudApi.getDeviceState('123', 456)).rejects.toThrow();
    });
  });

  describe('setDeviceTemperature', () => {
    beforeEach(() => {
      // Set contextKey for authenticated requests
      (melCloudApi as any).contextKey = 'test-context-key';
    });

    it('should set device temperature successfully', async () => {
      // The setDeviceTemperature method will use the mocked https.request
      // which is already set up in beforeEach to return appropriate responses
      // for both getDeviceState and setDevice calls
      const result = await melCloudApi.setDeviceTemperature('123', 456, 24);
      expect(result).toBe(true);
    });

    it('should throw error when not logged in', async () => {
      (melCloudApi as any).contextKey = null;

      await expect(melCloudApi.setDeviceTemperature('123', 456, 24))
        .rejects.toThrow('Not logged in to MELCloud');
    });

    it('should handle API errors', async () => {
      // Reset the mock to simulate error condition
      jest.clearAllMocks();
      
      // Mock a network error for setDeviceTemperature
      const mockRequest = {
        write: jest.fn(),
        end: jest.fn(),
        on: jest.fn().mockImplementation((event, callback) => {
          if (event === 'error') {
            setTimeout(() => callback(new Error('API error')), 0);
          }
        })
      };

      (mockedHttps.request as jest.Mock).mockImplementation(() => {
        return mockRequest as any;
      });

      await expect(melCloudApi.setDeviceTemperature('123', 456, 24)).rejects.toThrow();
    });
  });
});
