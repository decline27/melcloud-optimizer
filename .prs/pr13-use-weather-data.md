# PR #13: Use Already-Fetched Weather Data for Thermal Learning

**Status**: ✅ Implemented  
**Priority**: MEDIUM (Data Quality Improvement)  
**Estimated Effort**: 1 hour  
**Risk Level**: LOW

---

## Problem Statement

Thermal learning currently collects data with **hardcoded zero values** for weather conditions, even though real weather data is already being fetched during the same optimization run.

### Current Broken Flow

In `optimizeZone1()` method:
1. **Line 1233-1258**: Thermal learning collects data point with hardcoded zeros:
   ```typescript
   weatherConditions: {
     windSpeed: 0,       // ❌ Hardcoded
     humidity: 0,        // ❌ Hardcoded
     cloudCover: 0,      // ❌ Hardcoded
     precipitation: 0    // ❌ Hardcoded
   }
   ```

2. **Line 1280**: Weather data is fetched from API
3. **Line 1297-1303**: `weatherInfo` object is populated with real weather data

**Problem**: Thermal learning happens **before** weather fetch, so it uses fake data!

### Impact

The thermal model is trying to learn building behavior but with incorrect weather data:
- Can't learn that windy days lose heat faster
- Can't learn that humid days feel warmer
- Can't learn that cloudy days need more heating
- Can't learn precipitation impact on thermal mass

---

## Proposed Changes

### File: `src/services/optimizer.ts`

#### Change 1: Move thermal learning block after weather fetch

**Current Location**: Lines 1233-1258 (before weather fetch)  
**New Location**: After line 1307 (after weather fetch)

**Before**:
```typescript
// Line 1233-1258 - BEFORE weather fetch
if (this.useThermalLearning && this.thermalModelService) {
  const dataPoint = {
    timestamp: new Date().toISOString(),
    indoorTemperature: currentTemp ?? 20,
    outdoorTemperature: outdoorTemp,
    targetTemperature: currentTarget ?? 20,
    heatingActive: !deviceState.IdleZone1,
    weatherConditions: {
      windSpeed: 0,      // ❌ Hardcoded
      humidity: 0,
      cloudCover: 0,
      precipitation: 0
    }
  };
  this.thermalModelService.collectDataPoint(dataPoint);
}

// ... 50 lines later ...

// Line 1280-1307 - Weather fetch happens here
const forecast = await this.weatherApi.getForecast();
weatherInfo = { current: forecast.current, ... };
```

**After**:
```typescript
// Line 1280-1307 - Weather fetch happens FIRST
const forecast = await this.weatherApi.getForecast();
weatherInfo = { current: forecast.current, ... };

// NEW LOCATION - Thermal learning uses real weather data
if (this.useThermalLearning && this.thermalModelService) {
  const dataPoint = {
    timestamp: new Date().toISOString(),
    indoorTemperature: currentTemp ?? 20,
    outdoorTemperature: outdoorTemp,
    targetTemperature: currentTarget ?? 20,
    heatingActive: !deviceState.IdleZone1,
    weatherConditions: weatherInfo?.current ? {
      windSpeed: weatherInfo.current.windSpeed ?? 0,
      humidity: weatherInfo.current.humidity ?? 0,
      cloudCover: weatherInfo.current.cloudCover ?? 0,
      precipitation: weatherInfo.current.precipitation ?? 0
    } : undefined  // Fallback if no weather API
  };
  this.thermalModelService.collectDataPoint(dataPoint);
  
  this.logger.log('Thermal data point collected', {
    indoorTemp: dataPoint.indoorTemperature,
    outdoorTemp: dataPoint.outdoorTemperature,
    targetTemp: dataPoint.targetTemperature,
    heatingActive: dataPoint.heatingActive,
    hasWeather: !!weatherInfo?.current
  });
}
```

---

## Implementation Steps

1. **Delete** thermal learning block from lines 1233-1258
2. **Insert** updated thermal learning block after line 1307 (after weather fetch)
3. **Update** weatherConditions to use `weatherInfo.current` data
4. **Add** logging to show when weather data is available

---

## Verification Plan

### Unit Tests

No new tests needed - existing tests will verify:
- Thermal learning still works
- No breaking changes to optimization flow

### Manual Verification

1. **Enable thermal learning**:
   ```javascript
   // In Homey settings or code
   useThermalLearning = true
   ```

2. **Run optimizer and check logs**:
   ```bash
   homey app run
   ```

3. **Verify in logs**:
   - Look for "Thermal data point collected"
   - Check `hasWeather: true` in log output
   - Verify windSpeed, humidity, cloudCover, precipitation are NOT zero

4. **Check thermal model data**:
   ```javascript
   // After a few hours of collection
   // Verify thermal data points have real weather values
   ```

---

## Success Metrics

- ✅ Thermal learning happens after weather fetch
- ✅ Weather data is populated from `weatherInfo.current`
- ✅ Fallback to `undefined` if weather API unavailable
- ✅ No additional API calls (reuses existing data)
- ✅ All existing tests still pass
- ✅ Logs show `hasWeather: true` when weather API available

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

The change is simple code movement with no logic changes, making rollback safe.

---

## Benefits

- ✅ **Zero performance cost** - reuses already-fetched weather data
- ✅ **Better thermal model** - learns with real weather conditions
- ✅ **Simple implementation** - just move code block and update data source
- ✅ **Safe fallback** - handles missing weather API gracefully

---

## Implementation Checklist

- [x] Move thermal learning block after weather fetch
- [x] Update weatherConditions to use `weatherInfo.current`
- [x] Add fallback for missing weather API
- [x] Update logging to show weather availability
- [x] Run full test suite
- [x] Manual verification with real weather data
- [x] Update documentation
- [x] Mark as complete in implementation plan
