# MELCloud Heat Pump Optimizer - AI Coding Guide

## Architecture Overview

This is a **Homey SDK 3.0 TypeScript app** that optimizes Mitsubishi Electric heat pumps via MELCloud API using dynamic electricity pricing. The system combines real-time price data (Tibber/ENTSO-E), thermal modeling, and COP (Coefficient of Performance) tracking to reduce energy costs by 5-30%.

### Key Components

- **Entry Point**: `index.ts` → `src/app.ts` (main Homey app class)
- **API Layer**: `src/api.ts` (HTTP endpoints for settings UI)  
- **Orchestration**: `src/orchestration/service-manager.ts` (coordinates services)
- **Optimization Engine**: `optimization/engine.ts` (pure decision logic, no I/O)
- **Services**: MELCloud API, Tibber/ENTSO-E pricing, thermal modeling, COP tracking
- **Utilities**: Enhanced savings calculator, memory management, timeline logging

## Critical Development Patterns

### Service Architecture Pattern
Services are coordinated through `ServiceManager` with dependency injection. Always use the manager pattern:

```typescript
// Good: Use service manager
const serviceState = getServiceState();
const optimizer = serviceState.optimizer;

// Bad: Direct instantiation bypasses coordination
const optimizer = new Optimizer(/* deps */);
```

### Pure Engine + Adapter Pattern
The optimization engine (`optimization/engine.ts`) is **pure** - no I/O, just decision logic. Adapters handle external APIs:

```typescript
// Engine receives inputs, returns decisions
const decision = computeHeatingDecision(prices, telemetry, config);
// Adapters apply decisions to real systems
await melCloudApi.setTemperature(decision.targetC);
```

### Memory Management is Critical
This app has known memory leak issues. Always clean up intervals, listeners, and large objects:

```typescript
// Required pattern for intervals
private cleanupInterval?: NodeJS.Timeout;

startMonitoring() {
  this.cleanupInterval = setInterval(() => { /* work */ }, 60000);
}

cleanup() {
  if (this.cleanupInterval) {
    clearInterval(this.cleanupInterval);
    this.cleanupInterval = undefined;
  }
}
```

## Testing Strategy

### Dual Configuration System
- **Unit Tests**: `npm run test:unit` (uses `jest.config.unit.js`, includes mocks)
- **Integration Tests**: `npm run test` (uses `jest.config.js`, requires real API credentials)

### Mock Strategy
Unit tests use comprehensive mocks in `test/mocks/`. Key mocks:
- `homey.mock.ts` - Complete Homey platform simulation
- `node-fetch.mock.ts` - HTTP request mocking
- Specific service mocks for isolated testing

### Integration Test Requirements
Integration tests need `test/config.json` (gitignored) with real credentials:
```json
{
  "tibber_api_token": "real_token",
  "melcloud_email": "real_email",  
  "melcloud_password": "real_password"
}
```

## Price Data Handling

### Dual Provider System
Support both Tibber (GraphQL) and ENTSO-E (XML REST) price sources:

```typescript
// Selection logic in service-manager.ts
function selectPriceProvider(homey, priceSource: 'tibber' | 'entsoe') {
  if (priceSource === 'tibber' && tibberToken) {
    return new TibberApi(tibberToken);
  }
  return new EntsoePriceService(homey); // Fallback
}
```

### Currency and Timezone Handling
Prices are normalized to local currency with proper timezone handling. Use `TimeZoneHelper` for all time operations.

## Build and Development

### TypeScript + Homey Build Chain
```bash
npm run build       # Full build (TypeScript → JavaScript → .homeyapp)
npm run build:ts    # TypeScript compilation only
npm run lint        # Type checking without emit
npm run dev         # Development with debug output
```

### Environment Configuration
- Development: `env.json` (gitignored, use `env.json.example`)
- Production: Environment variables via Homey platform
- Settings: `assets/settings/index.html` provides configuration UI

## Common Gotchas

### Mixed JS/TS Architecture
The app mixes compiled TypeScript with some legacy JavaScript. Always check file extensions and use proper imports:

```typescript
// Required for API compatibility
const api = require('../api.js'); // Note .js extension
```

### Homey Platform Constraints
- Memory limits are strict (monitor via `src/util/memory.ts`)
- Cron jobs must be idempotent (duplicate execution protection needed)
- Timeline events for user feedback are mandatory for good UX
- Settings persistence uses `homey.settings.get/set()`

### Anti-Cycling Protection
Heat pumps require minimum time between setpoint changes to prevent wear:

```typescript
// Check time since last change before setting new target
const minChangeMinutes = this.config.safety.minSetpointChangeMinutes;
if (timeSinceLastChange < minChangeMinutes) {
  return { action: 'hold', reason: 'Anti-cycling protection' };
}
```

## Code Quality Standards

- **No 1900+ line files**: The current `optimizer.ts` violates this - break into focused services
- **Explicit error handling**: Always handle external API failures gracefully
- **Type safety**: Prefer TypeScript over JavaScript, use proper types from `src/types/`
- **Memory conscious**: Clean up resources, monitor usage patterns
- **Timeline logging**: User-visible explanations for all optimization decisions

## Integration Points

- **MELCloud API**: Device control and telemetry (rate-limited, requires auth)
- **Tibber GraphQL**: Real-time pricing data (token-based auth)
- **ENTSO-E REST**: Day-ahead European electricity prices (XML parsing required)
- **Homey Platform**: Settings persistence, cron scheduling, flow actions, timeline events