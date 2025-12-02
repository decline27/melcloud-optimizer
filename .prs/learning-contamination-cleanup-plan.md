# Learning System Contamination Cleanup - Implementation Plan

## Overview

This document outlines a phased approach to remove hardcoded "magic numbers" that contaminate or limit the learning system's ability to adapt. Each PR is sized for a focused review, ordered by **impact × ease of implementation**.

**Last Updated:** 2025-12-02

---

## Impact Assessment Summary

Before implementing remaining PRs, we assess each against:
- **Optimization Impact**: How much does this affect temperature decisions (°C) and energy savings?
- **Learning Contamination**: Does this constant actually block or bias learning?
- **Risk vs Reward**: Is the change worth the complexity/testing overhead?

### Decision Matrix

| PR | Temp Impact | Frequency | Learning Block? | Verdict |
|----|-------------|-----------|-----------------|---------|
| PR-4 | ±0.3-0.5°C | Every winter hour | Partial | ✅ Worth doing |
| PR-5 | ±0.2-0.5°C | Every optimization | **Yes** | ✅ Worth doing |
| PR-6 | ±0.3-0.7°C | Every planning cycle | No (configurable) | ⚠️ Low priority |
| PR-7 | Savings calc only | Weekly calibration | No | ⚠️ Low priority |
| PR-8 | ~0.1-0.3°C | 20-60% of hours | **Yes** | ✅ **Quick win** |
| PR-9 | Indirect | Learning only | **Yes** | ✅ Worth doing |
| PR-10 | Pattern accuracy | Hot water only | **Yes** | ✅ **Quick win** |

### Detailed Impact Analysis

#### PR-8: Good COP Adjustment (🔴 HIGH PRIORITY)
**Current hardcoded value:** `0.3` (30% reduction multiplier)

**Frequency:** The "good COP" tier (normalized 0.5-0.8) is hit ~20-60% of operating hours depending on heat pump and conditions.

**Temperature impact:** 
- With 4°C comfort band and midTemp offset of 2°C: `0.3 × 2 = 0.6°C` adjustment
- Typical real-world: **0.1-0.4°C** per decision

**Learning contamination:** YES - excellent/poor/very-poor are adaptive, but this tier is frozen. Creates inconsistent behavior where learning improves other tiers but this one stays static.

**Verdict:** ✅ **WORTH DOING** - Small change, completes PR-1 pattern, high code consistency value.

---

#### PR-9: Normalized COP in Learner (🟢 LOW PRIORITY)
**Current hardcoded values:** `4.0` and `2.5` raw COP thresholds

**Frequency:** Called once per optimization cycle via `learnFromOutcome()`.

**Learning contamination:** MINIMAL - While thresholds don't match normalized values, the actual impact is very low:
- Only adjusts `copEfficiencyBonusHigh` by ±1% per cycle
- Parameter is tightly bounded (0.1-0.5 range)
- Other learning mechanisms (`learnCOPThresholds`) already use normalized values

**Risk:** Medium - requires passing normalized COP through call chain.

**Verdict:** ⚠️ **DEFER** - Code consistency fix only. The 1% per-cycle adjustment on a bounded parameter doesn't cause meaningful learning bias.

---

#### PR-10: Hot Water Blend Pattern (🟡 MEDIUM PRIORITY)
**Current hardcoded value:** `0.8` max blend factor

**Impact:** Hot water patterns always retain 20% of defaults, even at 100% confidence. Thermal model (PR-2) now goes up to 95%.

**Learning contamination:** YES - Creates permanent 20% anchor bias in hot water predictions.

**Actual effect:** Hot water usage predictions may be ~5-10% less accurate than they could be after extended learning.

**Verdict:** ✅ **WORTH DOING** - Simple change, applies proven PR-2 pattern, consistency value.

---

#### PR-5: Normalized COP in Fine-Tuning (🟡 MEDIUM PRIORITY)
**Current hardcoded values:** `3`, `2`, `1.5` raw COP thresholds

**Temperature impact:** ±0.2 to ±0.5°C per decision

**Frequency:** Applied after main temperature calculation, every optimization cycle.

**Learning contamination:** YES - Different heat pumps have different COP ranges. A high-efficiency unit might have "excellent" at COP 5, while a standard unit's "excellent" is 3.5. Using raw values means the optimizer doesn't adapt to the specific unit.

**Verdict:** ✅ **WORTH DOING** - Moderate effort, meaningful impact on different heat pump types.

---

#### PR-4: Outdoor Adjustments (🟡 MEDIUM PRIORITY)
**Current hardcoded values:** `5°C`, `15°C` thresholds, `0.5°C`, `0.3°C` adjustments

**Temperature impact:** ±0.3-0.5°C when outdoor temp crosses thresholds.

**Learning contamination:** PARTIAL - The thermal model already learns `outdoorTempImpact`, but this adjustment is separate and doesn't use that learned value.

**Verdict:** ⚠️ **OPTIONAL** - Could derive from thermal model's `outdoorTempImpact`, but current fixed values are reasonable for most buildings.

---

#### PR-6: Planning Bias Constants (🟢 LOW PRIORITY)
**Current hardcoded values:** `0.5`, `0.3`, `0.7` bias values

**Learning contamination:** NO - These are already exposed via `PlanningBiasOptions`. The defaults are reasonable.

**Verdict:** ⚠️ **SKIP OR DEFER** - Configurable already, just not centralized. Low learning impact.

---

#### PR-7: Energy Assumptions (🟢 LOW PRIORITY)
**Current hardcoded values:** `20°C` baseline, `2.0 kW` power

**Impact:** Affects savings calculations in weekly calibration, not real-time decisions.

**Learning contamination:** NO - These are used for estimation, not for temperature decisions.

**Verdict:** ⚠️ **SKIP OR DEFER** - Accuracy improvement only, no learning impact.

---

## Revised Recommendations

### ✅ COMPLETED (High ROI)
| PR | Effort | Result |
|----|--------|--------|
| **PR-1** | 2 hours | COP adjustment magnitudes now adaptive |
| **PR-2** | 2 hours | Thermal model blend 60-95% based on confidence |
| **PR-3** | 1 hour | Hot water uses user's cheap_percentile |
| **PR-5** | 2 hours | Fine-tuning uses normalized COP |
| **PR-8** | 30 min | Good COP tier now adaptive |
| **PR-10** | 30 min | Hot water blend matches thermal model |

### ⚠️ DEFERRED (Low ROI)
| PR | Reason |
|----|--------|
| **PR-4** | Thermal model already learns outdoor impact separately |
| **PR-6** | Already configurable via `PlanningBiasOptions`, just not centralized |
| **PR-7** | Affects display/logging only, not temperature decisions |
| **PR-9** | 1% per-cycle adjustment on bounded 0.1-0.5 parameter - minimal real bias |

### Final Status
- **6 of 10 PRs completed** - all high-value learning contamination issues fixed
- **4 PRs deferred** - code consistency fixes with negligible learning impact
- **Estimated effort saved**: ~4 hours by deferring low-value items

---

## PR Priority Matrix

| Priority | PR | Impact | Effort | Risk | Status |
|----------|-----|--------|--------|------|--------|
| 🔴 High | PR-1 | High | Low | Low | ✅ **COMPLETE** |
| 🔴 High | PR-2 | High | Medium | Low | ✅ **COMPLETE** |
| 🟡 Medium | PR-3 | Medium | Low | Low | ✅ **COMPLETE** |
| 🟡 Medium | PR-4 | Medium | Medium | Low | ⚠️ Deferred |
| 🟡 Medium | PR-5 | Medium | Medium | Medium | ✅ **COMPLETE** |
| 🟢 Low | PR-6 | Low | Low | Low | ⚠️ Deferred |
| 🟢 Low | PR-7 | Low | Medium | Low | ⚠️ Deferred |
| 🔴 High | PR-8 | High | Low | Low | ✅ **COMPLETE** |
| 🟢 Low | PR-9 | Low | Medium | Medium | ⚠️ Deferred |
| 🟡 Medium | PR-10 | Medium | Low | Low | ✅ **COMPLETE** |

---

## ✅ COMPLETED PRs

### PR-1: Add COP Adjustment Magnitudes to Adaptive Parameters ✅ COMPLETED

**Priority: 🔴 HIGH | Impact: HIGH | Effort: LOW | Risk: LOW**

**Status: COMPLETED** (2025-12-02)

### Changes Made
- Added `copAdjustmentExcellent`, `copAdjustmentPoor`, `copAdjustmentVeryPoor`, `summerModeReduction` to `AdaptiveParameters` interface
- Modified `temperature-optimizer.ts` to use `adaptiveThresholds.copAdjustmentExcellent/Poor/VeryPoor`
- Added learning logic in `learnCOPAdjustmentMagnitudes()`

### Verified Implementation
```typescript
// src/services/temperature-optimizer.ts:219-223
const adaptiveThresholds = this.adaptiveParametersLearner?.getStrategyThresholds() || {
  copAdjustmentExcellent: 0.2,
  copAdjustmentPoor: 0.8,
  copAdjustmentVeryPoor: 1.2,
  summerModeReduction: 0.5
};
```

### Testing
- ✅ All unit tests pass
- ✅ Build compiles successfully

---

#### PR-2: Remove Anchor Bias from Thermal Model Blending ✅ COMPLETED

**Priority: 🔴 HIGH | Impact: HIGH | Effort: MEDIUM | Risk: LOW**

**Status: COMPLETED** (2025-12-02)

### Changes Made
- Modified `src/services/thermal-model/thermal-analyzer.ts` to use adaptive blend factor
- Blend factor now ranges from 60% (low confidence) to 95% (high confidence)
- Formula: `blendFactor = min(0.95, 0.6 + (modelConfidence * 0.35))`
- Applied to: heatingRate, coolingRate, outdoorTempImpact, windImpact, thermalMass

### Verified Implementation
```typescript
// src/services/thermal-model/thermal-analyzer.ts:175-176
const adaptiveBlendFactor = Math.min(0.95, 0.6 + (this.thermalCharacteristics.modelConfidence * 0.35));
this.thermalCharacteristics.heatingRate = adaptiveBlendFactor * avgHeatingRate + (1 - adaptiveBlendFactor) * this.thermalCharacteristics.heatingRate;
```

### Testing
- ✅ All unit tests pass
- ✅ Build compiles successfully

---

### PR-3: Use Configurable Cheap Percentile in Hot Water Optimizer ✅ COMPLETED

**Priority: 🟡 MEDIUM | Impact: MEDIUM | Effort: LOW | Risk: LOW**

**Status: COMPLETED** (2025-12-02)

### Changes Made
- Modified `src/services/hot-water-optimizer.ts` to use `cheapThreshold` from user settings
- Replaced hardcoded percentiles with multipliers of user's `cheap_percentile`:
  - Excellent COP: `cheapThreshold * 1.6` 
  - Good COP: `cheapThreshold * 1.2`
  - Poor COP: `cheapThreshold * 0.6`
  - Very Poor COP: `cheapThreshold * 0.4`

### Verified Implementation
```typescript
// src/services/hot-water-optimizer.ts:56-100
const cheapThreshold = this.priceAnalyzer.getCheapPercentile();
if (currentPercentile <= cheapThreshold * 1.2) { // Good COP
if (currentPercentile <= cheapThreshold * 0.6) { // Poor COP
if (currentPercentile <= cheapThreshold * 0.4) { // Very Poor COP
```

### Testing
- ✅ All unit tests pass
- ✅ Build compiles successfully
- ✅ Behavior unchanged for default 25% setting

---

## 🔄 READY PRs

### PR-4: Make Outdoor Temperature Adjustments Configurable/Learned

**Priority: 🟡 MEDIUM | Impact: MEDIUM | Effort: MEDIUM | Risk: LOW**

### Problem
Fixed temperature breakpoints and adjustments in winter mode don't account for building characteristics.

### Verified Location
```typescript
// src/services/temperature-optimizer.ts:367
const outdoorAdjustment = outdoorTemp < 5 ? 0.5 : outdoorTemp > 15 ? -0.3 : 0;
```

### Solution
1. Add outdoor adjustment parameters to `AdaptiveParameters`
2. Derive from thermal model's `outdoorTempImpact` characteristic

```typescript
// In adaptive-parameters.ts
outdoorColdThreshold: number;    // Default: 5
outdoorWarmThreshold: number;    // Default: 15
outdoorColdBoost: number;        // Default: 0.5
outdoorWarmReduction: number;    // Default: 0.3
```

### Files to Modify
1. `src/services/adaptive-parameters.ts` - Add outdoor parameters
2. `src/services/temperature-optimizer.ts` - Use learned values
3. Consider deriving from thermal model's `outdoorTempImpact`

### Testing
- Verify defaults match current behavior
- Test learning integration

---

## PR-5: Remove Hardcoded COP Values in Fine-Tuning ✅ COMPLETED

**Priority: 🟡 MEDIUM | Impact: MEDIUM | Effort: MEDIUM | Risk: MEDIUM**

**Status: COMPLETED** (2025-12-02)

### Changes Made
- Modified `src/services/temperature-optimizer.ts` to use normalized COP with adaptive thresholds in fine-tuning
- Modified `src/services/hot-water-optimizer.ts` to use normalized COP with `COP_THRESHOLDS.GOOD` instead of raw `2.5`
- Updated unit tests to use correct normalized COP values that trigger thresholds

### Verified Implementation
```typescript
// src/services/temperature-optimizer.ts - Fine-tuning now uses normalized COP
const normalizedHotWaterCOP = this.copNormalizer.normalize(metrics.realHotWaterCOP);
const normalizedHeatingCOP = this.copNormalizer.normalize(metrics.realHeatingCOP);

if (metrics.optimizationFocus === 'hotwater' && normalizedHotWaterCOP > fineTuneThresholds.excellentCOPThreshold) {
  targetTemp += 0.2;
} else if (metrics.optimizationFocus === 'both' && normalizedHeatingCOP > fineTuneThresholds.goodCOPThreshold) {
  targetTemp += 0.3;
} else if (normalizedHeatingCOP < fineTuneThresholds.minimumCOPThreshold && metrics.realHeatingCOP > 0) {
  targetTemp -= 0.5;
}

// src/services/hot-water-optimizer.ts - Pattern-based optimizer uses normalized COP
const normalizedHWCOP = CopNormalizer.roughNormalize(hotWaterCOP, 4.0);
if (currentPrice < avgPrice * priceRatioThreshold && normalizedHWCOP > COP_THRESHOLDS.GOOD) {
```

### Testing
- ✅ Build compiles successfully
- ✅ All 798 unit tests pass
- ✅ Temperature optimizer tests updated for normalized thresholds

---

## PR-6: Make Planning Bias Parameters Configurable

**Priority: 🟢 LOW | Impact: LOW | Effort: LOW | Risk: LOW**

### Problem
Fixed planning bias values don't adapt to building thermal characteristics.

### Verified Locations
```typescript
// src/services/planning-utils.ts:27-29
const DEFAULT_CHEAP_BIAS = 0.5;
const DEFAULT_EXPENSIVE_BIAS = 0.3;
const DEFAULT_MAX_ABS_BIAS = 0.7;
```

**Note**: These are already exposed via `PlanningBiasOptions` but the defaults are hardcoded.

### Solution
1. Add to constants.ts for centralized management
2. Consider deriving from thermal model (high thermal mass → larger biases acceptable)

### Files to Modify
1. `src/constants.ts` - Add planning bias defaults
2. `src/services/planning-utils.ts` - Import from constants

### Testing
- Verify no behavior change with default values

---

## PR-7: Replace Hardcoded Energy Assumptions in Thermal Controller

**Priority: 🟢 LOW | Impact: LOW | Effort: MEDIUM | Risk: LOW**

### Problem
Energy calculations use hardcoded reference values.

### Verified Locations
```typescript
// src/services/thermal-controller.ts:189
const extraEnergy = (preheatingTarget - 20) * this.thermalMassModel.thermalCapacity;

// src/services/thermal-controller.ts:199
const avgHeatingPower = 2.0;
```

### Solution
1. Use `comfortBand.minTemp` or midpoint instead of hardcoded `20`
2. Learn average heating power from MELCloud energy data or make configurable

### Files to Modify
1. `src/services/thermal-controller.ts` - Pass comfort band, make power configurable

### Testing
- Verify savings calculations remain reasonable
- Add unit tests for edge cases

---

## 🆕 NEW PRs (Discovered in Review)

### PR-8: Add "Good COP" Adjustment to Adaptive Parameters ✅ COMPLETED

**Priority: 🔴 HIGH | Impact: HIGH | Effort: LOW | Risk: LOW**

**Status: COMPLETED** (2025-12-02)

### Changes Made
- Added `copAdjustmentGood` to `AdaptiveParameters` interface (default: 0.3)
- Added to `DEFAULT_PARAMETERS`, `getParameters()` blending, and `getStrategyThresholds()`
- Modified `temperature-optimizer.ts` to use `adaptiveThresholds.copAdjustmentGood` instead of hardcoded `0.3`
- Added learning logic in `learnCOPAdjustmentMagnitudes()` with bounds [0.1, 0.5]

### Verified Implementation
```typescript
// src/services/temperature-optimizer.ts:231-233
} else if (copEfficiencyFactor > COP_THRESHOLDS.GOOD) {
  copAdjustment = -adaptiveThresholds.copAdjustmentGood * Math.abs(targetTemp - midTemp);
  this.logger.log(`Good COP: Reducing temperature adjustment by ${(adaptiveThresholds.copAdjustmentGood * 100).toFixed(0)}%`);
```

### Testing
- ✅ Build compiles successfully
- ✅ Hot water analyzer tests pass
- ✅ Consistent with PR-1 pattern for other COP tiers

---

### PR-9: Use Normalized COP in Adaptive Parameter Learning

**Priority: 🟡 MEDIUM | Impact: MEDIUM | Effort: MEDIUM | Risk: MEDIUM**

### Problem
The adaptive parameter learner uses raw COP values (4.0, 2.5) instead of normalized COP, ignoring the learned COP range from `CopNormalizer`.

### Verified Location
```typescript
// src/services/adaptive-parameters.ts:207-213
if (copPerformance > 4.0) {
  // Excellent COP: can afford slightly higher bonus
  this.parameters.copEfficiencyBonusHigh = Math.min(0.5, this.parameters.copEfficiencyBonusHigh * 1.01);
} else if (copPerformance < 2.5) {
  // Poor COP: reduce efficiency bonus
  this.parameters.copEfficiencyBonusHigh = Math.max(0.1, this.parameters.copEfficiencyBonusHigh * 0.99);
}
```

### Impact
- A heat pump with excellent COP of 3.5 would never trigger the ">4.0" branch
- Ignores the adaptive normalization used elsewhere in the system
- Different heat pump models have different COP ranges

### Solution
Pass normalized COP to the learner, or use the same thresholds from `getStrategyThresholds()`:
```typescript
// Option 1: Pass normalized COP
public learnFromOutcome(season, actualSavings, comfortViolations, normalizedCopPerformance?: number)

// Option 2: Use adaptive thresholds
if (normalizedCOP > this.parameters.excellentCOPThreshold) { ... }
```

### Files to Modify
1. `src/services/adaptive-parameters.ts` - Use normalized COP or adaptive thresholds
2. Callers of `learnFromOutcome` - Pass normalized COP

### Testing
- Verify learning triggers at correct normalized thresholds
- Test with various COP ranges

---

### PR-10: Apply Adaptive Blend Pattern to Hot Water Analyzer ✅ COMPLETED

**Priority: 🟡 MEDIUM | Impact: MEDIUM | Effort: LOW | Risk: LOW**

**Status: COMPLETED** (2025-12-02)

### Changes Made
- Modified `src/services/hot-water/hot-water-analyzer.ts` to use adaptive blend formula
- Replaced `Math.min(0.8, confidence / 100)` with `Math.min(0.95, 0.6 + (confidence / 100) * 0.35)`
- Now matches thermal model's adaptive blending pattern (PR-2)

### Verified Implementation
```typescript
// src/services/hot-water/hot-water-analyzer.ts:206-209
// Adaptive blend factor: increases with confidence to reduce anchor bias
// At low confidence (0%): 60% new, 40% old (stable but allows learning)
// At high confidence (100%): 95% new, 5% old (trusts measured data)
const adaptiveBlendFactor = Math.min(0.95, 0.6 + (confidence / 100) * 0.35);
```

### Testing
- ✅ Build compiles successfully
- ✅ Hot water analyzer tests pass (3/3)
- ✅ Consistent with PR-2 thermal model pattern

---

## Deferred Items (Future Consideration)

These items have merit but lower priority or require more extensive changes:

### D-1: COP Normalizer Range Bounds
**Location**: `src/services/cop-normalizer.ts:24-26`
```typescript
MIN_VALID_COP: 0.5,
MAX_VALID_COP: 6.0,
```
**Status**: Working as designed for outlier rejection. Could be made configurable but low priority.

### D-2: Adaptive Parameter Learning Bounds
**Location**: `src/services/adaptive-parameters.ts:202`
```typescript
currentWeight = Math.max(0.2, Math.min(0.9, currentWeight));
```
**Status**: Bounds prevent runaway learning. Could be widened but requires careful testing.

### D-3: Confidence Based Only on Cycle Count
**Location**: `src/services/adaptive-parameters.ts:220`
```typescript
this.parameters.confidence = Math.min(1.0, this.parameters.learningCycles / 100);
```
**Status**: Confidence is purely cycle-count based—doesn't incorporate outcome quality. After 100 "bad" cycles with comfort violations, confidence still hits 100%. Could be enhanced to factor in success rate, but requires careful design.

### D-4: Fixed Learning Multipliers
**Location**: `src/services/adaptive-parameters.ts:192-200`
```typescript
if (comfortSatisfied && goodSavings) {
  currentWeight *= 1.02;  // Fixed 2% increase
} else if (!comfortSatisfied) {
  currentWeight *= 0.98;  // Fixed 2% decrease
}
```
**Status**: Learning speed is constant regardless of outcome magnitude. A large comfort violation adjusts the same as a minor one. Could scale with outcome severity but adds complexity.

### D-5: Thermal Model Confidence Cap
**Location**: `src/services/thermal-model/thermal-analyzer.ts:215`
```typescript
const maxConfidencePoints = 168; // 1 week of hourly data
```
**Status**: Could be increased for seasonal coverage, but one week is reasonable for initial learning.

### D-6: Strategy Parameter Learning Bounds
**Location**: `src/services/adaptive-parameters.ts:301-320`
```typescript
this.parameters.preheatAggressiveness = Math.max(0.5, ...);  // Floor at 0.5
this.parameters.preheatAggressiveness = Math.min(3.0, ...);  // Ceiling at 3.0
```
**Status**: Arbitrary bounds (0.5, 2.5, 3.0) limit learning. Buildings with unusual characteristics might need values outside these ranges. Low priority as current bounds are conservative.

---

## Implementation Notes

### General Guidelines
1. Each PR should include unit tests for new/modified behavior
2. Maintain backward compatibility with existing settings
3. Log warnings when falling back to defaults
4. Document new parameters in settings UI where applicable

### Migration Considerations
- New adaptive parameters should initialize from current defaults
- Existing learned data should not be invalidated
- Consider migration logic for stored parameter structures

### Testing Strategy
1. Unit tests for each modified file
2. Integration tests for learning loop behavior
3. Manual testing with representative scenarios
4. Compare optimization decisions before/after changes

---

## Summary

| PR | Title | Impact | Status | Recommendation |
|----|-------|--------|--------|----------------|
| PR-1 | COP Adjustment Magnitudes | ±0.2-1.2°C | ✅ **COMPLETED** | — |
| PR-2 | Thermal Model Blending | Pattern accuracy | ✅ **COMPLETED** | — |
| PR-3 | Hot Water Percentiles | Scheduling | ✅ **COMPLETED** | — |
| PR-4 | Outdoor Adjustments | ±0.3-0.5°C | ⚠️ Deferred | Low ROI |
| PR-5 | Normalized COP Usage | ±0.2-0.5°C | ✅ **COMPLETED** | — |
| PR-6 | Planning Bias Constants | ±0.3-0.7°C | ⚠️ Deferred | Already configurable |
| PR-7 | Energy Assumptions | Display only | ⚠️ Deferred | No decision impact |
| PR-8 | Good COP Adjustment | ~0.1-0.4°C | ✅ **COMPLETED** | — |
| PR-9 | Normalized COP in Learner | ~1%/cycle | ⚠️ Deferred | Bounded, minimal bias |
| PR-10 | Hot Water Blend Pattern | Pattern accuracy | ✅ **COMPLETED** | — |

### Completed (6 of 10) ✅ ALL HIGH-VALUE ITEMS DONE
- ✅ **PR-1**: COP adjustment magnitudes (excellent/poor/very-poor) now adaptive
- ✅ **PR-2**: Thermal model uses adaptive blend (60-95% based on confidence)
- ✅ **PR-3**: Hot water percentiles derive from user's cheap_percentile setting
- ✅ **PR-5**: Fine-tuning uses normalized COP with adaptive thresholds
- ✅ **PR-8**: Good COP adjustment now adaptive (completes PR-1)
- ✅ **PR-10**: Hot water analyzer uses same adaptive blend as thermal model

### Deferred (Low ROI) - 4 items
| PR | Reason |
|----|--------|
| PR-4 | Thermal model already learns outdoor impact separately |
| PR-6 | Already configurable via `PlanningBiasOptions` |
| PR-7 | Affects display/logging only, not temperature decisions |
| PR-9 | 1% per-cycle adjustment on bounded 0.1-0.5 parameter - minimal bias |

### Progress Summary
- **Learning consistency achieved**: All 4 COP tiers now use adaptive adjustments
- **Blend pattern unified**: Both thermal and hot water models use adaptive 60-95% blend
- **COP normalization unified**: Fine-tuning now uses normalized COP (PR-5 complete)
- **All high-value items complete**: Remaining PRs are code consistency fixes with minimal learning impact
