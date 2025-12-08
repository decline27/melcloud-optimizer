# PR: Make Hardcoded Constants Learnable

**Branch:** `feature/learnable-constants`  
**Base:** `feature/trajectory-aware-planning-bias`  
**Status:** Draft  
**Created:** 2025-12-08

---

## Overview

Convert hardcoded "magic number" constants into learnable parameters that adapt to the specific heat pump installation and building characteristics. This leverages the existing `AdaptiveParametersLearner` infrastructure to minimize code changes and risk.

## Motivation

Currently, several constants are hardcoded with values derived from "typical Nordic installations":
- `REFERENCE_COP = 4.0` - But actual heat pump performance varies significantly
- `MAX_COASTING_HOURS = 4` - But thermal mass varies by building
- `COLD_OUTDOOR_BONUS = 0.5°C` - But comfort perception varies
- `DEFAULT_HEATING_POWER_KW = 2.0` - But heat pump capacity varies

Making these learnable will:
1. **Improve accuracy** - Parameters match actual installation
2. **Reduce manual tuning** - System self-calibrates
3. **Increase savings** - Better optimization decisions

## Implementation Plan

### Phase 1: Derive from Existing Learned Data (Quick Wins)
**Effort: 15 min | Risk: Low**

These changes use data we already learn/track:

#### 1.1 Derive `REFERENCE_COP` from `CopNormalizer`

The `CopNormalizer` already tracks observed COP ranges. Use `maxObserved` as the reference.

**File:** `src/services/thermal-controller.ts`

```typescript
// Before:
private calculateBoostValue(boostTarget: number, heatingCOP: number, baselineTemp: number = 20): number {
    const extraEnergy = (boostTarget - baselineTemp) * this.thermalMassModel.thermalCapacity;
    return extraEnergy * BOOST_SAVINGS_FACTOR * (heatingCOP / REFERENCE_COP);
}

// After:
private calculateBoostValue(
    boostTarget: number, 
    heatingCOP: number, 
    baselineTemp: number = 20,
    referenceCOP: number = REFERENCE_COP  // Optional: use learned value
): number {
    const extraEnergy = (boostTarget - baselineTemp) * this.thermalMassModel.thermalCapacity;
    return extraEnergy * BOOST_SAVINGS_FACTOR * (heatingCOP / referenceCOP);
}
```

**Caller update in Optimizer:**
```typescript
const learnedReferenceCOP = this.copNormalizer.getState().maxObserved || REFERENCE_COP;
const savings = this.thermalController.calculateBoostValue(target, cop, minTemp, learnedReferenceCOP);
```

#### 1.2 Derive `MAX_COASTING_HOURS` from `ThermalMassModel`

The thermal mass model already learns `thermalCapacity`. Higher capacity = longer safe coasting.

**File:** `src/services/thermal-controller.ts`

```typescript
// Before:
const coastingHours = Math.min(
    (currentTemp - coastingTarget) / this.thermalMassModel.heatLossRate,
    MAX_COASTING_HOURS
);

// After:
// Coasting limit scales with thermal capacity (higher = longer safe coasting)
const maxCoastingForBuilding = Math.min(
    this.thermalMassModel.thermalCapacity * 1.5,  // ~1.5h per unit capacity
    MAX_COASTING_HOURS  // Safety cap at 4h (can be raised to 6h)
);
const coastingHours = Math.min(
    (currentTemp - coastingTarget) / this.thermalMassModel.heatLossRate,
    maxCoastingForBuilding
);
```

#### 1.3 Derive `PREHEAT_DURATION_HOURS` from Thermal Response

Similar approach - buildings with higher thermal capacity can preheat longer.

```typescript
// Preheat duration scales with thermal capacity
const preheatDuration = Math.min(
    Math.max(1, this.thermalMassModel.thermalCapacity * 0.8),  // ~0.8h per unit
    PREHEAT_DURATION_HOURS  // Cap at default
);
```

---

### Phase 2: Add New Learnable Parameters to AdaptiveParameters
**Effort: 20 min | Risk: Low**

Extend the existing learning system with new parameters.

#### 2.1 Update Interface

**File:** `src/services/adaptive-parameters.ts`

```typescript
export interface AdaptiveParameters {
  // ... existing parameters ...
  
  // NEW: Environmental response parameters (learnable)
  coldOutdoorBonus: number;           // Default 0.5°C - boost when outdoor < 5°C
  mildOutdoorReduction: number;       // Default 0.3°C - reduction when outdoor > 15°C
  transitionEfficiencyReduction: number; // Default 0.4°C - reduction for low transition efficiency
  
  // NEW: Timing parameters (can be learned from thermal response)
  maxCoastingHoursMultiplier: number; // Default 1.0 - multiplier for calculated max coasting
  preheatDurationMultiplier: number;  // Default 1.0 - multiplier for calculated preheat duration
}
```

#### 2.2 Update Defaults

```typescript
const DEFAULT_PARAMETERS: AdaptiveParameters = {
  // ... existing ...
  
  // Environmental response (new)
  coldOutdoorBonus: 0.5,
  mildOutdoorReduction: 0.3,
  transitionEfficiencyReduction: 0.4,
  
  // Timing multipliers (new)
  maxCoastingHoursMultiplier: 1.0,
  preheatDurationMultiplier: 1.0,
};
```

#### 2.3 Expose in getStrategyThresholds()

```typescript
public getStrategyThresholds() {
  const params = this.getParameters();
  return {
    // ... existing ...
    
    // Environmental response
    coldOutdoorBonus: params.coldOutdoorBonus,
    mildOutdoorReduction: params.mildOutdoorReduction,
    transitionEfficiencyReduction: params.transitionEfficiencyReduction,
    
    // Timing multipliers
    maxCoastingHoursMultiplier: params.maxCoastingHoursMultiplier,
    preheatDurationMultiplier: params.preheatDurationMultiplier,
  };
}
```

---

### Phase 3: Update Consumers to Use Learned Values
**Effort: 15 min | Risk: Low**

#### 3.1 Update temperature-optimizer.ts

```typescript
// Before:
const outdoorAdjustment = outdoorTemp < COLD_OUTDOOR_THRESHOLD 
    ? COLD_OUTDOOR_BONUS 
    : outdoorTemp > MILD_OUTDOOR_THRESHOLD 
        ? -MILD_OUTDOOR_REDUCTION 
        : 0;

// After:
const adaptiveThresholds = this.adaptiveParametersLearner?.getStrategyThresholds();
const coldBonus = adaptiveThresholds?.coldOutdoorBonus ?? COLD_OUTDOOR_BONUS;
const mildReduction = adaptiveThresholds?.mildOutdoorReduction ?? MILD_OUTDOOR_REDUCTION;
const outdoorAdjustment = outdoorTemp < COLD_OUTDOOR_THRESHOLD 
    ? coldBonus 
    : outdoorTemp > MILD_OUTDOOR_THRESHOLD 
        ? -mildReduction 
        : 0;
```

#### 3.2 Update thermal-controller.ts

```typescript
// In calculateThermalMassStrategy, after getting adaptiveThresholds:
const coastingMultiplier = adaptiveThresholds.maxCoastingHoursMultiplier ?? 1.0;
const maxCoastingForBuilding = Math.min(
    this.thermalMassModel.thermalCapacity * 1.5 * coastingMultiplier,
    MAX_COASTING_HOURS
);
```

---

### Phase 4: Add Learning Logic (Future)
**Effort: 30 min | Risk: Low**

Add learning to `learnFromOutcome()` for the new parameters.

```typescript
private learnEnvironmentalResponse(
    outdoorTemp: number,
    comfortSatisfied: boolean,
    goodSavings: boolean
): void {
    const learningRate = 0.002;
    
    // Learn cold outdoor bonus
    if (outdoorTemp < 5) {
        if (!comfortSatisfied) {
            // Too cold - increase bonus
            this.parameters.coldOutdoorBonus = Math.min(1.0, 
                this.parameters.coldOutdoorBonus + learningRate * 5);
        } else if (goodSavings) {
            // Comfortable and saving - can reduce slightly
            this.parameters.coldOutdoorBonus = Math.max(0.2,
                this.parameters.coldOutdoorBonus - learningRate);
        }
    }
    
    // Learn mild outdoor reduction
    if (outdoorTemp > 15) {
        if (!comfortSatisfied) {
            // Too warm - reduce the reduction
            this.parameters.mildOutdoorReduction = Math.max(0.1,
                this.parameters.mildOutdoorReduction - learningRate * 3);
        } else if (goodSavings) {
            // Comfortable and saving - can reduce more
            this.parameters.mildOutdoorReduction = Math.min(0.6,
                this.parameters.mildOutdoorReduction + learningRate);
        }
    }
}

private learnTimingParameters(
    actualCoastingHours: number,
    expectedCoastingHours: number,
    comfortSatisfied: boolean
): void {
    const learningRate = 0.005;
    
    if (!comfortSatisfied && actualCoastingHours > 2) {
        // Coasted too long - reduce multiplier
        this.parameters.maxCoastingHoursMultiplier = Math.max(0.5,
            this.parameters.maxCoastingHoursMultiplier - learningRate * 10);
    } else if (comfortSatisfied && actualCoastingHours < expectedCoastingHours * 0.7) {
        // Could have coasted longer - increase multiplier
        this.parameters.maxCoastingHoursMultiplier = Math.min(1.5,
            this.parameters.maxCoastingHoursMultiplier + learningRate * 5);
    }
}
```

---

## Testing Plan

### Unit Tests to Add

1. **Phase 1 Tests:**
   - `thermal-controller.calculateBoostValue` with custom referenceCOP
   - Coasting hours scaling with thermal capacity
   - Preheat duration scaling with thermal capacity

2. **Phase 2 Tests:**
   - New parameters in `AdaptiveParameters` migration
   - `getStrategyThresholds()` returns new fields
   - Confidence blending for new parameters

3. **Phase 3 Tests:**
   - `temperature-optimizer` uses learned outdoor adjustments
   - Fallback to defaults when no learned values

4. **Phase 4 Tests:**
   - `learnEnvironmentalResponse` adjusts correctly
   - Bounds are respected
   - Learning converges under consistent feedback

### Integration Tests

- Full optimization cycle with learned parameters
- Migration from existing installations (no new fields)
- Parameter persistence across restarts

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Breaking existing behavior | Low | Medium | All defaults match current values |
| Learning instability | Low | Low | Bounds + slow learning rate |
| Migration issues | Low | Low | Spread operator preserves existing |
| Performance impact | Very Low | Low | Minimal additional computation |

---

## Rollout Plan

1. **Phase 1 only** - Merge after testing, immediate benefit from derived values
2. **Phase 2** - Add to AdaptiveParameters, no behavior change yet
3. **Phase 3** - Enable using learned values, monitor in production
4. **Phase 4** - Add learning logic after Phase 3 proves stable

---

## Files Changed

| File | Phase | Changes |
|------|-------|---------|
| `src/services/thermal-controller.ts` | 1, 3 | Derive coasting/preheat from thermal model |
| `src/services/adaptive-parameters.ts` | 2, 4 | New parameters + learning logic |
| `src/services/temperature-optimizer.ts` | 3 | Use learned outdoor adjustments |
| `src/services/optimizer.ts` | 1, 3 | Pass learned referenceCOP |
| `test/unit/adaptive-parameters.test.ts` | 2, 4 | Tests for new parameters |
| `test/unit/thermal-controller.test.ts` | 1 | Tests for derived values |

---

## Checklist

- [x] Phase 1: Derive REFERENCE_COP from CopNormalizer (calculateBoostValue accepts referenceCOP param)
- [x] Phase 1: Derive MAX_COASTING_HOURS from ThermalMassModel (thermalCapacity * 1.5, capped at 6h)
- [x] Phase 1: Derive PREHEAT_DURATION from ThermalMassModel (thermalCapacity * 0.8, capped at 3h)
- [x] Build passes
- [x] All existing tests pass (temperature-optimizer: 29, adaptive-parameters: 50)
- [x] Phase 2: Add new parameters to AdaptiveParameters interface
- [x] Phase 2: Add defaults for new parameters
- [x] Phase 2: Expose in getStrategyThresholds()
- [x] Phase 3: Update temperature-optimizer.ts consumers (coldOutdoorBonus, mildOutdoorReduction)
- [x] Phase 3: Update thermal-controller.ts consumers (maxCoastingHoursMultiplier, preheatDurationMultiplier)
- [x] Phase 4: Add learnEnvironmentalResponse() (coldOutdoorBonus, mildOutdoorReduction, transitionEfficiencyReduction)
- [x] Phase 4: Add learnTimingParameters() (maxCoastingHoursMultiplier, preheatDurationMultiplier)
- [x] Tests: Unit tests for new learning methods (17 new tests added)
- [ ] Tests: Integration tests (optional - not blocking)
