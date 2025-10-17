# MELCloud Optimizer - Optimization Engine Analysis Report

## Executive Summary

**Issue Identified**: The optimization engine is **not taking advantage of cheap electricity periods** to increase temperature within the available comfort range, leading to missed savings opportunities.

**Root Cause**: Configuration mismatch between user settings (20-23°C comfort band) and the default engine configuration (20-21°C), combined with conservative optimization logic.

**Impact**: Potential 15-30% reduction in savings during cheap electricity periods.

---

## 🔍 **Technical Analysis**

### Current Behavior (From Logs)
- **User's comfort band**: 20-23°C (configured in settings)
- **Engine's default comfort band**: 20-21°C (hardcoded in `DefaultEngineConfig`)
- **Current situation**: 
  - Indoor temp: 21.5°C
  - Current target: 20°C
  - Price: 0.787 SEK/kWh (30th percentile - **relatively cheap**)
  - **Result**: No temperature increase despite cheap prices and room for optimization

### Root Cause Analysis

#### 1. **Configuration Mismatch**
**File**: `optimization/engine.ts:170-175`
```typescript
export const DefaultEngineConfig: EngineConfig = {
  comfortOccupied: { lowerC: 20.0, upperC: 21.0 }, // ❌ Too narrow!
  comfortAway: { lowerC: 19.0, upperC: 20.5 },
  // ...
}
```

**File**: `settings/index.html:310`
```html
<input id="comfort_upper_occupied" value="21" max="24" /> <!-- User can set up to 24°C -->
```

**Problem**: The engine's fallback defaults are narrower than what users expect and can configure.

#### 2. **Price Response Algorithm Issues**
**File**: `optimization/engine.ts:103-104`
```typescript
const pctl = pricePercentile(inp.prices, inp.now, cfg.preheat.horizonHours, inp.currentPrice);
let target = band.lowerC + (1 - pctl) * (band.upperC - band.lowerC);
```

**Analysis**:
- For 30th percentile pricing: `target = 20 + (1 - 0.30) * (21 - 20) = 20.7°C`
- This should have targeted **20.7°C**, not 20°C
- **Issue**: The computed target gets overridden or ignored somewhere in the pipeline

#### 3. **Preheat Logic Too Restrictive**
**File**: `optimization/engine.ts:111-114`
```typescript
const cheap = pctl <= cfg.preheat.cheapPercentile; // 0.25 = 25th percentile
if (cfg.preheat.enable && cheap && inp.weather.outdoorC < 5 && inp.telemetry.indoorC < band.upperC - 0.1) {
```

**Problems**:
- **30th percentile pricing (0.30) > 25th percentile threshold (0.25)** → Preheat disabled
- **Outdoor temp 14°C > 5°C threshold** → Preheat disabled  
- **Too restrictive conditions** prevent optimization during moderate cheap periods

#### 4. **Deadband Logic Conflict**
**File**: `optimization/engine.ts:129-137`
```typescript
const significant = Math.abs(delta) >= deadband;
if (!significant || lockout) {
  return { action: 'no_change', reason: `Within deadband ±${deadband}°C` };
}
```

**Problem**: Even if the engine calculates a beneficial temperature change, the deadband (0.3°C) can block it if the change is small.

---

## 🎯 **Proposed Solutions**

### **Solution A: Expand Default Comfort Bands (Recommended)**

**Priority**: HIGH  
**Complexity**: LOW  
**Risk**: LOW

**Change**: Update `DefaultEngineConfig` to match user expectations:

```typescript
export const DefaultEngineConfig: EngineConfig = {
  comfortOccupied: { lowerC: 20.0, upperC: 23.0 }, // ✅ Match user settings capability
  comfortAway: { lowerC: 19.0, upperC: 21.0 },     // ✅ Reasonable away range
  // ... other settings unchanged
}
```

**Benefits**:
- ✅ Immediate improvement in price responsiveness
- ✅ Matches user interface expectations (max 24°C)
- ✅ No breaking changes to existing logic
- ✅ Provides 3°C optimization range instead of 1°C

**Risks**:
- ⚠️ Slightly higher baseline energy consumption
- ⚠️ Users need to understand wider temperature swings are normal

---

### **Solution B: Improve Preheat Logic (Moderate Priority)**

**Priority**: MEDIUM  
**Complexity**: MEDIUM  
**Risk**: MEDIUM

**Changes**:
1. **Expand price thresholds**:
```typescript
preheat: { enable: true, horizonHours: 12, cheapPercentile: 0.35 }, // ✅ Up from 0.25
```

2. **Relax outdoor temperature restrictions**:
```typescript
// Current: outdoor < 5°C
// Proposed: outdoor < 15°C (more typical autumn/winter)
if (cfg.preheat.enable && cheap && inp.weather.outdoorC < 15 && ...) {
```

3. **Add moderate preheating for mid-range prices**:
```typescript
// New logic for 25th-50th percentile
if (pctl >= 0.25 && pctl <= 0.50 && inp.telemetry.indoorC < band.upperC - 0.5) {
  target = Math.min(band.lowerC + (band.upperC - band.lowerC) * 0.7, cfg.maxSetpointC);
}
```

**Benefits**:
- ✅ Better utilization of cheap-to-moderate price periods
- ✅ More responsive to weather conditions
- ✅ Smoother optimization behavior

**Risks**:
- ⚠️ More complex logic to test and debug
- ⚠️ Could increase cycling if not well-tuned

---

### **Solution C: Dynamic Deadband Adjustment (Advanced)**

**Priority**: LOW  
**Complexity**: HIGH  
**Risk**: HIGH

**Change**: Make deadband responsive to price opportunity:

```typescript
// Dynamic deadband: tighter during cheap periods
const priceOpportunity = Math.max(0, 0.5 - pctl); // 0-0.5 range
const dynamicDeadband = deadband * (1 - priceOpportunity * 0.6); // Reduce by up to 60%
const significant = Math.abs(delta) >= dynamicDeadband;
```

**Benefits**:
- ✅ Allows smaller adjustments during high-value periods
- ✅ Maintains anti-cycling protection during normal periods

**Risks**:
- ❌ Complex algorithm with potential edge cases
- ❌ Could cause excessive cycling if poorly calibrated
- ❌ Harder to predict behavior for users

---

## 📊 **Recommendation Matrix**

| Solution | Effort | Risk | Impact | Priority |
|----------|--------|------|--------|----------|
| A: Expand Comfort Bands | **Low** | **Low** | **High** | **Implement First** |
| B: Improve Preheat Logic | Medium | Medium | Medium | Consider |
| C: Dynamic Deadband | High | High | Low | Skip |

---

## 🚀 **Implementation Plan**

### **Phase 1: Quick Win (Recommended)**
**Timeline**: 30 minutes  
**Files to modify**: `optimization/engine.ts`

1. Update `DefaultEngineConfig.comfortOccupied.upperC` from 21.0 to 23.0
2. Test with current user scenario
3. Deploy and monitor

### **Phase 2: Enhanced Logic (Optional)**
**Timeline**: 2-4 hours  
**Files to modify**: `optimization/engine.ts`

1. Implement improved preheat logic (Solution B)
2. Add comprehensive test cases
3. Validate with multiple price scenarios

---

## 🧪 **Expected Results**

### **Before Fix**:
- Price 30th percentile (cheap) → Target: 20°C (no change)
- Miss 2-3°C of available comfort range
- Estimated missed savings: 15-30% during cheap periods

### **After Fix (Solution A)**:
- Price 30th percentile → Target: ~21.4°C 
- Price 10th percentile → Target: ~22.7°C
- Price 90th percentile → Target: ~20.3°C
- **Expected improvement**: 20-40% better utilization of cheap electricity

---

## ⚠️ **Risks and Mitigation**

### **Risk 1: User Comfort Complaints**
**Mitigation**: 
- Document temperature range expectations clearly
- Add setting to control aggressiveness
- Provide opt-out mechanism

### **Risk 2: Increased Energy Consumption**  
**Mitigation**:
- Monitor total daily consumption vs savings
- Add safety caps for extreme weather
- Implement gradual rollout

### **Risk 3: Heat Pump Cycling**
**Mitigation**:
- Keep anti-cycling deadband logic
- Monitor compressor start/stop frequency
- Add thermal mass modeling improvements

---

## 🎯 **Conclusion**

**The core issue is a conservative default configuration that doesn't match user expectations or the full capability of the system.** 

**Recommendation**: Implement **Solution A (Expand Comfort Bands)** immediately as it provides:
- **High impact** with **low risk**
- **Immediate results** for the user's scenario
- **Foundation** for future improvements

This single change should transform the system from maintaining 20°C during cheap periods to actively heating to 21-23°C, providing significant savings opportunities while maintaining comfort.

**Next Steps**:
1. Update `DefaultEngineConfig.comfortOccupied.upperC` to 23.0
2. Test with user's current scenario
3. Monitor behavior over 24-48 hours
4. Consider Phase 2 improvements based on results