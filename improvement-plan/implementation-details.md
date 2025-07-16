# Implementation Details

This document provides specific implementation details for addressing the issues outlined in the memory optimization plan.

## Type Safety Implementation

### Define Proper Interfaces

```typescript
// src/types/index.ts

// Logger Interface
export interface Logger {
  debug: (message: string, ...meta: any[]) => void;
  info: (message: string, ...meta: any[]) => void;
  warn: (message: string, ...meta: any[]) => void;
  error: (message: string, ...meta: any[]) => void;
}

// Weather API Interface
export interface WeatherApi {
  getCurrentWeather: (location: GeoLocation) => Promise<WeatherData>;
  getForecast: (location: GeoLocation, hours: number) => Promise<WeatherData[]>;
}

// Weather Data Interface
export interface WeatherData {
  timestamp: Date;
  temperature: number;
  windSpeed: number;
  humidity: number;
  cloudCover: number;
  precipitation: number;
}

// GeoLocation Interface
export interface GeoLocation {
  latitude: number;
  longitude: number;
}
```

### Implement Type Guards

```typescript
// src/util/validation.ts

import { WeatherData, ThermalDataPoint } from '../types';

export function isWeatherData(data: any): data is WeatherData {
  return (
    data &&
    typeof data === 'object' &&
    data.timestamp instanceof Date &&
    typeof data.temperature === 'number' &&
    typeof data.windSpeed === 'number' &&
    typeof data.humidity === 'number' &&
    typeof data.cloudCover === 'number' &&
    typeof data.precipitation === 'number'
  );
}

export function isThermalDataPoint(data: any): data is ThermalDataPoint {
  return (
    data &&
    typeof data === 'object' &&
    typeof data.timestamp === 'number' &&
    typeof data.indoorTemperature === 'number' &&
    typeof data.outdoorTemperature === 'number' &&
    typeof data.targetTemperature === 'number' &&
    typeof data.isHeatingActive === 'boolean' &&
    (!data.weatherConditions || (
      typeof data.weatherConditions === 'object' &&
      typeof data.weatherConditions.windSpeed === 'number' &&
      typeof data.weatherConditions.humidity === 'number' &&
      typeof data.weatherConditions.cloudCover === 'number' &&
      typeof data.weatherConditions.precipitation === 'number'
    ))
  );
}
```

## Memory Leak Prevention Implementation

### Enhanced `stop()` Method

```typescript
// src/services/thermal-model/thermal-model-service.ts

public stop(): void {
  this.logger.info('Stopping ThermalModelService');
  
  // Run final data cleanup
  this.cleanupOldData();
  
  // Clear all intervals
  if (this.modelUpdateInterval) {
    clearInterval(this.modelUpdateInterval);
    this.modelUpdateInterval = null;
  }
  
  if (this.dataCleanupInterval) {
    clearInterval(this.dataCleanupInterval);
    this.dataCleanupInterval = null;
  }
  
  if (this.memoryCheckInterval) {
    clearInterval(this.memoryCheckInterval);
    this.memoryCheckInterval = null;
  }
  
  // Release references
  this.dataCollector = null;
  this.analyzer = null;
  
  // Log final memory usage
  const memUsage = process.memoryUsage();
  this.logger.info('Final memory usage before stopping ThermalModelService', {
    heapUsed: Math.round(memUsage.heapUsed / 1024) + ' KB',
    heapTotal: Math.round(memUsage.heapTotal / 1024) + ' KB',
    rss: Math.round(memUsage.rss / 1024) + ' KB'
  });
}
```

### Optimized Data Retention

```typescript
// src/services/thermal-model/data-collector.ts

// Reduce these constants
const DEFAULT_MAX_DATA_POINTS = 1000; // Was 2000
const MAX_DATA_AGE_DAYS = 14; // Was 30
const RECENT_DATA_THRESHOLD_DAYS = 5; // Was 7
```

### Application-wide Memory Monitoring

```typescript
// src/app.ts

private setupMemoryMonitoring(): void {
  const MEMORY_CHECK_INTERVAL = 15 * 60 * 1000; // 15 minutes
  const HIGH_MEMORY_THRESHOLD = 0.75; // 75% of available heap
  const CRITICAL_MEMORY_THRESHOLD = 0.85; // 85% of available heap
  
  this.memoryMonitorInterval = setInterval(() => {
    const memUsage = process.memoryUsage();
    const heapUsedPercentage = memUsage.heapUsed / memUsage.heapTotal;
    
    this.log('Memory usage check', {
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + ' MB',
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + ' MB',
      percentage: Math.round(heapUsedPercentage * 100) + '%'
    });
    
    if (heapUsedPercentage > CRITICAL_MEMORY_THRESHOLD) {
      this.log('CRITICAL: Memory usage too high, forcing cleanup');
      this.thermalModelService.cleanupOldData();
      global.gc && global.gc(); // Force garbage collection if available
    } else if (heapUsedPercentage > HIGH_MEMORY_THRESHOLD) {
      this.log('WARNING: High memory usage, scheduling cleanup');
      this.thermalModelService.cleanupOldData();
    }
  }, MEMORY_CHECK_INTERVAL);
}
```

## API Logging Implementation

### `logApiCall` Method

```typescript
// src/services/base-api-service.ts

protected async logApiCall<T>(
  endpoint: string,
  params: Record<string, any>,
  apiCallFn: () => Promise<T>
): Promise<T> {
  const startTime = Date.now();
  const sanitizedParams = this.sanitizeParams(params);
  
  try {
    this.logger.debug(`API call to ${endpoint} started`, { params: sanitizedParams });
    const result = await apiCallFn();
    const duration = Date.now() - startTime;
    
    this.logger.debug(`API call to ${endpoint} completed in ${duration}ms`);
    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    this.logger.error(`API call to ${endpoint} failed after ${duration}ms`, {
      params: sanitizedParams,
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

private sanitizeParams(params: Record<string, any>): Record<string, any> {
  const result = { ...params };
  
  // Redact sensitive fields
  const sensitiveFields = ['password', 'token', 'key', 'secret', 'auth', 'credential'];
  
  for (const key of Object.keys(result)) {
    if (sensitiveFields.some(field => key.toLowerCase().includes(field))) {
      result[key] = '[REDACTED]';
    } else if (typeof result[key] === 'object' && result[key] !== null) {
      result[key] = this.sanitizeParams(result[key]);
    }
  }
  
  return result;
}
```

## Proper Shutdown Implementation

### `onUninit` Method

```typescript
// src/app.ts

public async onUninit(): Promise<void> {
  this.log('App is shutting down, performing cleanup...');
  
  // Stop all cron jobs
  if (this.optimizationCronJob) {
    this.optimizationCronJob.stop();
    this.log('Stopped optimization cron job');
  }
  
  // Stop thermal model service
  if (this.thermalModelService) {
    this.thermalModelService.stop();
    this.log('Stopped thermal model service');
  }
  
  // Clear all intervals
  if (this.memoryMonitorInterval) {
    clearInterval(this.memoryMonitorInterval);
    this.log('Cleared memory monitor interval');
  }
  
  // Save any pending data
  try {
    await this.saveAllSettings();
    this.log('Successfully saved all settings');
  } catch (error) {
    this.error('Failed to save settings during shutdown', error);
  }
  
  this.log('Cleanup completed, app is ready to shut down');
}

private async saveAllSettings(): Promise<void> {
  // Implement logic to save all critical settings and data
  // This is a placeholder for the actual implementation
}
```

## Testing Plan

1. **Memory Usage Tests**
   - Create tests that simulate long-running operations
   - Monitor memory usage over time
   - Verify cleanup mechanisms work as expected

2. **Shutdown Tests**
   - Simulate app shutdown scenarios
   - Verify all resources are properly released
   - Check data integrity after restart

3. **Type Safety Tests**
   - Test with valid and invalid data structures
   - Verify type guards correctly identify issues
   - Ensure proper error handling for type mismatches