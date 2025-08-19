import { TibberApi } from '../../src/services/tibber-api';
import {
  createMockLogger
} from '../mocks';

// Mock node-fetch
jest.mock('node-fetch', () => jest.fn());

describe('TibberApi Enhanced Tests', () => {
  let api: TibberApi;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let mockFetch: jest.MockedFunction<any>;

  // Helper function to setup successful fetch response
  const setupSuccessResponse = (data: any) => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(data),
      text: jest.fn().mockResolvedValue(JSON.stringify(data))
    });
  };

  // Helper function to setup error response
  const setupErrorResponse = (status: number, statusText = 'Error') => {
    mockFetch.mockResolvedValue({
      ok: false,
      status,
      statusText,
      json: jest.fn().mockResolvedValue({ error: statusText }),
      text: jest.fn().mockResolvedValue(`{"error":"${statusText}"}`)
    });
  };

  // Helper function to setup network error
  const setupNetworkError = (error: Error) => {
    mockFetch.mockRejectedValue(error);
  };

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Get the mocked fetch function
    mockFetch = require('node-fetch') as jest.MockedFunction<any>;
    
    mockLogger = createMockLogger();
    api = new TibberApi('test-token', mockLogger as any);
  });

  afterEach(() => {
    // Clean up any timers
    jest.clearAllTimers();
  });

  describe('Constructor', () => {
    test('should initialize with provided token and logger', () => {
      expect(api).toBeDefined();
      expect(mockLogger.api).toHaveBeenCalledWith(
        'Tibber API service initialized',
        { token: '***' }
      );
    });

    test('should initialize with default logger if none provided', () => {
      // Mock global logger
      global.logger = mockLogger as any;
      
      const apiWithoutLogger = new TibberApi('test-token');
      expect(apiWithoutLogger).toBeDefined();
    });

    test('should handle empty token', () => {
      const apiWithEmptyToken = new TibberApi('', mockLogger as any);
      expect(apiWithEmptyToken).toBeDefined();
      expect(mockLogger.api).toHaveBeenCalledWith(
        'Tibber API service initialized',
        { token: 'not provided' }
      );
    });
  });

  describe('getPrices', () => {
    test('should get prices successfully', async () => {
      const mockPriceData = {
        data: {
          viewer: {
            homes: [{
              currentSubscription: {
                priceInfo: {
                  current: {
                    total: 1.2,
                    startsAt: '2023-01-01T12:00:00Z'
                  },
                  today: [
                    {
                      total: 1.2,
                      startsAt: '2023-01-01T12:00:00Z'
                    },
                    {
                      total: 1.5,
                      startsAt: '2023-01-01T13:00:00Z'
                    }
                  ],
                  tomorrow: [
                    {
                      total: 0.8,
                      startsAt: '2023-01-02T12:00:00Z'
                    }
                  ]
                }
              }
            }]
          }
        }
      };

      setupSuccessResponse(mockPriceData);

      const result = await api.getPrices();
      
      expect(result).toBeDefined();
      expect(result.current).toEqual({
        price: 1.2,
        time: '2023-01-01T12:00:00Z'
      });
      expect(result.prices).toHaveLength(3); // today + tomorrow
      expect(result.prices[0]).toEqual({
        price: 1.2,
        time: '2023-01-01T12:00:00Z'
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.tibber.com/v1-beta/gql',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-token',
            'Content-Type': 'application/json'
          }),
          body: expect.stringContaining('priceInfo')
        })
      );
    });

    test('should handle missing current price', async () => {
      const mockPriceData = {
        data: {
          viewer: {
            homes: [{
              currentSubscription: {
                priceInfo: {
                  current: null,
                  today: [
                    {
                      total: 1.2,
                      startsAt: '2023-01-01T12:00:00Z'
                    }
                  ],
                  tomorrow: []
                }
              }
            }]
          }
        }
      };

      setupSuccessResponse(mockPriceData);

      const result = await api.getPrices();
      
      expect(result).toBeDefined();
      expect(result.current).toBeNull();
      expect(result.prices).toHaveLength(1);
    });

    test('should handle empty homes array', async () => {
      const mockPriceData = {
        data: {
          viewer: {
            homes: []
          }
        }
      };

      setupSuccessResponse(mockPriceData);

      await expect(api.getPrices()).rejects.toThrow();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('No homes found'),
        expect.any(Error)
      );
    });

    test('should handle API errors', async () => {
      setupErrorResponse(401, 'Unauthorized');

      await expect(api.getPrices()).rejects.toThrow();
      expect(mockLogger.error).toHaveBeenCalled();
    });

    test('should handle network errors', async () => {
      setupNetworkError(new Error('Network error'));

      await expect(api.getPrices()).rejects.toThrow('Network error');
      expect(mockLogger.error).toHaveBeenCalled();
    });

    test('should handle malformed response data', async () => {
      const malformedData = {
        data: {
          viewer: null
        }
      };

      setupSuccessResponse(malformedData);

      await expect(api.getPrices()).rejects.toThrow();
      expect(mockLogger.error).toHaveBeenCalled();
    });

    test('should handle GraphQL errors', async () => {
      const errorData = {
        errors: [
          {
            message: 'Invalid token',
            extensions: {
              code: 'UNAUTHENTICATED'
            }
          }
        ]
      };

      setupSuccessResponse(errorData);

      await expect(api.getPrices()).rejects.toThrow();
      expect(mockLogger.error).toHaveBeenCalled();
    });

    test('should handle missing price data', async () => {
      const mockPriceData = {
        data: {
          viewer: {
            homes: [{
              currentSubscription: {
                priceInfo: {
                  current: null,
                  today: [],
                  tomorrow: []
                }
              }
            }]
          }
        }
      };

      setupSuccessResponse(mockPriceData);

      const result = await api.getPrices();
      
      expect(result).toBeDefined();
      expect(result.current).toBeNull();
      expect(result.prices).toHaveLength(0);
    });

    test('should validate token before making requests', async () => {
      // Create API instance with empty token
      const apiNoToken = new TibberApi('', mockLogger as any);
      
      await expect(apiNoToken.getPrices()).rejects.toThrow();
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    test('should handle timeout errors', async () => {
      setupNetworkError(new Error('Request timeout'));

      await expect(api.getPrices()).rejects.toThrow();
      expect(mockLogger.error).toHaveBeenCalled();
    });

    test('should handle JSON parsing errors', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockRejectedValue(new Error('Invalid JSON')),
        text: jest.fn().mockResolvedValue('invalid json')
      });

      await expect(api.getPrices()).rejects.toThrow();
      expect(mockLogger.error).toHaveBeenCalled();
    });

    test('should handle rate limiting', async () => {
      setupErrorResponse(429, 'Too Many Requests');

      await expect(api.getPrices()).rejects.toThrow();
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('Authentication', () => {
    test('should include authorization header in requests', async () => {
      const mockPriceData = {
        data: {
          viewer: {
            homes: [{
              currentSubscription: {
                priceInfo: {
                  current: { total: 1.2, startsAt: '2023-01-01T12:00:00Z' },
                  today: [],
                  tomorrow: []
                }
              }
            }]
          }
        }
      };

      setupSuccessResponse(mockPriceData);

      await api.getPrices();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-token'
          })
        })
      );
    });

    test('should handle authentication errors', async () => {
      const errorData = {
        errors: [
          {
            message: 'Authentication required',
            extensions: {
              code: 'UNAUTHENTICATED'
            }
          }
        ]
      };

      setupSuccessResponse(errorData);

      await expect(api.getPrices()).rejects.toThrow();
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('Price Data Validation', () => {
    test('should handle prices with missing fields', async () => {
      const mockPriceData = {
        data: {
          viewer: {
            homes: [{
              currentSubscription: {
                priceInfo: {
                  current: { total: 1.2 }, // Missing startsAt
                  today: [
                    { total: 1.3 }, // Missing startsAt
                    { startsAt: '2023-01-01T13:00:00Z' } // Missing total
                  ],
                  tomorrow: []
                }
              }
            }]
          }
        }
      };

      setupSuccessResponse(mockPriceData);

      const result = await api.getPrices();
      
      expect(result).toBeDefined();
      // Should handle missing fields gracefully
      expect(result.current?.price).toBe(1.2);
    });

    test('should handle extreme price values', async () => {
      const mockPriceData = {
        data: {
          viewer: {
            homes: [{
              currentSubscription: {
                priceInfo: {
                  current: { total: 999.99, startsAt: '2023-01-01T12:00:00Z' },
                  today: [
                    { total: -0.50, startsAt: '2023-01-01T13:00:00Z' }, // Negative price
                    { total: 0, startsAt: '2023-01-01T14:00:00Z' } // Zero price
                  ],
                  tomorrow: []
                }
              }
            }]
          }
        }
      };

      setupSuccessResponse(mockPriceData);

      const result = await api.getPrices();
      
      expect(result).toBeDefined();
      expect(result.current?.price).toBe(999.99);
      expect(result.prices[1]?.price).toBe(-0.50);
      expect(result.prices[2]?.price).toBe(0);
    });
  });
});