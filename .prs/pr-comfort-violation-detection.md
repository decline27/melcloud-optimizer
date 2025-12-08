# PR: Implement Comfort Violation Detection

## Status: ✅ COMPLETED (2025-12-08)

---

## Problem Statement

The learning system never receives comfort violation feedback. The `comfortViolations` value was hardcoded to `0` in two locations in `optimizer.ts`, making the adaptive learning system "deaf" to temperature discomfort.

### Root Cause
```typescript
// src/services/optimizer.ts:2108 (BEFORE FIX)
const comfortViolations = 0;  // HARDCODED - learning never knew about discomfort!
```

### Impact
- The learning system only learned to be MORE aggressive, never LESS
- `if (!comfortSatisfied)` branch in adaptive-parameters.ts NEVER ran
- Learning penalty for comfort violations NEVER applied
- System could over-cool/over-heat homes without self-correcting

---

## Solution Implemented

### New Method: `detectComfortViolations()`

Added a private method to the Optimizer class that compares the actual indoor temperature (from MELCloud) against the user's configured comfort band:

```typescript
/**
 * Detect comfort violations by comparing current temperature against comfort band.
 * This enables the learning system to adjust strategies when comfort is not maintained.
 * @param currentTemp Current indoor temperature from MELCloud
 * @param comfortBand User's configured comfort band (minTemp, maxTemp)
 * @returns Number of violations (0 or 1)
 */
private detectComfortViolations(
  currentTemp: number | undefined,
  comfortBand: { minTemp: number; maxTemp: number }
): number {
  // Can't detect violations without temperature data
  if (currentTemp === undefined || !Number.isFinite(currentTemp)) {
    return 0;
  }

  // Allow a small margin (0.5°C) to avoid false positives from normal fluctuations
  const margin = 0.5;

  if (currentTemp < comfortBand.minTemp - margin) {
    this.logger.log(`Comfort violation detected: ${currentTemp.toFixed(1)}°C < ${comfortBand.minTemp}°C (too cold)`);
    return 1;
  }

  if (currentTemp > comfortBand.maxTemp + margin) {
    this.logger.log(`Comfort violation detected: ${currentTemp.toFixed(1)}°C > ${comfortBand.maxTemp}°C (too warm)`);
    return 1;
  }

  return 0;
}
```

### Changes Made

| Location | Change |
|----------|--------|
| `optimizer.ts:2108` | `const comfortViolations = 0` → `const comfortViolations = this.detectComfortViolations(...)` |
| `optimizer.ts:2176` | Added detection call before learning |
| `optimizer.ts:2308-2339` | New `detectComfortViolations()` method |

---

## How It Works (No User Input Required)

| Data Source | Where It Comes From |
|-------------|---------------------|
| **Current indoor temperature** | MELCloud API via device state polling |
| **Comfort band (min/max)** | User settings configured once in the app |

The detection is **fully automatic**:
1. User sets comfort band once (e.g., 19-22°C)
2. MELCloud reports actual indoor temperature every cycle
3. If temp falls outside band ± 0.5°C margin → violation detected
4. Learning system adjusts strategies accordingly

---

## What the Learning System Now Does

| Scenario | What Happened | What System Learns |
|----------|---------------|-------------------|
| Temp drops to 18°C when min is 19°C | Coasting was too aggressive | Reduce `coastingReduction` |
| Temp rises to 24°C when max is 22°C | Preheating was too aggressive | Reduce `preheatAggressiveness` |
| Temp stays within 19-22°C | Optimization worked well | Increase confidence |

---

## Verification

- ✅ TypeScript compiles successfully
- ✅ 148 optimizer tests pass (1 pre-existing failure unrelated)
- ✅ Both call sites updated
- ✅ Logging added for violation detection

---

## Files Changed

| File | Changes |
|------|---------|
| `src/services/optimizer.ts` | Added `detectComfortViolations()` method, updated 2 call sites |

---

## Related PRs

This fix enables the following learning mechanisms that were previously dead code:

- `adaptive-parameters.ts:198-200` - `if (!comfortSatisfied) { currentWeight *= 0.98 }`
- `adaptive-parameters.ts:300-310` - Reduce aggressiveness on comfort fail
- `adaptive-parameters.ts:361-368` - Learn COP adjustment magnitudes based on comfort
