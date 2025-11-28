# Optimizer Refactoring Plan

## Safe, Incremental Breakdown of `optimizer.ts` (3,248 lines → ~500-600 lines)

**Goal:** Break down the monolithic optimizer into focused, testable modules without breaking any optimization logic or existing functionality.

**Guiding Principles:**
1. ✅ **Test-First Validation** - Run full test suite after each PR
2. ✅ **No Logic Changes** - Pure extraction, no behavioral modifications
3. ✅ **Backwards Compatibility** - Keep public API stable
4. ✅ **One Module Per PR** - Easy to review and revert if needed
5. ✅ **Re-export Pattern** - Optimizer class re-exports for compatibility

---

## Current State Analysis

### Already Extracted Services ✅
These modules already exist and are being used:
- `thermal-controller.ts` (213 lines) - Thermal mass strategy
- `hot-water-optimizer.ts` (309 lines) - Hot water scheduling
- `zone-optimizer.ts` (155 lines) - Zone 2 optimization
- `price-analyzer.ts` - Price classification
- `constraint-manager.ts` - Temperature constraints
- `state-manager.ts` - Zone state tracking
- `settings-loader.ts` - Settings access

### Remaining in `optimizer.ts` (To Extract)
| Line Range | Responsibility | Target Module | Lines |
|------------|---------------|---------------|-------|
| 794-847 | COP Range Tracking & Normalization | `cop-normalizer.ts` | ~55 |
| 887-995 | Hot Water Usage Learning | `hot-water-usage-learner.ts` | ~110 |
| 1037-1200 | Real Energy Metrics | `energy-metrics-service.ts` | ~165 |
| 1217-1400 | Temperature Calculation with Real Data | `temperature-optimizer.ts` | ~185 |
| 2407-2520 | Savings Calculation | `savings-service.ts` | ~115 |
| 2653-2740 | Cost Estimation | *(merge into savings-service.ts)* | ~90 |
| 2772-2900 | Weekly Calibration | `calibration-service.ts` | ~130 |
| 2944-3040 | Basic Temperature Calculation | *(merge into temperature-optimizer.ts)* | ~100 |
| 3046-3200 | Enhanced Daily Savings | *(merge into savings-service.ts)* | ~155 |

---

## PR Execution Plan

### PR 1: Extract COP Normalizer Service
**Branch:** `refactor/extract-cop-normalizer`  
**Risk Level:** 🟢 Low  
**Estimated Lines:** ~80 new + ~55 removed from optimizer

#### What Gets Extracted
```
src/services/cop-normalizer.ts (NEW)
├── COPNormalizer class
├── updateCOPRange(cop: number): void
├── normalizeCOP(cop: number): number
├── getCOPRange(): { min, max, history, updateCount }
├── loadFromSettings(homey): void
├── saveToSettings(homey): void
```

#### Changes to optimizer.ts
- Remove `copRange` property and related methods
- Import and use `COPNormalizer` instance
- Delegate `updateCOPRange()` and `normalizeCOP()` calls

#### Test Validation
```bash
npm run test:unit -- --testPathPattern="cop|optimizer"
```

#### Acceptance Criteria
- [ ] All existing optimizer tests pass
- [ ] New `cop-normalizer.test.ts` with 100% coverage
- [ ] COP normalization behavior unchanged (snapshot tests)
- [ ] Settings persistence works correctly

---

### PR 2: Extract Hot Water Usage Learner
**Branch:** `refactor/extract-hot-water-learner`  
**Risk Level:** 🟢 Low  
**Estimated Lines:** ~130 new + ~110 removed from optimizer

#### What Gets Extracted
```
src/services/hot-water-usage-learner.ts (NEW)
├── HotWaterUsageLearner class
├── learnFromHistory(usageHistory[]): void
├── refreshFromService(hotWaterService): void
├── getUsagePattern(): HotWaterUsagePattern
├── getDefaultPeakHours(): number[]
```

#### Changes to optimizer.ts
- Remove `hotWaterUsagePattern` property
- Remove `learnHotWaterUsage()` method
- Remove `refreshHotWaterUsagePattern()` method
- Import and use `HotWaterUsageLearner` instance

#### Test Validation
```bash
npm run test:unit -- --testPathPattern="hot-water|optimizer"
```

#### Acceptance Criteria
- [ ] All existing hot water tests pass
- [ ] Pattern learning produces identical results
- [ ] Peak hours detection unchanged

---

### PR 3: Extract Energy Metrics Service
**Branch:** `refactor/extract-energy-metrics`  
**Risk Level:** 🟡 Medium (touches MELCloud API)  
**Estimated Lines:** ~200 new + ~165 removed from optimizer

#### What Gets Extracted
```
src/services/energy-metrics-service.ts (NEW)
├── EnergyMetricsService class
├── getRealEnergyMetrics(): Promise<OptimizationMetrics | null>
├── getLastEnergyData(): RealEnergyData | null
├── determineSeason(heatingConsumed, hotWaterConsumed): SeasonalMode
├── determineOptimizationFocus(trends, metrics): OptimizationFocus
```

#### Changes to optimizer.ts
- Remove `lastEnergyData` property
- Remove `optimizationMetrics` property
- Remove `getRealEnergyMetrics()` method
- Import and use `EnergyMetricsService` instance

#### Dependencies
- `MelCloudApi` - for API calls
- `COPNormalizer` - for COP range updates
- `HotWaterUsageLearner` - for pattern refresh

#### Test Validation
```bash
npm run test:unit -- --testPathPattern="energy|metrics|optimizer"
```

#### Acceptance Criteria
- [ ] All optimizer enhanced tests pass
- [ ] Seasonal mode detection unchanged
- [ ] COP metrics calculation unchanged
- [ ] Integration test with real MELCloud data

---

### PR 4: Extract Temperature Optimizer
**Branch:** `refactor/extract-temperature-optimizer`  
**Risk Level:** 🟡 Medium (core optimization logic)  
**Estimated Lines:** ~250 new + ~285 removed from optimizer

#### What Gets Extracted
```
src/services/temperature-optimizer.ts (NEW)
├── TemperatureOptimizer class
├── calculateOptimalTemperature(prices, currentTemp): number
├── calculateOptimalTemperatureWithRealData(prices, metrics): { targetTemp, reason, metrics }
├── applySeasonalAdjustments(target, metrics, outdoorTemp): number
├── applyCOPAdjustments(target, cop, copWeight): number
```

#### Changes to optimizer.ts
- Remove `calculateOptimalTemperature()` method
- Remove `calculateOptimalTemperatureWithRealData()` method
- Import and use `TemperatureOptimizer` instance

#### Dependencies
- `COPNormalizer` - for COP efficiency
- `AdaptiveParametersLearner` - for learned weights
- `COPHelper` - for seasonal COP

#### Test Validation
```bash
npm run test:unit -- --testPathPattern="temperature|optimizer.calculate|optimizer.enhanced"
```

#### Acceptance Criteria
- [ ] Temperature calculations produce identical results
- [ ] Seasonal adjustments unchanged
- [ ] COP-based adjustments unchanged
- [ ] Snapshot tests for edge cases

---

### PR 5: Extract Savings Service
**Branch:** `refactor/extract-savings-service`  
**Risk Level:** 🟢 Low  
**Estimated Lines:** ~300 new + ~360 removed from optimizer

#### What Gets Extracted
```
src/services/savings-service.ts (NEW)
├── SavingsService class
├── calculateSavings(oldTemp, newTemp, price, kind): number
├── calculateRealHourlySavings(from, to, price, metrics, kind): Promise<number>
├── calculateDailySavings(hourlyResults): Promise<number>
├── calculateEnhancedDailySavings(current, historical, factors): SavingsCalculationResult
├── calculateEnhancedDailySavingsWithBaseline(...): Promise<SavingsCalculationResult>
├── estimateCostSavings(target, original, price, avg, metrics): string
```

#### Changes to optimizer.ts
- Remove all savings calculation methods
- Import and use `SavingsService` instance

#### Dependencies
- `EnhancedSavingsCalculator` - for advanced calculations
- `PriceAnalyzer` - for price data
- `EnergyMetricsService` - for consumption data

#### Test Validation
```bash
npm run test:unit -- --testPathPattern="savings|optimizer"
```

#### Acceptance Criteria
- [ ] All savings calculations unchanged
- [ ] Currency and grid fee handling correct
- [ ] Baseline comparison logic preserved

---

### PR 6: Extract Calibration Service
**Branch:** `refactor/extract-calibration-service`  
**Risk Level:** 🟢 Low  
**Estimated Lines:** ~170 new + ~130 removed from optimizer

#### What Gets Extracted
```
src/services/calibration-service.ts (NEW)
├── CalibrationService class
├── runWeeklyCalibration(): Promise<CalibrationResult>
├── calibrateThermalModel(thermalModelService): CalibrationResult
├── calibrateBasic(currentK): number
├── learnFromOptimizationOutcome(savings, violations, cop): void
```

#### Changes to optimizer.ts
- Remove `runWeeklyCalibration()` method
- Remove `learnFromOptimizationOutcome()` method
- Import and use `CalibrationService` instance

#### Dependencies
- `ThermalController` - for model updates
- `ThermalModelService` - for characteristics
- `AdaptiveParametersLearner` - for outcome learning

#### Test Validation
```bash
npm run test:unit -- --testPathPattern="calibration|thermal-model|optimizer"
```

#### Acceptance Criteria
- [ ] Weekly calibration produces same results
- [ ] Learning outcome updates unchanged
- [ ] Thermal model persistence correct

---

### PR 7: Cleanup & Final Integration
**Branch:** `refactor/optimizer-cleanup`  
**Risk Level:** 🟡 Medium (final integration)  
**Estimated Lines:** Optimizer reduced to ~500-600 lines

#### What Remains in optimizer.ts
```
src/services/optimizer.ts (~500-600 lines)
├── Optimizer class (orchestrator only)
├── Constructor & initialization
├── runOptimization() - coordination only
├── optimizeZone1() - delegates to TemperatureOptimizer
├── optimizeZone2() - delegates to ZoneOptimizer
├── optimizeTank() - delegates to HotWaterOptimizer
├── collectOptimizationInputs()
├── applySetpointChanges()
├── buildOptimizationResult()
├── Public API methods (thin wrappers)
├── cleanup()
```

#### New Architecture Diagram
```
                    ┌─────────────────────────────────────────┐
                    │              Optimizer                   │
                    │           (Orchestrator)                 │
                    └─────────────┬───────────────────────────┘
                                  │
        ┌─────────────────────────┼─────────────────────────┐
        │                         │                         │
        ▼                         ▼                         ▼
┌───────────────┐      ┌─────────────────┐       ┌─────────────────┐
│ Temperature   │      │   Savings       │       │   Calibration   │
│  Optimizer    │      │   Service       │       │   Service       │
└───────────────┘      └─────────────────┘       └─────────────────┘
        │                         │
        ▼                         ▼
┌───────────────┐      ┌─────────────────┐
│     COP       │      │   Energy        │
│  Normalizer   │      │   Metrics       │
└───────────────┘      └─────────────────┘
        │                         │
        ▼                         ▼
┌───────────────┐      ┌─────────────────┐
│  Hot Water    │      │    Thermal      │
│ Usage Learner │      │   Controller    │
└───────────────┘      └─────────────────┘
```

#### Full Test Suite
```bash
npm run test:unit  # All 75+ unit test files
npm run test       # Integration tests
```

#### Acceptance Criteria
- [ ] All tests pass (unit + integration)
- [ ] optimizer.ts < 700 lines
- [ ] No behavioral changes
- [ ] Memory usage stable or improved
- [ ] Build passes with no new warnings

---

## Testing Strategy

### For Each PR

1. **Before Starting**
   ```bash
   git checkout main
   npm run test:unit  # Baseline - all should pass
   git checkout -b refactor/extract-[module-name]
   ```

2. **After Extraction**
   ```bash
   # Run specific related tests
   npm run test:unit -- --testPathPattern="[module]|optimizer"
   
   # Run full unit suite
   npm run test:unit
   
   # Check for TypeScript errors
   npm run build:ts
   ```

3. **Snapshot Testing for Critical Logic**
   ```typescript
   // test/unit/[module].snapshot.test.ts
   describe('[Module] Output Consistency', () => {
     it('should produce same output as original', () => {
       const result = newModule.calculate(...inputs);
       expect(result).toMatchSnapshot();
     });
   });
   ```

4. **Integration Validation**
   ```bash
   npm run test  # Full integration test
   ```

---

## Rollback Strategy

Each PR is independent and can be reverted:

```bash
# If a PR causes issues
git revert [commit-hash]
git push

# The Optimizer class maintains backward compatibility
# through thin wrapper methods that delegate to services
```

---

## Timeline Estimate

| PR | Module | Est. Hours | Dependencies |
|----|--------|------------|--------------|
| PR 1 | COP Normalizer | 2-3h | None |
| PR 2 | Hot Water Usage Learner | 2-3h | None |
| PR 3 | Energy Metrics Service | 3-4h | PR 1, PR 2 |
| PR 4 | Temperature Optimizer | 4-5h | PR 1, PR 3 |
| PR 5 | Savings Service | 3-4h | PR 3 |
| PR 6 | Calibration Service | 2-3h | PR 3, PR 4 |
| PR 7 | Final Cleanup | 2-3h | All above |

**Total: ~18-25 hours over 7 PRs**

---

## PR Template

Use this template for each refactoring PR:

```markdown
## Refactor: Extract [Module Name]

### Summary
Extracts [specific functionality] from `optimizer.ts` into a dedicated `[module-name].ts` service.

### Changes
- [ ] New file: `src/services/[module-name].ts`
- [ ] New tests: `test/unit/[module-name].test.ts`
- [ ] Modified: `src/services/optimizer.ts` (removed ~X lines)
- [ ] Re-exports added for backward compatibility

### Testing
- [ ] All existing optimizer tests pass
- [ ] New module tests with 100% coverage
- [ ] Snapshot tests for output consistency
- [ ] Integration tests pass

### Metrics
| Before | After |
|--------|-------|
| optimizer.ts: X lines | optimizer.ts: Y lines |
| | [module].ts: Z lines |

### Rollback
This PR can be safely reverted without affecting other modules.
```

---

## Success Metrics

After all PRs are merged:

| Metric | Before | Target |
|--------|--------|--------|
| `optimizer.ts` lines | 3,248 | < 700 |
| Number of services | 7 | 13 |
| Average service size | ~460 lines | < 300 lines |
| Test coverage | ~75% | > 85% |
| Cyclomatic complexity (max) | High | Medium |

---

## Questions to Resolve Before Starting

1. **Dependency Injection:** Should extracted services use constructor injection or method injection?
   - **Recommendation:** Constructor injection for required deps, method injection for optional

2. **Singleton vs Instance:** Should services be singletons or instances?
   - **Recommendation:** Instances, managed by `ServiceManager`

3. **Interface Extraction:** Should we create interfaces for each new service?
   - **Recommendation:** Yes, for testability (`ICOPNormalizer`, `IEnergyMetrics`, etc.)

---

*Document created: November 28, 2025*  
*Target completion: December 2025*
