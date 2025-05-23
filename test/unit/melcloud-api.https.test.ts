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

describe('MelCloudApi with HTTPS', () => {
  let melCloudApi: MelCloudApi;
  let mockRequest: jest.Mock;
  let mockResponse: EventEmitter & Partial<IncomingMessage>;
  let mockRequestObject: EventEmitter & Partial<ClientRequest>;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Create mock response object (EventEmitter to simulate Node.js response events)
    mockResponse = new EventEmitter() as EventEmitter & Partial<IncomingMessage>;
    mockResponse.statusCode = 200;
    mockResponse.statusMessage = 'OK';

    // Create mock request object
    mockRequestObject = new EventEmitter() as EventEmitter & Partial<ClientRequest>;
    mockRequestObject.write = jest.fn();
    mockRequestObject.end = jest.fn();

    // Mock https.request
    mockRequest = jest.fn().mockImplementation((options, callback) => {
      // Call the callback with the mock response
      if (callback) {
        callback(mockResponse);
      }
      return mockRequestObject;
    });

    // Set up the mock implementation
    (https.request as jest.Mock).mockImplementation(mockRequest);

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
      mockRequestObject.emit('error', new Error('Network error'));

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

  // Additional tests for other methods can be added here
});
