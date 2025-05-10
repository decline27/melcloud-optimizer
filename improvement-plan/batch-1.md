# Batch 1: Core Functionality and Error Handling

## Overview

This batch focuses on improving the core functionality and error handling of the MELCloud Optimizer. The primary goals are to:

1. Standardize error handling across API services
2. Implement consistent logging patterns
3. Enhance type safety in critical components
4. Fix memory leaks in the thermal model service

## Detailed Implementation Plan

### 1. Standardize Error Handling in API Services

#### Files to Modify:
- `src/services/melcloud-api.ts` (Lines 44-46, 70-72, 131-133, 168-170)
- `src/services/tibber-api.ts` (Similar error handling patterns)

#### Implementation:

Replace direct console.error calls with proper logger usage:

```typescript
// BEFORE
catch (error) {
  console.error('MELCloud login error:', error);
  throw error;
}

// AFTER
catch (error) {
  this.logger.error('MELCloud login error:', error);
  // Add more context to the error
  const enhancedError = error instanceof Error 
    ? new Error(`MELCloud login failed: ${error.message}`) 
    : new Error(`MELCloud login failed: ${String(error)}`);
  throw enhancedError;
}
```

Add error classification and recovery mechanisms:

```typescript
private isNetworkError(error: unknown): boolean {
  return error instanceof Error && 
    (error.message.includes('network') || 
     error.message.includes('timeout') || 
     error.message.includes('connection'));
}

private isAuthError(error: unknown): boolean {
  return error instanceof Error && 
    (error.message.includes('auth') || 
     error.message.includes('credentials') || 
     error.message.includes('login'));
}

// In API methods:
catch (error) {
  if (this.isNetworkError(error)) {
    this.logger.error('Network error in MELCloud API:', error);
    throw new Error(`Network error: ${error instanceof Error ? error.message : String(error)}`);
  } else if (this.isAuthError(error)) {
    this.logger.error('Authentication error in MELCloud API:', error);
    throw new Error(`Authentication error: ${error instanceof Error ? error.message : String(error)}`);
  } else {
    this.logger.error('Unknown error in MELCloud API:', error);
    throw new Error(`Unknown error: ${error instanceof Error ? error.message : String(error)}`);
  }
}
```

### 2. Implement Consistent Logging Patterns

#### Files to Modify:
- `src/services/melcloud-api.ts`
- `src/services/tibber-api.ts`
- `src/services/optimizer.ts`
- `src/services/thermal-model/thermal-model-service.ts`

#### Implementation:

Add logger initialization to all service constructors:

```typescript
// In MelCloudApi class
private logger: any;

constructor(logger: any) {
  this.logger = logger;
}

// Then replace all console.log/error calls with:
this.logger.log('Message');
this.logger.error('Error message', error);
```

Create a standardized logging helper for API calls:

```typescript
// Add to each API service
private logApiCall(method: string, endpoint: string, params?: any): void {
  this.logger.log(`API Call: ${method} ${endpoint}${params ? ' with params: ' + JSON.stringify(params) : ''}`);
}

// Usage before API calls:
this.logApiCall('POST', 'Login/ClientLogin', { Email: email });
```

### 3. Enhance Type Safety in Critical Components

#### Files to Modify:
- `src/services/optimizer.ts` (Lines 20-21)
- `src/services/thermal-model/thermal-model-service.ts` (Various any types)

#### Implementation:

Create proper interfaces for logger:

```typescript
// Add to src/util/logger.ts
export interface Logger {
  log(message: string, ...args: any[]): void;
  error(message: string, error?: Error | unknown, ...args: any[]): void;
  debug(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
}
```

Replace `any` types with proper interfaces:

```typescript
// In optimizer.ts
private logger: Logger;
private thermalModelService: ThermalModelService | null = null;
private weatherApi: WeatherApi | null = null;

// Create WeatherApi interface
export interface WeatherApi {
  getCurrentWeather(): Promise<WeatherData>;
}

export interface WeatherData {
  temperature: number;
  windSpeed: number;
  humidity: number;
  cloudCover: number;
  precipitation: number;
}
```

### 4. Fix Memory Leaks in Thermal Model Service

#### Files to Modify:
- `src/services/thermal-model/data-collector.ts` (Lines 30-50)
- `src/services/thermal-model/thermal-model-service.ts` (Lines 34-35, 478-487)

#### Implementation:

Implement data retention policy in DataCollector:

```typescript
// In data-collector.ts
private maxDataPoints: number = 1000; // Configurable limit

addDataPoint(dataPoint: ThermalDataPoint): void {
  this.dataPoints.push(dataPoint);
  
  // Trim data points if exceeding the limit
  if (this.dataPoints.length > this.maxDataPoints) {
    // Remove oldest data points, keeping the most recent ones
    this.dataPoints = this.dataPoints.slice(-this.maxDataPoints);
    this.homey.log(`Trimmed thermal data points to ${this.maxDataPoints} entries`);
  }
  
  // Save to persistent storage
  this.saveDataPoints();
}
```

Ensure proper cleanup of intervals in thermal-model-service.ts:

```typescript
// In thermal-model-service.ts
public stop(): void {
  if (this.dataCollectionInterval) {
    clearInterval(this.dataCollectionInterval);
    this.dataCollectionInterval = null;
  }

  if (this.modelUpdateInterval) {
    clearInterval(this.modelUpdateInterval);
    this.modelUpdateInterval = null;
  }

  this.homey.log('Thermal model service stopped and resources cleaned up');
}

// Call this method in app.ts onUninit
async onUninit() {
  this.log('MELCloud Optimizer App is shutting down');

  // Stop cron jobs
  if (this.hourlyJob) {
    this.hourlyJob.stop();
    this.log('Hourly cron job stopped');
  }

  if (this.weeklyJob) {
    this.weeklyJob.stop();
    this.log('Weekly cron job stopped');
  }
  
  // Stop thermal model service
  if (this.thermalModelService) {
    this.thermalModelService.stop();
    this.log('Thermal model service stopped');
  }

  this.log('MELCloud Optimizer App shutdown complete');
}
```

## Testing Procedures

1. **Error Handling Tests**:
   - Simulate network errors in API calls
   - Test authentication failures
   - Verify error messages are properly formatted

2. **Logging Tests**:
   - Verify log messages are consistent across services
   - Check that sensitive information is not logged

3. **Type Safety Tests**:
   - Run TypeScript compiler with strict mode
   - Verify no any types remain in critical components

4. **Memory Leak Tests**:
   - Run the app with a large number of data points
   - Monitor memory usage over time
   - Verify data points are properly trimmed

## Expected Outcomes

1. More consistent and informative error messages
2. Better logging for debugging and monitoring
3. Improved type safety and code maintainability
4. Reduced memory usage and prevention of memory leaks

## Verification Steps

1. Run the test suite to verify all tests pass
2. Manually test error scenarios to ensure proper handling
3. Monitor memory usage during extended operation
4. Verify logs contain consistent and useful information
