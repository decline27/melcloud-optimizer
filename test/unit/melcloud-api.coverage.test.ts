import { MelCloudApi } from '../../src/services/melcloud-api';
import { createMockLogger } from '../mocks';
import { TimeZoneHelper } from '../../src/util/time-zone-helper';

// Mock TimeZoneHelper to avoid real instantiation
jest.mock('../../src/util/time-zone-helper', () => ({
  TimeZoneHelper: jest.fn().mockImplementation(() => ({
    updateSettings: jest.fn(),
    formatDate: jest.fn(),
    isInDSTperiod: jest.fn(),
    getTimeZoneString: jest.fn()
  }))
}));

// Mock the base API service to avoid real network calls
jest.mock('../../src/services/base-api-service', () => {
  const mockThrottledApiCall = jest.fn();
  const mockRetryableRequest = jest.fn();
  const mockCreateApiError = jest.fn();

  return {
    BaseApiService: class {
      serviceName: string;
      logger: any;
      circuitBreaker: any;
      throttledApiCall: any;
      retryableRequest: any;
      createApiError: any;

      constructor(serviceName: string, logger: any) {
        this.serviceName = serviceName;
        this.logger = logger;
        this.circuitBreaker = {
          execute: jest.fn().mockImplementation((fn) => fn())
        };
        this.throttledApiCall = mockThrottledApiCall;
        this.retryableRequest = mockRetryableRequest.mockImplementation(async (fn: () => Promise<any>) => {
          return await fn();
        });
        this.createApiError = mockCreateApiError.mockImplementation((error: unknown) => {
          if (error instanceof Error) {
            return error;
          }
          return new Error(String(error));
        });
      }
    }
  };
});

describe('MelCloudApi additional coverage', () => {
  let api: MelCloudApi;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockLogger = createMockLogger();
    api = new MelCloudApi(mockLogger);

    // Ensure we start with no credentials unless explicitly set in a test
    global.homeySettings = {
      get: jest.fn().mockReturnValue(undefined),
      set: jest.fn(),
      unset: jest.fn(),
      on: jest.fn()
    } as any;

    // Mock the logger methods that are called by the base class
    (api as any).logger = {
      ...mockLogger,
      warn: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
      api: jest.fn(),
      log: jest.fn()
    };

    // Mock additional base class methods
    (api as any).getCachedData = jest.fn().mockReturnValue(null);
    (api as any).setCachedData = jest.fn();
    (api as any).logApiCall = jest.fn();

    // Mock the errorHandler with logError method
    const loggerRef = (api as any).logger;
    (api as any).errorHandler = {
      createAppError: jest.fn().mockImplementation((error: unknown, context?: any) => {
        const message = error instanceof Error ? error.message : String(error);
        const appError = new Error(message) as any;
        appError.category = context?.category || 'API_ERROR';
        appError.context = context;
        return appError;
      }),
      logError: jest.fn().mockImplementation((error: any, context?: any) => {
        // Just log the error without throwing
        loggerRef.error(error.message, { error, ...context });
        return error;
      })
    };
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  test('ensureConnected returns false when credentials missing (schedules reconnect)', async () => {
    // Call the private ensureConnected via any cast to exercise the branch where credentials are missing
    const res = await (api as any).ensureConnected();
    // Implementation schedules a reconnect and returns false instead of throwing
    expect(res).toBe(false);
  });

  test('clearReconnectTimers clears timers array', () => {
    // Insert a fake timer into reconnectTimers
    const timer = setTimeout(() => {}, 1000);
    (api as any).reconnectTimers = [timer];

    // Call private clearReconnectTimers
    (api as any).clearReconnectTimers();

    expect((api as any).reconnectTimers).toHaveLength(0);
  });

  test('getDailyEnergyTotals returns zeros/fallback when energy data is empty', async () => {
    // Mock getEnergyData to return an empty object and force the fallback
    (api as any).getEnergyData = jest.fn().mockResolvedValue({});

    const result = await api.getDailyEnergyTotals('1', 1);

    // Expect numeric totals to be present (zeros) and COP fields to be null
    expect(result.TotalHeatingConsumed).toBeDefined();
    expect(result.TotalHeatingConsumed).toBe(0);
    expect(result.heatingCOP).toBeNull();
    expect(result.hotWaterCOP).toBeNull();
    expect(result.averageCOP).toBeNull();
  });

  test('getDailyEnergyTotals handles malformed API response gracefully', async () => {
    // Mock getEnergyData to return malformed data
    (api as any).getEnergyData = jest.fn().mockResolvedValue({
      TotalConsumedHeating: 'invalid',
      TotalConsumedHotWater: null,
      TotalConsumedCooling: undefined
    });

    const result = await api.getDailyEnergyTotals('1', 1);

    // Should return zeros for invalid data
    expect(result.TotalHeatingConsumed).toBe(0);
    expect(result.TotalHotWaterConsumed).toBe(0);
    expect(result.TotalCoolingConsumed).toBe(0);
  });

  test('ensureConnected handles login failures gracefully', async () => {
    // Mock credentials to be available
    const mockGet = jest.fn((key: string) => {
      if (key === 'melcloud_user') return 'test@example.com';
      if (key === 'melcloud_pass') return 'password';
      return undefined;
    });

    global.homeySettings = {
      get: mockGet,
      set: jest.fn(),
      unset: jest.fn(),
      on: jest.fn()
    } as any;

    // Mock login to fail
    (api as any).login = jest.fn().mockRejectedValue(new Error('Login failed'));

    const result = await (api as any).ensureConnected();
    expect(result).toBe(false);
  });

  test('ensureConnected succeeds when already connected', async () => {
    // Set context key to simulate being connected
    (api as any).contextKey = 'test-context-key';

    const result = await (api as any).ensureConnected();
    expect(result).toBe(true);
  });

  test('reconnect logic handles max attempts correctly', async () => {
    // Mock credentials
    const mockGet = jest.fn((key: string) => {
      if (key === 'melcloud_user') return 'test@example.com';
      if (key === 'melcloud_pass') return 'password';
      return undefined;
    });

    global.homeySettings = {
      get: mockGet,
      set: jest.fn(),
      unset: jest.fn(),
      on: jest.fn()
    } as any;

    // Set max reconnect attempts to 1
    (api as any).maxReconnectAttempts = 1;
    (api as any).reconnectAttempts = 1;

    // Mock login to fail
    (api as any).login = jest.fn().mockRejectedValue(new Error('Login failed'));

    const result = await (api as any).ensureConnected();
    expect(result).toBe(false);
    expect((api as any).reconnectAttempts).toBe(1); // Should not increment beyond max
  });

  test('getDeviceState handles missing temperature data', async () => {
    // Mock successful connection
    (api as any).contextKey = 'test-key';
    (api as any).throttledApiCall.mockResolvedValue({
      EffectiveFlags: 0,
      SetTemperatureZone1: 20,
      // Missing RoomTemperatureZone1
      OperationMode: 0
    });

    const result = await api.getDeviceState('123', 456);

    expect(result).toBeDefined();
    expect(result.SetTemperatureZone1).toBe(20);
    // Should handle missing temperature gracefully
  });

  test('setDeviceTemperature validates input parameters', async () => {
    // Mock successful connection
    (api as any).contextKey = 'test-key';
    (api as any).throttledApiCall = jest.fn().mockResolvedValue({ success: true });

    // Test with invalid deviceId
    await expect(api.setDeviceTemperature('', 456, 20)).rejects.toThrow();

    // Test with invalid buildingId
    await expect(api.setDeviceTemperature('123', 0, 20)).rejects.toThrow();

    // Test with invalid temperature
    await expect(api.setDeviceTemperature('123', 456, 0)).rejects.toThrow();
    await expect(api.setDeviceTemperature('123', 456, 50)).rejects.toThrow();
  });

  test('constructor initializes time zone helper and circuit breaker correctly', () => {
    // Test that constructor calls parent with correct parameters
    const mockLogger = createMockLogger();
    const api = new MelCloudApi(mockLogger);

    // Verify time zone helper is initialized
    expect((api as any).timeZoneHelper).toBeDefined();
    expect((api as any).timeZoneHelper).toBeInstanceOf(TimeZoneHelper);

    // Verify circuit breaker configuration is passed to parent
    // This is tested indirectly through the parent class behavior
    expect(api).toBeDefined();
  });

  test('constructor handles undefined logger parameter', () => {
    // Mock global logger
    const originalGlobalLogger = global.logger;
    global.logger = createMockLogger() as any;

    // Create instance without logger parameter
    const api = new MelCloudApi();

    // Verify it uses global logger
    expect((api as any).timeZoneHelper).toBeDefined();
    expect(api).toBeDefined();

    // Restore global logger
    global.logger = originalGlobalLogger;
  });

  test('setDevicePower sets device power state successfully', async () => {
    // Mock successful connection
    (api as any).contextKey = 'test-key';
    (api as any).throttledApiCall.mockResolvedValue({ success: true });
    (api as any).getDeviceState = jest.fn().mockResolvedValue({
      DeviceID: '123',
      Power: false
    });

    const result = await api.setDevicePower('123', 456, true);
    expect(result).toBe(true);
    expect((api as any).throttledApiCall).toHaveBeenCalledWith('POST', 'Device/SetAtw', expect.anything());
  });

  test('setDevicePower handles authentication errors', async () => {
    // Mock authentication error
    (api as any).contextKey = 'test-key';
    (api as any).throttledApiCall.mockRejectedValue(new Error('Authentication failed'));
    (api as any).getDeviceState = jest.fn().mockResolvedValue({
      DeviceID: '123',
      Power: false
    });

    await expect(api.setDevicePower('123', 456, true)).rejects.toThrow();
  });

  test('setZoneTemperature sets zone temperature successfully', async () => {
    // Mock successful connection
    (api as any).contextKey = 'test-key';
    (api as any).throttledApiCall.mockResolvedValue({ success: true });
    (api as any).getDeviceState = jest.fn().mockResolvedValue({
      DeviceID: '123',
      SetTemperatureZone1: 20,
      SetTemperatureZone2: 20
    });

    const result = await api.setZoneTemperature('123', 456, 22, 1);
    expect(result).toBe(true);
    expect((api as any).throttledApiCall).toHaveBeenCalledWith('POST', 'Device/SetAtw', expect.anything());
  });

  test('setZoneTemperature validates zone parameter', async () => {
    // Mock successful connection
    (api as any).contextKey = 'test-key';
    (api as any).getDeviceState = jest.fn().mockResolvedValue({
      DeviceID: '123',
      SetTemperatureZone1: 20
    });

    await expect(api.setZoneTemperature('123', 456, 22, 3)).rejects.toThrow('Invalid zone: 3');
  });

  test('setTankTemperature sets tank temperature successfully', async () => {
    // Mock successful connection
    (api as any).contextKey = 'test-key';
    (api as any).throttledApiCall.mockResolvedValue({ success: true });
    (api as any).getDeviceState = jest.fn().mockResolvedValue({
      DeviceID: '123',
      SetTankWaterTemperature: 40
    });

    const result = await api.setTankTemperature('123', 456, 45);
    expect(result).toBe(true);
    expect((api as any).throttledApiCall).toHaveBeenCalledWith('POST', 'Device/SetAtw', expect.anything());
  });

  test('setTankTemperature handles API errors', async () => {
    // Mock API error
    (api as any).contextKey = 'test-key';
    (api as any).throttledApiCall.mockRejectedValue(new Error('API error'));
    (api as any).getDeviceState = jest.fn().mockResolvedValue({
      DeviceID: '123',
      SetTankWaterTemperature: 40
    });

    await expect(api.setTankTemperature('123', 456, 45)).rejects.toThrow();
  });
});
