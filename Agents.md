<!-- OPENSPEC:START -->
# OpenSpec Instructions

These instructions are for AI assistants working in this project.

Always open `@/openspec/AGENTS.md` when the request:
- Mentions planning or proposals (words like proposal, spec, change, plan)
- Introduces new capabilities, breaking changes, architecture shifts, or big performance/security work
- Sounds ambiguous and you need the authoritative spec before coding

Use `@/openspec/AGENTS.md` to learn:
- How to create and apply change proposals
- Spec format and conventions
- Project structure and guidelines

Keep this managed block so 'openspec update' can refresh the instructions.

<!-- OPENSPEC:END -->

# AI Agent Instructions for MELCloud Heat Pump Optimizer

## Project Overview

This Homey SDK 3 TypeScript app orchestrates Mitsubishi Electric heat pump scheduling by combining MELCloud telemetry, dynamic electricity pricing, weather forecasts, and learned thermal/usage models. The optimizer runs entirely on user-provided settings, persists learned parameters, and typically saves 5-30% on energy without compromising comfort.

## Architecture

### Entry Points
- `index.ts` -> `src/app.ts`: main Homey app class; initializes logging, timeline helper, HotWaterService, flow actions, timezone propagation, and legacy migrations.
- `api.ts`: API facade exposed to the Homey settings UI; coordinates service initialization, price-provider refresh, optimization triggers, and memory snapshots.
- `src/api.ts`: thin wrapper the settings front-end calls to reach app methods (`runHourlyOptimizer`, `getMemoryUsage`, etc.).
- `drivers/boiler/driver.ts`: device driver handling MELCloud API bootstrapping, cron-based hourly optimization / weekly calibration (using user timezone), capability sync, and device flow cards.

### Service Coordination
- `src/orchestration/service-manager.ts`: singleton registry for MELCloud, price providers, optimizer, and weather service. Chooses Tibber vs ENTSO-E, exposes `getServiceState`/`getServiceStateSnapshot`, persists historical data, and provides refresh helpers.
- Cron jobs now run in the boiler driver; the app notifies the driver via `updateTimezone()` whenever timezone settings change.

### Core Services
- `src/services/melcloud-api.ts`: MELCloud REST wrapper using `TimeZoneHelper` and centralized logging.
- `src/services/optimizer.ts`: decision engine blending thermal characteristics, adaptive parameters, price tiers, hot-water demand, COP metrics, and planning utilities.
- `src/services/tibber-api.ts`: Tibber GraphQL integration with timezone-aware timestamps.
- `src/services/entsoe-price-service.ts`: ENTSO-E provider with caching, consumer markup modeling, FX conversion, and Homey settings fallbacks; fetches XML through `src/entsoe.ts`.
- `src/services/fx-rate-service.ts`: EUR->currency FX fetcher (frankfurter.app) with 24 h TTL stored in `fx_rate_cache`.
- `weather.ts`: MET.no forecast client with five-minute caching; feeds optimizer and planning utilities.
- `src/services/hot-water/`: collector, analyzer, and service coordinating hot water usage predictions with `TimeZoneHelper`.
- `src/services/thermal-model/`: data collector, analyzer, and service managing detailed + aggregated samples with retention and memory safeguards.

### Supporting Utilities
- `src/util/logger.ts`: `HomeyLogger` centralizes log levels, timeline integration, prefixes, and category filtering.
- `src/util/time-zone-helper.ts`: canonical timezone handling used by the app, optimizer, MELCloud, Tibber, and hot water services.
- `src/util/timeline-helper.ts` & `timeline-helper-wrapper.ts`: standardized timeline entries with fallbacks to Flow and notifications.
- `src/util/memory.ts`: process memory capture used by API health endpoints.
- `src/util/validation.ts`, `src/util/error-handler.ts`, etc., for consistent validation and error reporting.

### Configuration Surface
- Settings UI lives in `settings/index.html` and covers credentials, price source, comfort bands, hot-water configuration, currency overrides, consumer markup JSON, FX cache, logging level, and timezone controls.
- Flow definitions reside under `.homeycompose/flow/` and `drivers/boiler/driver.flow.compose.json`; custom capabilities are in `capabilities/`.

## Pricing & Currency Pipeline

- `price_data_source` selects Tibber or ENTSO-E. If Tibber lacks a token, `service-manager` falls back to ENTSO-E.
- ENTSO-E requests go through `src/entsoe.ts`, and `EntsoePriceService` handles caching, consumer markups (`consumer_markup_config`, `enable_consumer_markup`, `markup_currency_unit`), and FX conversion via `FxRateService`.
- FX rates persist in settings (`fx_rate_cache`, `fx_rate_eur_to_<code>`), defaulting to one-day TTL. Rates inform price normalization so the optimizer always works in the user's configured currency (`currency_code` / detected fallback).
- Monetary math relies on `HeatOptimizerApp.majorToMinor` / `minorToMajor` to keep precision consistent with currency decimals.

## Learning and Adaptation System

### Thermal Learning (`src/services/thermal-model/`)
- `ThermalDataCollector` maintains detailed points (`thermal_model_data`) and aggregated summaries (`thermal_model_aggregated_data`) with 30-day retention, 500 KB guardrails, and memory watchdog logging.
- `ThermalModelService` schedules 6 h model refreshes and 12 h cleanup, seeds initial update after 30 min, and records memory deltas.
- `ThermalAnalyzer` sorts chronologically, learns heating/cooling rates, weather impact, and thermal mass using 80/20 blending between new data and historic characteristics. Forecast helpers fall back to safe defaults until confidence >= 0.2-0.3.

### Adaptive Parameter Learning (`src/services/adaptive-parameters.ts`)
- Learns seasonal price sensitivities (`priceWeightSummer|Winter|Transition`) within 0.2-0.9 bounds based on savings vs comfort trade-offs.
- Evolves COP thresholds, `veryChepMultiplier`, and temperature adjustments (`preheatAggressiveness`, `coastingReduction`, `boostIncrease`) using confidence-weighted blending.
- `learnFromOutcome` ingests savings, comfort violations, and COP performance, increments `learningCycles`, and persists to `adaptive_business_parameters`.
- `getParameters` blends with defaults until confidence >= 0.3 to stabilize early behavior.

### Hot Water Usage Learning (`src/services/hot-water/`)
- `HotWaterDataCollector` samples every five minutes, deduplicates by energy deltas, aggregates older data, and keeps combined storage under ~500 KB (`hot_water_usage_data`, aggregated variants).
- `HotWaterAnalyzer` requires >= 12 data points, blends new vs historical patterns, tracks 0-100 confidence, and produces hourly/day-of-week predictions.
- `HotWaterService` runs timezone-aware analyses every six hours and surfaces predictions + target recommendations to the optimizer.

### Impact on Decision Thresholds
- Price tiers multiply user `preheat_cheap_percentile` by learned `veryChepMultiplier`.
- Comfort targets draw from current comfort band plus adaptive aggressiveness/coasting/boost offsets.
- COP thresholds adapt to measured performance; optimizer reverts to defaults while confidence is low.
- Planning utilities (`computePlanningBias`, `updateThermalResponse`) temper oscillation by comparing expected vs observed heating behavior.

## Optimization Workflow Highlights

- Hourly optimizer combines thermal characteristics, adaptive parameters, price windows, hot-water demand, COP tracking, and weather adjustments to decide preheat/coast/boost actions.
- Weekly calibration re-evaluates K-factor; results feed `learnFromOptimizationOutcome`.
- Timeline and notification events flow through `TimelineHelper`, with automatic fallbacks to Flow actions if the timeline API is unavailable.
- API endpoints expose memory snapshots via `captureProcessMemory` to help track Homey memory ceilings.

## Data Persistence & Settings

- Adaptive parameters -> `adaptive_business_parameters`.
- Thermal samples -> `thermal_model_data`, `thermal_model_aggregated_data`; optimizer historical data managed by `service-manager`.
- Hot water usage -> `hot_water_usage_data`, `hot_water_usage_aggregated_data`, `hot_water_usage_patterns`.
- COP history -> `cop_snapshots_daily`, `cop_snapshots_weekly`, `cop_snapshots_monthly`.
- Cost metrics -> `orchestrator_metrics` (tracks total savings, cost impact, shifted energy, timestamps).
- FX cache -> `fx_rate_cache`; consumer markup + currency overrides live in `consumer_markup_config`, `currency_code`, `markup_currency_unit`.
- Defaults exist only to guard against missing settings-production behavior must always honor user configuration and learned data.

## Logging, Timeline & Metrics

- Use `HomeyLogger` (initialized in `src/app.ts`) for all logging; avoid raw `console.log`.
- Respect user log level and `log_to_timeline`; timeline entries go through `TimelineHelper` / `TimelineHelperWrapper`.
- `OrchestratorMetrics` persists savings + cost impact; legacy migrations run in app `onInit`.
- Health + memory diagnostics are returned via API so the settings UI can surface warnings.

## Development Guidelines

### Platform Requirements
- Homey SDK 3.0 only-follow app lifecycle hooks (`onInit`, `onUninit`, driver lifecycle).
- New logic must be TypeScript (`.ts`); generated JS should only come from the build output.

### Build & Test
```bash
npm run build       # TypeScript -> JavaScript -> .homeyapp bundle
npm run build:ts    # TypeScript compilation only
npm run lint        # Type checking
npm run dev         # Development with debug logging
npm run test:unit   # Unit tests with mocks (test/mocks)
npm run test        # Integration tests (needs test/config.json with real creds)
```

### Critical Patterns
- **Memory cleanup**: clear intervals/timeouts (`ThermalModelService`, hot water service, Entsoe price service), reuse cached singletons, and honor `cleanup()` hooks.
- **Logging & timeline**: route through `HomeyLogger` + `TimelineHelper` to respect verbosity and prevent duplicate timeline spam.
- **Service manager**: do not new-up optimizer, MELCloud API, or price providers-use `getServiceState()` / `refreshPriceProvider()` (`src/orchestration/service-manager.ts`).
- **Settings-driven behavior**: read from `homey.settings` (`comfort_lower_*`, `preheat_cheap_percentile`, `price_data_source`, etc.) and surface defaults in `settings/index.html`, not in code.
- **Timezone handling**: use `TimeZoneHelper.updateSettings` and propagate via API so optimizer, Tibber, ENTSO-E, hot water, and driver cron stay in sync.
- **Flow cards**: app registers the `get_entsoe_prices` action card in `src/app.ts`; device-level cards are defined via Homey Compose and wired in `drivers/boiler/driver.ts`.

### Common Gotchas
- Mixed JS/TS files remain for compatibility-avoid wholesale conversions without planning.
- MET.no weather API enforces rate limits; rely on built-in five-minute cache and avoid tight polling loops.
- External APIs (MELCloud, Tibber, ENTSO-E, Frankfurter FX) rate-limit; reuse provider singletons and caches.
- Homey has tight memory ceilings-use aggregation helpers, trim arrays, and monitor sizes before persisting to settings.
- Cron jobs execute in driver context-timezone-sensitive logic belongs in the driver or must use `TimeZoneHelper`.
- Learning systems expect chronologically ordered data; do not insert retroactive points out of order.

### Environment Setup
- Copy `env.json.example` -> `env.json` for local dev (MELCloud/Tibber credentials, ENTSO-E token, etc.).
- Integration tests need `test/config.json` with real credentials; unit tests use mocks under `test/mocks/`.
- VS Code users should enable TypeScript, ESLint, and Homey tooling for best ergonomics.

⚠️  Do Not Modify  
- optimizer.ts decision logic  
- thermal-model/analyzer.ts math functions  
- hot-water/analyzer.ts learning formulas  


## Quick Reference

### Key APIs & Services
- MELCloud control - `src/services/melcloud-api.ts`
- Tibber pricing - `src/services/tibber-api.ts`
- ENTSO-E + FX - `src/services/entsoe-price-service.ts`, `src/services/fx-rate-service.ts`, `src/entsoe.ts`
- Weather forecasts - `weather.ts`
- Thermal modeling - `src/services/thermal-model/`
- Hot water optimization - `src/services/hot-water/`
- Planning utilities - `src/services/planning-utils.ts`
- COP tracking - `src/services/cop-helper.ts`
- Timeline & logging - `src/util/timeline-helper.ts`, `src/util/logger.ts`

### Custom Capabilities
- `occupied`, `holiday_mode`, `legionella_now`, `heating_cop`, `hotwater_cop` (defined under `capabilities/` and linked via driver compositions).

### Settings Categories
- **Quick Start**: MELCloud credentials, device selection, price source.
- **Temperature Control**: comfort bands, occupancy behavior, anti-cycling safeguards.
- **Pricing**: Tibber token, ENTSO-E area/token, cheap percentile, currency overrides, consumer markup toggles, FX cache management.
- **Advanced**: thermal learning controls, COP parameters, logging level/timeline, timezone options, developer diagnostics.

This playbook keeps AI assistants aligned with the current architecture, learning systems, and coding practices for the MELCloud heat pump optimizer.
