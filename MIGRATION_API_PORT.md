Migration note — API porting started

What I ported
- Added three API endpoint methods to `src/api.ts` in TypeScript:
  - `getDeviceList({ homey })` — formats device list using an injected `melCloud` service.
  - `getRunHourlyOptimizer({ homey })` — delegates to `optimizer.runEnhancedOptimization()`.
  - `getRunWeeklyCalibration({ homey })` — checks historical data and delegates to `optimizer.runWeeklyCalibration()` when enough data exists.

Why these were chosen
- These endpoints were failing in tests after `api.js` was replaced with a shim, and they're small, self-contained, and good first targets for incremental migration.

How the port works (contract)
- Inputs: an object with a `homey` instance (optional).
- Outputs: objects with `success: boolean` and either `result` or `error` (or `historicalDataCount` for the weekly calibration case).
- Errors: return `{ success: false, error: string }`.

Assumptions made
- The app or global object will expose services during runtime tests (e.g., `this.app.melCloud` or `global.melCloud`). Tests use `api.__test` injection; runtime will typically use app-scoped services.
- Minimum historical data threshold for weekly calibration is 20 optimizations (matches tests expectations).

Files changed
- `src/api.ts` — added three endpoint methods and inline documentation.
- `api.js` — existing compatibility shim (left in place to preserve tests and runtime behavior).

Next steps for a developer to take over
1. Replace shim delegations with real service wiring:
   - Ensure the app initializes and exposes `melCloud`, `optimizer`, and `historicalData` on the app instance so the new `Api` uses real services.
2. Move more endpoints from the legacy JS into `src/api.ts` incrementally. Prioritize endpoints used by integration tests.
3. Add TypeScript types for service inputs/outputs (e.g., `MelCloudDevice`, `OptimizationResult`) to improve correctness and tests.
4. Remove the minimal fallback implementations from `api.js` once `src/api.ts` is the authoritative implementation and compiled outputs are present.

How to run locally
- Install dependencies and run tests:

```bash
npm ci
npm run ci
```

Notes
- I kept `api.js` as a compatibility shim to make tests green during migration. The goal is to port more of the API into `src/api.ts` and have the TypeScript build produce the final runtime `api.js` in `.homeybuild`.

If you'd like, I can continue porting additional API endpoints now — tell me which endpoint to prioritize or I can port the remaining endpoints in `api.js` incrementally.
