import { MelCloudApi } from '../../src/services/melcloud-api';
import * as https from 'https';
import { EventEmitter } from 'events';
import { IncomingMessage, ClientRequest } from 'http';

// Mock https module
jest.mock('https', () => {
  return {
    request: jest.fn()
  };
});

// Create mock request and response objects
const mockRequestObject = new EventEmitter() as EventEmitter & Partial<ClientRequest>;
mockRequestObject.write = jest.fn();
mockRequestObject.end = jest.fn();

const mockResponse = new EventEmitter() as EventEmitter & Partial<IncomingMessage>;
mockResponse.statusCode = 200;
mockResponse.statusMessage = 'OK';

// Mock https.request
const mockRequest = jest.fn().mockImplementation((options, callback) => {
  if (callback) {
    callback(mockResponse);
  }
  return mockRequestObject;
});

// Set up the mock implementation
(https.request as jest.Mock).mockImplementation(mockRequest);

describe('MelCloudApi Direct Tests', () => {
  let melCloudApi: MelCloudApi;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Reset mock response
    mockResponse.statusCode = 200;
    mockResponse.statusMessage = 'OK';

    // Create a new instance of MelCloudApi
    melCloudApi = new MelCloudApi();

    // Override the minApiCallInterval to 0 for faster tests
    (melCloudApi as any).minApiCallInterval = 0;
  });

  afterEach(() => {
    // Clean up any pending timers
    melCloudApi.cleanup();

    // Reset mock response
    mockResponse.statusCode = 200;
    mockResponse.statusMessage = 'OK';

    // Reset all mocks
    jest.clearAllMocks();

    // Clear any pending timeouts
    jest.useRealTimers();
  });

  describe('login', () => {
    it('should login successfully', async () => {
      // Set up the response data
      const responseData = {
        ErrorId: null,
        LoginData: {
          ContextKey: 'test-context-key'
        }
      };

      // Create a promise that resolves when the test is complete
      const testPromise = melCloudApi.login('test@example.com', 'password')
        .then(result => {
          // Verify the result
          expect(result).toBe(true);
          expect((melCloudApi as any).contextKey).toBe('test-context-key');

          // Verify https.request was called with correct parameters
          expect(mockRequest).toHaveBeenCalledWith(
            expect.objectContaining({
              hostname: 'app.melcloud.com',
              path: '/Mitsubishi.Wifi.Client/Login/ClientLogin',
              method: 'POST',
              headers: expect.objectContaining({
                'Content-Type': 'application/json',
                'Accept': 'application/json'
              })
            }),
            expect.any(Function)
          );

          // Verify request body was written
          expect(mockRequestObject.write).toHaveBeenCalledWith(expect.stringContaining('"Email":"test@example.com"'));
          expect(mockRequestObject.write).toHaveBeenCalledWith(expect.stringContaining('"Password":"password"'));
        });

      // Emit data and end events to simulate response
      mockResponse.emit('data', JSON.stringify(responseData));
      mockResponse.emit('end');

      // Wait for the test to complete
      return testPromise;
    });

    it('should throw error when login fails', async () => {
      // Set up the response data
      const responseData = {
        ErrorId: 1,
        ErrorMessage: 'Invalid credentials'
      };

      // Create a promise that resolves when the test is complete
      const testPromise = expect(melCloudApi.login('test@example.com', 'wrong-password'))
        .rejects.toThrow('MELCloud login failed: Invalid credentials');

      // Emit data and end events to simulate response
      mockResponse.emit('data', JSON.stringify(responseData));
      mockResponse.emit('end');

      // Wait for the test to complete
      return testPromise;
    });

    it('should handle network errors', async () => {
      // Create a promise that resolves when the test is complete
      const testPromise = expect(melCloudApi.login('test@example.com', 'password'))
        .rejects.toThrow('API request error: Network error');

      // Emit error event to simulate network error
      const requestError = new Error('Network error');
      mockRequestObject.emit('error', requestError);

      // Wait for the test to complete
      return testPromise;
    });
  });

  describe('getDevices', () => {
    beforeEach(() => {
      // Set contextKey for authenticated requests
      (melCloudApi as any).contextKey = 'test-context-key';
    });

    it('should get devices successfully', async () => {
      // Set up the response data
      const responseData = [
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
      ];

      // Create a promise that resolves when the test is complete
      const testPromise = melCloudApi.getDevices()
        .then(devices => {
          // Verify the result
          expect(devices).toHaveLength(1);
          expect(devices[0].id).toBe(456);
          expect(devices[0].name).toBe('Test Device');
          expect(devices[0].buildingId).toBe(123);

          // Verify https.request was called with correct parameters
          expect(mockRequest).toHaveBeenCalledWith(
            expect.objectContaining({
              hostname: 'app.melcloud.com',
              path: '/Mitsubishi.Wifi.Client/User/ListDevices',
              method: 'GET',
              headers: expect.objectContaining({
                'X-MitsContextKey': 'test-context-key',
                'Accept': 'application/json'
              })
            }),
            expect.any(Function)
          );
        });

      // Emit data and end events to simulate response
      mockResponse.emit('data', JSON.stringify(responseData));
      mockResponse.emit('end');

      // Wait for the test to complete
      return testPromise;
    });

    it('should throw error when not logged in', async () => {
      // Reset contextKey to simulate not being logged in
      (melCloudApi as any).contextKey = null;

      // Expect getDevices to throw an error
      await expect(melCloudApi.getDevices())
        .rejects.toThrow('Not logged in to MELCloud');

      // Verify https.request was not called
      expect(mockRequest).not.toHaveBeenCalled();
    });

    it('should handle API errors', async () => {
      // Set up the response status code to indicate an error
      mockResponse.statusCode = 500;
      mockResponse.statusMessage = 'Internal Server Error';

      // Create a promise that resolves when the test is complete
      const testPromise = expect(melCloudApi.getDevices())
        .rejects.toThrow('API error: 500 Internal Server Error');

      // Emit data and end events to simulate response
      mockResponse.emit('data', '{"error": "Internal Server Error"}');
      mockResponse.emit('end');

      // Wait for the test to complete
      return testPromise;
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
      // Set up the response data
      const responseData = {
        DeviceID: '123',
        BuildingID: 456,
        RoomTemperatureZone1: 21.5,
        SetTemperatureZone1: 22.0
      };

      // Create a promise that resolves when the test is complete
      const testPromise = melCloudApi.getDeviceState('123', 456)
        .then(state => {
          // Verify the result
          expect(state).toBeDefined();
          expect(state.DeviceID).toBe('123');
          expect(state.RoomTemperatureZone1).toBe(21.5);

          // Verify https.request was called with correct parameters
          expect(mockRequest).toHaveBeenCalledWith(
            expect.objectContaining({
              hostname: 'app.melcloud.com',
              path: '/Mitsubishi.Wifi.Client/Device/Get?id=123&buildingID=456',
              method: 'GET',
              headers: expect.objectContaining({
                'X-MitsContextKey': 'test-context-key',
                'Accept': 'application/json'
              })
            }),
            expect.any(Function)
          );
        });

      // Emit data and end events to simulate response
      mockResponse.emit('data', JSON.stringify(responseData));
      mockResponse.emit('end');

      // Wait for the test to complete
      return testPromise;
    });

    it('should throw error when not logged in', async () => {
      // Reset contextKey to simulate not being logged in
      (melCloudApi as any).contextKey = null;

      // Expect getDeviceState to throw an error
      await expect(melCloudApi.getDeviceState('123', 456))
        .rejects.toThrow('Not logged in to MELCloud');

      // Verify https.request was not called
      expect(mockRequest).not.toHaveBeenCalled();
    });

    it('should handle API errors', async () => {
      // Set up the response status code to indicate an error
      mockResponse.statusCode = 500;
      mockResponse.statusMessage = 'Internal Server Error';

      // Create a promise that resolves when the test is complete
      const testPromise = expect(melCloudApi.getDeviceState('123', 456))
        .rejects.toThrow('API error: 500 Internal Server Error');

      // Emit data and end events to simulate response
      mockResponse.emit('data', '{"error": "Internal Server Error"}');
      mockResponse.emit('end');

      // Wait for the test to complete
      return testPromise;
    });
  });

  describe('setDeviceTemperature', () => {
    beforeEach(() => {
      // Set contextKey for authenticated requests
      (melCloudApi as any).contextKey = 'test-context-key';
    });

    it('should set device temperature successfully', async () => {
      // Set up the response data for the first call (getDeviceState)
      const getDeviceStateResponse = {
        DeviceID: '123',
        BuildingID: 456,
        SetTemperatureZone1: 21.0
      };

      // Set up the response data for the second call (setDeviceTemperature)
      const setTemperatureResponse = {};

      // Mock the implementation for both requests in one go
      mockRequest
        // First call for getDeviceState
        .mockImplementationOnce((options, callback) => {
          if (callback) {
            callback(mockResponse);
            mockResponse.emit('data', JSON.stringify(getDeviceStateResponse));
            mockResponse.emit('end');
          }
          return mockRequestObject;
        })
        // Second call for setDeviceTemperature
        .mockImplementationOnce((options, callback) => {
          if (callback) {
            callback(mockResponse);
            mockResponse.emit('data', JSON.stringify(setTemperatureResponse));
            mockResponse.emit('end');
          }
          return mockRequestObject;
        });

      // Execute the test
      const result = await melCloudApi.setDeviceTemperature('123', 456, 22.0);

      // Verify the result
      expect(result).toBe(true);

      // Verify https.request was called twice (get state and set temperature)
      expect(mockRequest).toHaveBeenCalledTimes(2);

      // Verify the second call was to set temperature
      expect(mockRequest.mock.calls[1][0]).toMatchObject({
        hostname: 'app.melcloud.com',
        path: '/Mitsubishi.Wifi.Client/Device/SetAta',
        method: 'POST'
      });

      // Verify request body was written with the correct temperature
      expect(mockRequestObject.write).toHaveBeenCalledWith(expect.stringContaining('"SetTemperature":22'));
    });

    it('should throw error when not logged in', async () => {
      // Reset contextKey to simulate not being logged in
      (melCloudApi as any).contextKey = null;

      // Expect setDeviceTemperature to throw an error
      await expect(melCloudApi.setDeviceTemperature('123', 456, 22.0))
        .rejects.toThrow('Not logged in to MELCloud');

      // Verify https.request was not called
      expect(mockRequest).not.toHaveBeenCalled();
    });

    it('should handle API errors', async () => {
      // Set up the response status code to indicate an error
      mockResponse.statusCode = 500;
      mockResponse.statusMessage = 'Internal Server Error';

      // Create a promise that resolves when the test is complete
      const testPromise = expect(melCloudApi.setDeviceTemperature('123', 456, 22.0))
        .rejects.toThrow('API error: 500 Internal Server Error');

      // Emit data and end events to simulate response
      mockResponse.emit('data', '{"error": "Internal Server Error"}');
      mockResponse.emit('end');

      // Wait for the test to complete
      return testPromise;
    });
  });
});
