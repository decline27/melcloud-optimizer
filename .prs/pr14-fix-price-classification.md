# PR #14: Fix Price Classification to Always Calculate Percentile

**Status**: ✅ Implemented  
**Priority**: HIGH (Correctness)  
**Estimated Effort**: 1 hour  
**Risk Level**: LOW

---

## Problem Statement

The `PriceAnalyzer` currently takes a "shortcut" for Tibber price providers. If Tibber provides a pre-calculated price level (e.g., "CHEAP"), the code uses it directly and returns `NaN` for critical statistics like `normalized`, `min`, `max`, and `avg`.

### Current Broken Flow

In `src/services/price-analyzer.ts`:
```typescript
// Lines 56-70
if (this.priceProvider?.constructor?.name === 'TibberApi' && nativeLevel) {
  const mapped = this.mapTibberLevel(nativeLevel);
  return {
    label: mapped,
    percentile: this.estimatePercentileFromLevel(mapped), // ❌ Estimation
    thresholds: resolvePriceThresholds({...}),
    normalized: NaN, // ❌ Missing data
    min: NaN,        // ❌ Missing data
    max: NaN,        // ❌ Missing data
    avg: NaN         // ❌ Missing data
  };
}
```

### Impact

1.  **Blind Optimization**: Strategies that rely on `avg` price (like boost logic) fail or behave unpredictably because they receive `NaN`.
2.  **Inaccurate Percentiles**: The system uses rough estimates (e.g., CHEAP = 25th percentile) instead of the actual mathematical percentile (e.g., 18th percentile), leading to suboptimal decisions.
3.  **Inconsistent Behavior**: The algorithm behaves differently depending on the price provider, making it hard to test and validate.

---

## Proposed Changes

### File: `src/services/price-analyzer.ts`

#### Change 1: Remove the Tibber shortcut

**Action**: Delete the entire `if` block (lines 56-70) that handles the Tibber shortcut.

**Result**: The code will fall through to the standard `classifyPriceUnified` function (line 74), which:
1.  Calculates the actual percentile based on the full price list.
2.  Computes accurate `min`, `max`, and `avg` statistics.
3.  Returns a complete `PriceClassificationStats` object.

**Before**:
```typescript
public analyzePrice(currentPrice: number, futurePrices: PricePoint[] | Pick<TibberPriceInfo, 'prices' | 'priceLevel'>): PriceClassificationStats {
    const priceList = Array.isArray(futurePrices) ? futurePrices : futurePrices.prices;
    const nativeLevel = Array.isArray(futurePrices) ? undefined : futurePrices.priceLevel;

    // SHORTCUT BLOCK TO REMOVE
    if (this.priceProvider?.constructor?.name === 'TibberApi' && nativeLevel) {
       // ... returns NaN stats
    }

    const adaptiveThresholds = this.adaptiveLearner?.getStrategyThresholds();
    return classifyPriceUnified(...)
}
```

**After**:
```typescript
public analyzePrice(currentPrice: number, futurePrices: PricePoint[] | Pick<TibberPriceInfo, 'prices' | 'priceLevel'>): PriceClassificationStats {
    const priceList = Array.isArray(futurePrices) ? futurePrices : futurePrices.prices;
    
    // Shortcut removed - always calculate full stats
    
    const adaptiveThresholds = this.adaptiveLearner?.getStrategyThresholds();

    return classifyPriceUnified(priceList, currentPrice, {
      cheapPercentile: this.preheatCheapPercentile,
      veryCheapMultiplier: adaptiveThresholds?.veryChepMultiplier
    });
}
```

---

## Verification Plan

### Unit Tests

1.  **Verify Tibber Behavior**:
    - Create a test case with Tibber-like data (including `priceLevel`).
    - Call `analyzePrice`.
    - Assert that `min`, `max`, and `avg` are **numbers**, not `NaN`.
    - Assert that `percentile` is calculated correctly from the prices, not just estimated from the label.

2.  **Regression Testing**:
    - Ensure existing tests for non-Tibber providers still pass.

### Manual Verification

1.  **Run Optimization**:
    - Trigger an optimization run.
    - Check logs for "Price analysis".
    - Verify that `avg`, `min`, and `max` values are present and correct in the logs.

---

## Success Metrics

- ✅ `analyzePrice` never returns `NaN` for statistics.
- ✅ Percentiles are calculated mathematically for all providers.
- ✅ All unit tests pass.

---

## Rollback Plan

If issues arise:
1.  **Revert commit**: `git revert <commit-hash>`
2.  **Verify**: Ensure tests pass.

---

## Implementation Checklist

- [x] Remove Tibber shortcut block in `src/services/price-analyzer.ts`
- [x] Remove unused helper methods (`mapTibberLevel`, `estimatePercentileFromLevel`) if they are no longer needed (or keep them if used elsewhere).
- [x] Run unit tests to verify fix.
- [x] Update documentation.
