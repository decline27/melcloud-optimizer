# Learning System Contamination Cleanup - Implementation Plan

## Overview

This document outlines a phased approach to remove hardcoded "magic numbers" that contaminate or limit the learning system's ability to adapt. Each PR is sized for a focused review, ordered by **impact × ease of implementation**.

---

## PR Priority Matrix

| Priority | PR | Impact | Effort | Risk | Status |
|----------|-----|--------|--------|------|--------|
| 🔴 High | PR-1 | High | Low | Low | ✅ **COMPLETE** |
| 🔴 High | PR-2 | High | Medium | Low | Ready |
| 🟡 Medium | PR-3 | Medium | Low | Low | Ready |
| 🟡 Medium | PR-4 | Medium | Medium | Low | Ready |
| 🟡 Medium | PR-5 | Medium | Medium | Medium | Ready |
| 🟢 Low | PR-6 | Low | Low | Low | Ready |
| 🟢 Low | PR-7 | Low | Medium | Low | Ready |

---

## PR-1: Add COP Adjustment Magnitudes to Adaptive Parameters

**Priority: 🔴 HIGH | Impact: HIGH | Effort: LOW | Risk: LOW**

### Problem
In `temperature-optimizer.ts:219-237`, COP-based temperature adjustments use fixed magnitudes (`+0.2`, `-0.8`, `-1.2`) that never adapt based on actual outcomes.

### Verified Locations
```typescript
// src/services/temperature-optimizer.ts:220
copAdjustment = 0.2; // Small bonus for excellent efficiency

// src/services/temperature-optimizer.ts:229
copAdjustment = -0.8 * this.copWeight; // Reduce temperature

// src/services/temperature-optimizer.ts:233
copAdjustment = -1.2 * this.copWeight;
```

### Solution
Add learned adjustment magnitudes to `AdaptiveParameters` interface:
```typescript
// In adaptive-parameters.ts
export interface AdaptiveParameters {
  // ... existing fields ...
  copAdjustmentExcellent: number;  // Default: 0.2
  copAdjustmentPoor: number;       // Default: 0.8
  copAdjustmentVeryPoor: number;   // Default: 1.2
}
```

### Files to Modify
1. `src/services/adaptive-parameters.ts` - Add new parameters with defaults and learning logic
2. `src/services/temperature-optimizer.ts` - Use adaptive values instead of hardcoded
3. `src/constants.ts` - Add default magnitudes

### Testing
- Unit tests for new adaptive parameters
- Verify fallback to defaults when learner unavailable

---

## PR-2: Remove Anchor Bias from Thermal Model Blending ✅ COMPLETED

**Priority: 🔴 HIGH | Impact: HIGH | Effort: MEDIUM | Risk: LOW**

**Status: COMPLETED** (2024-12-02)

### Changes Made
- Modified `src/services/thermal-model/thermal-analyzer.ts` to use adaptive blend factor
- Blend factor now ranges from 60% (low confidence) to 95% (high confidence)
- Formula: `blendFactor = min(0.95, 0.6 + (modelConfidence * 0.35))`
- Applied to: heatingRate, coolingRate, outdoorTempImpact, windImpact, thermalMass

### Problem (Resolved)
In `thermal-analyzer.ts:176`, new thermal characteristics are always blended 80/20 with previous values, permanently anchoring learned values to initial defaults.

### Verified Location
```typescript
// src/services/thermal-model/thermal-analyzer.ts:176
this.thermalCharacteristics.heatingRate = 0.8 * avgHeatingRate + 0.2 * this.thermalCharacteristics.heatingRate;
```

Also affects:
- `coolingRate` (line ~180)
- `outdoorTempImpact` (line ~184)
- `windImpact` (line ~188)
- `thermalMass` (line ~207)

### Solution (Implemented)
Make blend factor adaptive based on `modelConfidence`:
```typescript
// Adaptive blend factor: increases with confidence to reduce anchor bias
// At low confidence (0): 60% new, 40% old (stable but allows learning)
// At high confidence (1): 95% new, 5% old (trusts measured data)
const adaptiveBlendFactor = Math.min(0.95, 0.6 + (this.thermalCharacteristics.modelConfidence * 0.35));
this.thermalCharacteristics.heatingRate = adaptiveBlendFactor * avgHeatingRate + (1 - adaptiveBlendFactor) * this.thermalCharacteristics.heatingRate;
```

### Files Modified
1. `src/services/thermal-model/thermal-analyzer.ts` - Implemented adaptive blending

### Testing
- ✅ All 798 unit tests pass
- ✅ Build compiles successfully

---

## PR-3: Use Configurable Cheap Percentile in Hot Water Optimizer

**Priority: 🟡 MEDIUM | Impact: MEDIUM | Effort: LOW | Risk: LOW**

### Problem
Hot water optimizer uses hardcoded percentile thresholds (`30%`, `15%`, `10%`) instead of deriving from the user's configured `preheat_cheap_percentile`.

### Verified Locations
```typescript
// src/services/hot-water-optimizer.ts:75
if (currentPercentile <= 0.3) { // Only during cheapest 30%

// src/services/hot-water-optimizer.ts:83
if (currentPercentile <= 0.15) { // Only during cheapest 15%

// src/services/hot-water-optimizer.ts:98
if (currentPercentile <= 0.1) { // Only during cheapest 10%
```

### Solution
Replace with expressions using `priceAnalyzer.getCheapPercentile()`:
```typescript
const cheapPercentile = this.priceAnalyzer.getCheapPercentile();
if (currentPercentile <= cheapPercentile * 1.2) { // Good COP: ~30% if cheap=25%
if (currentPercentile <= cheapPercentile * 0.6) { // Poor COP: ~15% if cheap=25%
if (currentPercentile <= cheapPercentile * 0.4) { // Very Poor COP: ~10% if cheap=25%
```

### Files to Modify
1. `src/services/hot-water-optimizer.ts` - Use relative percentiles

### Testing
- Verify behavior matches current with default 25% percentile
- Test with different percentile configurations

---

## PR-4: Make Outdoor Temperature Adjustments Configurable/Learned

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

## PR-5: Remove Hardcoded COP Values in Fine-Tuning

**Priority: 🟡 MEDIUM | Impact: MEDIUM | Effort: MEDIUM | Risk: MEDIUM**

### Problem
Raw COP thresholds are used instead of normalized values, ignoring the learned COP range.

### Verified Locations
```typescript
// src/services/temperature-optimizer.ts:400
if (metrics.optimizationFocus === 'hotwater' && metrics.realHotWaterCOP > 3) {

// src/services/temperature-optimizer.ts:404
} else if (metrics.optimizationFocus === 'both' && metrics.realHeatingCOP > 2) {

// src/services/temperature-optimizer.ts:408
} else if (metrics.realHeatingCOP < 1.5 && metrics.realHeatingCOP > 0) {

// src/services/hot-water-optimizer.ts:268
if (currentPrice < avgPrice * priceRatioThreshold && hotWaterCOP > 2.5) {
```

### Solution
Use `CopNormalizer` to get normalized values and compare against learned thresholds:
```typescript
const normalizedCOP = this.copNormalizer.normalize(metrics.realHotWaterCOP);
if (metrics.optimizationFocus === 'hotwater' && normalizedCOP > adaptiveThresholds.excellentCOPThreshold) {
```

### Files to Modify
1. `src/services/temperature-optimizer.ts` - Use normalized COP
2. `src/services/hot-water-optimizer.ts` - Use normalized COP

### Testing
- Verify normalization is applied correctly
- Test with various COP ranges

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
**Location**: `src/services/adaptive-parameters.ts:186`
```typescript
currentWeight = Math.max(0.2, Math.min(0.9, currentWeight));
```
**Status**: Bounds prevent runaway learning. Could be widened but requires careful testing.

### D-3: Confidence Cycle Count
**Location**: `src/services/adaptive-parameters.ts:206`
```typescript
this.parameters.confidence = Math.min(1.0, this.parameters.learningCycles / 100);
```
**Status**: Could incorporate outcome quality, but current implementation is stable.

### D-4: Thermal Model Confidence Cap
**Location**: `src/services/thermal-model/thermal-analyzer.ts:215`
```typescript
const maxConfidencePoints = 168; // 1 week of hourly data
```
**Status**: Could be increased for seasonal coverage, but one week is reasonable for initial learning.

### D-5: Hot Water Analyzer Blend Factor Cap
**Location**: `src/services/hot-water/hot-water-analyzer.ts:206`
```typescript
const blendFactor = Math.min(0.8, confidence / 100);
```
**Status**: Similar to thermal model - caps at 80% new data. Could be addressed with PR-2 pattern.

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

| PR | Title | Impact | Status |
|----|-------|--------|--------|
| PR-1 | COP Adjustment Magnitudes | Allows adaptation of temperature penalties | ✅ COMPLETED |
| PR-2 | Thermal Model Blending | Removes anchor bias from learned values | ✅ COMPLETED |
| PR-3 | Hot Water Percentiles | Respects user price settings | Ready |
| PR-4 | Outdoor Adjustments | Building-specific outdoor response | Ready |
| PR-5 | Normalized COP Usage | Consistent COP interpretation | Ready |
| PR-6 | Planning Bias Constants | Centralized configuration | Ready |
| PR-7 | Energy Assumptions | Accurate savings calculations | Ready |

**Recommended order**: PR-1 → PR-2 → PR-3 → PR-5 → PR-4 → PR-6 → PR-7

This order prioritizes high-impact changes that unlock adaptive behavior, followed by consistency improvements, then lower-priority cleanup.
