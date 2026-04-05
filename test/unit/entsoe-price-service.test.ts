import { EntsoePriceService } from '../../src/services/entsoe-price-service';

jest.mock('../../src/entsoe');
jest.mock('../../src/services/fx-rate-service');

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { fetchPrices } = require('../../src/entsoe');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const FxRateService = require('../../src/services/fx-rate-service').default;

/** Two price points spanning the current hour so pickCurrentPrice finds a valid entry */
function makePricePoints() {
  const now = Date.now();
  return [
    { ts_iso_utc: new Date(now - 60 * 60 * 1000).toISOString(), price_eur_per_kwh: 0.05, price_eur_per_mwh: NaN },
    { ts_iso_utc: new Date(now + 60 * 60 * 1000).toISOString(), price_eur_per_kwh: 0.06, price_eur_per_mwh: NaN }
  ];
}

function makeHomey(settings: Record<string, any> = {}, i18nCurrency?: string) {
  return {
    settings: {
      get: jest.fn((key: string) => settings[key] ?? null),
      set: jest.fn()
    },
    app: { log: jest.fn(), warn: jest.fn() },
    ...(i18nCurrency !== undefined ? { i18n: { getCurrency: () => i18nCurrency } } : {})
  };
}

describe('EntsoePriceService — currency resolution', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fetchPrices.mockResolvedValue(makePricePoints());
    FxRateService.mockImplementation(() => ({
      getRate: jest.fn().mockResolvedValue({ rate: 11.5, source: 'frankfurter.app', status: 'success' })
    }));
  });

  test('falls back to i18n.getCurrency() when currency setting is not configured', async () => {
    const homey = makeHomey({}, 'SEK'); // no currency setting, but Homey locale says SEK
    const svc = new EntsoePriceService(homey as any);

    const result = await svc.getPrices();

    expect(result.currencyCode).toBe('SEK');
  });

  test('prefers explicit currency setting over i18n.getCurrency()', async () => {
    const homey = makeHomey({ currency: 'NOK' }, 'SEK'); // setting=NOK, i18n=SEK
    const svc = new EntsoePriceService(homey as any);

    const result = await svc.getPrices();

    expect(result.currencyCode).toBe('NOK');
  });

  test('stays EUR when no currency setting and no i18n available', async () => {
    const homey = makeHomey({}); // no currency, no i18n
    FxRateService.mockImplementation(() => ({
      getRate: jest.fn().mockResolvedValue({ rate: null, source: null, status: 'failed' })
    }));
    const svc = new EntsoePriceService(homey as any);

    const result = await svc.getPrices();

    expect(result.currencyCode).toBe('EUR');
  });
});
