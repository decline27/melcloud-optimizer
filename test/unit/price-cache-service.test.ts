import { PriceCacheService } from '../../src/services/price-cache-service';
import type { PriceProvider, TibberPriceInfo } from '../../src/types';

const FAKE_PRICE_DATA: TibberPriceInfo = {
  current: { price: 0.1, time: new Date().toISOString() },
  prices: [{ time: new Date().toISOString(), price: 0.1 }],
  quarterHourly: [],
  currencyCode: 'NOK'
};

function makeService(
  cachedEntry: unknown = null,
  providerResult: TibberPriceInfo = FAKE_PRICE_DATA,
  homeId = 'home1'
) {
  const mockProvider: PriceProvider = { getPrices: jest.fn().mockResolvedValue(providerResult) };
  const stored: Record<string, unknown> = {};
  if (cachedEntry !== null) {
    stored[`tibber_price_cache_${homeId}`] = cachedEntry;
  }
  const mockSettings = {
    get: jest.fn((key: string) => stored[key] ?? null),
    set: jest.fn((key: string, value: unknown) => { stored[key] = value; })
  };
  const mockLogger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const service = new PriceCacheService(mockProvider, mockSettings, mockLogger, homeId);
  return { service, mockProvider, mockSettings, mockLogger };
}

function todayEntry(hasTomorrow = false): object {
  return {
    data: FAKE_PRICE_DATA,
    fetchedAt: new Date().toISOString(),
    hasTomorrow
  };
}

function yesterdayEntry(): object {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return {
    data: FAKE_PRICE_DATA,
    fetchedAt: yesterday.toISOString(),
    hasTomorrow: true
  };
}

describe('PriceCacheService — cache validity', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('no cache → fetches from provider', async () => {
    jest.setSystemTime(new Date('2026-04-06T08:00:00Z'));
    const { service, mockProvider } = makeService(null);
    await service.getPrices();
    expect(mockProvider.getPrices).toHaveBeenCalledTimes(1);
  });

  it('cache from yesterday → fetches from provider', async () => {
    jest.setSystemTime(new Date('2026-04-06T08:00:00Z'));
    const { service, mockProvider } = makeService(yesterdayEntry());
    await service.getPrices();
    expect(mockProvider.getPrices).toHaveBeenCalledTimes(1);
  });

  it('cache from today, time before 13:30 → returns cache without fetching', async () => {
    jest.setSystemTime(new Date('2026-04-06T10:00:00Z'));
    const { service, mockProvider } = makeService(todayEntry(false));
    await service.getPrices();
    expect(mockProvider.getPrices).not.toHaveBeenCalled();
  });

  it('cache from today, time after 13:30, hasTomorrow=true → returns cache without fetching', async () => {
    jest.setSystemTime(new Date('2026-04-06T14:00:00Z'));
    const { service, mockProvider } = makeService(todayEntry(true));
    await service.getPrices();
    expect(mockProvider.getPrices).not.toHaveBeenCalled();
  });

  it('cache from today, time after 13:30, hasTomorrow=false → fetches from provider', async () => {
    jest.setSystemTime(new Date('2026-04-06T14:00:00Z'));
    const { service, mockProvider } = makeService(todayEntry(false));
    await service.getPrices();
    expect(mockProvider.getPrices).toHaveBeenCalledTimes(1);
  });
});
