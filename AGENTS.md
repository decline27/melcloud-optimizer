# MELCloud Optimizer - LLM Agent Instructions

> **Last Updated:** December 4, 2025  
> Guidelines for AI agents working on this codebase.

---

## Project Overview

This is a **Homey app** that optimizes Mitsubishi Electric heat pump operation based on electricity prices, weather, and learned thermal characteristics. The goal is to maintain comfort while minimizing energy costs.

**Key Technologies:**
- TypeScript, Homey SDK 3.0
- MELCloud API (device control)
- Tibber/ENTSO-E APIs (electricity prices)
- Node.js runtime on Homey hub

---

## Architecture Summary

```
Optimizer (orchestrator, ~2,350 lines)
    ├── TemperatureOptimizer (core temp calculations)
    ├── SavingsService (savings calculations)
    ├── CalibrationService (weekly calibration)
    ├── ZoneOptimizer (Zone 2 coordination)
    ├── HotWaterOptimizer (tank scheduling)
    ├── ThermalController (thermal mass strategy)
    ├── PriceAnalyzer (price classification)
    ├── CopNormalizer (COP with outlier guards)
    └── ConstraintManager (safety limits)
```

**External APIs:**
- `MelCloudApi` → MELCloud device state/control
- `TibberApi` / `EntsoePriceService` → electricity prices

---

## Critical Rules

### 1. Control Philosophy
**ALWAYS control via room temperature targets, NOT flow temperature.**

```typescript
// ✅ CORRECT - adjust room setpoint (value from user settings)
SetTemperatureZone1: targetTemperature

// ❌ WRONG - never force flow temperature directly
SetHeatFlowTemperatureZone1: flowTemp
```

This preserves COP (efficiency) and aligns with Mitsubishi's control logic.

### 2. Safety Constraints (Never Bypass)

These constraints are **user-configurable** via the settings page. Always read them from settings:

```typescript
const settings = settingsLoader.loadConstraintSettings();
// settings.minSetpointChangeMinutes - Anti-cycling protection
// settings.deadband - Minimum change threshold
// settings.tempStepMax - Max change per cycle
```

**Never hardcode constraint values** - always use `SettingsLoader` to get user preferences.

### 3. Comfort Bands (Never Exceed)

Comfort bands are **user-configurable**. Always read from settings:

```typescript
import { getComfortBand } from './constraint-manager';

const band = getComfortBand(homey.settings, isOccupied);
// band.min - Lower limit (never go below)
// band.max - Upper limit (never exceed)
```

**Never hardcode temperature values** - users set their own comfort preferences.

### 4. COP Normalization

Always use `CopNormalizer.normalize()` for COP values. It:
- Filters outliers based on learned valid range
- Uses percentile-based bounds (learned over time)
- Persists state to settings

```typescript
const normalizedCOP = copNormalizer.normalize(rawCOP);
// Returns 0-1 value based on learned COP range
```

---

## Key Settings

All settings are **user-configurable** via the Homey settings page. Never assume default values - always read from `SettingsLoader`:

```typescript
const settingsLoader = new SettingsLoader(homey, logger);
const copSettings = settingsLoader.loadCOPSettings();
const priceSettings = settingsLoader.loadPriceSettings();
const constraintSettings = settingsLoader.loadConstraintSettings();
```

Full reference: [`documentation/SETTINGS_REFERENCE.md`](file:///Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize/documentation/SETTINGS_REFERENCE.md)

---

## Optimization Flow

```
1. Collect inputs (device state, prices, weather)
2. Classify price (VERY_CHEAP → VERY_EXPENSIVE)
3. Calculate thermal strategy (preheat/coast/maintain/boost)
4. Compute optimal temperature within comfort band
5. Apply constraints (deadband, step limit, anti-cycling)
6. Send setpoint via MELCloud API
7. Record savings and learn from outcome
```

---

## File Locations

| Component | File |
|-----------|------|
| Main orchestrator | `src/services/optimizer.ts` |
| Temperature logic | `src/services/temperature-optimizer.ts` |
| Savings calculations | `src/services/savings-service.ts` |
| Thermal strategies | `src/services/thermal-controller.ts` |
| Constraints | `src/services/constraint-manager.ts` |
| Settings | `src/services/settings-loader.ts` |
| Types | `src/types/index.ts` |
| API endpoints | `api.ts` |
| Main app | `src/app.ts` |

---

## Common Patterns

### Reading Settings
```typescript
const settingsLoader = new SettingsLoader(homey, logger);
const settings = settingsLoader.loadAllSettings();
// settings.cop, settings.constraints, settings.price, etc.
```

### Applying Constraints
```typescript
import { applySetpointConstraints } from './constraint-manager';

// All values come from settings - never hardcode!
const constraints = settingsLoader.loadConstraintSettings();

const result = applySetpointConstraints({
  proposedC: newTarget,
  currentTargetC: currentTarget,
  minC: comfortBand.min,
  maxC: comfortBand.max,
  stepC: constraints.tempStepMax,
  deadbandC: constraints.deadband,
  minChangeMinutes: constraints.minSetpointChangeMinutes,
  lastChangeMs: lastChangeTime
});

if (result.allowed) {
  // Apply result.clampedC
}
```

### Price Classification
```typescript
const level = priceAnalyzer.getPriceLevel(percentile);
// Returns: VERY_CHEAP, CHEAP, MODERATE, EXPENSIVE, VERY_EXPENSIVE
```

---

## Testing

```bash
npm run test:unit    # Unit tests
npm run build        # TypeScript compilation
npm run lint         # ESLint
homey app run        # Deploy to Homey
```

---

## Documentation

| Document | Purpose |
|----------|---------|
| [`ARCHITECTURE.md`](file:///Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize/ARCHITECTURE.md) | System architecture |
| [`documentation/SETTINGS_REFERENCE.md`](file:///Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize/documentation/SETTINGS_REFERENCE.md) | All configuration parameters |
| [`documentation/SERVICES_REFERENCE.md`](file:///Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize/documentation/SERVICES_REFERENCE.md) | Service API reference |
| [`documentation/ALGORITHM_REFERENCE.md`](file:///Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize/documentation/ALGORITHM_REFERENCE.md) | Optimization algorithms |
| [`documentation/MELCLOUD_API_REFERENCE.md`](file:///Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize/documentation/MELCLOUD_API_REFERENCE.md) | MELCloud API patterns |
| [`documentation/USER_GUIDE.md`](file:///Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize/documentation/USER_GUIDE.md) | End-user documentation |

---

## Do NOT

1. ❌ Bypass constraint manager for "urgent" changes
2. ❌ Store unbounded arrays in settings (use TTL/caps)
3. ❌ Call MELCloud API without circuit breaker
4. ❌ Force flow temperature as primary control
5. ❌ Ignore COP when planning heating strategy
6. ❌ Exceed comfort band limits to save money
7. ❌ **Hardcode any values** - temperatures, thresholds, timeouts, etc. must come from user settings or learned state
8. ❌ Assume default values - always read current user configuration via `SettingsLoader`

---

## Do

1. ✅ Use services for their designated purposes
2. ✅ Persist learning state to settings
3. ✅ Log all optimization decisions with reasoning
4. ✅ Run tests after changes: `npm run test:unit`
5. ✅ Follow existing patterns for new features
6. ✅ Update documentation when changing behavior
