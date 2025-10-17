# Project Context

## Purpose

**MELCloud Optimizer** is a Homey SDK 3.0 home automation app that optimizes Mitsubishi Electric heat pumps to reduce energy costs by 5-30% while maintaining comfort. The system combines real-time electricity pricing data, thermal modeling, weather forecasts, and coefficient of performance (COP) tracking to make intelligent heating decisions.

**Key Goals:**
- Automatically shift heat pump operation to low-price electricity periods
- Track and learn thermal characteristics of the building
- Predict hot water demand and optimize heating accordingly
- Maintain occupancy-aware comfort bands with anti-cycling protection
- Provide transparent, timeline-based explanations of all optimization decisions

## Tech Stack

### Core Technologies
- **Language**: TypeScript 5.8+ (strict mode)
- **Runtime**: Node.js >=16.0.0
- **Platform**: Homey SDK 3.0 (local execution only, no cloud)
- **Build**: TypeScript → JavaScript → .homeyapp bundle via Homey CLI

### Key Dependencies
- `luxon` 3.4+ – timezone-aware datetime handling (canonical for all time operations)
- `moment-timezone` 0.5+ – legacy timezone support (being phased out)
- `node-fetch` 2.7+ – HTTP client for external APIs
- `fast-xml-parser` 4.5+ – ENTSO-E XML price parsing
- `cron` 3.1+ – scheduling recurring optimization tasks
- `commander` 14.0+ – CLI utilities for simulation and analysis

### Testing & Quality
- **Unit Tests**: Jest 29.7+ with ts-jest, mocks in `test/mocks/`
- **Test Configs**: Dual setup (`jest.config.unit.js` for unit, `jest.config.js` for integration with real APIs)
- **Coverage**: 60% branches, 75% functions, 70% lines/statements (enforced)
- **Linting**: `tsc --noEmit` for strict type checking

## Project Conventions

### Code Style
- **File Extensions**: Primary source in `.ts`; legacy `.js` files remain for compatibility
- **Naming**: kebab-case for files, camelCase for variables/functions/methods, PascalCase for classes/interfaces
- **Imports**: Path aliases not used; relative imports preferred within `src/`
- **Strict TypeScript**: `strict: true`, `forceConsistentCasingInFileNames: true`
- **No single-letter variables** except loop indices; prefer `index`, `item`, `entry`
- **File size limit**: Target <600 lines per file; avoid 1900+ line monoliths (e.g., legacy `optimizer.ts` needs refactoring)

### Architecture Patterns

#### Service Manager Pattern
All external services (MELCloud API, Tibber, ENTSO-E, Weather) are **coordinated singletons** via `src/orchestration/service-manager.ts`. Never instantiate services directly.

```typescript
// ✅ Correct
const { optimizer, melCloudApi } = getServiceState();

// ❌ Wrong - bypasses coordination
const optimizer = new Optimizer(deps);
```

#### Pure Engine + Adapter Pattern
The optimization engine (`optimization/engine.ts`) is **pure**: no I/O, deterministic decisions only. Adapters handle API calls.

```typescript
// Engine: pure logic
const decision = computeHeatingDecision(prices, telemetry, weather);

// Adapter: apply to real system
await melCloudApi.setTemperature(decision.targetC);
```

#### Memory-Conscious Aggregation
Large datasets (thermal samples, hot water usage, COP history) use tiered storage with ~500 KB guardrails:
- **Detailed**: `thermal_model_data`, `hot_water_usage_data` (30-day sliding window)
- **Aggregated**: `thermal_model_aggregated_data`, `hot_water_usage_aggregated_data` (older data summarized)
- **Summaries**: Daily/weekly/monthly snapshots for metrics

#### Learning + Confidence System
Adaptive parameters blend new observations with historical defaults using a **0–1 confidence score**. Until confidence ≥0.3–0.5, fallback to safe defaults.

```typescript
// Example: adaptive seasonal price weight
const weight = confidence >= 0.3 
  ? blendWeights(learnedWeight, defaultWeight, confidence)
  : defaultWeight;
```

#### Timezone-Aware Everywhere
Use `TimeZoneHelper` (canonical in `src/util/time-zone-helper.ts`) for all time operations. All services sync to user timezone via this utility.

```typescript
const now = TimeZoneHelper.getCurrentLocalTime(userTimezone);
```

### Testing Strategy

#### Dual-Mode Testing
1. **Unit Tests** (`npm run test:unit`): Mock all external dependencies; fast & reliable
2. **Integration Tests** (`npm run test`): Real API credentials in `test/config.json` (gitignored); validates actual behavior

#### Mocks Location
- `test/mocks/homey.mock.ts` – Complete Homey platform simulation
- `test/mocks/node-fetch.mock.ts` – HTTP request interception
- Service-specific mocks for isolated testing

#### Coverage Expectations
- **Branches**: ≥60%
- **Functions**: ≥75%
- **Lines/Statements**: ≥70%
- **Excluded from gates**: Network-heavy files (melcloud-api.ts, app.ts), orchestrator plumbing

### Git Workflow

#### Branching Strategy
- **main**: Production-ready, all changes via pull request
- **Feature branches**: `feature/<description>` for new capabilities
- **Bugfix branches**: `fix/<description>` for non-breaking repairs
- **Refactor branches**: `refactor/<description>` for structural improvements

#### Commit Conventions
- Prefix with scope: `[core]`, `[services]`, `[ui]`, `[test]`
- Be specific: `[services] add FxRateService for EUR currency conversion` not `fix stuff`
- Reference issues: `Closes #123` or `Relates to #456`

#### Proposal-Driven Changes
Use OpenSpec for:
- New features or capabilities
- Breaking API/schema changes
- Architecture shifts
- Performance-altering optimizations

**Skip proposals** for:
- Bug fixes (restoring intended behavior)
- Typos, comments, formatting
- Non-breaking dependency updates
- Configuration-only changes

## Domain Context

### Heat Pump Physics & Terminology
- **COP (Coefficient of Performance)**: Ratio of heating output to electrical input; target ≥3.0 for efficiency
- **Setpoint**: Target water/room temperature in °C; changes enforce anti-cycling delays to prevent compressor wear
- **K-factor**: Building thermal loss rate (kW/°C); learned weekly via calibration
- **DHW (Domestic Hot Water)**: Heated water for taps; scheduled based on demand patterns and price windows

### Price Data Providers
- **Tibber**: Swedish real-time hourly pricing via GraphQL; token-based auth
- **ENTSO-E**: European day-ahead markets; REST API with XML responses; covers 40+ bidding zones
- **Fallback Logic**: If Tibber token missing or API fails, switch to ENTSO-E automatically

### Optimization Workflow
1. **Hourly Trigger** (cron): Read current prices, device telemetry, weather forecast
2. **Decision Engine**: Apply thermal model + learned parameters + COP heuristics
3. **Output**: Recommended setpoint (°C), reasoning (timeline event), metadata (COP, price percentile)
4. **Execution**: Anti-cycling check → MELCloud API call → record outcome for learning

### User Workflows
- **Occupancy Modes**: Manual "Home"/"Away"/"Holiday" via Homey flow cards or settings
- **Comfort Bands**: User specifies lower/upper temperature comfort range per mode
- **Price Sensitivity**: User configures percentile threshold (e.g., "heat when price < 20th percentile")
- **Learning Feedback**: System adapts seasonal weights, COP thresholds, preheat aggression based on observed outcomes

## Important Constraints

### Platform Constraints (Homey SDK 3.0)
- **Memory**: Strict ceiling (~50 MB observed); monitor via `src/util/memory.ts`
- **Execution**: Local-only (no cloud); cron jobs are idempotent and may execute out of order
- **I/O**: Rate-limited HTTP clients; reuse singletons and caches
- **Settings Persistence**: `homey.settings.get/set()` only; max recommended ~1 MB total

### Technical Constraints
- **Mixed JS/TS**: Legacy `.js` files remain for compatibility; prefer new code in `.ts`
- **Build Chain**: TypeScript → JavaScript in `.homeybuild/` → Homey package
- **Thermal Learning**: Requires chronological data; retroactive insertions will corrupt analysis
- **COP Tracking**: Needs device power telemetry; fallback heuristics if unavailable

### Business Constraints
- **No Cloud Dependency**: App must function without external infrastructure
- **Privacy**: All data stays local; no telemetry sent to third-party servers
- **Open Source**: Licensed under provided terms; cite Mitsubishi Electric properly
- **User Transparency**: Every optimization decision must be logged to timeline with reasoning

### Regulatory & Safety
- **Anti-Cycling**: Minimum 5–10 minutes between setpoint changes (configurable via `safety.minSetpointChangeMinutes`)
- **Extreme Cold Protection**: Hard minimum setpoint (typically 16°C) to prevent freeze damage
- **Legionella Prevention**: Configurable hot water boost schedule to maintain 60°C+ kill temperature

## External Dependencies

### MELCloud API
- **Base URL**: `https://app.melcloud.com/` (production)
- **Auth**: Email + password login; session cookies
- **Rate Limits**: Implicit; typically <1 req/sec recommended
- **Endpoints Used**: Device list, telemetry polling, setpoint control, energy history

### Tibber GraphQL API
- **Endpoint**: `https://api.tibber.com/v1-beta/gql`
- **Auth**: Bearer token in Authorization header
- **Data**: Real-time hourly electricity prices (€/kWh) + 24-hour forecast
- **Rate Limits**: ~10 req/min per token
- **Fallback**: ENTSO-E if token missing or quota exhausted

### ENTSO-E Transparency Platform
- **Base URL**: `https://web-api.tp.entsoe.eu/` (XML REST)
- **Auth**: API token in query params
- **Data**: Day-ahead market clearing prices by bidding zone (XML)
- **Rate Limits**: 10 calls/min; 40 calls/day per token
- **Coverage**: 40+ European countries; supports FX conversion for local currencies

### Frankfurter FX Rates (Independent Central Bank)
- **Base URL**: `https://api.frankfurter.app/`
- **Data**: Daily EUR → local currency conversion (24-hour cache)
- **Rate Limits**: No auth required; public API
- **Used For**: Normalizing ENTSO-E prices (EUR) to user's configured currency

### MET.no Weather Forecasts
- **Base URL**: `https://api.met.no/`
- **Data**: 6-hourly forecasts for location (temperature, wind, precipitation)
- **Rate Limits**: 20 req/sec; 5-minute internal cache to stay well under limit
- **Auth**: None; requires User-Agent header with contact info

### Homey Flow Actions
- **Custom Cards**: Registered in `src/app.ts`; include `get_entsoe_prices`, `set_optimal_temperature`
- **Device Flow Cards**: MELCloud boiler device exposes capabilities like `occupied`, `holiday_mode`, `heating_cop`, `hotwater_cop`
- **Timeline Integration**: All events logged via `TimelineHelper` with fallback to notifications if API unavailable
