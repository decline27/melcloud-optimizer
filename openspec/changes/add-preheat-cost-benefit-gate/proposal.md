## Why
Preheat decisions currently rely on heuristics (price percentiles, COP, comfort) without checking whether early heat yields a net monetary benefit. We already have a thermal model and price forecast, so we should gate preheat with modeled cost vs savings while avoiding any new user-facing settings.

## What Changes
- Add an automatic preheat cost/benefit gate that uses thermal model cooling/thermal mass plus normalized COP and forecast prices to decide if preheat is economically positive.
- Normalize price cadence for the gate (hourly/sub-hourly) and reuse constrained setpoint deltas; fall back to the existing heuristic when confidence or data is insufficient.
- Emit a single debug log capturing ΔT, extraCostNow, savedCostLater, netBenefit, confidence, cadence window, and chosen path (gated vs fallback).

## Impact
- Affected specs: thermal-control
- Affected code: `src/services/thermal-controller.ts`, `src/services/thermal-model/*`, COP normalization wiring/logging; possible minor test/documentation updates.
