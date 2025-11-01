# 🛠️ Implementation Plan: High-Impact Bug Fixes

**Date**: 2025-11-01  
**Branch**: `fix-optimizer-high-impact`  
**Approach**: One fix at a time, test thoroughly, commit, move to next

---

## Strategy: Safe, Incremental Changes

### Guiding Principles
1. **One issue per commit** - Easy to revert if problems arise
2. **Test before and after** - Verify existing behavior, then verify fix
3. **Monitor in production** - Deploy to test instance, observe 24h minimum
4. **Rollback plan ready** - Document how to undo each change
5. **Update documentation** - Keep HIGH_IMPACT_CODE_REVIEW.md current

### Testing Protocol (Applied to Each Fix)
- [ ] **Unit tests pass** - `npm run test:unit`
- [ ] **Integration tests pass** - `npm run test` (if applicable)
- [ ] **Build succeeds** - `npm run build`
- [ ] **Deploy to test device** - `homey app install`
- [ ] **Monitor logs** - Check for 2 hours minimum
- [ ] **Verify fix in logs** - Confirm expected behavior change
- [ ] **Check for regressions** - Ensure nothing else broke

---

## Phase 1: Issue #2 - Deadband + Step Rounding Stalemate

**Priority**: First (smallest, most isolated change)  
**Risk**: Low  
**Estimated Time**: 2-4 hours including testing  
**Status**: ✅ **COMPLETED** (2025-01-22)

### ✅ Completion Summary
**Commit**: `9ca9864`  
**Branch**: `fix-optimizer-high-impact`  
**Implementation Time**: ~2 hours

**Changes Made**:
- Modified `src/util/setpoint-constraints.ts` lines 111-132
- Added early deadband check against raw delta BEFORE step rounding
- Added 6 comprehensive unit tests in `test/unit/setpoint-constraints.test.ts`
- All tests PASS ✓
- TypeScript builds cleanly ✓

**Test Results**:
- Before fix: 2 tests FAILED (bug confirmed)
- After fix: 10/10 tests PASS
- Coverage for setpoint-constraints.ts: 71.92%

**Validation Status**: ⏳ Monitoring phase (24h minimum required)

---

### Original Plan Details

### Why This First?
- Smallest code change (one function)
- No dependencies on other fixes
- Easy to verify in logs
- Quick win to validate approach

### Implementation Steps

#### Step 1.1: Create Unit Test (30 min)
**File**: `test/unit/setpoint-constraints.test.ts` (new file)

```typescript
import { applySetpointConstraints } from '../../src/util/setpoint-constraints';

describe('Setpoint Constraints - Deadband + Step Interaction', () => {
  it('should detect change BEFORE rounding when raw delta exceeds deadband', () => {
    // Issue #2 repro: proposed=20.8, current=21.2, step=0.5, deadband=0.3
    // Raw delta = -0.4°C (exceeds deadband)
    // After rounding: 21.0 - 21.2 = -0.2°C (below deadband) ❌
    const result = applySetpointConstraints({
      proposedC: 20.8,
      currentTargetC: 21.2,
      minC: 18,
      maxC: 23,
      stepC: 0.5,
      deadbandC: 0.3,
      minChangeMinutes: 30,
      lastChangeMs: Date.now() - 60 * 60 * 1000 // 1h ago, no lockout
    });

    // Expected: change should be TRUE because raw delta (0.4) > deadband (0.3)
    expect(result.changed).toBe(true);
    expect(result.constrainedC).toBe(21.0); // Rounded to step
    expect(Math.abs(result.deltaC)).toBeCloseTo(0.2, 1); // Final delta
  });

  it('should reject change when raw delta is below deadband', () => {
    const result = applySetpointConstraints({
      proposedC: 21.1,
      currentTargetC: 21.2,
      minC: 18,
      maxC: 23,
      stepC: 0.5,
      deadbandC: 0.3,
      minChangeMinutes: 30,
      lastChangeMs: Date.now() - 60 * 60 * 1000
    });

    // Raw delta = 0.1°C < 0.3°C deadband
    expect(result.changed).toBe(false);
    expect(result.constrainedC).toBe(21.2); // Stays at current
  });

  it('should handle edge case: proposed exactly on step boundary', () => {
    const result = applySetpointConstraints({
      proposedC: 21.0, // Exactly on step
      currentTargetC: 21.5,
      minC: 18,
      maxC: 23,
      stepC: 0.5,
      deadbandC: 0.3,
      minChangeMinutes: 30,
      lastChangeMs: Date.now() - 60 * 60 * 1000
    });

    // Raw delta = -0.5°C > 0.3°C deadband
    expect(result.changed).toBe(true);
    expect(result.constrainedC).toBe(21.0);
  });
});
```

**Validation**: Run test, expect FAILURE (proves bug exists)
```bash
npm run test:unit -- setpoint-constraints.test.ts
# Expected: FAIL on first test (detects change = false currently)
```

#### Step 1.2: Implement Fix (15 min)
**File**: `src/util/setpoint-constraints.ts`

**Current code (lines 120-126)**:
```typescript
  const stepped = roundToStep(constrained, stepC);
  const stepApplied = Math.abs(stepped - constrained) > EPS;
  const deltaC = stepped - current;
  const changed = Math.abs(deltaC) >= Math.max(deadbandC, 0);
```

**New code**:
```typescript
  // Check deadband BEFORE rounding to avoid stalemate
  const preStepped = constrained;
  const preStepDelta = preStepped - current;
  const changedBeforeStep = Math.abs(preStepDelta) >= Math.max(deadbandC, 0);

  // Only round if change is significant
  const stepped = changedBeforeStep ? roundToStep(constrained, stepC) : current;
  const stepApplied = Math.abs(stepped - constrained) > EPS;
  const deltaC = stepped - current;
  
  // Change is valid if pre-step delta exceeded deadband AND post-rounding has non-zero delta
  const changed = changedBeforeStep && (Math.abs(deltaC) > EPS);
```

**Validation**: Run test, expect SUCCESS
```bash
npm run test:unit -- setpoint-constraints.test.ts
# Expected: PASS on all tests
```

#### Step 1.3: Update Notes in Function (5 min)
Add notes array entry explaining the logic:

```typescript
  if (!changedBeforeStep) {
    notes.push(`pre-step delta ${preStepDelta.toFixed(2)}°C below deadband ${deadbandC}°C`);
  } else if (!changed) {
    notes.push(`pre-step change detected but post-rounding delta too small`);
  }
```

#### Step 1.4: Integration Test (30 min)
**File**: `test/integration/optimizer-deadband.test.ts` (new file)

```typescript
import { Optimizer } from '../../src/services/optimizer';

describe('Optimizer - Deadband Fix Integration', () => {
  it('should apply setpoint when raw delta exceeds deadband despite rounding', async () => {
    // Setup: mock optimizer with deadband=0.3, step=0.5
    // Current temp: 21.2°C
    // Price: very cheap (should suggest lower temp, e.g., 20.8°C)
    // After rounding: 21.0°C
    // Should apply because raw delta (0.4) > deadband (0.3)
    
    // Run optimization
    const result = await optimizer.runEnhancedOptimization();
    
    // Verify change was applied
    expect(result.action).toBe('temperature_adjusted');
    expect(result.toTemp).toBe(21.0);
  });
});
```

#### Step 1.5: Build and Deploy (15 min)
```bash
# Build
npm run build

# Check for TypeScript errors
npm run lint

# Deploy to test device
homey app install

# Watch logs
homey app log | grep -i "deadband\|constraint"
```

#### Step 1.6: Monitor Production (2-24 hours)
**Success Criteria**:
- [ ] Logs show "pre-step delta X.XX°C below deadband" messages (new format)
- [ ] More `temperature_adjusted` actions compared to baseline
- [ ] No unexpected `no_change` actions when prices are very different
- [ ] No errors or crashes

**Metrics to Track**:
```bash
# Count optimization actions over 24h
homey app log > issue2-logs.txt
grep "temperature_adjusted" issue2-logs.txt | wc -l
grep "no_change" issue2-logs.txt | wc -l
# Compare ratio to historical baseline
```

#### Step 1.7: Commit and Update Documentation (10 min)
```bash
git add src/util/setpoint-constraints.ts test/unit/setpoint-constraints.test.ts
git commit -m "fix: resolve deadband + step rounding stalemate (Issue #2)

- Check deadband before rounding instead of after
- Prevents permanent stalemate when rounded delta < deadband
- Add unit tests covering edge cases
- Expected impact: +5-12% savings from unblocked adjustments"

# Update review doc
```

**Update HIGH_IMPACT_CODE_REVIEW.md**:
```markdown
### #2: Resolve Deadband + Step Rounding Stalemate
**Status**: ✅ FIXED (2025-11-01)
**Commit**: [hash]
**Validation**: Monitored 24h, saw 35% increase in temperature_adjusted actions
```

---

## Phase 2: Issue #7 - Hot Water Tank Deadband Too Tight

**Priority**: Second (small, independent change)  
**Risk**: Low  
**Estimated Time**: 1-2 hours including testing  
**Status**: ✅ **COMPLETED** (2025-11-01)

### ✅ Completion Summary
**Commit**: `6206f4e`  
**Branch**: `fix-optimizer-high-impact`  
**Implementation Time**: ~1 hour

**Changes Made**:
- Modified `src/services/optimizer.ts` line 2517
- Changed formula from `max(0.2, step/2)` to `max(0.5, step)`
- Added 4 comprehensive unit tests in `test/unit/optimizer.test.ts`
- All tests PASS ✓
- TypeScript builds cleanly ✓

**Test Results**:
- 15/15 tests PASS (11 existing + 4 new Issue #7 tests)
- Verified deadband scaling with different step sizes

**Validation Status**: ⏳ Monitoring phase (combined with Phase 1)

---

### Original Plan Details

### Why This Second?
- Simple constant change
- Builds on Phase 1 (deadband understanding)
- Easy to verify (fewer tank setpoint changes)
- Low risk - only affects tank, not main zone

### Implementation Steps

#### Step 2.1: Check Current Tank Behavior (30 min)
**Baseline Measurement**:
```bash
# Monitor tank changes for 24h BEFORE fix
homey app log | grep -i "tank.*temperature.*adjusted" > tank-baseline.txt
# Count occurrences
wc -l tank-baseline.txt
# Look for oscillation patterns
grep -A2 -B2 "tank.*temperature.*adjusted" issue2-logs.txt
```

**Expected**: See tank adjustments every 1-2 hours when price level changes.

#### Step 2.2: Implement Fix (5 min)
**File**: `src/services/optimizer.ts:2486`

**Current**:
```typescript
const tankDeadband = Math.max(0.2, this.tankTempStep / 2);
```

**New**:
```typescript
// Increase tank deadband to match step size (prevents oscillation)
// Issue #7: Previous 0.5°C deadband with 1.0°C step caused excessive cycling
const tankDeadband = Math.max(0.5, this.tankTempStep);
```

#### Step 2.3: Add Comment Explaining Change (2 min)
```typescript
/**
 * Tank deadband should be >= step size to prevent micro-adjustments.
 * With typical tank range of 40-50°C and 1-2°C price-driven changes,
 * a 1.0°C deadband aligns with intentional temperature shifts while
 * filtering out noise from minor price fluctuations.
 */
const tankDeadband = Math.max(0.5, this.tankTempStep);
```

#### Step 2.4: Build and Deploy (10 min)
```bash
npm run build
homey app install
```

#### Step 2.5: Monitor Production (24 hours)
**Success Criteria**:
- [ ] Tank setpoint changes reduced by 30-50%
- [ ] No comfort complaints (tank temp stays adequate)
- [ ] Logs show larger tank delta when changes do occur

**Metrics**:
```bash
# After 24h with fix
homey app log | grep -i "tank.*temperature.*adjusted" > tank-after-fix.txt
wc -l tank-after-fix.txt
# Compare to tank-baseline.txt - expect 30-50% reduction
```

#### Step 2.6: Commit and Update Documentation
```bash
git add src/services/optimizer.ts
git commit -m "fix: increase tank deadband to prevent oscillation (Issue #7)

- Change tank deadband from 0.5°C to 1.0°C (equal to step)
- Reduces cycling by 30-50% based on monitoring
- Aligns with typical 2°C price-driven adjustments"
```

---

## Phase 3: Issue #1 - Savings Accounting on No-Change Hours

**Priority**: Third (most visible impact, moderate complexity)  
**Risk**: Medium (changes accounting logic)  
**Estimated Time**: 4-6 hours including testing  
**Status**: ⏳ Pending

### Why This Third?
- High user visibility (fixes "negative savings" perception)
- More complex than Phase 1-2 (accounting logic)
- Requires careful baseline definition
- Benefits from confidence in previous fixes

### Implementation Steps

#### Step 3.1: Define Canonical Baseline (30 min)
**Decision**: Use `constraintsBand.maxTemp` as baseline (user's comfort ceiling)

**Rationale**:
- Reflects "dumb thermostat at max comfort" scenario
- User-configurable via comfort band settings
- Already available in optimizer context
- Consistent with thermal model expectations

**Document in code**:
```typescript
/**
 * Canonical Baseline Definition
 * 
 * For savings accounting, we compare against a "dumb thermostat" baseline
 * that maintains the maximum comfort temperature 24/7 without optimization.
 * 
 * Baseline = constraintsBand.maxTemp (user's comfort ceiling)
 * 
 * This represents the energy cost if the user manually set their heat pump
 * to the highest comfortable temperature and never adjusted it.
 */
```

#### Step 3.2: Create Helper Function (20 min)
**File**: `src/services/optimizer.ts` (add near calculateRealHourlySavings)

```typescript
/**
 * Calculate savings vs baseline for current optimization decision.
 * Always calculates savings, whether setpoint changed or held.
 * 
 * @param effectiveSetpoint - Actual setpoint being used (changed or held)
 * @param baselineSetpoint - "Dumb thermostat" baseline (typically comfort max)
 * @param currentPrice - Current electricity price
 * @param metrics - Energy metrics for calculation
 * @returns Hourly savings in local currency
 */
private async calculateBaselineSavings(
  effectiveSetpoint: number,
  baselineSetpoint: number,
  currentPrice: number,
  metrics?: OptimizationMetrics
): Promise<number> {
  // Only calculate savings if we're running below baseline
  if (baselineSetpoint <= effectiveSetpoint + 0.1) {
    return 0;
  }

  try {
    return await this.calculateRealHourlySavings(
      baselineSetpoint,
      effectiveSetpoint,
      currentPrice,
      metrics,
      'zone1'
    );
  } catch (error) {
    this.logger.warn('Failed to calculate baseline savings', error as Error);
    return 0;
  }
}
```

#### Step 3.3: Update No-Change Path (30 min)
**File**: `src/services/optimizer.ts:2752-2795`

**Replace entire no-change savings block**:

```typescript
// Calculate savings vs baseline (always, regardless of change)
let savingsNumericNoChange = 0;

try {
  // Use comfort band maximum as baseline (canonical "dumb thermostat")
  const baselineSetpoint = constraintsBand.maxTemp;
  
  // Zone 1: Calculate savings from holding below baseline
  savingsNumericNoChange += await this.calculateBaselineSavings(
    safeCurrentTarget,
    baselineSetpoint,
    currentPrice,
    optimizationResult.metrics
  );
  
  // Zone 2: Add savings if zone2 control is active
  if (zone2Result && typeof zone2Result.fromTemp === 'number' && typeof zone2Result.toTemp === 'number') {
    savingsNumericNoChange += await this.calculateRealHourlySavings(
      zone2Result.fromTemp,
      zone2Result.toTemp,
      currentPrice,
      optimizationResult.metrics,
      'zone2'
    );
  }
  
  // Tank: Add savings if tank control is active
  if (tankResult && typeof tankResult.fromTemp === 'number' && typeof tankResult.toTemp === 'number') {
    savingsNumericNoChange += await this.calculateRealHourlySavings(
      tankResult.fromTemp,
      tankResult.toTemp,
      currentPrice,
      optimizationResult.metrics,
      'tank'
    );
  }
  
  this.logger.log(
    `Savings vs baseline: holding ${safeCurrentTarget.toFixed(1)}°C vs baseline ${baselineSetpoint.toFixed(1)}°C = ${savingsNumericNoChange.toFixed(3)} currency units`
  );
  
} catch (savingsErr) {
  this.logger.warn('Failed to calculate no-change savings', savingsErr as Error);
  savingsNumericNoChange = 0;
}
```

#### Step 3.4: Create Unit Test (45 min)
**File**: `test/unit/savings-accounting.test.ts` (new file)

```typescript
describe('Savings Accounting - No Change Hours', () => {
  it('should calculate baseline savings when holding below max', async () => {
    // Setup: comfort max = 22°C, holding at 20°C
    const savings = await optimizer.calculateBaselineSavings(
      20.0,  // effective
      22.0,  // baseline
      1.5,   // price
      mockMetrics
    );
    
    expect(savings).toBeGreaterThan(0);
  });

  it('should return zero when holding at baseline', async () => {
    const savings = await optimizer.calculateBaselineSavings(
      22.0,  // effective = baseline
      22.0,
      1.5,
      mockMetrics
    );
    
    expect(savings).toBe(0);
  });

  it('should return zero when holding above baseline', async () => {
    const savings = await optimizer.calculateBaselineSavings(
      23.0,  // above baseline
      22.0,
      1.5,
      mockMetrics
    );
    
    expect(savings).toBe(0);
  });
});
```

#### Step 3.5: Integration Test (30 min)
**File**: `test/integration/savings-no-change.test.ts`

```typescript
describe('Savings Accounting Integration', () => {
  it('should show positive savings on no-change hours when holding below max', async () => {
    // Setup: Force deadband lockout
    optimizer.lastSetpointChangeMs = Date.now();
    
    // Mock: current = 20°C, max = 22°C, price = expensive
    const result = await optimizer.runEnhancedOptimization();
    
    expect(result.action).toBe('no_change');
    expect(result.fromTemp).toBe(20.0);
    expect(result.toTemp).toBe(20.0);
    expect(result.savings).toBeGreaterThan(0); // ✅ Should show savings vs baseline!
    expect(result.reason).toContain('lockout'); // Confirms no-change reason
  });
});
```

#### Step 3.6: Build, Deploy, Monitor (24-48 hours)
```bash
npm run test:unit
npm run build
homey app install
```

**Success Criteria**:
- [ ] "No change" hours show positive savings when holding < max
- [ ] Daily total savings are positive (no more negative days)
- [ ] Logs show "Savings vs baseline: holding X°C vs baseline Y°C = Z"
- [ ] No calculation errors in savings logic

**Metrics**:
```bash
# Extract savings from no-change hours
homey app log | grep "no_change" -A5 | grep "savings:" > nochange-savings.txt
# Verify: most entries have savings > 0
```

#### Step 3.7: Commit and Update Documentation
```bash
git add src/services/optimizer.ts test/unit/savings-accounting.test.ts test/integration/savings-no-change.test.ts
git commit -m "fix: calculate baseline savings on no-change hours (Issue #1)

- Always calculate zone1 savings vs baseline (comfort max)
- Use canonical baseline definition consistently
- Add calculateBaselineSavings() helper
- Fixes negative/zero daily savings on hold days
- Expected impact: +8-15% in reported savings"
```

---

## Phase 4: Issue #3 - Thermal Model Confidence Reset

**Priority**: Fourth (enables learning system)  
**Risk**: Low  
**Estimated Time**: 3-4 hours including testing  
**Status**: ⏳ Pending

### Why This Fourth?
- Fixes learning system foundation
- Low risk (adds persistence, doesn't change logic)
- Benefits from stable savings accounting (Phase 3)
- Enables Phase 5 (thermal inertia fix)

### Implementation Steps

#### Step 4.1: Add updateModelNow() Method (20 min)
**File**: `src/services/thermal-model/thermal-model-service.ts`

```typescript
/**
 * Force immediate thermal model update and persistence.
 * Used after calibration to ensure confidence is saved.
 */
public updateModelNow(): void {
  try {
    const data = this.collector.getData();
    
    if (data.length < 24) {
      this.logger.log(`Skipping model update: insufficient data (${data.length} points, need 24)`);
      return;
    }
    
    this.logger.log(`Force updating thermal model with ${data.length} data points`);
    this.analyzer.updateModel(data);
    
    const characteristics = this.analyzer.getThermalCharacteristics();
    this.logger.log(
      `Thermal model updated - Confidence: ${(characteristics.modelConfidence * 100).toFixed(1)}%, ` +
      `Thermal mass: ${characteristics.thermalMass.toFixed(2)}`
    );
  } catch (error) {
    this.logger.error('Error forcing thermal model update:', error);
    throw error;
  }
}
```

#### Step 4.2: Call updateModelNow() After Calibration (10 min)
**File**: `src/services/optimizer.ts:3083`

**After the return statement in runWeeklyCalibration()**:

```typescript
        return {
          oldK: previousK,
          newK,
          oldS: previousS,
          newS,
          timestamp: new Date().toISO(),
          thermalCharacteristics: characteristics,
          analysis: `Learning-based calibration (confidence ${(confidence * 100).toFixed(0)}%)`
        };
      } catch (error) {
        this.logger.error('Error using thermal learning for calibration:', error);
      }
    }
    
    // NEW: Force thermal model update to persist confidence
    if (this.thermalModelService) {
      try {
        this.thermalModelService.updateModelNow();
        this.logger.log('✓ Thermal model confidence persisted after calibration');
      } catch (err) {
        this.logger.error('Failed to persist thermal model confidence after calibration', err);
      }
    }

    // ... rest of function (fallback calibration path)
```

#### Step 4.3: Add Unit Test (30 min)
**File**: `test/unit/thermal-model-persistence.test.ts`

```typescript
describe('Thermal Model Confidence Persistence', () => {
  it('should persist confidence after updateModelNow()', () => {
    const service = new ThermalModelService(mockHomey);
    
    // Add data points
    for (let i = 0; i < 50; i++) {
      service.collectDataPoint(mockDataPoint);
    }
    
    // Force update
    service.updateModelNow();
    
    // Check settings were saved
    const saved = mockHomey.settings.get('thermal_model_characteristics');
    expect(saved).toBeDefined();
    
    const parsed = JSON.parse(saved);
    expect(parsed.modelConfidence).toBeGreaterThan(0);
  });

  it('should increase confidence after weekly calibration', async () => {
    // Get initial confidence
    const before = optimizer.thermalModelService?.getThermalCharacteristics();
    const confidenceBefore = before?.modelConfidence || 0;
    
    // Run calibration
    await optimizer.runWeeklyCalibration();
    
    // Check confidence persisted
    const after = optimizer.thermalModelService?.getThermalCharacteristics();
    const confidenceAfter = after?.modelConfidence || 0;
    
    expect(confidenceAfter).toBeGreaterThanOrEqual(confidenceBefore);
  });
});
```

#### Step 4.4: Build, Deploy, Monitor (48 hours)
```bash
npm run test:unit
npm run build
homey app install
```

**Success Criteria**:
- [ ] After weekly calibration, check settings: `thermal_model_characteristics` has `modelConfidence > 0`
- [ ] Logs show "✓ Thermal model confidence persisted after calibration"
- [ ] Confidence grows over multiple calibration cycles
- [ ] No errors from updateModelNow()

**Verification**:
```bash
# Manually trigger calibration
homey app log &
# Via API or wait for weekly cron

# Check settings
homey settings list | grep thermal_model_characteristics
# Parse JSON, verify modelConfidence field
```

#### Step 4.5: Commit and Update Documentation
```bash
git add src/services/thermal-model/thermal-model-service.ts src/services/optimizer.ts test/unit/thermal-model-persistence.test.ts
git commit -m "fix: persist thermal model confidence after calibration (Issue #3)

- Add updateModelNow() method to force immediate persistence
- Call after weekly calibration to save confidence
- Add tests verifying confidence persistence
- Expected impact: +40-60% faster learning convergence"
```

---

## Phase 5: Issue #6 - Thermal Inertia Confidence Trap

**Priority**: Fifth (builds on Phase 4)  
**Risk**: Low  
**Estimated Time**: 2-3 hours including testing  
**Status**: ⏳ Pending

### Why This Fifth?
- Depends on Phase 4 (confidence persistence working)
- Simple logic change (blending instead of cutoff)
- Improves learning experience for users
- Low risk (just changes a multiplier calculation)

### Implementation Steps

#### Step 5.1: Implement Graduated Blending (15 min)
**File**: `src/util/enhanced-savings-calculator.ts:288-307`

**Replace thermal inertia factor calculation**:

```typescript
/**
 * Calculate thermal inertia factor based on temperature changes.
 * Uses graduated blending of learned vs default values based on confidence.
 */
private calculateThermalInertiaFactor(optimizations: OptimizationData[]): number {
  if (optimizations.length === 0) return 0;

  // Calculate average temperature change magnitude
  const avgTempChange = optimizations.reduce((sum, opt) => {
    return sum + Math.abs(opt.targetTemp - opt.targetOriginal);
  }, 0) / optimizations.length;

  // Use real thermal characteristics with graduated blending
  if (this.thermalModelService) {
    try {
      const characteristics = this.thermalModelService.getThermalCharacteristics();
      
      // Graduated confidence blending (no binary cutoff)
      const confidence = Math.min(1, Math.max(0, characteristics.modelConfidence));
      const thermalMassMultiplier = characteristics.thermalMass * 0.15;
      
      // Blend learned factor with default based on confidence
      const learnedFactor = thermalMassMultiplier * confidence;
      const defaultFactor = 0.02 * (1 - confidence);
      const blendedMultiplier = learnedFactor + defaultFactor;
      
      // Cap at reasonable maximum
      const maxMultiplier = Math.max(0.1, thermalMassMultiplier);
      const result = Math.min(avgTempChange * blendedMultiplier, maxMultiplier);
      
      this.safeDebug('Thermal inertia factor with graduated blending:', {
        avgTempChange: avgTempChange.toFixed(2),
        thermalMass: characteristics.thermalMass.toFixed(3),
        confidence: confidence.toFixed(3),
        learnedFactor: learnedFactor.toFixed(4),
        defaultFactor: defaultFactor.toFixed(4),
        blendedMultiplier: blendedMultiplier.toFixed(4),
        result: result.toFixed(4)
      });
      
      return result;
      
    } catch (error) {
      this.safeError('Error getting thermal characteristics for inertia, using fallback:', error);
    }
  }

  // Fallback when no thermal model available
  return Math.min(avgTempChange * 0.02, 0.1);
}
```

#### Step 5.2: Add Unit Test (30 min)
**File**: `test/unit/thermal-inertia-blending.test.ts`

```typescript
describe('Thermal Inertia Graduated Blending', () => {
  it('should use 100% default at confidence=0', () => {
    // Mock confidence = 0
    const factor = calculator.calculateThermalInertiaFactor(mockOptimizations);
    // Should use default 0.02 multiplier
    expect(factor).toBeCloseTo(0.02 * avgTempChange, 2);
  });

  it('should blend at confidence=0.5', () => {
    // Mock confidence = 0.5, thermal mass = 0.8
    const factor = calculator.calculateThermalInertiaFactor(mockOptimizations);
    // Should be between default and learned
    expect(factor).toBeGreaterThan(0.02 * avgTempChange);
    expect(factor).toBeLessThan(0.8 * 0.15 * avgTempChange);
  });

  it('should use mostly learned at confidence=0.9', () => {
    // Mock confidence = 0.9
    const factor = calculator.calculateThermalInertiaFactor(mockOptimizations);
    // Should be close to learned value
    expect(factor).toBeGreaterThan(0.8 * 0.15 * 0.9 * avgTempChange);
  });

  it('should handle confidence < 0.3 gracefully (no cutoff)', () => {
    // Mock confidence = 0.25 (old code would use hardcoded default)
    const factor = calculator.calculateThermalInertiaFactor(mockOptimizations);
    // Should still blend, not jump to pure default
    expect(factor).toBeGreaterThan(0.02 * avgTempChange);
  });
});
```

#### Step 5.3: Build, Deploy, Monitor (24 hours)
```bash
npm run test:unit
npm run build
homey app install
```

**Success Criteria**:
- [ ] Logs show "Thermal inertia factor with graduated blending" messages
- [ ] Confidence values 0.1-0.3 show intermediate blending (not pure default)
- [ ] Projected savings use learned thermal data even at low confidence
- [ ] No calculation errors

**Metrics**:
```bash
# Check blending behavior in logs
homey app log | grep "graduated blending" -A5
# Verify confidence, learnedFactor, defaultFactor values look reasonable
```

#### Step 5.4: Commit and Update Documentation
```bash
git add src/util/enhanced-savings-calculator.ts test/unit/thermal-inertia-blending.test.ts
git commit -m "fix: use graduated blending for thermal inertia factor (Issue #6)

- Replace binary 0.3 confidence cutoff with smooth blending
- Combine learned and default factors weighted by confidence
- Provides gradual learning incentive for users
- Expected impact: +3-7% savings accuracy during learning phase"
```

---

## Post-Implementation: Final Validation

### All Fixes Deployed - 48 Hour Soak Test

**Success Criteria** (cumulative):
- [ ] All unit tests pass
- [ ] All integration tests pass  
- [ ] No new errors in logs (48h monitoring)
- [ ] Temperature adjustments increased (Phase 1, 2 fixes)
- [ ] No-change hours show positive savings (Phase 3 fix)
- [ ] Thermal confidence grows after calibration (Phase 4 fix)
- [ ] Thermal inertia uses blended values (Phase 5 fix)
- [ ] User reports: improved savings visibility
- [ ] No comfort complaints

### Metrics Dashboard (create script)
**File**: `scripts/analyze-fixes.sh`

```bash
#!/bin/bash
# Analyze impact of all 5 fixes

echo "=== Fix Impact Analysis ==="
echo ""

# Issue #2: Temperature adjustments
adj=$(grep "temperature_adjusted" homey.log | wc -l)
nochange=$(grep "no_change" homey.log | wc -l)
echo "Issue #2 (Deadband): temperature_adjusted=$adj, no_change=$nochange"
echo "  Ratio: $(echo "scale=2; $adj / ($adj + $nochange)" | bc)"
echo ""

# Issue #7: Tank changes
tank=$(grep "Tank.*adjusted" homey.log | wc -l)
echo "Issue #7 (Tank): tank_adjustments=$tank"
echo ""

# Issue #1: No-change savings
positive=$(grep "no_change" homey.log -A3 | grep "savings:" | grep -v "0.000" | wc -l)
total=$(grep "no_change" homey.log | wc -l)
echo "Issue #1 (Savings): no_change_with_positive_savings=$positive / $total"
echo "  Rate: $(echo "scale=2; 100 * $positive / $total" | bc)%"
echo ""

# Issue #3: Confidence
conf=$(homey settings get thermal_model_characteristics | jq -r '.modelConfidence')
echo "Issue #3 (Confidence): current_confidence=$conf"
echo ""

# Issue #6: Thermal inertia blending
blend=$(grep "graduated blending" homey.log | tail -1)
echo "Issue #6 (Inertia): $blend"
echo ""

echo "=== End Analysis ==="
```

### Update HIGH_IMPACT_CODE_REVIEW.md

After all fixes deployed and validated, update the review document with final status:

```markdown
## Implementation Status

**Branch**: `fix-optimizer-high-impact`  
**Dates**: 2025-11-01 to 2025-11-0X  
**Status**: ✅ ALL FIXES DEPLOYED

| Issue | Status | Commit | Validation Date | Impact Observed |
|-------|--------|--------|-----------------|-----------------|
| #2 Deadband Stalemate | ✅ Fixed | abc123 | 2025-11-02 | +38% more adjustments |
| #7 Tank Deadband | ✅ Fixed | def456 | 2025-11-02 | -42% tank changes |
| #1 Savings Accounting | ✅ Fixed | ghi789 | 2025-11-04 | +12% reported savings |
| #3 Confidence Reset | ✅ Fixed | jkl012 | 2025-11-06 | Confidence now persists |
| #6 Thermal Inertia | ✅ Fixed | mno345 | 2025-11-06 | Smooth learning curve |

**Total Impact**: +15-22% reported savings, learning system operational
```

---

## Rollback Procedures

### If Any Fix Causes Issues

#### Immediate Rollback
```bash
# Revert last commit
git revert HEAD
npm run build
homey app install

# OR revert to specific commit
git revert <commit-hash>
npm run build
homey app install
```

#### Per-Phase Rollback

**Phase 1 (Deadband)**: 
- Risk: Too many setpoint changes
- Rollback: `git revert <commit-hash>` 
- Verify: Check that "pre-step delta" messages disappear from logs

**Phase 2 (Tank)**:
- Risk: Tank temp insufficient
- Rollback: Change `Math.max(0.5, this.tankTempStep)` back to `Math.max(0.2, this.tankTempStep / 2)`
- Verify: Tank changes resume normal frequency

**Phase 3 (Savings)**:
- Risk: Savings calculation errors
- Rollback: Revert to try-catch with optional baseline
- Verify: No "Failed to calculate" errors

**Phase 4 (Confidence)**:
- Risk: Settings corruption
- Rollback: Remove `updateModelNow()` call
- Verify: No errors in weekly calibration

**Phase 5 (Inertia)**:
- Risk: Incorrect projections
- Rollback: Restore if/else cutoff at 0.3
- Verify: Projections match historical accuracy

---

## Communication Plan

### User Updates (Timeline)

**Before Starting**:
- Post in GitHub: "Starting bug fix implementation, monitoring closely"
- Discord/Forum: Explain fixes, ask for volunteers to monitor test instance

**After Each Phase**:
- GitHub commit messages (detailed)
- Brief update in issues: "Fix #2 deployed, monitoring 24h"

**After All Phases**:
- GitHub release notes summarizing all fixes
- Forum post: "5 major bugs fixed, here's what improved"
- Request user feedback on savings reporting

---

## Next Steps After This Plan

1. **Review this plan** - Ensure understanding of each step
2. **Set up monitoring** - Prepare log analysis scripts
3. **Create feature branch** - `git checkout -b fix-optimizer-high-impact`
4. **Start Phase 1** - Begin with deadband fix (smallest, safest)
5. **Follow protocol** - Test → Deploy → Monitor → Commit
6. **Update docs** - Keep HIGH_IMPACT_CODE_REVIEW.md current

**Estimated Total Time**: 2-3 weeks (including monitoring periods)

---

**Ready to begin Phase 1?** Let me know and I'll help implement the first fix with unit tests.
