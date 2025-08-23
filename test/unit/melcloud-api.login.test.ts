import { MelCloudApi } from '../../src/services/melcloud-api';

describe('MelCloudApi (login)', () => {
  const logger: any = { log: jest.fn(), error: jest.fn(), warn: jest.fn() };

  beforeEach(() => jest.restoreAllMocks());

  test('login returns true when API responds with no error', async () => {
    const api = new MelCloudApi(logger);

    // Stub throttledApiCall to return successful login payload including Account.ContextKey
    jest.spyOn(MelCloudApi.prototype as any, 'throttledApiCall').mockResolvedValue({
      ErrorId: null,
      LoginData: { ContextKey: 'mock-context-key' },
    });

    // Ensure retryableRequest just invokes the provided function
    jest.spyOn(MelCloudApi.prototype as any, 'retryableRequest').mockImplementation(async (fn: any) => fn());

    const res = await api.login('user@example.com', 'password');
    expect(res).toBe(true);
  });
});
