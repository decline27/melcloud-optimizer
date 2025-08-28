import { MelCloudApi } from '../../src/services/melcloud-api';
import { createMockLogger } from '../mocks';

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
    (api as any).throttledApiCall = jest.fn().mockResolvedValue({
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
});
