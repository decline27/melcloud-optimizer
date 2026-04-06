# Tibber Price Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wrap TibberApi in a `PriceCacheService` that persists price data to Homey settings, reducing Tibber API calls to ≤2/day and keeping the optimizer working when Tibber is unavailable.

**Architecture:** A new `PriceCacheService` implements `PriceProvider` and wraps `TibberApi`. It checks a settings-persisted cache before calling the API and falls back to cached data on failure. Wired in `selectPriceProvider` in `service-manager.ts` — no other files change.

**Tech Stack:** TypeScript, Jest, Homey settings API

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `src/services/price-cache-service.ts` | Cache wrapper implementing `PriceProvider` |
| Create | `test/unit/price-cache-service.test.ts` | Full unit test coverage |
| Modify | `src/orchestration/service-manager.ts` | Wire `PriceCacheService` around `TibberApi` |

---

## Task 1: Cache validity logic

**Files:**
- Create: `src/services/price-cache-service.ts`
- Create: `test/unit/price-cache-service.test.ts`

- [ ] **Step 1: Write failing tests for cache validity**

Create `test/unit/price-cache-service.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx jest test/unit/price-cache-service.test.ts --no-coverage
```

Expected: all 5 tests fail — `Cannot find module '../../src/services/price-cache-service'`

- [ ] **Step 3: Create the service file with validity logic**

Create `src/services/price-cache-service.ts`:

```typescript
import type { PriceProvider, TibberPriceInfo } from '../types';

interface TibberPriceCache {
  data: TibberPriceInfo;
  fetchedAt: string;
  hasTomorrow: boolean;
}

interface CacheSettings {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

interface CacheLogger {
  log(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}

const TOMORROW_PRICES_AVAILABLE_HOUR = 13;
const TOMORROW_PRICES_AVAILABLE_MINUTE = 30;

export class PriceCacheService implements PriceProvider {
  private cached: TibberPriceCache | null = null;
  private readonly settingsKey: string;

  constructor(
    private readonly provider: PriceProvider,
    private readonly settings: CacheSettings,
    private readonly logger: CacheLogger,
    homeId?: string
  ) {
    this.settingsKey = `tibber_price_cache_${homeId ?? 'default'}`;
    this.loadFromSettings();
  }

  private loadFromSettings(): void {
    try {
      const stored = this.settings.get(this.settingsKey);
      if (stored && typeof stored === 'object' &&
          'data' in (stored as object) && 'fetchedAt' in (stored as object)) {
        this.cached = stored as TibberPriceCache;
        this.logger.log(`PriceCacheService: loaded cached prices from settings (fetchedAt: ${this.cached.fetchedAt})`);
      }
    } catch (err) {
      this.logger.error('PriceCacheService: failed to load cache from settings', err);
    }
  }

  private saveToSettings(cache: TibberPriceCache): void {
    try {
      this.settings.set(this.settingsKey, cache);
    } catch (err) {
      this.logger.error('PriceCacheService: failed to save cache to settings', err);
    }
  }

  private isToday(fetchedAt: string): boolean {
    const fetchDate = new Date(fetchedAt);
    const now = new Date();
    return fetchDate.toDateString() === now.toDateString();
  }

  private isPastTomorrowThreshold(): boolean {
    const now = new Date();
    const h = now.getHours();
    const m = now.getMinutes();
    return h > TOMORROW_PRICES_AVAILABLE_HOUR ||
      (h === TOMORROW_PRICES_AVAILABLE_HOUR && m >= TOMORROW_PRICES_AVAILABLE_MINUTE);
  }

  private isCacheValid(): boolean {
    if (!this.cached) return false;
    if (!this.isToday(this.cached.fetchedAt)) return false;
    if (this.isPastTomorrowThreshold() && !this.cached.hasTomorrow) return false;
    return true;
  }

  private hasTomorrowPrices(data: TibberPriceInfo): boolean {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const tomorrowMs = tomorrow.getTime();
    const allPrices = [...(data.prices ?? []), ...(data.quarterHourly ?? [])];
    return allPrices.some(p => {
      const ts = Date.parse(p.time);
      return Number.isFinite(ts) && ts >= tomorrowMs;
    });
  }

  async getPrices(): Promise<TibberPriceInfo> {
    if (this.isCacheValid()) {
      this.logger.log(`PriceCacheService: returning cached prices (fetchedAt: ${this.cached!.fetchedAt})`);
      return this.cached!.data;
    }

    try {
      const data = await this.provider.getPrices();
      const cache: TibberPriceCache = {
        data,
        fetchedAt: new Date().toISOString(),
        hasTomorrow: this.hasTomorrowPrices(data)
      };
      this.cached = cache;
      this.saveToSettings(cache);
      this.logger.log(`PriceCacheService: fetched fresh prices, hasTomorrow=${cache.hasTomorrow}`);
      return data;
    } catch (err) {
      if (this.cached) {
        const staleness = this.isToday(this.cached.fetchedAt) ? 'today' : 'yesterday';
        this.logger.warn(`PriceCacheService: Tibber API failed, using cached prices from ${staleness} (fetchedAt: ${this.cached.fetchedAt})`);
        return this.cached.data;
      }
      throw err;
    }
  }

  updateTimeZoneSettings(offsetHours: number, useDst: boolean, timeZoneName?: string): void {
    this.provider.updateTimeZoneSettings?.(offsetHours, useDst, timeZoneName);
  }

  cleanup(): void {
    this.provider.cleanup?.();
  }
}
```

- [ ] **Step 4: Run validity tests — expect all 5 to pass**

```bash
npx jest test/unit/price-cache-service.test.ts --no-coverage
```

Expected: 5 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/services/price-cache-service.ts test/unit/price-cache-service.test.ts
git commit -m "feat: add PriceCacheService with cache validity logic"
```

---

## Task 2: getPrices fallback behaviour

**Files:**
- Modify: `test/unit/price-cache-service.test.ts`

- [ ] **Step 1: Write failing tests for getPrices fallback**

Append to `test/unit/price-cache-service.test.ts` after the existing `describe` block:

```typescript
describe('PriceCacheService — getPrices', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('stores fetched data in settings after successful fetch', async () => {
    jest.setSystemTime(new Date('2026-04-06T08:00:00Z'));
    const { service, mockSettings } = makeService(null);
    await service.getPrices();
    expect(mockSettings.set).toHaveBeenCalledWith(
      'tibber_price_cache_home1',
      expect.objectContaining({ data: FAKE_PRICE_DATA, hasTomorrow: false })
    );
  });

  it('returns provider data on successful fetch', async () => {
    jest.setSystemTime(new Date('2026-04-06T08:00:00Z'));
    const { service } = makeService(null);
    const result = await service.getPrices();
    expect(result).toBe(FAKE_PRICE_DATA);
  });

  it('on provider failure with today cache → returns cache and warns', async () => {
    jest.setSystemTime(new Date('2026-04-06T08:00:00Z'));
    const providerError = new Error('Tibber down');
    const mockProvider: PriceProvider = { getPrices: jest.fn().mockRejectedValue(providerError) };
    const mockSettings = {
      get: jest.fn(() => yesterdayEntry()),
      set: jest.fn()
    };
    const mockLogger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const service = new PriceCacheService(mockProvider, mockSettings, mockLogger, 'home1');
    const result = await service.getPrices();
    expect(result).toBe((yesterdayEntry() as any).data);
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Tibber API failed'), expect.anything());
  });

  it('on provider failure with no cache → propagates error', async () => {
    jest.setSystemTime(new Date('2026-04-06T08:00:00Z'));
    const providerError = new Error('Tibber down');
    const mockProvider: PriceProvider = { getPrices: jest.fn().mockRejectedValue(providerError) };
    const mockSettings = { get: jest.fn(() => null), set: jest.fn() };
    const mockLogger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const service = new PriceCacheService(mockProvider, mockSettings, mockLogger, 'home1');
    await expect(service.getPrices()).rejects.toThrow('Tibber down');
  });

  it('detects hasTomorrow=true when prices include tomorrow timestamps', async () => {
    jest.setSystemTime(new Date('2026-04-06T08:00:00Z'));
    const tomorrow = new Date('2026-04-07T00:00:00Z');
    const dataWithTomorrow: TibberPriceInfo = {
      current: { price: 0.1, time: new Date().toISOString() },
      prices: [
        { time: new Date().toISOString(), price: 0.1 },
        { time: tomorrow.toISOString(), price: 0.2 }
      ],
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
```

- [ ] **Step 2: Run tests — expect the 5 new tests to pass (implementation is already complete)**

```bash
npx jest test/unit/price-cache-service.test.ts --no-coverage
```

Expected: all 10 tests pass

- [ ] **Step 3: Commit**

```bash
git add test/unit/price-cache-service.test.ts
git commit -m "test: add getPrices fallback coverage for PriceCacheService"
```

---

## Task 3: Settings persistence on startup

**Files:**
- Modify: `test/unit/price-cache-service.test.ts`

- [ ] **Step 1: Write failing tests for constructor loading**

Append to `test/unit/price-cache-service.test.ts`:

```typescript
describe('PriceCacheService — settings persistence', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('loads valid cache from settings in constructor, uses it without fetching', async () => {
    jest.setSystemTime(new Date('2026-04-06T08:00:00Z'));
    const { service, mockProvider } = makeService(todayEntry(false));
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
    const mockProvider: PriceProvider = { getPrices: jest.fn().mockResolvedValue(FAKE_PRICE_DATA) };
    const mockSettings = { get: jest.fn(() => 'not-an-object'), set: jest.fn() };
    const mockLogger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const service = new PriceCacheService(mockProvider, mockSettings, mockLogger, 'home1');
    await service.getPrices();
    expect(mockProvider.getPrices).toHaveBeenCalledTimes(1);
  });

  it('handles settings.get throwing gracefully', async () => {
    jest.setSystemTime(new Date('2026-04-06T08:00:00Z'));
    const mockProvider: PriceProvider = { getPrices: jest.fn().mockResolvedValue(FAKE_PRICE_DATA) };
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
    const mockProvider: PriceProvider = { getPrices: jest.fn().mockResolvedValue(FAKE_PRICE_DATA) };
    const mockSettings = {
      get: jest.fn(() => null),
      set: jest.fn(() => { throw new Error('write error'); })
    };
    const mockLogger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const service = new PriceCacheService(mockProvider, mockSettings, mockLogger, 'home1');
    const result = await service.getPrices();
    expect(result).toBe(FAKE_PRICE_DATA);
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
```

- [ ] **Step 2: Run tests — all should pass (implementation already handles these cases)**

```bash
npx jest test/unit/price-cache-service.test.ts --no-coverage
```

Expected: all 17 tests pass

- [ ] **Step 3: TypeScript compile check**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add test/unit/price-cache-service.test.ts
git commit -m "test: add settings persistence coverage for PriceCacheService"
```

---

## Task 4: Wire into service-manager

**Files:**
- Modify: `src/orchestration/service-manager.ts:61-98`

- [ ] **Step 1: Add import for PriceCacheService**

In `src/orchestration/service-manager.ts`, add to the import block at the top of the file (after the existing imports):

```typescript
import { PriceCacheService } from '../services/price-cache-service';
```

- [ ] **Step 2: Replace the return in the Tibber branch of `selectPriceProvider`**

Find this block (lines 71–86):

```typescript
  if (priceSource === 'tibber') {
    if (tibberToken) {
      const tibberLogger = (appLogger && typeof appLogger.api === 'function') ? appLogger : undefined;
      const homeId = typeof tibberHomeId === 'string' && tibberHomeId.length > 0 ? tibberHomeId : undefined;
      const tibberApi = new TibberApi(tibberToken, tibberLogger, homeId);
      tibberApi.updateTimeZoneSettings(
        timeZoneOffset,
        useDST,
        typeof timeZoneName === 'string' && timeZoneName.length > 0 ? timeZoneName : undefined
      );
      homey.app.log?.('Tibber price provider initialized');
      if (homeId) {
        homey.app.log?.(`Using Tibber home ID: ${homeId}`);
      }
      return tibberApi;
    }
```

Replace with:

```typescript
  if (priceSource === 'tibber') {
    if (tibberToken) {
      const tibberLogger = (appLogger && typeof appLogger.api === 'function') ? appLogger : undefined;
      const homeId = typeof tibberHomeId === 'string' && tibberHomeId.length > 0 ? tibberHomeId : undefined;
      const tibberApi = new TibberApi(tibberToken, tibberLogger, homeId);
      tibberApi.updateTimeZoneSettings(
        timeZoneOffset,
        useDST,
        typeof timeZoneName === 'string' && timeZoneName.length > 0 ? timeZoneName : undefined
      );
      homey.app.log?.('Tibber price provider initialized');
      if (homeId) {
        homey.app.log?.(`Using Tibber home ID: ${homeId}`);
      }
      const cacheLogger = {
        log: (msg: string, ...args: unknown[]) => homey.app.log(msg, ...args),
        warn: (msg: string, ...args: unknown[]) => homey.app.warn ? homey.app.warn(msg, ...args) : homey.app.log(msg, ...args),
        error: (msg: string, ...args: unknown[]) => homey.app.error(msg, ...args)
      };
      return new PriceCacheService(tibberApi, homey.settings, cacheLogger, homeId);
    }
```

- [ ] **Step 3: TypeScript compile check**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 4: Run full test suite**

```bash
npx jest --no-coverage 2>&1 | tail -10
```

Expected: all tests pass, no regressions

- [ ] **Step 5: Commit**

```bash
git add src/orchestration/service-manager.ts
git commit -m "feat: wrap TibberApi with PriceCacheService for settings-persisted price caching"
```

---

## Done

After Task 4 completes:
- Tibber API is called at most twice per day (once at/after midnight for today, once after 13:30 for tomorrow)
- Cached prices survive Homey restarts (stored in settings under `tibber_price_cache_<homeId>`)
- If Tibber is down, the optimizer uses the most recent cached prices with a logged warning
- ENTSO-E is unaffected
