import { PriceCacheService } from '../../src/services/price-cache-service';
import type { PriceProvider, TibberPriceInfo } from '../../src/types';

function makeService(
  cachedEntry: unknown = null,
  homeId = 'home1'
) {
  const fakeData: TibberPriceInfo = {
    current: { price: 0.1, time: new Date().toISOString() },
    prices: [{ time: new Date().toISOString(), price: 0.1 }],
    quarterHourly: [],
    currencyCode: 'NOK'
  };
  const mockProvider: PriceProvider = { getPrices: jest.fn().mockResolvedValue(fakeData) };
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
  return { service, mockProvider, mockSettings, mockLogger, fakeData };
}

function todayEntry(fakeData: TibberPriceInfo, hasTomorrow = false): object {
  return {
    data: fakeData,
    fetchedAt: new Date().toISOString(),
    hasTomorrow
  };
}

function yesterdayEntry(fakeData: TibberPriceInfo): object {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return {
    data: fakeData,
    fetchedAt: yesterday.toISOString(),
    hasTomorrow: false
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
    const { fakeData } = makeService(null);
    const { service, mockProvider } = makeService(yesterdayEntry(fakeData));
    await service.getPrices();
    expect(mockProvider.getPrices).toHaveBeenCalledTimes(1);
  });

  it('cache from today, time before 13:30 → returns cache without fetching', async () => {
    jest.setSystemTime(new Date('2026-04-06T10:00:00Z'));
    const { fakeData } = makeService(null);
    const { service, mockProvider } = makeService(todayEntry(fakeData, false));
    await service.getPrices();
    expect(mockProvider.getPrices).not.toHaveBeenCalled();
  });

  it('cache from today, time after 13:30, hasTomorrow=true → returns cache without fetching', async () => {
    jest.setSystemTime(new Date('2026-04-06T14:00:00Z'));
    const { fakeData } = makeService(null);
    const { service, mockProvider } = makeService(todayEntry(fakeData, true));
    await service.getPrices();
    expect(mockProvider.getPrices).not.toHaveBeenCalled();
  });

  it('cache from today, time after 13:30, hasTomorrow=false → fetches from provider', async () => {
    jest.setSystemTime(new Date('2026-04-06T14:00:00Z'));
    const { fakeData } = makeService(null);
    const { service, mockProvider } = makeService(todayEntry(fakeData, false));
    await service.getPrices();
    expect(mockProvider.getPrices).toHaveBeenCalledTimes(1);
  });
});

describe('PriceCacheService — getPrices', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('stores fetched data in settings after successful fetch', async () => {
    jest.setSystemTime(new Date('2026-04-06T08:00:00Z'));
    const { service, mockSettings, fakeData } = makeService(null);
    await service.getPrices();
    expect(mockSettings.set).toHaveBeenCalledWith(
      'tibber_price_cache_home1',
      expect.objectContaining({ data: fakeData, hasTomorrow: false })
    );
  });

  it('returns provider data on successful fetch', async () => {
    jest.setSystemTime(new Date('2026-04-06T08:00:00Z'));
    const { service, fakeData } = makeService(null);
    const result = await service.getPrices();
    expect(result).toBe(fakeData);
  });

  it('on provider failure with today cache → returns cache and warns', async () => {
    jest.setSystemTime(new Date('2026-04-06T14:00:00Z')); // after 13:30 → cache invalid (no tomorrow)
    const { fakeData } = makeService(null);
    const cachedEntry = todayEntry(fakeData, false); // today, no tomorrow → invalid after 13:30

    const mockProvider: PriceProvider = { getPrices: jest.fn().mockRejectedValue(new Error('Tibber down')) };
    const stored: Record<string, unknown> = { 'tibber_price_cache_home1': cachedEntry };
    const mockSettings = {
      get: jest.fn((key: string) => stored[key] ?? null),
      set: jest.fn()
    };
    const mockLogger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const service = new PriceCacheService(mockProvider, mockSettings, mockLogger, 'home1');

    const result = await service.getPrices();
    expect(result).toBe((cachedEntry as { data: TibberPriceInfo }).data);
    // Staleness label should say 'today', not 'yesterday'
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/Tibber API failed.*today/)
    );
  });

  it('on provider failure with yesterday cache → returns cache and warns with staleness', async () => {
    jest.setSystemTime(new Date('2026-04-06T08:00:00Z'));
    const { fakeData } = makeService(null);
    const cachedEntry = yesterdayEntry(fakeData);

    const mockProvider: PriceProvider = { getPrices: jest.fn().mockRejectedValue(new Error('Tibber down')) };
    const stored: Record<string, unknown> = { 'tibber_price_cache_home1': cachedEntry };
    const mockSettings = {
      get: jest.fn((key: string) => stored[key] ?? null),
      set: jest.fn()
    };
    const mockLogger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const service = new PriceCacheService(mockProvider, mockSettings, mockLogger, 'home1');

    const result = await service.getPrices();
    expect(result).toBe((cachedEntry as { data: TibberPriceInfo }).data);
    // Staleness label should say 'yesterday'
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/Tibber API failed.*yesterday/)
    );
  });

  it('on provider failure with no cache → propagates error', async () => {
    jest.setSystemTime(new Date('2026-04-06T08:00:00Z'));
    const mockProvider: PriceProvider = { getPrices: jest.fn().mockRejectedValue(new Error('Tibber down')) };
    const mockSettings = { get: jest.fn(() => null), set: jest.fn() };
    const mockLogger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const service = new PriceCacheService(mockProvider, mockSettings, mockLogger, 'home1');
    await expect(service.getPrices()).rejects.toThrow('Tibber down');
  });

  it('detects hasTomorrow=true when prices include tomorrow timestamps', async () => {
    jest.setSystemTime(new Date('2026-04-06T08:00:00Z'));
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(0, 0, 0, 0);
    const dataWithTomorrow: TibberPriceInfo = {
      current: { price: 0.1, time: new Date().toISOString() },
      prices: [
        { time: new Date().toISOString(), price: 0.1 },
        { time: tomorrow.toISOString(), price: 0.2 }
      ],
      quarterHourly: [],
      currencyCode: 'NOK'
    };
    const mockProvider: PriceProvider = { getPrices: jest.fn().mockResolvedValue(dataWithTomorrow) };
    const mockSettings = { get: jest.fn(() => null), set: jest.fn() };
    const mockLogger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const service = new PriceCacheService(mockProvider, mockSettings, mockLogger, 'home1');
    await service.getPrices();
    expect(mockSettings.set).toHaveBeenCalledWith(
      'tibber_price_cache_home1',
      expect.objectContaining({ hasTomorrow: true })
    );
  });
});

describe('PriceCacheService — settings persistence', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('loads valid cache from settings in constructor, uses it without fetching', async () => {
    jest.setSystemTime(new Date('2026-04-06T08:00:00Z'));
    const { fakeData } = makeService(null);
    const { service, mockProvider } = makeService(todayEntry(fakeData, false));
    await service.getPrices();
    expect(mockProvider.getPrices).not.toHaveBeenCalled();
  });

  it('handles missing settings key gracefully (null)', async () => {
    jest.setSystemTime(new Date('2026-04-06T08:00:00Z'));
    const { service, mockProvider } = makeService(null);
    await service.getPrices();
    expect(mockProvider.getPrices).toHaveBeenCalledTimes(1);
  });

  it('handles corrupt settings value gracefully', async () => {
    jest.setSystemTime(new Date('2026-04-06T08:00:00Z'));
    const mockProvider: PriceProvider = { getPrices: jest.fn().mockResolvedValue(
      { current: { price: 0.1, time: new Date().toISOString() }, prices: [{ time: new Date().toISOString(), price: 0.1 }], quarterHourly: [], currencyCode: 'NOK' }
    ) };
    const mockSettings = { get: jest.fn(() => 'not-an-object'), set: jest.fn() };
    const mockLogger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const service = new PriceCacheService(mockProvider, mockSettings, mockLogger, 'home1');
    await service.getPrices();
    expect(mockProvider.getPrices).toHaveBeenCalledTimes(1);
  });

  it('handles settings.get throwing gracefully', async () => {
    jest.setSystemTime(new Date('2026-04-06T08:00:00Z'));
    const mockProvider: PriceProvider = { getPrices: jest.fn().mockResolvedValue(
      { current: { price: 0.1, time: new Date().toISOString() }, prices: [{ time: new Date().toISOString(), price: 0.1 }], quarterHourly: [], currencyCode: 'NOK' }
    ) };
    const mockSettings = { get: jest.fn(() => { throw new Error('settings error'); }), set: jest.fn() };
    const mockLogger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const service = new PriceCacheService(mockProvider, mockSettings, mockLogger, 'home1');
    await service.getPrices();
    expect(mockProvider.getPrices).toHaveBeenCalledTimes(1);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('failed to load cache from settings'),
      expect.any(Error)
    );
  });

  it('settings.set failure logs error but still returns data', async () => {
    jest.setSystemTime(new Date('2026-04-06T08:00:00Z'));
    const fakeData: TibberPriceInfo = {
      current: { price: 0.1, time: new Date().toISOString() },
      prices: [{ time: new Date().toISOString(), price: 0.1 }],
      quarterHourly: [],
      currencyCode: 'NOK'
    };
    const mockProvider: PriceProvider = { getPrices: jest.fn().mockResolvedValue(fakeData) };
    const mockSettings = {
      get: jest.fn(() => null),
      set: jest.fn(() => { throw new Error('write error'); })
    };
    const mockLogger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const service = new PriceCacheService(mockProvider, mockSettings, mockLogger, 'home1');
    const result = await service.getPrices();
    expect(result).toBe(fakeData);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('failed to save cache to settings'),
      expect.any(Error)
    );
  });

  it('uses home-id-scoped settings key', () => {
    const mockProvider: PriceProvider = { getPrices: jest.fn() };
    const mockSettings = { get: jest.fn(() => null), set: jest.fn() };
    const mockLogger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    new PriceCacheService(mockProvider, mockSettings, mockLogger, 'my-home-abc');
    expect(mockSettings.get).toHaveBeenCalledWith('tibber_price_cache_my-home-abc');
  });

  it('uses "default" key when homeId is undefined', () => {
    const mockProvider: PriceProvider = { getPrices: jest.fn() };
    const mockSettings = { get: jest.fn(() => null), set: jest.fn() };
    const mockLogger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    new PriceCacheService(mockProvider, mockSettings, mockLogger, undefined);
    expect(mockSettings.get).toHaveBeenCalledWith('tibber_price_cache_default');
  });
});
