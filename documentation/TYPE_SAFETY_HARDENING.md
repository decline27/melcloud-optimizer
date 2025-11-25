## Type Safety Hardening (PR: remove any assertions)

### Overview
- Removes `any` assertions around MELCloud COP data and Homey settings to improve compile-time safety and runtime guards.
- Introduces typed helpers for COP structures and a SettingsAccessor to enforce shape/range validation on settings reads/writes.
- Refines optimizer fallbacks for Zone 2 and tank control to keep behavior deterministic when price data or device capabilities are missing.

### Key Changes
- **COP typing:** Added `EnhancedCOPData`/`DailyCOPData` types with `isEnhancedCOPData` guard and `getCOPValue` helper; MELCloud API parsing and optimizer COP extraction now rely on these instead of `any`.
- **Settings accessor:** New `SettingsAccessor` centralizes typed `get/set` calls, number bounds, boolean defaults, and custom validators; optimizer now uses it for occupancy/timezone where available.
- **Optimizer safeguards:** Zone2 optimization now handles missing price arrays with a clamped fallback target; tank constraint setter routes through `ConstraintManager` to persist enablement/bounds; decision logging uses typed weather/price structures.
- **Price analysis:** `analyzePrice` signature now uses `PricePoint`/`TibberPriceInfo` and maps Tibber-native price levels without casting.

### Impact
- Safer runtime behavior when MELCloud returns partial COP data or Homey settings are empty/malformed.
- Clearer fallbacks for secondary zone and tank control prevent undefined results in edge tests.
- Downstream code benefits from stronger typing and reduced reliance on `any`, easing future refactors.

### Testing
- `npm run test:unit -- --runInBand`
  - Confirms enhanced optimizer edge cases (Zone2 fallback, tank data), COP helper coverage, settings accessor validation, and revised savings calculator behavior.
