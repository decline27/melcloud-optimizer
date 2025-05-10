# Batch 2: Performance Optimizations

## Overview

This batch focuses on improving the performance of the MELCloud Optimizer by optimizing API calls, implementing better caching strategies, improving algorithm efficiency, and enhancing memory management.

## Detailed Implementation Plan

### 1. Optimize API Call Patterns

#### Files to Modify:
- `src/services/melcloud-api.ts` (Lines 116-134, 143-171)
- `src/services/tibber-api.ts` (Similar API call patterns)

#### Implementation:

Implement request throttling to prevent API rate limiting:

```typescript
// Add to MelCloudApi class
private lastApiCallTime: number = 0;
private minApiCallInterval: number = 2000; // 2 seconds minimum between calls

private async throttledApiCall<T>(
  method: string, 
  endpoint: string, 
  options: RequestInit = {}
): Promise<T> {
  // Ensure minimum time between API calls
  const now = Date.now();
  const timeSinceLastCall = now - this.lastApiCallTime;
  
  if (timeSinceLastCall < this.minApiCallInterval) {
    const waitTime = this.minApiCallInterval - timeSinceLastCall;
    this.logger.debug(`Throttling API call to ${endpoint}, waiting ${waitTime}ms`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }
  
  this.lastApiCallTime = Date.now();
  
  // Make the API call
  const url = `${this.baseUrl}${endpoint}`;
  this.logger.debug(`API Call: ${method} ${url}`);
  
  const response = await fetch(url, {
    method,
    ...options,
    headers: {
      ...(this.contextKey ? { 'X-MitsContextKey': this.contextKey } : {}),
      ...(options.headers || {})
    }
  });
  
  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }
  
  return await response.json() as T;
}

// Then refactor API methods to use this helper:
async getDeviceState(deviceId: string, buildingId: number): Promise<any> {
  if (!this.contextKey) {
    throw new Error('Not logged in to MELCloud');
  }

  try {
    return await this.throttledApiCall(
      'GET', 
      `Device/Get?id=${deviceId}&buildingID=${buildingId}`
    );
  } catch (error) {
    this.logger.error(`MELCloud get device state error for device ${deviceId}:`, error);
    throw error;
  }
}
```

### 2. Implement Better Caching Strategies

#### Files to Modify:
- `src/services/melcloud-api.ts` (Add caching)
- `src/services/tibber-api.ts` (Add caching)

#### Implementation:

Add a caching layer for API responses:

```typescript
// Add to MelCloudApi class
private cache: Map<string, { data: any; timestamp: number }> = new Map();
private cacheTTL: number = 5 * 60 * 1000; // 5 minutes default TTL

private getCachedData<T>(key: string): T | null {
  const cached = this.cache.get(key);
  
  if (!cached) {
    return null;
  }
  
  // Check if cache is still valid
  const now = Date.now();
  if (now - cached.timestamp > this.cacheTTL) {
    this.cache.delete(key);
    return null;
  }
  
  return cached.data as T;
}

private setCachedData<T>(key: string, data: T): void {
  this.cache.set(key, {
    data,
    timestamp: Date.now()
  });
}

// Then update API methods to use cache:
async getDeviceState(deviceId: string, buildingId: number): Promise<any> {
  if (!this.contextKey) {
    throw new Error('Not logged in to MELCloud');
  }

  const cacheKey = `device_state_${deviceId}_${buildingId}`;
  const cachedData = this.getCachedData<any>(cacheKey);
  
  if (cachedData) {
    this.logger.debug(`Using cached device state for device ${deviceId}`);
    return cachedData;
  }

  try {
    const data = await this.throttledApiCall(
      'GET', 
      `Device/Get?id=${deviceId}&buildingID=${buildingId}`
    );
    
    this.setCachedData(cacheKey, data);
    return data;
  } catch (error) {
    this.logger.error(`MELCloud get device state error for device ${deviceId}:`, error);
    throw error;
  }
}
```

### 3. Improve Algorithm Efficiency in the Optimizer

#### Files to Modify:
- `src/services/optimizer.ts` (Lines 414-484)

#### Implementation:

Optimize the temperature calculation algorithm:

```typescript
// Refactor calculateOptimalTemperature for better efficiency
private async calculateOptimalTemperature(
  currentPrice: number,
  avgPrice: number,
  minPrice: number,
  maxPrice: number,
  currentTemp: number
): Promise<number> {
  // Cache frequently used values
  const tempRange = this.maxTemp - this.minTemp;
  const midTemp = (this.maxTemp + this.minTemp) / 2;
  
  // Normalize price between 0 and 1 more efficiently
  const normalizedPrice = maxPrice === minPrice 
    ? 0.5 // Handle edge case of equal prices
    : (currentPrice - minPrice) / (maxPrice - minPrice);
  
  // Invert (lower price = higher temperature)
  const invertedPrice = 1 - normalizedPrice;
  
  // Calculate base target based on price
  let targetTemp = midTemp + (invertedPrice - 0.5) * tempRange;
  
  // Apply COP adjustment if helper is available
  if (this.copHelper && this.copWeight > 0) {
    try {
      // Determine if we're in summer mode (cached calculation)
      const isSummer = this.autoSeasonalMode 
        ? this.copHelper.isSummerSeason() 
        : this.summerMode;
      
      // Get the appropriate COP value based on season
      const seasonalCOP = await this.copHelper.getSeasonalCOP();
      
      if (seasonalCOP > 0) {
        // Optimize the COP normalization calculation
        const normalizedCOP = Math.min(Math.max((seasonalCOP - 1) / 4, 0), 1);
        
        // Calculate COP adjustment (higher COP = higher temperature)
        const copAdjustment = (normalizedCOP - 0.5) * tempRange * this.copWeight;
        
        // Apply the adjustment
        targetTemp += copAdjustment;
        
        // In summer mode, reduce heating temperature
        if (isSummer) {
          targetTemp += -1.0 * this.copWeight; // Reduce by up to 1°C based on COP weight
        }
      }
    } catch (error) {
      this.logger.error('Error applying COP adjustment:', error);
    }
  }
  
  return targetTemp;
}
```

### 4. Enhance Memory Management

#### Files to Modify:
- `src/services/thermal-model/thermal-model-service.ts` (Lines 34-74)
- `src/app.ts` (Memory management for cron jobs)

#### Implementation:

Implement better memory management in the thermal model service:

```typescript
// In thermal-model-service.ts
private cleanupOldData(): void {
  try {
    // Get current data points
    const dataPoints = this.dataCollector.getAllDataPoints();
    
    // Keep only the last 30 days of data
    const thirtyDaysAgo = DateTime.now().minus({ days: 30 }).toMillis();
    
    const filteredDataPoints = dataPoints.filter(point => {
      const timestamp = DateTime.fromISO(point.timestamp).toMillis();
      return timestamp >= thirtyDaysAgo;
    });
    
    // If we filtered out any points, update the data collector
    if (filteredDataPoints.length < dataPoints.length) {
      this.dataCollector.setDataPoints(filteredDataPoints);
      this.homey.log(`Cleaned up thermal data: removed ${dataPoints.length - filteredDataPoints.length} old data points`);
    }
  } catch (error) {
    this.homey.error('Error cleaning up old thermal data:', error);
  }
}

// Call this method periodically
private scheduleModelUpdates(): void {
  // Update model every 6 hours
  this.modelUpdateInterval = setInterval(() => {
    this.updateThermalModel();
  }, 6 * 60 * 60 * 1000);
  
  // Clean up old data once a day
  this.dataCleanupInterval = setInterval(() => {
    this.cleanupOldData();
  }, 24 * 60 * 60 * 1000);

  // Initial model update
  setTimeout(() => {
    this.updateThermalModel();
  }, 30 * 60 * 1000); // First update after 30 minutes
  
  // Initial data cleanup
  setTimeout(() => {
    this.cleanupOldData();
  }, 60 * 60 * 1000); // First cleanup after 1 hour

  this.homey.log('Thermal model updates and data cleanup scheduled');
}
```

Add memory usage monitoring to the app:

```typescript
// Add to app.ts
private monitorMemoryUsage(): void {
  const memoryUsageInterval = setInterval(() => {
    const memoryUsage = process.memoryUsage();
    this.log('Memory Usage:', {
      rss: `${Math.round(memoryUsage.rss / 1024 / 1024)} MB`,
      heapTotal: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)} MB`,
      heapUsed: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)} MB`,
      external: `${Math.round(memoryUsage.external / 1024 / 1024)} MB`
    });
  }, 60 * 60 * 1000); // Log memory usage every hour
  
  // Store the interval for cleanup
  this.memoryUsageInterval = memoryUsageInterval;
}

// Call this in onInit
async onInit() {
  // ... existing code ...
  
  // Monitor memory usage in development mode
  if (process.env.NODE_ENV === 'development') {
    this.monitorMemoryUsage();
  }
  
  // ... rest of onInit ...
}

// Clean up in onUninit
async onUninit() {
  // ... existing code ...
  
  if (this.memoryUsageInterval) {
    clearInterval(this.memoryUsageInterval);
  }
  
  // ... rest of onUninit ...
}
```

## Testing Procedures

1. **API Call Optimization Tests**:
   - Measure API call frequency before and after changes
   - Test throttling behavior under high load
   - Verify API calls are properly spaced

2. **Caching Tests**:
   - Verify cached data is returned when appropriate
   - Test cache invalidation after TTL expires
   - Measure performance improvement with caching

3. **Algorithm Efficiency Tests**:
   - Benchmark temperature calculation algorithm
   - Test with various price and COP scenarios
   - Verify results match expected values

4. **Memory Management Tests**:
   - Monitor memory usage over extended periods
   - Verify old data is properly cleaned up
   - Test with large datasets to ensure stability

## Expected Outcomes

1. Reduced API call frequency and better compliance with rate limits
2. Faster response times due to caching
3. More efficient temperature optimization algorithm
4. Stable memory usage even with extended operation

## Verification Steps

1. Run performance benchmarks before and after changes
2. Monitor API call patterns in production
3. Track memory usage over time
4. Verify system stability under load
