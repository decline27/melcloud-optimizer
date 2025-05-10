# Batch 4: Robustness and Edge Cases

## Overview

This batch focuses on improving the robustness of the MELCloud Optimizer by handling network failures gracefully, implementing comprehensive input validation, adding recovery mechanisms for critical failures, and enhancing timeline entry creation.

## Detailed Implementation Plan

### 1. Handle Network Failures Gracefully

#### Files to Modify:
- `src/services/melcloud-api.ts`
- `src/services/tibber-api.ts`
- `src/app.ts` (Lines 604-634, 639-668)

#### Implementation:

Add retry logic for network failures:

```typescript
// Add to both API services
private async retryableRequest<T>(
  requestFn: () => Promise<T>,
  maxRetries: number = 3,
  retryDelay: number = 2000
): Promise<T> {
  let lastError: Error | unknown;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await requestFn();
    } catch (error) {
      lastError = error;
      
      // Check if it's a network error that we should retry
      if (
        error instanceof Error && 
        (error.message.includes('network') || 
         error.message.includes('timeout') || 
         error.message.includes('connection'))
      ) {
        this.logger.warn(
          `Network error on attempt ${attempt}/${maxRetries}, retrying in ${retryDelay}ms:`, 
          error
        );
        
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        
        // Increase delay for next attempt (exponential backoff)
        retryDelay *= 2;
      } else {
        // Not a retryable error
        throw error;
      }
    }
  }
  
  // If we get here, all retries failed
  throw lastError;
}

// Use in API methods:
async getDeviceState(deviceId: string, buildingId: number): Promise<MelCloudDevice> {
  if (!this.contextKey) {
    throw new Error('Not logged in to MELCloud');
  }

  const cacheKey = `device_state_${deviceId}_${buildingId}`;
  const cachedData = this.getCachedData<MelCloudDevice>(cacheKey);
  
  if (cachedData) {
    this.logger.debug(`Using cached device state for device ${deviceId}`);
    return cachedData;
  }

  try {
    const data = await this.retryableRequest(
      () => this.throttledApiCall<MelCloudDevice>(
        'GET', 
        `Device/Get?id=${deviceId}&buildingID=${buildingId}`
      )
    );
    
    this.setCachedData(cacheKey, data);
    return data;
  } catch (error) {
    this.logger.error(`MELCloud get device state error for device ${deviceId}:`, error);
    throw error;
  }
}
```

Add fallback mechanisms for API failures in the app:

```typescript
// In app.ts, modify runHourlyOptimizer
public async runHourlyOptimizer(): Promise<any> {
  this.log('Starting hourly optimization');
  this.log('===== HOURLY OPTIMIZATION STARTED =====');

  try {
    // Call the API implementation
    const api = require('../api.js');
    const result = await api.getRunHourlyOptimizer({ homey: this.homey });

    if (result.success) {
      this.log('===== HOURLY OPTIMIZATION COMPLETED SUCCESSFULLY =====');
      return result;
    } else {
      throw new Error(result.error || 'Unknown error');
    }
  } catch (err) {
    const error = err as Error;
    this.error('Hourly optimization error', error);

    // Check if we have cached data we can use as fallback
    try {
      const lastResult = this.homey.settings.get('last_optimization_result');
      if (lastResult) {
        this.log('Using cached optimization result as fallback');
        
        // Send notification about the fallback
        await this.homey.notifications.createNotification({ 
          excerpt: `HourlyOptimizer error: ${error.message}. Using cached settings as fallback.` 
        });
        
        this.log('===== HOURLY OPTIMIZATION COMPLETED WITH FALLBACK =====');
        return { ...lastResult, fallback: true };
      }
    } catch (fallbackErr) {
      this.error('Failed to use fallback optimization result', fallbackErr as Error);
    }

    // Send notification about the failure
    try {
      await this.homey.notifications.createNotification({ 
        excerpt: `HourlyOptimizer error: ${error.message}` 
      });
    } catch (notifyErr) {
      this.error('Failed to send notification', notifyErr as Error);
    }

    this.error('===== HOURLY OPTIMIZATION FAILED =====');
    throw error; // Re-throw to propagate the error
  }
}
```

### 2. Implement Comprehensive Input Validation

#### Files to Modify:
- `src/services/optimizer.ts` (Lines 99-103, 110-116)
- `src/services/thermal-model/thermal-model-service.ts` (Various methods)

#### Implementation:

Add input validation to all public methods:

```typescript
// In optimizer.ts
setTemperatureConstraints(minTemp: number, maxTemp: number, tempStep: number): void {
  // Validate inputs
  if (typeof minTemp !== 'number' || isNaN(minTemp)) {
    throw new Error('Invalid minTemp: must be a number');
  }
  
  if (typeof maxTemp !== 'number' || isNaN(maxTemp)) {
    throw new Error('Invalid maxTemp: must be a number');
  }
  
  if (typeof tempStep !== 'number' || isNaN(tempStep) || tempStep <= 0) {
    throw new Error('Invalid tempStep: must be a positive number');
  }
  
  if (minTemp >= maxTemp) {
    throw new Error('Invalid temperature range: minTemp must be less than maxTemp');
  }
  
  this.minTemp = minTemp;
  this.maxTemp = maxTemp;
  this.tempStep = tempStep;
}

setCOPSettings(copWeight: number, autoSeasonalMode: boolean, summerMode: boolean): void {
  // Validate inputs
  if (typeof copWeight !== 'number' || isNaN(copWeight) || copWeight < 0 || copWeight > 1) {
    throw new Error('Invalid copWeight: must be a number between 0 and 1');
  }
  
  if (typeof autoSeasonalMode !== 'boolean') {
    throw new Error('Invalid autoSeasonalMode: must be a boolean');
  }
  
  if (typeof summerMode !== 'boolean') {
    throw new Error('Invalid summerMode: must be a boolean');
  }
  
  this.copWeight = copWeight;
  this.autoSeasonalMode = autoSeasonalMode;
  this.summerMode = summerMode;
  this.logger.log(`COP settings updated - Weight: ${this.copWeight}, Auto Seasonal: ${this.autoSeasonalMode}, Summer Mode: ${this.summerMode}`);
}
```

Add validation helpers:

```typescript
// Add to src/util/validation.ts
export function validateNumber(value: any, name: string, options: { min?: number; max?: number; integer?: boolean } = {}): number {
  if (typeof value !== 'number' || isNaN(value)) {
    throw new Error(`Invalid ${name}: must be a number`);
  }
  
  if (options.min !== undefined && value < options.min) {
    throw new Error(`Invalid ${name}: must be at least ${options.min}`);
  }
  
  if (options.max !== undefined && value > options.max) {
    throw new Error(`Invalid ${name}: must be at most ${options.max}`);
  }
  
  if (options.integer && !Number.isInteger(value)) {
    throw new Error(`Invalid ${name}: must be an integer`);
  }
  
  return value;
}

export function validateBoolean(value: any, name: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`Invalid ${name}: must be a boolean`);
  }
  
  return value;
}

export function validateString(value: any, name: string, options: { minLength?: number; maxLength?: number; pattern?: RegExp } = {}): string {
  if (typeof value !== 'string') {
    throw new Error(`Invalid ${name}: must be a string`);
  }
  
  if (options.minLength !== undefined && value.length < options.minLength) {
    throw new Error(`Invalid ${name}: must be at least ${options.minLength} characters`);
  }
  
  if (options.maxLength !== undefined && value.length > options.maxLength) {
    throw new Error(`Invalid ${name}: must be at most ${options.maxLength} characters`);
  }
  
  if (options.pattern !== undefined && !options.pattern.test(value)) {
    throw new Error(`Invalid ${name}: does not match required pattern`);
  }
  
  return value;
}
```

### 3. Add Recovery Mechanisms for Critical Failures

#### Files to Modify:
- `src/app.ts` (Add recovery methods)
- `src/services/melcloud-api.ts` (Add auto-reconnect)

#### Implementation:

Add auto-reconnect to MELCloud API:

```typescript
// In melcloud-api.ts
private reconnectAttempts: number = 0;
private maxReconnectAttempts: number = 5;
private reconnectDelay: number = 5000; // 5 seconds initial delay

private async ensureConnected(): Promise<boolean> {
  if (this.contextKey) {
    return true; // Already connected
  }
  
  if (this.reconnectAttempts >= this.maxReconnectAttempts) {
    this.logger.error(`Maximum reconnect attempts (${this.maxReconnectAttempts}) reached`);
    throw new Error('Failed to reconnect to MELCloud after multiple attempts');
  }
  
  this.reconnectAttempts++;
  
  try {
    // Get credentials from global settings
    const email = global.homeySettings?.get('melcloud_user');
    const password = global.homeySettings?.get('melcloud_pass');
    
    if (!email || !password) {
      throw new Error('MELCloud credentials not available');
    }
    
    this.logger.log(`Attempting to reconnect to MELCloud (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    
    // Try to login
    const success = await this.login(email, password);
    
    if (success) {
      this.reconnectAttempts = 0; // Reset counter on success
      this.logger.log('Successfully reconnected to MELCloud');
      return true;
    } else {
      throw new Error('Login returned false');
    }
  } catch (error) {
    this.logger.error(`Failed to reconnect to MELCloud (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}):`, error);
    
    // Exponential backoff for next attempt
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    this.logger.log(`Will retry in ${delay / 1000} seconds`);
    
    // Schedule retry
    setTimeout(() => {
      this.ensureConnected().catch(err => {
        this.logger.error('Scheduled reconnect failed:', err);
      });
    }, delay);
    
    return false;
  }
}

// Use in API methods:
async getDeviceState(deviceId: string, buildingId: number): Promise<MelCloudDevice> {
  try {
    if (!this.contextKey) {
      const connected = await this.ensureConnected();
      if (!connected) {
        throw new Error('Not connected to MELCloud');
      }
    }
    
    // Rest of the method...
  } catch (error) {
    // Error handling...
  }
}
```

Add system health check to app:

```typescript
// In app.ts
private async checkSystemHealth(): Promise<{ healthy: boolean; issues: string[] }> {
  const issues: string[] = [];
  
  // Check MELCloud connection
  try {
    const api = require('../api.js');
    const melcloudStatus = await api.getMelCloudStatus({ homey: this.homey });
    
    if (!melcloudStatus.connected) {
      issues.push('MELCloud connection: Not connected');
    }
  } catch (error) {
    issues.push(`MELCloud connection check failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  
  // Check Tibber API
  try {
    const api = require('../api.js');
    const tibberStatus = await api.getTibberStatus({ homey: this.homey });
    
    if (!tibberStatus.connected) {
      issues.push('Tibber API connection: Not connected');
    }
  } catch (error) {
    issues.push(`Tibber API connection check failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  
  // Check cron jobs
  if (!this.hourlyJob || !this.hourlyJob.running) {
    issues.push('Hourly optimization job: Not running');
  }
  
  if (!this.weeklyJob || !this.weeklyJob.running) {
    issues.push('Weekly calibration job: Not running');
  }
  
  return {
    healthy: issues.length === 0,
    issues
  };
}

// Add a public method to run health check and recover if needed
public async runSystemHealthCheck(): Promise<{ healthy: boolean; issues: string[]; recovered: boolean }> {
  this.log('Running system health check');
  
  const healthStatus = await this.checkSystemHealth();
  
  if (!healthStatus.healthy) {
    this.log(`System health check found ${healthStatus.issues.length} issues:`, healthStatus.issues);
    
    // Try to recover
    let recovered = false;
    
    try {
      // Restart cron jobs if needed
      if (!this.hourlyJob?.running || !this.weeklyJob?.running) {
        this.log('Restarting cron jobs');
        this.initializeCronJobs();
        recovered = true;
      }
      
      // Other recovery actions as needed
      
      this.log('System recovery actions completed');
    } catch (error) {
      this.error('Failed to recover system:', error as Error);
    }
    
    return {
      ...healthStatus,
      recovered
    };
  }
  
  this.log('System health check passed');
  return {
    ...healthStatus,
    recovered: false
  };
}
```

### 4. Enhance Timeline Entry Creation

#### Files to Modify:
- `src/app.ts` (Lines 234-266, 307-339, 454-486, 532-564)

#### Implementation:

Create a reusable timeline entry helper:

```typescript
// Add to app.ts
private async createTimelineEntry(title: string, message: string, icon: string = 'flow:device_changed'): Promise<boolean> {
  try {
    this.log(`Creating timeline entry: ${title} | ${message}`);
    
    // First try the direct timeline API if available
    if (typeof this.homey.timeline === 'object' && typeof this.homey.timeline.createEntry === 'function') {
      await this.homey.timeline.createEntry({
        title,
        body: message,
        icon
      });
      this.log('Timeline entry created using timeline API');
      return true;
    }
    // Then try the notifications API as the main fallback
    else if (typeof this.homey.notifications === 'object' && typeof this.homey.notifications.createNotification === 'function') {
      await this.homey.notifications.createNotification({
        excerpt: `${title}: ${message}`,
      });
      this.log('Timeline entry created using notifications API');
      return true;
    }
    // Finally try homey.flow if available
    else if (typeof this.homey.flow === 'object' && typeof this.homey.flow.runFlowCardAction === 'function') {
      await this.homey.flow.runFlowCardAction({
        uri: 'homey:flowcardaction:homey:manager:notifications:create_notification',
        id: 'homey:manager:notifications:create_notification',
        args: { text: `${title}: ${message}` }
      });
      this.log('Timeline entry created using flow API');
      return true;
    }
    else {
      this.log('No timeline API available, using log only');
      return false;
    }
  } catch (err) {
    this.error('Failed to create timeline entry', err as Error);
    return false;
  }
}

// Replace all timeline entry creation code with calls to this helper:
// For example, in the hourly job:
await this.createTimelineEntry(
  'MELCloud Optimizer',
  '🕒 Automatic hourly optimization | Adjusting temperatures based on price and COP'
);
```

## Testing Procedures

1. **Network Failure Tests**:
   - Simulate network outages during API calls
   - Verify retry logic works as expected
   - Test fallback mechanisms

2. **Input Validation Tests**:
   - Test with valid and invalid inputs
   - Verify appropriate error messages are generated
   - Check edge cases (null, undefined, etc.)

3. **Recovery Mechanism Tests**:
   - Simulate critical failures
   - Verify auto-reconnect functionality
   - Test system health check and recovery

4. **Timeline Entry Tests**:
   - Test timeline entry creation with different APIs
   - Verify fallback mechanisms work
   - Check error handling

## Expected Outcomes

1. More robust operation during network issues
2. Better error messages for invalid inputs
3. Automatic recovery from critical failures
4. Consistent timeline entries across different Homey versions

## Verification Steps

1. Run tests with simulated network failures
2. Verify system recovers from critical failures
3. Check timeline entries in the Homey app
4. Test with invalid inputs to verify validation
