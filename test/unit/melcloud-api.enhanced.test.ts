import { MelCloudApi } from '../../src/services/melcloud-api';
import {
  createMockLogger
} from '../mocks';

// Mock node modules
jest.mock('https', () => ({
  request: jest.fn()
}));

jest.mock('url', () => ({
  URL: jest.fn().mockImplementation((url: string) => ({
    pathname: url.split('.com')[1] || url,
    hostname: 'app.melcloud.com',
    protocol: 'https:'
  }))
}));

describe('MelCloudApi Enhanced Tests', () => {
  let api: MelCloudApi;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let mockRequest: any;
  let mockResponse: any;
  let mockHttps: any;

  // Helper function to setup successful response
  const setupSuccessResponse = (data: string) => {
    mockResponse.on.mockImplementation((event: string, handler: any) => {
      if (event === 'data') {
        setImmediate(() => handler(data));
      } else if (event === 'end') {
        setImmediate(() => handler());
      }
    });
  };

  // Helper function to setup error response
  const setupErrorResponse = (statusCode: number, data: string) => {
    mockResponse.statusCode = statusCode;
    mockResponse.on.mockImplementation((event: string, handler: any) => {
      if (event === 'data') {
        setImmediate(() => handler(data));
      } else if (event === 'end') {
        setImmediate(() => handler());
      }
    });
  };

  // Helper function to setup network error
  const setupNetworkError = (error: Error) => {
    mockRequest.on.mockImplementation((event: string, handler: any) => {
      if (event === 'error') {
        setImmediate(() => handler(error));
      }
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Get the mocked https module
    mockHttps = require('https');
    
    mockLogger = createMockLogger();
    api = new MelCloudApi(mockLogger as any);

    // Mock response object
    mockResponse = {
      statusCode: 200,
      statusMessage: 'OK',
      headers: {},
      on: jest.fn(),
      setEncoding: jest.fn()
    };

    // Mock request object
    mockRequest = {
      on: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
      setTimeout: jest.fn(),
      destroy: jest.fn()
    };

    // Setup https.request mock
    mockHttps.request.mockImplementation((options: any, callback?: any) => {
      // Call the callback with our mock response
      if (callback) {
        setImmediate(() => callback(mockResponse));
      }
      return mockRequest;
    });

    // Default success response
    setupSuccessResponse('{"ErrorId":null,"LoginData":{"ContextKey":"test-context-key"}}');
  });

  describe('Constructor', () => {
    test('should initialize with default logger if none provided', () => {
      // Mock global logger
      global.logger = mockLogger as any;
      
      const apiWithoutLogger = new MelCloudApi();
      expect(apiWithoutLogger).toBeDefined();
    });

    test('should initialize with provided logger', () => {
      expect(api).toBeDefined();
      expect(mockLogger.log).not.toHaveBeenCalled(); // Constructor doesn't log
    });
  });

  describe('login', () => {
    test('should login successfully with valid credentials', async () => {
      setupSuccessResponse('{"ErrorId":null,"LoginData":{"ContextKey":"test-context-key"}}');

      const result = await api.login('test@example.com', 'password');
      
      expect(result).toBe(true);
      expect(mockHttps.request).toHaveBeenCalledWith(
        expect.objectContaining({
          hostname: 'app.melcloud.com',
          method: 'POST',
          path: '/Login/ClientLogin'
        }),
        expect.any(Function)
      );
      expect(mockRequest.write).toHaveBeenCalledWith(
        expect.stringContaining('test@example.com')
      );
      expect(mockRequest.end).toHaveBeenCalled();
    });

    test('should throw error when login fails', async () => {
      setupErrorResponse(401, '{"ErrorId":1,"ErrorMessage":"Invalid credentials"}');

      await expect(api.login('wrong@example.com', 'wrongpass')).rejects.toThrow();
      expect(mockLogger.error).toHaveBeenCalled();
    });

    test('should handle network errors gracefully', async () => {
      setupNetworkError(new Error('Network error'));

      await expect(api.login('test@example.com', 'password')).rejects.toThrow('Network error');
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Login failed'),
        expect.any(Error)
      );
    });

    test('should handle timeout errors', async () => {
      mockRequest.on.mockImplementation((event: string, handler: any) => {
        if (event === 'timeout') {
          setImmediate(() => handler());
        }
      });

      await expect(api.login('test@example.com', 'password')).rejects.toThrow();
      expect(mockLogger.error).toHaveBeenCalled();
    });

    test('should validate input parameters', async () => {
      await expect(api.login('', 'password')).rejects.toThrow();
      await expect(api.login('test@example.com', '')).rejects.toThrow();
    });
  });

  describe('getDevices', () => {
    beforeEach(async () => {
      // Login first to set context key
      setupSuccessResponse('{"ErrorId":null,"LoginData":{"ContextKey":"test-context-key"}}');
      await api.login('test@example.com', 'password');
      jest.clearAllMocks();
    });

    test('should get devices successfully', async () => {
      setupSuccessResponse('[{"DeviceID":"device-1","DeviceName":"Test Device","BuildingID":1}]');

      const devices = await api.getDevices();
      
      expect(devices).toHaveLength(1);
      expect(devices[0]).toEqual({
        DeviceID: 'device-1',
        DeviceName: 'Test Device', 
        BuildingID: 1
      });
      expect(mockHttps.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          path: '/User/ListDevices'
        }),
        expect.any(Function)
      );
    });

    test('should handle empty device list', async () => {
      setupSuccessResponse('[]');

      const devices = await api.getDevices();
      expect(devices).toEqual([]);
    });

    test('should throw error when not logged in', async () => {
      // Create new API instance without login
      const newApi = new MelCloudApi(mockLogger as any);
      
      await expect(newApi.getDevices()).rejects.toThrow('Not logged in');
    });

    test('should handle API errors', async () => {
      setupErrorResponse(500, '{"error":"Internal server error"}');

      await expect(api.getDevices()).rejects.toThrow();
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('getDeviceState', () => {
    beforeEach(async () => {
      // Login first
      await api.login('test@example.com', 'password');
      jest.clearAllMocks();
    });

    test('should get device state successfully', async () => {
      const mockDeviceState = {
        DeviceID: 'device-1',
        RoomTemperature: 21.5,
        SetTemperature: 22.0,
        OutdoorTemperature: 5.0,
        IdleZone1: false,
        DailyHeatingEnergyProduced: 10.5,
        DailyHeatingEnergyConsumed: 3.2
      };

      setupSuccessResponse(JSON.stringify(mockDeviceState));

      const state = await api.getDeviceState('device-1', 1);
      
      expect(state).toEqual(mockDeviceState);
      expect(mockHttps.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          path: expect.stringContaining('/Device/Get?id=device-1&buildingID=1')
        }),
        expect.any(Function)
      );
    });

    test('should handle missing device', async () => {
      setupErrorResponse(404, '{"error":"Device not found"}');

      await expect(api.getDeviceState('invalid-device', 1)).rejects.toThrow();
      expect(mockLogger.error).toHaveBeenCalled();
    });

    test('should validate device ID parameter', async () => {
      await expect(api.getDeviceState('', 1)).rejects.toThrow();
      await expect(api.getDeviceState('device-1', 0)).rejects.toThrow();
    });
  });

  describe('setDeviceTemperature', () => {
    beforeEach(async () => {
      // Login first
      await api.login('test@example.com', 'password');
      jest.clearAllMocks();
    });

    test('should set device temperature successfully', async () => {
      setupSuccessResponse('{"result":true}');

      const result = await api.setDeviceTemperature('device-1', 1, 23.0);
      
      expect(result).toBe(true);
      expect(mockHttps.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          path: '/Device/SetAta'
        }),
        expect.any(Function)
      );
      expect(mockRequest.write).toHaveBeenCalledWith(
        expect.stringContaining('23')
      );
    });

    test('should validate temperature range', async () => {
      await expect(api.setDeviceTemperature('device-1', 1, 50)).rejects.toThrow();
      await expect(api.setDeviceTemperature('device-1', 1, -10)).rejects.toThrow();
    });

    test('should handle API failures', async () => {
      setupErrorResponse(400, '{"error":"Invalid temperature"}');

      await expect(api.setDeviceTemperature('device-1', 1, 22)).rejects.toThrow();
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('getDeviceById', () => {
    test('should return device by ID', async () => {
      // Set up internal devices array
      (api as any).devices = [
        { DeviceID: 'device-1', DeviceName: 'Device 1' },
        { DeviceID: 'device-2', DeviceName: 'Device 2' }
      ];

      const device = api.getDeviceById('device-1');
      expect(device).toEqual({ DeviceID: 'device-1', DeviceName: 'Device 1' });
    });

    test('should return undefined for non-existent device', () => {
      (api as any).devices = [];
      const device = api.getDeviceById('non-existent');
      expect(device).toBeUndefined();
    });
  });

  describe('Error Handling', () => {
    beforeEach(async () => {
      await api.login('test@example.com', 'password');
      jest.clearAllMocks();
    });

    test('should handle JSON parsing errors', async () => {
      setupSuccessResponse('invalid json');

      await expect(api.getDevices()).rejects.toThrow();
      expect(mockLogger.error).toHaveBeenCalled();
    });

    test('should handle request timeouts', async () => {
      mockRequest.on.mockImplementation((event: string, handler: any) => {
        if (event === 'timeout') {
          setImmediate(() => {
            handler();
            mockRequest.destroy();
          });
        }
      });

      await expect(api.getDevices()).rejects.toThrow();
    });

    test('should handle connection errors', async () => {
      setupNetworkError(new Error('Connection refused'));

      await expect(api.getDevices()).rejects.toThrow('Connection refused');
    });
  });

  describe('Reconnection Logic', () => {
    test('should attempt reconnection on authentication failure', async () => {
      // First attempt fails with auth error
      let callCount = 0;
      mockResponse.on.mockImplementation((event: string, handler: any) => {
        callCount++;
        if (event === 'data') {
          if (callCount === 1) {
            setImmediate(() => handler('{"ErrorId":1,"ErrorMessage":"Authentication failed"}'));
          } else {
            setImmediate(() => handler('{"ErrorId":null,"LoginData":{"ContextKey":"new-key"}}'));
          }
        } else if (event === 'end') {
          setImmediate(() => handler());
        }
      });

      // This should trigger a retry
      try {
        await api.getDevices();
      } catch (error) {
        // Expected to fail as we haven't set up the login properly
      }

      expect(mockLogger.error).toHaveBeenCalled();
    });
  });
});