# PR #16: Fix Thermal Strategies to Respect User Comfort Band

**Status**: ✅ Implemented  
**Priority**: HIGH (Bug Fix)  
**Estimated Effort**: 2 hours  
**Risk Level**: LOW

---

## Problem Statement

The thermal controller's preheat/coast/boost strategies currently **ignore user-configured comfort band settings** and use hardcoded temperature limits instead.

### Current Broken Behavior

1. User sets comfort band in settings:
   - Occupied: `comfort_lower_occupied = 20.0°C`, `comfort_upper_occupied = 21.0°C`
   - Away: `comfort_lower_away = 19.0°C`, `comfort_upper_away = 20.5°C`

2. `getCurrentComfortBand()` correctly loads these settings with safety caps (16-26°C)

3. **BUT** `thermal-controller.ts` completely ignores this and uses hardcoded values:
   - Line 127: `Math.max(targetTemp - coastingReduction, 16)` ← hardcoded 16°C
   - Line 146: `Math.min(targetTemp + boostIncrease, 26)` ← hardcoded 26°C
   - Line 106: Uses `thermalMassModel.maxPreheatingTemp` (23°C) instead of user's max

### Impact

- **Coast strategy** can reduce temperature to 16°C even if user's minimum is 20°C
- **Boost strategy** can increase temperature to 26°C even if user's maximum is 21°C
- **Preheat strategy** can heat to 23°C even if user's maximum is 21°C
- User comfort preferences are violated by the optimizer

---

## Proposed Changes

### File: `src/services/thermal-controller.ts`

#### Change 1: Add `comfortBand` parameter to method signature

**Location**: Line 49

**Before**:
```typescript
public calculateThermalMassStrategy(
    currentTemp: number,
    targetTemp: number,
    currentPrice: number,
    futurePrices: any[],
    copData: { heating: number; hotWater: number; outdoor: number },
    priceAnalyzer: PriceAnalyzer,
    preheatCheapPercentile: number,
    referenceTimeMs?: number
): ThermalStrategy {
```

**After**:
```typescript
public calculateThermalMassStrategy(
    currentTemp: number,
    targetTemp: number,
    currentPrice: number,
    futurePrices: any[],
    copData: { heating: number; hotWater: number; outdoor: number },
    priceAnalyzer: PriceAnalyzer,
    preheatCheapPercentile: number,
    comfortBand: { minTemp: number; maxTemp: number },
    referenceTimeMs?: number
): ThermalStrategy {
```

#### Change 2: Fix preheat strategy to respect max temp

**Location**: Line 104-107

**Before**:
```typescript
const preheatingTarget = Math.min(
    targetTemp + (heatingEfficiency * adaptiveThresholds.preheatAggressiveness),
    this.thermalMassModel.maxPreheatingTemp
);
```

**After**:
```typescript
const preheatingTarget = Math.min(
    targetTemp + (heatingEfficiency * adaptiveThresholds.preheatAggressiveness),
    comfortBand.maxTemp  // Use user's max temp instead of hardcoded 23°C
);
```

#### Change 3: Fix coast strategy to respect min temp

**Location**: Line 127

**Before**:
```typescript
const coastingTarget = Math.max(targetTemp - adaptiveThresholds.coastingReduction, 16); // Min temp hardcoded for now
```

**After**:
```typescript
const coastingTarget = Math.max(targetTemp - adaptiveThresholds.coastingReduction, comfortBand.minTemp);
```

#### Change 4: Fix boost strategy to respect max temp

**Location**: Line 146

**Before**:
```typescript
const boostTarget = Math.min(targetTemp + adaptiveThresholds.boostIncrease, 26); // Max temp hardcoded
```

**After**:
```typescript
const boostTarget = Math.min(targetTemp + adaptiveThresholds.boostIncrease, comfortBand.maxTemp);
```

---

### File: `src/services/optimizer.ts`

#### Change 5: Pass comfort band to thermal controller

**Location**: Line 1393-1406 (in `optimizeZone1()`)

**Before**:
```typescript
thermalStrategy = this.thermalController.calculateThermalMassStrategy(
  currentTemp || 20,
  targetTemp,
  priceStats.currentPrice,
  priceData.prices,
  {
    heating: optimizationResult.metrics.realHeatingCOP,
    hotWater: optimizationResult.metrics.realHotWaterCOP,
    outdoor: outdoorTemp
  },
  this.priceAnalyzer,
  this.priceAnalyzer.getCheapPercentile(),
  planningReferenceTimeMs
);
```

**After**:
```typescript
thermalStrategy = this.thermalController.calculateThermalMassStrategy(
  currentTemp || 20,
  targetTemp,
  priceStats.currentPrice,
  priceData.prices,
  {
    heating: optimizationResult.metrics.realHeatingCOP,
    hotWater: optimizationResult.metrics.realHotWaterCOP,
    outdoor: outdoorTemp
  },
  this.priceAnalyzer,
  this.priceAnalyzer.getCheapPercentile(),
  constraintsBand,  // Pass the comfort band
  planningReferenceTimeMs
);
```

---

## Verification Plan

### Unit Tests

**File**: `test/unit/thermal-controller.test.ts`

```typescript
describe('ThermalController - Comfort Band Respect', () => {
  it('should respect comfort band min temp in coast strategy', () => {
    const comfortBand = { minTemp: 20.0, maxTemp: 21.0 };
    
    const strategy = thermalController.calculateThermalMassStrategy(
      21.0,  // currentTemp
      20.5,  // targetTemp
      2.0,   // expensive price
      prices,
      { heating: 3.0, hotWater: 2.5, outdoor: 5.0 },
      priceAnalyzer,
      0.25,
      comfortBand
    );
    
    if (strategy.action === 'coast') {
      expect(strategy.targetTemp).toBeGreaterThanOrEqual(20.0);  // User's min
      expect(strategy.targetTemp).not.toBe(16.0);  // Old hardcoded min
    }
  });
  
  it('should respect comfort band max temp in preheat strategy', () => {
    const comfortBand = { minTemp: 20.0, maxTemp: 21.0 };
    
    const strategy = thermalController.calculateThermalMassStrategy(
      20.0,  // currentTemp
      20.5,  // targetTemp
      0.5,   // cheap price
      prices,
      { heating: 4.0, hotWater: 3.0, outdoor: 5.0 },
      priceAnalyzer,
      0.25,
      comfortBand
    );
    
    if (strategy.action === 'preheat') {
      expect(strategy.targetTemp).toBeLessThanOrEqual(21.0);  // User's max
      expect(strategy.targetTemp).not.toBe(23.0);  // Old hardcoded max
    }
  });
  
  it('should respect comfort band max temp in boost strategy', () => {
    const comfortBand = { minTemp: 20.0, maxTemp: 21.0 };
    
    const strategy = thermalController.calculateThermalMassStrategy(
      19.0,  // currentTemp (below target)
      20.5,  // targetTemp
      0.4,   // cheap price
      prices,
      { heating: 4.5, hotWater: 3.5, outdoor: 5.0 },
      priceAnalyzer,
      0.25,
      comfortBand
    );
    
    if (strategy.action === 'boost') {
      expect(strategy.targetTemp).toBeLessThanOrEqual(21.0);  // User's max
      expect(strategy.targetTemp).not.toBe(26.0);  // Old hardcoded max
    }
  });
});
```

### Integration Test

**File**: `test/integration/optimizer-comfort-band.test.ts`

```typescript
describe('Optimizer - Comfort Band Integration', () => {
  it('should respect user comfort band throughout optimization', async () => {
    // Set user comfort band
    homey.settings.set('comfort_lower_occupied', 20.0);
    homey.settings.set('comfort_upper_occupied', 21.0);
    homey.settings.set('occupied', true);
    
    const result = await optimizer.runOptimization();
    
    // Verify final target respects comfort band
    expect(result.toTemp).toBeGreaterThanOrEqual(20.0);
    expect(result.toTemp).toBeLessThanOrEqual(21.0);
    
    // Verify thermal strategy (if applied) respects comfort band
    if (result.thermalStrategy) {
      expect(result.thermalStrategy.targetTemp).toBeGreaterThanOrEqual(20.0);
      expect(result.thermalStrategy.targetTemp).toBeLessThanOrEqual(21.0);
    }
  });
});
```

### Manual Verification

1. **Set custom comfort band**:
   ```javascript
   // In Homey settings
   comfort_lower_occupied = 20.0
   comfort_upper_occupied = 21.0
   ```

2. **Run optimizer and check logs**:
   ```bash
   homey app run
   ```

3. **Verify in logs**:
   - Look for thermal strategy logs
   - Confirm preheat never exceeds 21.0°C
   - Confirm coast never goes below 20.0°C
   - Confirm boost never exceeds 21.0°C

4. **Test edge cases**:
   - Very cheap prices (should trigger preheat)
   - Very expensive prices (should trigger coast)
   - Good COP + cheap prices (should trigger boost)
   - Verify all respect the 20-21°C band

---

## Success Metrics

- ✅ Thermal strategies never violate user comfort band
- ✅ Coast strategy uses `comfortBand.minTemp` instead of hardcoded 16°C
- ✅ Boost strategy uses `comfortBand.maxTemp` instead of hardcoded 26°C
- ✅ Preheat strategy uses `comfortBand.maxTemp` instead of hardcoded 23°C
- ✅ User can verify in logs that limits match their settings
- ✅ No regression in thermal strategy effectiveness
- ✅ All existing tests still pass

---

## Rollback Plan

If issues arise:

1. **Revert commit**:
   ```bash
   git revert <commit-hash>
   ```

2. **Verify tests pass**:
   ```bash
   npm test
   ```

3. **Deploy reverted version**:
   ```bash
   homey app run
   ```

The change is backward compatible - if `comfortBand` parameter is not provided, TypeScript will error at compile time, making it safe.

---

## Migration Notes

**Breaking Changes**: None - this is a bug fix

**User Action Required**: None - existing comfort band settings will automatically be respected

**Performance Impact**: None - same number of calculations, just using different limits

---

## Related Issues

- Fixes hardcoded temperature limits in thermal strategies
- Improves user experience by respecting preferences
- Aligns thermal controller behavior with rest of optimizer (which already respects comfort bands)

---

## Implementation Checklist

- [x] Update `thermal-controller.ts` method signature
- [x] Fix preheat strategy to use `comfortBand.maxTemp`
- [x] Fix coast strategy to use `comfortBand.minTemp`
- [x] Fix boost strategy to use `comfortBand.maxTemp`
- [x] Update `optimizer.ts` to pass comfort band
- [x] Add unit tests for comfort band respect
- [x] Add integration test
- [x] Run full test suite
- [x] Manual verification with custom comfort band
- [x] Update documentation
- [x] Mark as complete in implementation plan
