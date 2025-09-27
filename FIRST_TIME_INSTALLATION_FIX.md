# Fix for First-Time Installation CircuitBreaker Logger Issue

## Problem Description

When the Homey app is installed for the first time without proper configuration (missing MELCloud credentials, device IDs, etc.), the optimization cron jobs would still run and cause crashes due to undefined logger references in the CircuitBreaker implementation.

### Stack Trace Analysis
The original error occurred at exactly 11:00:00 (cron schedule) when:
1. **Driver cron job** triggers hourly optimization (`'0 * * * *'`)
2. **Device initialization** fails due to missing settings 
3. **Logger becomes undefined** after failed initialization
4. **CircuitBreaker** tries to call `this.logger.warn()` on undefined
5. **TypeError: Cannot read properties of undefined (reading 'warn')**

## Root Causes

1. **Race condition**: Cron jobs start before app is fully configured
2. **Missing defensive programming**: CircuitBreaker didn't handle undefined logger
3. **Insufficient configuration validation**: Services initialized without proper checks

## Solution Implementation

### 1. Defensive Programming in CircuitBreaker

Added null-safe logging throughout the CircuitBreaker class:

```typescript
// Before (crashed on undefined logger)
this.logger.warn(`Circuit ${this.name} failure: ${errorMessage}`);

// After (defensive with fallback)
if (this.logger && typeof this.logger.warn === 'function') {
  this.logger.warn(`Circuit ${this.name} failure: ${errorMessage}`);
} else {
  console.warn(`[CircuitBreaker] ${this.name} failure: ${errorMessage}`);
}
```

Applied to all logging methods:
- `onFailure()` - when circuit breaker fails
- `onSuccess()` - debug logging in half-open state
- `open()` - when circuit opens
- `halfOpen()` - when transitioning to half-open
- `close()` - when circuit closes
- `startMonitoring()` - periodic state monitoring
- `execute()` - fail-fast logging
- `updateSuccessHistory()` - adaptive threshold logging

### 2. Enhanced Configuration Validation

Improved service initialization to check required settings:

```typescript
// Enhanced validation in service-manager.ts
const missingSettings = [];
if (!melcloudUser) missingSettings.push('MELCloud username/email');
if (!melcloudPass) missingSettings.push('MELCloud password');

if (missingSettings.length > 0) {
  const errorMessage = `Missing required settings: ${missingSettings.join(', ')}. Please configure these in the app settings page before starting optimization.`;
  const configError = new Error(errorMessage);
  configError.needsConfiguration = true;
  throw configError;
}
```

### 3. Smart Cron Job Management

Updated driver to check configuration before starting cron jobs:

```typescript
private isAppFullyConfigured(): boolean {
  const melcloudUser = this.homey.settings.get('melcloud_user');
  const melcloudPass = this.homey.settings.get('melcloud_pass');
  const deviceId = this.homey.settings.get('device_id');
  const buildingId = this.homey.settings.get('building_id');

  // Check basic MELCloud configuration
  if (!melcloudUser || !melcloudPass || !deviceId || !buildingId) {
    this.logger.log('❌ Missing required MELCloud settings');
    return false;
  }

  return true;
}
```

### 4. Graceful Optimization Handling

Added configuration checks in optimization methods:

```typescript
private async runHourlyOptimization() {
  // Check if app is fully configured before proceeding
  if (!this.isAppFullyConfigured()) {
    this.logger.log('⚠️ Skipping hourly optimization - app not fully configured');
    return;
  }
  
  // ... proceed with optimization
}
```

### 5. Settings Change Listener

Added listener to restart cron jobs when configuration is completed:

```typescript
this.homey.settings.on('set', (key: string) => {
  const criticalSettings = ['melcloud_user', 'melcloud_pass', 'device_id', 'building_id'];
  if (criticalSettings.includes(key)) {
    this.logger.log(`🔧 Critical setting '${key}' changed, checking if cron jobs should start`);
    setTimeout(() => {
      this.ensureCronRunningIfReady();
    }, 1000);
  }
});
```

## Benefits

1. **No more crashes** on first-time installation
2. **Graceful handling** of undefined loggers
3. **Smart cron job startup** only when fully configured
4. **Automatic restart** when user completes configuration
5. **Better error messages** guiding users to configure settings
6. **Maintains functionality** for properly configured installations

## Testing

Created comprehensive tests in `circuit-breaker-undefined-logger.test.ts`:

- ✅ Handles undefined logger during failures
- ✅ Handles undefined logger during success in half-open state  
- ✅ Handles undefined logger with monitoring enabled
- ✅ Normal operation with working logger unchanged

## Files Modified

1. `src/util/circuit-breaker.ts` - Added defensive logging
2. `drivers/boiler/driver.ts` - Enhanced configuration checks and cron management
3. `src/orchestration/service-manager.ts` - Better error handling and validation
4. `api.ts` - Improved error propagation with needsConfiguration flag
5. `drivers/boiler/device.ts` - Defensive circuit breaker initialization

## Deployment Notes

This fix is backward compatible and improves the user experience for new installations while maintaining all existing functionality for configured installations.