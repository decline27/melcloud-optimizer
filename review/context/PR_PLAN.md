
# PR Execution Plan — MELCloud Optimizer

Guiding document distilled from the high-impact review so we can drive a PR through discrete, testable work items. Work the tasks sequentially; tick them off in git history as you land each fix.

---

## 1. Hot-Water Incremental Counters Drift

* **Files**: `src/services/hot-water/hot-water-service.ts`, `src/services/hot-water/hot-water-data-collector.ts`
* **Problem**: `collectData` subtracts the previous *increment* instead of the previous cumulative MELCloud counter, so after the second sample every delta explodes (e.g., 2.7 kWh − 0.4 kWh = bogus 2.3 kWh). Pattern learning, tank scheduling, and savings accounting all inherit the inflated numbers.
* **Plan**

  1. Persist last raw MELCloud counters (produced/consumed) and subtract from those, not from the prior normalized delta.
  2. Store the raw counters alongside each data point so historical rectification is possible.
  3. Backfill existing stored points by recomputing deltas once (if feasible) or document/reset.
  4. Add unit test proving successive cumulative readings (2.0 → 2.4 → 2.7 kWh) yield deltas 0.4 / 0.3 kWh.
  5. **Reliability enhancement:** update `lastDataCollectionTime` *only after* payload validation and successful persist, so missing MELCloud fields don’t block learning.
* **Status**: [x] Implemented: _pending commit hash_ (Tests: `npm run lint`, `npm test`)

## 2. Local Timestamp & Day-Of-Week Drift

* **Files**: `src/services/hot-water/hot-water-service.ts`
* **Problem**: `TimeZoneHelper.getLocalTime()` already returns localized fields, but we persist `localTime.date.toISOString()`. That date is the UTC value offset by the user’s timezone, so loading it later re-applies the offset, causing day rollovers 1–2 h early and breaking incremental comparisons/DST alignment.
* **Plan**

  1. Store actual wall-clock timestamps (e.g., keep both UTC ISO + explicit timezone name or store epoch) without double-shifting.
  2. When computing “same day”, compare using the same timezone helper rather than raw `Date` strings.
  3. Migration: normalize existing samples (or clear them) so counters don’t reset mid-evening.
  4. Add regression covering a UTC+2 user at 22:30: ensure the next sample still sees the same local day.
* **Status**: [x] Implemented: _pending commit hash_ (Tests: `npm run lint`, `npm test`)

## 3. Hot-Water Day-Of-Week Mapping Mismatch

* **Files**: `src/services/hot-water/hot-water-service.ts`, `src/services/hot-water/hot-water-analyzer.ts`
* **Problem**: Data capture remaps Sunday→6 / Monday→0 (`(getDay()+6)%7`), but forecasting uses `futureTime.weekday % 7` (Luxon Monday=1). Result: Monday usage patterns drive Tuesday decisions, weekend boosts fire on weekdays, etc.
* **Plan**

  1. Pick a single convention (recommend Monday=0..Sunday=6) and apply it in both collection and prediction.
  2. Migrate stored data or provide compatibility shim translating legacy values.
  3. Extend analyzer tests to assert Monday predictions pull Monday patterns.

## 4. Thermal Response Expected Delta Hard-Coded

* **Files**: `src/services/optimizer.ts`
* **Problem**: After constraints, `expectedDelta` is forced to +0.2 °C / −0.1 °C regardless of the actual requested change. When the house follows a 1.0 °C command, `updateThermalResponse` still thinks it should have seen 0.2 °C and keeps shrinking the gain, muting future preheat.
* **Plan**

  1. Feed the true `zone1FinalConstraints.deltaC` (or 0 when held) into `updateThermalResponse`.
  2. Clamp to a sensible window (e.g., ±2 °C) instead of a fixed ±0.2 °C constant.
  3. Add unit test around `updateThermalResponse` verifying no adjustment when observed≈expected.

## 5. Thermal Time-To-Target Ignores Delta Magnitude

* **Files**: `src/services/thermal-model/thermal-analyzer.ts`
* **Problem**: `calculateTimeToTarget` divides `tempDiff` by `heatingRate * tempDiff`, which simplifies to `1 / heatingRate`. A 0.5 °C nudge and a 3 °C boost both schedule roughly the same 2 h window, undermining preheat accuracy.
* **Plan**

  1. Base heating time on actual ramp rate (e.g., `tempDiff / max(heatingRate * referenceDelta, ε)` or reuse `predictTemperature` to integrate).
  2. Include cooling path parity so coast predictions stay consistent.
  3. Cover with tests showing larger deltas produce proportionally longer times.

## 6. Hot-Water Sampling Interval & Data Collector Reliability

* **Files**: `src/services/hot-water/hot-water-data-collector.ts`
* **Problem**: The collector assumes fixed 20 min samples and “3 per hour”, but actual polling is every 5 min. This inflates heating hours and delays memory trimming.
* **Plan**

  1. Derive sample intervals dynamically from consecutive timestamps instead of constants.
  2. Recalculate `heatingHours` and `dataPointsPerDay` based on real intervals.
  3. Add test verifying computed durations reflect a 5 min poll cadence, not 20 min.

---

## Validation Checklist

* [ ] Unit tests for hot-water delta math and day-of-week alignment.
* [ ] Integration/behavioral test (or logged evidence) showing `thermal_response` no longer drifts after a successful 1 °C change.
* [ ] Tests for `calculateTimeToTarget` spanning small vs large deltas.
* [ ] Manual verification: collect two consecutive MELCloud samples in a non-UTC timezone and confirm incremental counters + day labels behave.
* [ ] Confirm sampling-interval calculations reflect true 5 min cadence and that `lastDataCollectionTime` only updates after valid persist.

---
