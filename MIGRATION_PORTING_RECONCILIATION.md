# Migration / Porting Reconciliation Report

Date: 2025-08-23

This document records the mapping between the legacy `api-old-version.js` exports and the new TypeScript API in `src/api.ts`, notes behavioral differences, and lists concrete next steps to finalize the porting.

## Requirements checklist
- [x] Extract legacy `module.exports` API list and compare to `src/api.ts` exports
- [x] Flag important behavioral differences
- [x] Provide a concrete finalization checklist and immediate next actions

## Mapping: legacy exports → TypeScript port
All legacy functions exported from `api-old-version.js` were located and mapped to the TypeScript port in `src/api.ts`.

- `updateOptimizerSettings` → present as top-level `updateOptimizerSettings` and `Api.updateOptimizerSettings`
- `getDeviceList` → present as `Api.getDeviceList` and top-level `getDeviceList`
- `getRunHourlyOptimizer` → present as `Api.getRunHourlyOptimizer` and top-level `getRunHourlyOptimizer`
- `getRunWeeklyCalibration` → present as `Api.getRunWeeklyCalibration` and top-level `getRunWeeklyCalibration`
- `getThermalModelData` → present as `Api.getThermalModelData` and top-level `getThermalModelData`
- `getStartCronJobs` → present as `Api.getStartCronJobs` and top-level `getStartCronJobs`
- `getUpdateCronStatus` → present as `Api.getUpdateCronStatus` and top-level `getUpdateCronStatus`
- `getCheckCronStatus` → present as `Api.getCheckCronStatus` and top-level `getCheckCronStatus`
- `getCOPData` → present as `Api.getCOPData` and top-level `getCOPData`
- `getWeeklyAverageCOP` → present as `Api.getWeeklyAverageCOP` and top-level `getWeeklyAverageCOP`
- `getMelCloudStatus` → present as `Api.getMelCloudStatus` and top-level `getMelCloudStatus`
- `getTibberStatus` → present as `Api.getTibberStatus` and top-level `getTibberStatus`
- `runSystemHealthCheck` → present as `Api.runSystemHealthCheck` and top-level `runSystemHealthCheck`
- `getMemoryUsage` → present as `Api.getMemoryUsage` and top-level `getMemoryUsage`
- `runThermalDataCleanup` → present as `Api.runThermalDataCleanup` and top-level `runThermalDataCleanup`

Legacy `module.exports.__test` helpers (`setServices`, `setHistoricalData`, `resetAll`, `getState`) → implemented as `__test` in `src/api.ts` and attached to `module.exports.__test` for CommonJS compatibility.

## Notable behavioral differences to review
- Weekly calibration threshold
  - Legacy: required `historicalData.optimizations.length >= 24`
  - TS: checks `count < 20` and returns early if < 20
  - Action: decide whether to align to 24 or accept 20 (tests/integration may depend on this)

- Return shapes and keys
  - TS frequently returns `{ success: true/false, ... }` whereas some legacy endpoints returned `connected: true/false` or other shapes.
  - Action: audit callers (app code, runtime shims, external consumers) for reliance on exact keys.

- Cron jobs and global state
  - Legacy stored `hourlyJob` and `weeklyJob` on `global.*` and used them directly; TS delegates to app methods and `global.app` fallback remains.
  - Action: confirm runtime shim or app exposes cron objects if other code inspects them directly.

- Logging and side-effects
  - Legacy endpoints performed richer timeline and notification side-effects inline. TS endpoints delegate to services and will only perform those side-effects if the injected services implement them.
  - Action: run integration tests that exercise timeline/notification behavior.

- Globals are still used as temporary fallbacks
  - `src/api.ts` prefers app-scoped services but falls back to `(global as any).*`. `__test.setServices` mirrors into globals for tests. This is an explicit temporary compatibility measure.
  - Action: plan a sweep to remove global fallbacks once callsites/tests are migrated to injected services.

## Finalization checklist (concrete steps)
1. Run full typecheck and test-suite
   - `npx tsc --noEmit`
   - `npx jest --runInBand`
   - Fix any remaining type/test failures.

2. Verify behavior differences and accept or reconcile them
   - Decide weekly calibration threshold (20 vs 24)
   - Standardize return shapes for status endpoints (document the chosen shape)

3. Update runtime shim(s)
   - Ensure `api.js` (runtime compatibility file used by the Homey runtime) requires/forwards to the new compiled API implementation.
   - Update `.homeybuild` shims if present.

4. Run integration/smoke tests
   - Validate device list, COP endpoints, cron start/check, timeline entries, and notifications in a staging/dev Homey environment.

5. Remove legacy files
   - When tests and runtime checks are green, delete `api-old-version.js` and any duplicated runtime artifacts.
   - Keep a short migration note in the PR.

6. Remove temporary `__test` global mirroring
   - Migrate tests/call sites to use `__test.getState()` or injected services.
   - Remove global writes in `__test.setServices` and update tests accordingly.

7. Final cleanup
   - Lint, run typecheck, run full tests again; bump package/version as needed.

## Immediate next actions (pick one)
- A) Produce a machine-checked JSON mapping report (legacy → TS) — useful for automation and to attach to a PR.
- B) Run the full test-suite and report failures/coverage problems.
- C) Update the runtime `api.js` shim to point at the TypeScript API and run smoke tests.

Pick A/B/C and I'll proceed.

---

Generated from the reconciliation work on 2025-08-23.

