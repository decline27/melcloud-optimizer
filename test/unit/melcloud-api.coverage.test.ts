// Ensure any previous module state is reset and mock https to avoid real network calls
jest.resetModules();
jest.mock('https');

import { MelCloudApi } from '../../src/services/melcloud-api';
import { createMockLogger } from '../mocks';

describe('MelCloudApi additional coverage', () => {
  let api: MelCloudApi;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockLogger = createMockLogger();
    // Provide an empty settings provider to the constructor instead of mutating globals
    api = new MelCloudApi(mockLogger, { get: () => undefined, set: () => {}, unset: () => {}, on: () => {} } as any);
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
});
