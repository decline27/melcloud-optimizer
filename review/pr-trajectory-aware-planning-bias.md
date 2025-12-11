# PR Review Document – Trajectory-Aware Planning Bias & Learning

**Branch:** `feature/trajectory-aware-planning-bias`  
**Scope:** Planning bias, thermal controller, adaptive learning, constraints, COP/thermal learning wiring  
**Status:** Ready for implementation (issues + concrete actions below)

---

## 1) Architecture & Data Flow (trace)
- Prices: `PriceProvider.getPrices` → `PriceAnalyzer.getPriceData/analyzePrice` → `computePlanningBias` → `ThermalController.calculateThermalMassStrategy` + `TemperatureOptimizer.calculateOptimalTemperature*` → `applySetpointConstraints`/`ConstraintManager` → MELCloud writes in `Optimizer.optimize`.
- Settings: `SettingsLoader.loadAllSettings` feeds `cop_*`, `preheat_cheap_percentile`, `min_setpoint_change_minutes`, `deadband_c`, `temp_step_max`, timezone, occupancy → applied in `Optimizer.loadSettings` and `getCurrentComfortBand`.
- Learning: `AdaptiveParametersLearner` persisted under `adaptive_business_parameters`; `learnFromOutcome` only called via `CalibrationService.learnFromOptimizationOutcome` at the end of `Optimizer.optimize`. `CopNormalizer` persists `cop_guards_v1` (5–95 percentiles, cap 100 samples). `ThermalModelService` collects data and is used weekly by `CalibrationService`. `HotWaterUsageLearner` is constructed but not involved in planning bias.

## 2) Hardcoding vs User/Learned Inputs (hot spots)
- Planning bias (`src/services/planning-utils.ts`): defaults hardcoded (window 6h, lookahead 12h, cheap/expensive percentiles 25/75, biases +0.5/-0.3, max ±0.7). `Optimizer` call also hardcodes these, ignoring learning/settings except cheap percentile as symmetric expensive.
- Thermal controller (`src/services/thermal-controller.ts`): fixed constants `CHEAPEST_HOURS_COUNT=6`, `PREHEAT_TEMP_DELTA_THRESHOLD=0.5°C`, `BOOST_DURATION_HOURS=1`, `BOOST_SAVINGS_FACTOR=0.15`, caps `MAX_COASTING_HOURS_CAP=6`, `PREHEAT_DURATION_CAP=3`, `COASTING_HOURS_PER_CAPACITY=1.5`, `PREHEAT_HOURS_PER_CAPACITY=0.8`, `MIN_PREHEAT_DURATION=1`, `DEFAULT_HEATING_POWER_KW=2.0`, `DEFAULT_REFERENCE_COP=4.0`. Not user-configurable; only scaled by adaptive multipliers.
- Temperature optimizer (`src/services/temperature-optimizer.ts`): outdoor thresholds 5°C/15°C and bonuses 0.5/-0.3 hardcoded (can be learned but defaults fixed). COP adjustments partly learned via AdaptiveParameters, but default constants remain.
- Constraints/comfort: Properly user-configurable (`SettingsLoader`, `ConstraintManager`, `applySetpointConstraints`); comfort clamps [16,26] hardcoded.
- AdaptiveParameters defaults: learning rates 0.001–0.005, confidence 0→1 over 100 cycles; risk of quasi-static behavior without violations input.
- COP normalization: bounds 0.5–6.0, percentiles 5/95, history 100 (hardcoded; acceptable).

## 3) Learning Loop Quality
- Comfort signal missing: `Optimizer.learnFromOptimizationOutcome` always passes `comfortViolations=0`; learner never sees discomfort → drifts toward more aggressive settings regardless of comfort.
- Learning rates extremely small; without real signals adaptation is negligible over days/weeks.
- `ThermalController` uses `CopNormalizer.roughNormalize` (assumed max 5) instead of learned range, diverging from `TemperatureOptimizer`’s adaptive COP use.
- Planning bias not learnable and only partly tied to settings (cheap percentile only).

## 4) Scenario Robustness (likely gaps)
- Non-hourly/quarter-hour prices: planning bias window slices first N entries (not duration-aware); thermal controller assumes 24 entries = 24h. With 15‑min data, horizons shrink to 6h→1.5h, 24→6h effective.
- Flat/negative prices: planning bias 0; thermal controller percentile math on uniform array may still trigger preheat/coast—needs tests.
- Cheap-coming-later: planning bias handles downward trend, but thermal controller may still preheat based on current percentile without trajectory context.
- Comfort changes: no tests for tight bands or runtime band changes; coasting/preheat might clip too late/early.

## 5) Test Coverage Gaps (add)
- Planning bias: spike outside first 3h; quarter-hour input; negative/flat series; stale timestamps → expect zero/neutral bias.
- Thermal controller: respect comfort band on preheat/boost; coasting duration capped; uniform prices; negative prices; narrow band with step/deadband interaction.
- Learning integration: feed real `comfortViolations>0` and verify aggressiveness reduction; multi-day convergence with/without savings; persistence reload.
- Constraints: deadband vs step; minChange lockout; boundary temps at comfort edges.
- Temperature optimizer: outdoor thresholds at 5/15°C; COP normalization extremes; summer_mode override.
- Price analyzer: adaptive very-cheap multiplier effects; historical floor; missing prices/provider levels.

## 6) Actionable To-Do (prioritized)
**P1 (must)**  
1) Wire real comfort violations into `Optimizer.learnFromOptimizationOutcome` (compare indoor temp vs current comfort band) so `AdaptiveParametersLearner` sees discomfort.  
2) Make planning-bias inputs configurable/learnable: expose window/lookahead/cheap+exp bias magnitudes, and avoid hardcoded symmetric expensive percentile (derive from settings or adaptive thresholds).  
3) Guard price cadence: normalize forecast to hours or validate interval before planning bias/thermal controller (handle quarter-hour data or enforce hourly).  
4) Align COP use: inject `CopNormalizer` into `ThermalController` (replace `roughNormalize`) and pass learned `maxObserved` as reference COP for boost/savings.

**P2 (should)**  
5) Move thermal strategy caps/thresholds toward settings or adaptive params (`CHEAPEST_HOURS_COUNT`, coasting/preheat caps, `BOOST_SAVINGS_FACTOR`).  
6) Add the targeted tests listed above; include runtime setting-change scenarios (comfort band, `min_setpoint_change_minutes`, `preheat_cheap_percentile`).  
7) Add smoothing/decay and per-season bounds to adaptive parameters to prevent monotonic drift; tighten min/max ranges for price weights and aggressiveness.

**P3 (nice)**  
8) Small simulation harness for multi-day price/temperature scenarios to observe adaptation.  
9) Enhance explainability logs tying actions to planning bias and learned parameters.  
10) Explore horizon-aware (MPC-lite) planning using costs/comfort explicitly instead of fixed bias deltas.

## 7) Quick Code Pointers
- Planning bias constants & trend rule: `src/services/planning-utils.ts`
- Hardcoded thermal strategy caps: `src/services/thermal-controller.ts`
- Adaptive learning & defaults: `src/services/adaptive-parameters.ts`
- COP normalization config: `src/services/cop-normalizer.ts`
- Constraints/comfort bands: `src/services/constraint-manager.ts`, `applySetpointConstraints` (`src/util/setpoint-constraints.ts`)
- Optimizer wiring (comfort band, planning bias call, learning hook): `src/services/optimizer.ts`
