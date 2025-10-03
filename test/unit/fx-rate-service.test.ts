import fetch from 'node-fetch';
import FxRateService from '../../src/services/fx-rate-service';

jest.mock('node-fetch');
const mockedFetch = fetch as jest.MockedFunction<typeof fetch>;

describe('FxRateService', () => {
  const makeHomey = () => {
    const store: Record<string, any> = {};
    return {
      settings: {
        get: jest.fn((key: string) => store[key]),
        set: jest.fn((key: string, value: any) => {
          store[key] = value;
        })
      },
      app: {
        log: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
      },
      store
    } as any;
  };

  beforeEach(() => {
    mockedFetch.mockReset();
  });

  test('returns cached rate when cache is fresh', async () => {
    const homey = makeHomey();
    homey.settings.set('fx_rate_cache', {
      currency: 'NOK',
      rate: 11.1,
      fetchedAt: Date.now() - 1000,
      source: 'manual'
    });

    const svc = new FxRateService(homey);
    const result = await svc.getRate('NOK');

    expect(result.rate).toBe(11.1);
    expect(result.status).toBe('skipped');
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  test('fetches and stores rate when cache expired', async () => {
    const homey = makeHomey();

    mockedFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        rates: {
          NOK: 11.25
        }
      })
    } as any);

    const svc = new FxRateService(homey);
    const result = await svc.getRate('NOK', { forceRefresh: true });

    expect(result.rate).toBeCloseTo(11.25);
    expect(result.status).toBe('success');
    expect(homey.settings.set).toHaveBeenCalledWith('fx_rate_cache', expect.objectContaining({ rate: 11.25 }));
  });
});
