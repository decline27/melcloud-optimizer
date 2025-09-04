# API-Migration Temperature Setting Fix

**Issue:** Temperature setting via MELCloud API fails in the API-migration branch but works in the improvements branch.

**Root Cause Analysis:** The API-migration branch implements complex device type detection logic that fails to properly set temperatures, while the working improvements branch uses a simple, direct approach.

---

## 🚨 CRITICAL ISSUE IDENTIFIED

### Working Implementation (improvements branch)
```typescript
// src/services/melcloud-api.ts - Lines 34-49 (WORKING)
async setDeviceTemperature(deviceId: string, buildingId: number, temperature: number): Promise<boolean> {
  // Simple direct approach - WORKS
  const currentState = await this.getDeviceState(deviceId, buildingId);
  currentState.SetTemperature = temperature;  // SIMPLE DIRECT ASSIGNMENT
  
  const data = await this.retryableRequest(
    () => this.throttledApiCall<any>('POST', 'Device/SetAta', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentState),
    })
  );
  return data !== null;
}
```

### Broken Implementation (API-migration branch)
```typescript
// src/services/melcloud-api.ts - Lines 970-1049 (BROKEN)
async setDeviceTemperature(deviceId: string, buildingId: number, temperature: number): Promise<boolean> {
  // Complex device type detection - FAILS
  const currentState = await this.getDeviceState(deviceId, buildingId, true); // bypass cache
  
  // PROBLEMATIC: Complex detection logic
  const hasATWProperties = currentState.TankWaterTemperature !== undefined && 
                          currentState.SetTankWaterTemperature !== undefined &&
                          currentState.SetTemperatureZone1 !== undefined;
  const isATW = hasATWProperties;
  
  if (isATW) {
    currentState.SetTemperatureZone1 = temperature;  // ATW path
    endpoint = 'Device/SetAtw';
  } else {
    currentState.SetTemperature = temperature;       // ATA path
    endpoint = 'Device/SetAta';
  }
}
```

---

## 🔍 PROBLEM ANALYSIS

### Issues with API-Migration Approach:

1. **Complex Device Detection Logic**
   - Relies on presence of `TankWaterTemperature`, `SetTankWaterTemperature`, and `SetTemperatureZone1`
   - May incorrectly classify devices, leading to wrong API endpoint usage
   - Device state structure may vary between different MELCloud device types

2. **Wrong API Endpoint Selection**
   - Uses `Device/SetAtw` for detected ATW devices
   - Uses `Device/SetAta` for detected ATA devices
   - Endpoint selection based on unreliable device detection

3. **Cache Bypassing**
   - Forces fresh data retrieval with `getDeviceState(deviceId, buildingId, true)`
   - May cause timing or state consistency issues

4. **Field Assignment Inconsistency**
   - Sets `SetTemperatureZone1` for ATW devices
   - Sets `SetTemperature` for ATA devices
   - Different field names may not be supported consistently

### Working Approach Benefits:

1. **Simple Direct Assignment**
   - Always uses `SetTemperature` field
   - Consistent behavior across device types
   
2. **Single API Endpoint**
   - Always uses `Device/SetAta` endpoint
   - Reduces complexity and potential for errors

3. **No Complex Logic**
   - No device type detection needed
   - Fewer points of failure

---

## 🛠️ FIX IMPLEMENTATION

### Option 1: Revert to Simple Approach (RECOMMENDED)

Replace the complex `setDeviceTemperature` method in API-migration branch with the working simple implementation:

```typescript
/**
 * Set device temperature - FIXED VERSION
 * @param deviceId Device ID
 * @param buildingId Building ID
 * @param temperature Target temperature
 * @returns Promise resolving to success
 */
async setDeviceTemperature(deviceId: string, buildingId: number, temperature: number): Promise<boolean> {
  try {
    if (!this.contextKey) {
      const connected = await this.ensureConnected();
      if (!connected) {
        throw new Error('Not logged in to MELCloud');
      }
    }

    this.logger.log(`Setting temperature for device ${deviceId} to ${temperature}°C`);

    try {
      // Get current state (use cache if available)
      const currentState = await this.getDeviceState(deviceId, buildingId);

      // Simple direct temperature assignment - WORKS RELIABLY
      currentState.SetTemperature = temperature;

      this.logApiCall('POST', 'Device/SetAta', { deviceId, temperature });

      // Send update with retry - use SetAta endpoint consistently
      const data = await this.retryableRequest(
        () => this.throttledApiCall<any>('POST', 'Device/SetAta', {
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(currentState),
        }, true) // Critical operation - bypass circuit breaker
      );

      const success = data !== null;

      if (success) {
        this.logger.log(`Successfully set temperature for device ${deviceId} to ${temperature}°C`);
        // Invalidate device state cache since we made changes
        this.invalidateDeviceStateCache(deviceId, buildingId);
      } else {
        this.logger.error(`Failed to set temperature for device ${deviceId}`);
      }

      return success;
    } catch (error) {
      // Create a standardized error with context
      const appError = this.createApiError(error, {
        operation: 'setDeviceTemperature',
        deviceId,
        buildingId,
        temperature
      });

      // For authentication errors, try to reconnect
      if (appError.category === ErrorCategory.AUTHENTICATION) {
        this.logger.warn(`Authentication error in MELCloud setDeviceTemperature for device ${deviceId}, attempting to reconnect`);
        await this.ensureConnected();
      }

      // Log the error with appropriate level based on category
      this.errorHandler.logError(appError);
      throw appError;
    }
  } catch (error) {
    // If this is already an AppError, just rethrow it
    if (error instanceof AppError) {
      throw error;
    }

    // Otherwise, create and log a standardized error
    const appError = this.createApiError(error, {
      operation: 'setDeviceTemperature',
      deviceId,
      buildingId,
      temperature,
      outerCatch: true
    });

    this.errorHandler.logError(appError);
    throw appError;
  }
}
```

### Option 2: Fix the Complex Logic (ALTERNATIVE)

If you prefer to keep the device type detection, fix these issues:

1. **Improve Device Detection**
```typescript
// More reliable device detection
const hasATWProperties = currentState.TankWaterTemperature !== undefined || 
                        currentState.SetTankWaterTemperature !== undefined ||
                        currentState.SetTemperatureZone1 !== undefined;
// Use OR instead of AND to be more inclusive
```

2. **Fallback Logic**
```typescript
// Add fallback if detection fails
if (isATW) {
  // Try ATW approach first
  currentState.SetTemperatureZone1 = temperature;
  endpoint = 'Device/SetAtw';
} else {
  // Fallback to ATA approach
  currentState.SetTemperature = temperature;
  endpoint = 'Device/SetAta';
}

// If ATW fails, retry with ATA approach
if (!success && isATW) {
  this.logger.warn('ATW approach failed, retrying with ATA approach');
  currentState.SetTemperature = temperature;
  // Retry with SetAta endpoint
}
```

---

## 📋 IMPLEMENTATION STEPS

### Step 1: Backup Current Implementation
```bash
# Create backup of current API-migration implementation
git checkout API-migration
cp src/services/melcloud-api.ts src/services/melcloud-api.ts.backup
```

### Step 2: Apply the Fix
1. Open `src/services/melcloud-api.ts` in the API-migration branch
2. Locate the `setDeviceTemperature` method (around line 970)
3. Replace the entire method with the fixed version above
4. Save the file

### Step 3: Remove Unnecessary Methods (Optional)
The API-migration branch has additional methods that may not be needed:
- `setZoneTemperature` 
- `setTankTemperature`
- `setHotWaterMode`
- `setOperationMode`

These can be removed if not used, or kept as separate specialized methods.

### Step 4: Test the Fix
1. Build and deploy the app
2. Test temperature setting functionality
3. Monitor logs for successful temperature changes
4. Verify MELCloud API calls are working

### Step 5: Verification Commands
```typescript
// Test in Homey console or logs
this.logger.log('Testing temperature setting...');
await melCloudApi.setDeviceTemperature('your-device-id', your-building-id, 22);
```

---

## 🔍 WHY THE SIMPLE APPROACH WORKS

### MELCloud API Behavior:
1. **SetAta Endpoint Versatility**
   - `Device/SetAta` endpoint works for most Mitsubishi devices
   - Handles both ATA (Air-to-Air) and ATW (Air-to-Water) devices
   - More forgiving of field variations

2. **SetTemperature Field Reliability**
   - `SetTemperature` field is widely supported
   - Standard across most device types
   - MELCloud API internally maps it to appropriate device fields

3. **Reduced Complexity**
   - No device type guessing
   - No multiple API endpoint logic
   - Fewer variables = fewer failure points

---

## ⚠️ IMPORTANT NOTES

1. **Backup Before Changes**
   - Always backup the current implementation
   - Test in a development environment first

2. **Monitor After Deployment**
   - Check logs for successful API calls
   - Verify temperature changes are applied
   - Monitor for any new error patterns

3. **Device Compatibility**
   - The simple approach works for most common MELCloud devices
   - If specific devices need special handling, add targeted fixes later

4. **Cache Considerations**
   - The fix includes cache invalidation after temperature changes
   - This ensures subsequent reads get updated values

---

## 🎯 EXPECTED OUTCOME

After applying this fix:
- ✅ Temperature setting will work reliably
- ✅ Consistent behavior across device types  
- ✅ Reduced complexity and maintenance burden
- ✅ Better error handling and logging
- ✅ Compatibility with existing optimization logic

The API-migration branch will have the same temperature setting reliability as the working improvements branch while maintaining all other TypeScript migration benefits.

---

## 📞 TROUBLESHOOTING

If the fix doesn't work:

1. **Check Device State Structure**
```typescript
// Add debugging to see actual device state
const currentState = await this.getDeviceState(deviceId, buildingId);
this.logger.log('Device state structure:', JSON.stringify(currentState, null, 2));
```

2. **Verify API Response**
```typescript
// Add response logging
this.logger.log('API response:', JSON.stringify(data, null, 2));
```

3. **Test Different Field Names**
```typescript
// Try multiple field assignments as fallback
currentState.SetTemperature = temperature;
currentState.SetTemperatureZone1 = temperature; // Fallback for ATW
```

This fix addresses the core issue while maintaining the benefits of the TypeScript migration in the API-migration branch.