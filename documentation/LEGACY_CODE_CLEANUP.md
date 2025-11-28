# Legacy Code Cleanup Analysis

**Analysis Date:** November 28, 2025  
**Branch:** `refactor_optimazer`  
**Status:** ✅ COMPLETED

## Summary

During analysis of the previous refactoring to the service-based architecture, the following legacy/dead code was identified and cleaned up:

| Item | Lines Removed | Impact | Status |
|------|---------------|--------|--------|
| `calculatePriceLevel` method | 8 lines | 🟢 None - unused | ✅ Removed |
| `calculateComfortImpact` method | 19 lines | 🟢 None - unused | ✅ Removed |
| Orphaned JSDoc fragment | 8 lines | 🟢 None - dead code | ✅ Removed |
| `optimizer.ts.backup` file | 3,036 lines | 🟢 None - should not be in repo | ✅ Deleted |
| Dead tests for removed methods | ~40 lines | 🟢 None - tested dead code | ✅ Removed |

**Total cleanup: ~3,111 lines of dead code removed**

---

## 1. Orphaned Code Fragment in `optimizer.ts` ✅ FIXED

**Location:** Lines 993-1000 (now removed)

**Issue:** Truncated JSDoc comment and orphaned code fragment - appears to be leftovers from extracting hot water scheduling to `HotWaterOptimizer`

```typescript
  /**
   * Optimize hot water scheduling based on usage patterns
      // Cheap electricity (based on user's threshold) + decent COP
      return 'heat_now';
    }

    return 'maintain';
  }
```

**Action:** ✅ Deleted these lines

---

## 2. Unused Private Method: `calculatePriceLevel` ✅ FIXED

**Location:** Lines 854-857 (now removed)

```typescript
private calculatePriceLevel(percentile: number): string {
  return this.priceAnalyzer.getPriceLevel(percentile);
}
```

**Issue:** This is just a passthrough to `priceAnalyzer.getPriceLevel()` and is never called anywhere.

**Action:** ✅ Deleted method (lines 850-857 including JSDoc)

---

## 3. Unused Private Method: `calculateComfortImpact` ✅ FIXED

**Location:** Lines 3214-3223 (now removed)

```typescript
private calculateComfortImpact(oldTemp: number, newTemp: number): number {
  // Simple model: deviation from 21°C reduces comfort
  const idealTemp = 21;
  const oldDeviation = Math.abs(oldTemp - idealTemp);
  const newDeviation = Math.abs(newTemp - idealTemp);
  return oldDeviation - newDeviation;
}
```

**Issue:** Never called anywhere in the codebase.

**Action:** ✅ Deleted method (lines 3205-3223 including JSDoc)

---

## 4. Backup File Should Be Removed ✅ FIXED

**Location:** `src/services/optimizer.ts.backup` (3,036 lines)

**Issue:** This is a full backup of an older version of the optimizer. It should not be in the repository.

**Action:** ✅ File deleted

---

## 5. Unused Global Type Declarations ✅ VERIFIED OK

**Location:** `src/global.d.ts`

```typescript
declare global {
  var copHelper: COPHelper | null;
  var melCloud: MelCloudApi | null;
  var tibber: PriceProvider | null;
  var optimizer: Optimizer | null;
}
```

**Initial Analysis:** These global declarations appeared unused (no `global.copHelper`, `global.melCloud`, etc. in codebase).

**Resolution:** Upon investigation, these ARE actively used by `api.ts` for cleanup operations during settings changes. The declarations are correct and needed.

**Action:** ✅ Verified declarations are needed - kept unchanged

---

## 6. Duplicated COP Normalization Logic (Future Work)

**Location:** 
- `optimizer.ts` lines 794-847 (`updateCOPRange`, `normalizeCOP`)
- `thermal-controller.ts` line 90 (rough normalization fallback)
- `hot-water-optimizer.ts` line 47 (rough normalization fallback)

**Issue:** COP normalization logic exists in optimizer but extracted services have their own rough fallback implementations. This creates inconsistency.

**Action:** 
- PR 1 of refactoring plan extracts this to `CopNormalizer` service
- Extracted services should use the shared normalizer

---

## 7. Legacy Support Code (Keep for Now)

These items are intentional legacy support for backwards compatibility:

| Location | Purpose | Status |
|----------|---------|--------|
| `entsoe-price-service.ts:75-79` | Legacy SEK FX rate key | ✅ Keep for migration |
| `accounting-service.ts:54-70` | Legacy savings migration | ✅ Keep for migration |
| `optimizer.ts:1183` | Legacy COP field fallback | ✅ Keep for API compat |

---

## Cleanup Completed ✅

All immediate cleanup items have been addressed:

### Changes Applied to `src/services/optimizer.ts`:

1. ✅ **Deleted lines 993-1000** (orphaned code fragment)
2. ✅ **Deleted lines 850-857** (unused `calculatePriceLevel` method)  
3. ✅ **Deleted lines 3205-3223** (unused `calculateComfortImpact` method)

### Files Deleted:

1. ✅ `src/services/optimizer.ts.backup`

### Test Updates:

1. ✅ Removed tests for `calculateComfortImpact` in `test/unit/optimizer.direct.test.ts`
2. ✅ Removed tests for `calculateComfortImpact` in `test/unit/optimizer.enhanced.test.ts`

### Kept As-Is:

1. ✅ `src/global.d.ts` - declarations ARE used by `api.ts` for service cleanup

---

## Verification Results

```bash
# TypeScript compilation check
npm run build:ts
# ✅ PASSED - No errors

# Unit tests (optimizer-related)
npm run test:unit -- --testPathPattern="optimizer"
# ✅ PASSED - 17 passed test suites, 124 passed tests, 0 failed
```

---

## Impact Summary

| Action | Lines Removed | Status |
|--------|--------------|--------|
| Orphaned fragment | 8 lines | ✅ Done |
| `calculatePriceLevel` | 8 lines | ✅ Done |
| `calculateComfortImpact` | 19 lines | ✅ Done |
| Backup file | 3,036 lines | ✅ Done |
| Dead test code | ~40 lines | ✅ Done |
| **Total** | **~3,111 lines** | ✅ **Complete** |

All tests should pass unchanged since we're only removing dead code.
