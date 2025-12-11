## 1. Planning
- [x] 1.1 Confirm available thermal model outputs (cooling rate, thermal mass, confidence) and COP normalization inputs from optimizer/thermal controller.
- [x] 1.2 Define price cadence normalization and expensive-window selection for cost/benefit math without introducing user settings.

## 2. Implementation
- [x] 2.1 Implement preheat cost/benefit gate in `ThermalController` using thermal model data, normalized COP, constrained ΔT, and price window; include single debug log and fallbacks.
- [x] 2.2 Reuse existing constraint/comfort handling and avoid new settings; ensure CopNormalizer is injected instead of rough heuristics.

## 3. Testing & Docs
- [x] 3.1 Add unit tests covering positive netBenefit, marginal/negative spread skip, low-confidence/data fallback, and constrained-target impact.
- [x] 3.2 Update relevant docs/review notes and run `npm run test:unit` (plus lint/build if touched areas require).
