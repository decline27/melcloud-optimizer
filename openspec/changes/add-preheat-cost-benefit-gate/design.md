## Context
Issue #53 requires gating preheat based on modeled cost/benefit without adding user settings. We already have a thermal model (cooling rate, thermal mass, confidence), price forecasts, and normalized COP. ThermalController currently preheats on price/COP heuristics and clamps to comfort band but does not check economic net benefit.

## Goals / Non-Goals
- Goals: reuse thermal-model characteristics and CopNormalizer to decide if preheat yields positive net savings; normalize price cadence; fall back cleanly when confidence/data are insufficient; keep comfort/constraint handling intact; add a single debug log.
- Non-Goals: new user settings, UI changes, changing existing constraint flows, or altering optimizer decision surfaces beyond the gate.

## Algorithm Sketch
- Inputs: currentTemp, baseline targetTemp, current price, forecast price points (time+price), outdoor temp, heating COP, comfort band, constraint-aware ΔT if available, thermal characteristics (coolingRate, thermalMass, confidence), CopNormalizer range.
- Price normalization: sort upcoming price points (>= now), parse timestamps; if cadence <30/60 mins, aggregate to hourly buckets by hour start and average price. Require at least 6 normalized points; otherwise skip gate.
- Expensive window: use the first 6 normalized future points (≈6h) and compute `expensiveAvgPrice`.
- COP handling: use `copNormalizer.normalize(heatingCop)` when available; derive `effectiveCop = max(normalizedCOP * (copNormalizer.getRange().max || DEFAULT_REFERENCE_COP), MIN_COP_FOR_COST)`. If heating COP missing and no reliable range, skip gate.
- ΔT and energy: clamp preheat target to comfort max; if constraint result is available, use constrained target for ΔT. `heatKwh = ΔT * thermalCapacity` (fallback to existing thermalMassModel capacity). Skip gate if ΔT <= 0.
- Cost/benefit: `extraCostNow = (heatKwh / effectiveCop) * currentPrice`. Estimate losses over window: `heatLossPerHour = coolingRate * max(currentTemp - outdoorTemp, 0)`; `lostDegrees = heatLossPerHour * windowHours`; `savedDegrees = min(ΔT, lostDegrees)`; `savedHeatKwh = savedDegrees * thermalCapacity`; `savedCostLater = (savedHeatKwh / effectiveCop) * expensiveAvgPrice`; `netBenefit = savedCostLater - extraCostNow`. Require thermal model confidence >= 0.35 and normalized COP > 0 to apply gate.
- Decision: if netBenefit > 0 with sufficient confidence → allow preheat; else fallback to maintain/current heuristic path.

## Fallbacks and Logging
- Fallback triggers: missing thermalModelService, confidence < 0.35, insufficient normalized prices (<6), invalid timestamps/prices, missing COP and no range, ΔT ≤ 0.
- Logging: single debug log capturing proposed vs constrained target, ΔT used, normalized cadence/window, extraCostNow, savedCostLater, netBenefit, confidence, normalized COP, and whether gate allowed or fell back (with reason).
