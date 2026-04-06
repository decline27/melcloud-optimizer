# Tibber Price Cache Design

**Date:** 2026-04-06  
**Status:** Approved

## Problem

The hourly optimizer calls the Tibber API on every run. Tibber prices for a given day are fixed at midnight and do not change. Tomorrow's prices are published once around 13:00 CET. Calling the API 24 times per day to fetch the same data is wasteful and creates a hard dependency on Tibber availability — if Tibber is down, the optimizer has no price signal.

## Goal

- Call the Tibber API at most twice per day in normal operation
- Continue optimizing with cached prices if Tibber is temporarily unavailable
- Survive Homey restarts without losing cached prices

## Scope

Tibber only. ENTSO-E already has a 6-hour module-level cache that is sufficient.

---

## Architecture

A new `PriceCacheService` class wraps `TibberApi` and implements the existing `PriceProvider` interface. The rest of the stack (Optimizer, PriceAnalyzer) is unchanged.

```
Optimizer → PriceAnalyzer → PriceCacheService → TibberApi → Tibber API
                                   ↕
                            Homey settings
                          (tibber_price_cache_<homeId>)
```

### Wiring (service-manager.ts)

```typescript
const rawTibber = new TibberApi(tibberToken, logger, homeId);
const tibber = new PriceCacheService(rawTibber, homey, logger, homeId);
serviceState.tibber = tibber;
```

`PriceCacheService` reads the settings cache in its constructor so prices are available immediately on the first optimization run after a restart.

No changes to `TibberApi`, `Optimizer`, `PriceAnalyzer`, or the `PriceProvider` interface.

---

## Cache Validation Logic

Tibber prices come in two batches:
- **Today's prices** — published at midnight, fixed for the day
- **Tomorrow's prices** — published around 13:00 CET, fixed after that

Decision tree on each `getPrices()` call:

```
Has cached data?
├── No → fetch from Tibber, store result
└── Yes → is fetchedAt from today (local date)?
    ├── No → fetch from Tibber, store result
    └── Yes → is local time >= 13:30?
        ├── No → return cache (today's prices are complete)
        └── Yes → does cache.hasTomorrow === true?
            ├── Yes → return cache
            └── No → fetch from Tibber, store result
```

**On Tibber failure:** if a fetch attempt fails and cached data exists (even from yesterday), return the cached data and log a warning. Price data from the previous day is a reasonable fallback — daily price variation is rarely extreme enough to cause wrong optimization decisions.

**Tomorrow threshold:** 13:30 local time is a constant (`TOMORROW_PRICES_AVAILABLE_HOUR = 13`, `TOMORROW_PRICES_AVAILABLE_MINUTE = 30`). Not a user setting — it reflects Tibber's publication schedule.

**Normal call frequency:** at most 2 Tibber API calls per day — one after midnight for today's prices, one after 13:30 for tomorrow's prices.

---

## Persisted Data Schema

**Settings key:** `tibber_price_cache_<homeId>`

```typescript
interface TibberPriceCache {
  data: TibberPriceInfo;   // full response from TibberApi.getPrices()
  fetchedAt: string;        // ISO timestamp of the successful fetch
  hasTomorrow: boolean;     // whether tomorrow prices are present in data
}
```

`TibberPriceInfo` is the existing return type of `getPrices()` — no new types required.

**Size:** a full response with today + tomorrow quarter-hourly prices is ~192 price points ≈ 20 KB. Within Homey settings limits.

**Home ID in key:** if the user reconfigures with a different Tibber home ID, the old cache is ignored automatically. Old keys orphan harmlessly and can be cleaned up on next successful fetch.

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| Tibber down, cache from today | Return cache, log warning |
| Tibber down, cache from yesterday | Return cache, log warning with staleness notice |
| Tibber down, no cache | Propagate error (no price signal available) |
| Fetch succeeds | Update cache in settings, return fresh data |
| Settings write fails | Log error, still return the fetched data |

---

## File Location

`src/services/price-cache-service.ts` — new file, ~100 lines.

No other files modified except `src/orchestration/service-manager.ts` (wiring).

---

## Testing

- Cache hit: valid today's data before 13:30 → no fetch
- Cache hit: valid today's data after 13:30 with `hasTomorrow: true` → no fetch
- Cache miss: no cached data → fetch and store
- Cache miss: yesterday's data → fetch and store
- Cache miss: today's data after 13:30, `hasTomorrow: false` → fetch and store
- Fallback: fetch fails, cached data exists → return cache with warning
- Fallback: fetch fails, no cache → propagate error
- Home ID change: old cache key ignored, new key created on next fetch
