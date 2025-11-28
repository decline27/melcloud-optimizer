# Post-Refactoring Cleanup Plan

## Overview

After the successful optimizer refactoring (3,248 → 2,425 lines), this document identifies **duplicate, redundant, and legacy code** that should be cleaned up. The goal is to keep only the best implementations and remove redundancy.

**Estimated Impact:** ~200-250 lines can be removed/consolidated

---

## Priority 1: Remove Legacy Files 🔴

### 1.1 Delete `/services/cop-helper.ts` (Root Level)

| Attribute | Details |
|-----------|---------|
| **File** | `/services/cop-helper.ts` (1 line) |
| **Problem** | Legacy re-export that creates confusion |
| **Content** | `export { COPHelper } from '../src/services/cop-helper';` |
| **Action** | DELETE the file |
| **Risk** | Medium - currently required by `api.ts` (two `require('./services/cop-helper')` call sites) and type imports in `src/` / tests |

```bash
# Check for imports before deletion
grep -r "from.*services/cop-helper" --include="*.ts" .
grep -r "require.*services/cop-helper" --include="*.ts" .
```

**Adjustment:** Before deleting, re-point all call sites to `src/services/cop-helper` (or expose through the orchestrator) and remove the root-level re-export. Deletion alone will break `api.ts` and type imports.

---

## Priority 2: Remove Deprecated Wrapper Methods 🟡

### 2.1 Deprecated Savings Wrappers in `optimizer.ts`

These methods in `optimizer.ts` just delegate to `SavingsService` and are marked `@deprecated`. They add ~80 lines of code with zero value.

| Method | Line | Delegates To | Used By |
|--------|------|--------------|---------|
| `estimateCostSavings()` | 2235 | `savingsService.estimateCostSavings()` | Internal only (lines 2039) |
| `calculateRealHourlySavings()` | 2250 | `savingsService.calculateRealHourlySavings()` | Internal only (lines 2003, 2012, 2021, 2054, 2070, 2082) |
| `calculateDailySavings()` | 2264 | `savingsService.calculateDailySavings()` | Unknown - needs check |
| `calculateEnhancedDailySavings()` | 2357 | `savingsService.calculateEnhancedDailySavings()` | Unknown - needs check |
| `calculateEnhancedDailySavingsUsingTibber()` | 2369 | `savingsService.calculateEnhancedDailySavingsUsingPriceProvider()` | Unknown - needs check |
| `calculateEnhancedDailySavingsWithBaseline()` | 2386 | `savingsService.calculateEnhancedDailySavingsWithBaseline()` | `src/api.ts` line 143 |

### Action Plan for Savings Wrappers

**Phase 1: Make internal methods use service directly**
- Update lines 2003, 2012, 2021, 2039, 2054, 2070, 2082 to call `this.savingsService.xxx()` directly
- Change `estimateCostSavings` and `calculateRealHourlySavings` from `public` → `private` → then remove

**Phase 2: Update external callers**
- `api.ts` invokes `calculateRealHourlySavings` (lines ~1004/1011/1018) and `calculateEnhancedDailySavingsWithBaseline` (lines ~767/1092/1160/2858). Decide on one of:
  - Expose `getSavingsService()` on optimizer and switch API to call the service directly, **or**
  - Lift a small helper into API that delegates to `SavingsService` without going through optimizer.
- Update unit tests hitting wrappers: `test/unit/optimizer.enhanced.coverage.test.ts` (`calculateDailySavings`), `test/unit/optimizer.calculate.test.ts` + `test/unit/optimizer.thermal-model.test.ts` (`estimateCostSavings`), and any jest mocks that assume the methods exist.
- Update docs referencing these methods (e.g., `review/context/FACTS.md` and HIGH_IMPACT docs) once wrappers are removed.

**Phase 3: Delete deprecated methods**
- After callers/tests/docs are migrated, remove all 6 wrapper methods (~80 lines).

**Guardrail:** Optimizer decision logic is protected—keep behavioral paths intact while rewiring callers to `SavingsService`.

---

## Priority 3: Consolidate Hot Water Pattern Learning 🟡

### 3.1 Duplicate Pattern Learning Logic

Two services implement similar hot water pattern learning:

| Service | File | Lines | Keep? |
|---------|------|-------|-------|
| `HotWaterAnalyzer` | `src/services/hot-water/hot-water-analyzer.ts` | 439 | ✅ **KEEP** |
| `HotWaterUsageLearner` | `src/services/hot-water-usage-learner.ts` | 312 | 🟡 **SIMPLIFY** |

### Why Keep `HotWaterAnalyzer`?

| Feature | HotWaterAnalyzer | HotWaterUsageLearner |
|---------|------------------|----------------------|
| **Persistence** | ✅ Saves to Homey settings | ❌ In-memory only |
| **Data Source** | ✅ Uses HotWaterDataCollector | ❌ External history array |
| **Pattern Depth** | ✅ Hour + Day + HourByDay | ❌ Hour only |
| **Confidence** | ✅ 0-100% with blending | ❌ Boolean hasConfident |
| **Predictions** | ✅ `predictUsage(hour, day)` | ❌ Only `getPeakHours()` |
| **Weekend Factor** | ✅ Yes | ❌ No |

### Recommended Consolidation

**Option A: Simplify HotWaterUsageLearner to Pure Adapter** (Recommended)
- Keep `HotWaterUsageLearner` as a thin adapter between `Optimizer` ↔ `HotWaterAnalyzer`
- Remove duplicate learning logic from `HotWaterUsageLearner`
- Add method `getPeakHours()` to `HotWaterAnalyzer` for compatibility
- Rewire existing callers (`Optimizer.learnHotWaterUsage` @ ~889, `EnergyMetricsService.refreshHotWaterUsagePattern` @ ~360) to pass/use the analyzer-backed adapter. Ensure Homey + collector dependencies are injected into `HotWaterAnalyzer`.
- Update `hot-water-usage-learner` unit tests to reflect the adapter behavior (no internal learning).

**Code to Remove from HotWaterUsageLearner:**
```typescript
// DELETE: Lines 103-153 - learnFromHistory() 
// DELETE: Lines 163-201 - refreshFromService() duplicate logic
// DELETE: Lines 203-221 - calculateHourlyDemand() 
// DELETE: Lines 223-240 - identifyPeakHours()
```

**Lines Saved:** ~100 lines

**New HotWaterUsageLearner (Adapter Only):**
```typescript
export class HotWaterUsageLearner {
  constructor(
    private readonly analyzer: HotWaterAnalyzer,
    private readonly logger?: HotWaterLearnerLogger
  ) {}

  getPeakHours(): readonly number[] {
    const patterns = this.analyzer.getPatterns();
    // Derive peak hours from hourlyUsagePattern
    return patterns.hourlyUsagePattern
      .map((usage, hour) => ({ hour, usage }))
      .filter(h => h.usage > 1.5)
      .sort((a, b) => b.usage - a.usage)
      .slice(0, 5)
      .map(h => h.hour);
  }

  getPattern(): HotWaterUsagePattern {
    // Convert HotWaterAnalyzer patterns to optimizer format
    const patterns = this.analyzer.getPatterns();
    return {
      hourlyDemand: patterns.hourlyUsagePattern,
      peakHours: this.getPeakHours() as number[],
      minimumBuffer: 0,
      lastLearningUpdate: new Date(patterns.lastUpdated),
      dataPoints: patterns.confidence * 1.68, // Approximate
    };
  }

  hasConfidentPattern(): boolean {
    return this.analyzer.getPatterns().confidence >= 30;
  }

  getEstimatedDailyConsumption(): number {
    return this.analyzer.getPatterns().hourlyUsagePattern.reduce((s, v) => s + v, 0);
  }
}
```
**Note:** Add a `getPeakHours()` helper to `HotWaterAnalyzer` (non-breaking; do not alter learning math) and ensure existing persistence (`Homey.settings`) remains untouched.

---

## Priority 4: Unify COP Handling 🟢

### 4.1 COP Services Analysis

| Service | File | Purpose | Keep? |
|---------|------|---------|-------|
| `CopNormalizer` | `src/services/cop-normalizer.ts` | Real-time normalization | ✅ KEEP |
| `COPHelper` | `src/services/cop-helper.ts` | Historical tracking | ✅ KEEP |

**Finding: No duplication** - these are complementary:
- `CopNormalizer`: Normalizes a single COP value to 0-1 range using adaptive bounds
- `COPHelper`: Tracks historical COP data (daily/weekly/monthly) and provides seasonal adjustments

**No action needed** - well-designed separation of concerns.

---

## Priority 5: Minor Cleanups 🟢

### 5.1 Unused Imports Check

Run after each cleanup:
```bash
npm run lint 2>&1 | grep "is defined but never used"
```

### 5.2 Dead Code Detection

```bash
# Find potentially unused exports
npx ts-prune src/
```

---

## Implementation Order

| Phase | Task | Lines Removed | Risk |
|-------|------|---------------|------|
| 1 | Rewire `services/cop-helper` imports, then delete root re-export | 1 | Medium |
| 2 | Update internal savings calls to use service directly | 0 | Low |
| 3 | Migrate API/tests/docs off optimizer savings wrappers, then remove them | ~80 | Medium |
| 4 | Simplify HotWaterUsageLearner to analyzer-backed adapter (plus `HotWaterAnalyzer.getPeakHours`) | ~100 | Medium |
| 5 | Final lint/dead-code cleanup | ~20 | Low |

**Total Lines Removed:** ~200 lines

---

## Test Strategy

After each phase:
1. Run `npm run test:unit` - all 806 tests must pass
2. Run `npm run lint` - no new errors
3. Run `npm run build` - successful compilation

---

## Service Responsibility Matrix (After Cleanup)

| Domain | Primary Service | Role |
|--------|-----------------|------|
| **Savings** | `SavingsService` | All savings calculations |
| **COP Normalization** | `CopNormalizer` | Real-time COP normalization |
| **COP History** | `COPHelper` | Historical COP tracking |
| **Hot Water Patterns** | `HotWaterAnalyzer` | Pattern learning & prediction |
| **Hot Water Adapter** | `HotWaterUsageLearner` | Optimizer ↔ Analyzer bridge |
| **Temperature** | `TemperatureOptimizer` | Price-based temp calculation |
| **Thermal** | `ThermalController` | Thermal mass strategy |
| **Calibration** | `CalibrationService` | Weekly calibration |
| **Adaptive Learning** | `AdaptiveParametersLearner` | Business parameter learning |
| **Price** | `PriceAnalyzer` + `PriceClassifier` | Price classification |
| **Energy** | `EnergyMetricsService` | MELCloud energy data |

---

## Decision Log

| Decision | Rationale |
|----------|-----------|
| Keep `HotWaterAnalyzer` over `HotWaterUsageLearner` | Better persistence, richer patterns, day-of-week support |
| Keep both `CopNormalizer` and `COPHelper` | Complementary, not duplicate |
| Remove savings wrappers | Zero value-add, just delegation |
| Delete legacy re-export | Confusion, outdated path |

---

*Document created: November 28, 2025*
