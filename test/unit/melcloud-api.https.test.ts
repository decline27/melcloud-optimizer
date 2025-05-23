import { MelCloudApi } from '../../src/services/melcloud-api';
import * as https from 'https';
import { EventEmitter } from 'events';
import { IncomingMessage, ClientRequest } from 'http';

// Increase timeout for all tests in this file
jest.setTimeout(30000);

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

    // Mock the logger to prevent errors in cleanup
    (melCloudApi as any).logger = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      api: jest.fn()
    };

    // Mock the errorHandler to prevent errors
    (melCloudApi as any).errorHandler = {
      logError: jest.fn(),
      createAppError: jest.fn().mockImplementation((category, message, originalError) => {
        return {
          category: category || 'NETWORK',
          message: message || 'Network error',
          originalError: originalError || new Error(message || 'Network error')
        };
      })
    };
  });

  afterEach(() => {
    // Clean up any pending timers
    melCloudApi.cleanup();
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

      // Set up a mock implementation for the error handler
      const mockError = new Error('MELCloud login failed: Invalid credentials');
      (melCloudApi as any).errorHandler.createAppError.mockReturnValueOnce({
        category: 'API',
        message: 'MELCloud login failed: Invalid credentials',
        originalError: mockError
      });

      // Create a promise to track when the test is complete
      const loginPromise = melCloudApi.login('test@example.com', 'wrong-password');

      // Emit data and end events to simulate response
      mockResponse.emit('data', JSON.stringify(responseData));
      mockResponse.emit('end');

      // Expect the login to fail with the correct error message
      await expect(loginPromise).rejects.toThrow('MELCloud login failed: Invalid credentials');
    });

    it('should handle network errors', async () => {
      // Set up a mock implementation for the error handler
      const mockError = new Error('API request error: Network error');
      (melCloudApi as any).errorHandler.createAppError.mockReturnValueOnce({
        category: 'NETWORK',
        message: 'API request error: Network error',
        originalError: mockError
      });

      // Create a promise to track when the test is complete
      const loginPromise = melCloudApi.login('test@example.com', 'password');

      // Emit error event to simulate network error
      mockRequestObject.emit('error', new Error('Network error'));

      // Expect the login to fail with the correct error message
      await expect(loginPromise).rejects.toThrow('API request error: Network error');

      // Verify that the error handler was called
      expect((melCloudApi as any).errorHandler.logError).toHaveBeenCalled();
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

      // Mock the error handler to throw a specific error
      const mockError = new Error('Not logged in to MELCloud');
      (melCloudApi as any).errorHandler.createAppError.mockImplementation(() => {
        throw mockError;
      });

      try {
        // This should throw an error
        await melCloudApi.getDevices();
        // If we get here, the test should fail
        fail('Expected getDevices to throw an error');
      } catch (error) {
        // We expect an error to be thrown
        expect(error).toBe(mockError);
      }

      // Verify https.request was not called
      expect(mockRequest).not.toHaveBeenCalled();
    });

    it('should handle API errors', async () => {
      // Set up the response status code to indicate an error
      mockResponse.statusCode = 500;
      mockResponse.statusMessage = 'Internal Server Error';

      // Set up a mock implementation for the error handler
      const mockError = new Error('API error: 500 Internal Server Error');
      (melCloudApi as any).errorHandler.createAppError.mockReturnValueOnce({
        category: 'API',
        message: 'API error: 500 Internal Server Error',
        originalError: mockError
      });

      // Create a promise to track when the test is complete
      const getDevicesPromise = melCloudApi.getDevices();

      // Emit data and end events to simulate response
      mockResponse.emit('data', '{"error": "Internal Server Error"}');
      mockResponse.emit('end');

      // Expect the getDevices to fail with the correct error message
      await expect(getDevicesPromise).rejects.toThrow('API error: 500 Internal Server Error');
    });
  });

  // Additional tests for other methods can be added here
});
