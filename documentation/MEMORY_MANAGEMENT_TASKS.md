# MELCloud Optimizer: Memory Management Developer Tasks

> **Actionable developer tasks to fix memory leaks and improve memory management in the thermal model service**

**Last Updated:** August 22, 2025  
**Status:** 🔴 Critical Issues Identified - Immediate Action Required

---

## 🚨 PHASE 1: CRITICAL MEMORY LEAK FIXES (Week 1)
**Priority:** P0 - Must be completed within 48-72 hours

### Task 1.1: Implement Thermal Model Service Cleanup in App Shutdown
- [ ] **File:** `src/app.ts`
- [ ] **Estimated Time:** 30 minutes
- [ ] **Risk Level:** 🔴 Critical

#### Implementation Steps:
1. [ ] Locate the `onUninit()` method in `src/app.ts` (around line 1200)
2. [ ] Add thermal model service cleanup call
3. [ ] Add error handling for cleanup failures
4. [ ] Test that cleanup is called during app shutdown

#### Code Changes Required:
```typescript
// In src/app.ts - onUninit method
async onUninit() {
  try {
    this.logger.marker('MELCloud Optimizer App shutting down');

    // ADD THIS: Thermal model service cleanup
    if (this.thermalModelService) {
      try {
        this.thermalModelService.stop();
        this.logger.info('Thermal model service stopped successfully');
      } catch (error) {
        this.logger.error('Error stopping thermal model service:', error);
      }
    }

    // ADD THIS: Hot water service cleanup  
    if (this.hotWaterService) {
      try {
        this.hotWaterService.stop(); // Need to implement this method first
        this.logger.info('Hot water service stopped successfully');
      } catch (error) {
        this.logger.error('Error stopping hot water service:', error);
      }
    }

    // Existing cleanup code continues...
    if (this.hourlyJob) {
      this.hourlyJob.stop();
      this.logger.info('Hourly cron job stopped');
    }
    // ... rest of existing cleanup
  } catch (error) {
    this.logger.error('Error during app shutdown:', error);
  }
}
```

#### Verification Steps:
- [ ] Verify `thermalModelService` property exists in app class
- [ ] Test app shutdown and check logs for cleanup messages
- [ ] Verify no intervals remain active after shutdown

**Completion Notes:**
```
Date Completed: ___________
Developer: ___________
Issues Encountered: ___________
```

---

### Task 1.2: Enhance Thermal Model Service Interval Cleanup
- [ ] **File:** `src/services/thermal-model/thermal-model-service.ts`
- [ ] **Estimated Time:** 45 minutes
- [ ] **Risk Level:** 🔴 Critical

#### Implementation Steps:
1. [ ] Enhance the existing `stop()` method (around line 564)
2. [ ] Add verification that intervals are actually cleared
3. [ ] Add timeout tracking for setTimeout calls
4. [ ] Implement robust error handling

#### Code Changes Required:
```typescript
// In src/services/thermal-model/thermal-model-service.ts
export class ThermalModelService {
  private dataCollectionInterval: NodeJS.Timeout | null = null;
  private modelUpdateInterval: NodeJS.Timeout | null = null;
  private dataCleanupInterval: NodeJS.Timeout | null = null;
  // ADD THESE: Track setTimeout calls
  private initialModelUpdateTimeout: NodeJS.Timeout | null = null;
  private initialDataCleanupTimeout: NodeJS.Timeout | null = null;

  private scheduleModelUpdates(): void {
    // Existing setInterval code...

    // MODIFY THESE: Store timeout references
    this.initialModelUpdateTimeout = setTimeout(() => {
      this.updateThermalModel();
    }, 30 * 60 * 1000);

    this.initialDataCleanupTimeout = setTimeout(() => {
      this.cleanupOldData();
    }, 60 * 60 * 1000);
  }

  // ENHANCE EXISTING stop() method
  public stop(): void {
    try {
      this.homey.log('Stopping thermal model service...');

      // Run final data cleanup first
      try {
        this.cleanupOldData();
      } catch (cleanupError) {
        this.homey.error('Error during final data cleanup:', cleanupError);
      }

      // Enhanced interval cleanup with verification
      const intervals = [
        { ref: this.dataCollectionInterval, name: 'dataCollection' },
        { ref: this.modelUpdateInterval, name: 'modelUpdate' },
        { ref: this.dataCleanupInterval, name: 'dataCleanup' },
        { ref: this.initialModelUpdateTimeout, name: 'initialModelUpdate' },
        { ref: this.initialDataCleanupTimeout, name: 'initialDataCleanup' }
      ];

      intervals.forEach(({ ref, name }) => {
        if (ref) {
          clearInterval(ref); // Works for both setInterval and setTimeout
          this.homey.log(`${name} timer cleared successfully`);
        }
      });

      // Force nullify all references
      this.dataCollectionInterval = null;
      this.modelUpdateInterval = null;
      this.dataCleanupInterval = null;
      this.initialModelUpdateTimeout = null;
      this.initialDataCleanupTimeout = null;

      // Log final memory statistics
      try {
        const memoryStats = this.dataCollector.getMemoryUsage();
        this.homey.log(`Final memory stats - Data points: ${memoryStats.dataPointCount}, Memory: ${memoryStats.estimatedMemoryUsageKB}KB`);
      } catch (statsError) {
        this.homey.error('Error getting final memory statistics:', statsError);
      }

      this.homey.log('Thermal model service stopped and all resources cleaned up');
    } catch (error) {
      this.homey.error('Error stopping thermal model service:', error);
      throw error; // Re-throw to ensure caller knows cleanup failed
    }
  }
}
```

#### Verification Steps:
- [ ] Test that all intervals are cleared when `stop()` is called
- [ ] Verify no memory leaks after multiple start/stop cycles
- [ ] Check logs show all timers being cleared

**Completion Notes:**
```
Date Completed: ___________
Developer: ___________
Issues Encountered: ___________
```

---

### Task 1.3: Implement Hot Water Service Stop Method
- [ ] **File:** `src/services/hot-water/hot-water-service.ts`
- [ ] **Estimated Time:** 30 minutes
- [ ] **Risk Level:** 🟡 Medium

#### Implementation Steps:
1. [ ] Add `stop()` method to HotWaterService class
2. [ ] Identify any timers or intervals that need cleanup
3. [ ] Add memory cleanup for data collector

#### Code Changes Required:
```typescript
// In src/services/hot-water/hot-water-service.ts
export class HotWaterService {
  // ... existing code ...

  /**
   * Stop the hot water service and clean up resources
   */
  public stop(): void {
    try {
      this.homey.log('Stopping hot water service...');

      // Reset collection timers
      this.lastDataCollectionTime = 0;
      this.lastAnalysisTime = 0;

      // Clean up any data collector resources
      if (this.dataCollector) {
        try {
          // Force a final save of data
          const memoryBefore = this.dataCollector.getMemoryUsage();
          this.homey.log(`Hot water service stopping - final memory usage: ${memoryBefore.usageKB}KB`);
          
          // Note: DataCollector doesn't have intervals, but we should save data
          // The clearData method exists but we don't want to clear on shutdown
        } catch (error) {
          this.homey.error('Error during hot water data cleanup:', error);
        }
      }

      this.homey.log('Hot water service stopped successfully');
    } catch (error) {
      this.homey.error('Error stopping hot water service:', error);
      throw error;
    }
  }

  /**
   * Get service status for debugging
   */
  public getStatus(): any {
    return {
      lastDataCollection: new Date(this.lastDataCollectionTime).toISOString(),
      lastAnalysis: new Date(this.lastAnalysisTime).toISOString(),
      dataCollectionInterval: this.dataCollectionInterval,
      analysisInterval: this.analysisInterval,
      memoryUsage: this.dataCollector ? this.dataCollector.getMemoryUsage() : null
    };
  }
}
```

#### Verification Steps:
- [ ] Test that `stop()` method can be called without errors
- [ ] Verify service stops data collection after `stop()` is called
- [ ] Check memory usage is logged on shutdown

**Completion Notes:**
```
Date Completed: ___________
Developer: ___________
Issues Encountered: ___________
```

---

### Task 1.4: Reduce Memory Usage Thresholds
- [ ] **File:** `src/services/thermal-model/data-collector.ts`
- [ ] **Estimated Time:** 20 minutes
- [ ] **Risk Level:** 🔴 Critical

#### Implementation Steps:
1. [ ] Locate memory usage check method (around line 300)
2. [ ] Reduce warning threshold from 80% to 60%
3. [ ] Add critical threshold at 75% with emergency stop
4. [ ] Implement emergency stop mechanism

#### Code Changes Required:
```typescript
// In src/services/thermal-model/data-collector.ts
// MODIFY existing checkMemoryUsage method around line 300

private checkMemoryUsage(): void {
  try {
    // Only check memory usage every 10 minutes to avoid excessive logging
    const now = Date.now();
    if (now - this.lastMemoryCheck < 10 * 60 * 1000) {
      return;
    }

    this.lastMemoryCheck = now;

    // Get memory usage if available
    if (process && process.memoryUsage) {
      const memoryUsage = process.memoryUsage();
      const heapUsedMB = Math.round(memoryUsage.heapUsed / 1024 / 1024 * 100) / 100;
      const heapTotalMB = Math.round(memoryUsage.heapTotal / 1024 / 1024 * 100) / 100;
      const usagePercentage = Math.round((heapUsedMB / heapTotalMB) * 100);

      this.homey.log(`Memory usage: ${heapUsedMB}MB / ${heapTotalMB}MB (${usagePercentage}%)`);

      // CHANGE: Lower thresholds for better safety
      if (usagePercentage > 60 && !this.memoryWarningIssued) {
        this.homey.error(`High memory usage detected: ${usagePercentage}%. Triggering data cleanup.`);
        this.memoryWarningIssued = true;
        this.aggregateOlderData();
      } else if (usagePercentage > 75) {
        // NEW: Critical threshold with emergency stop
        this.homey.error(`CRITICAL memory usage: ${usagePercentage}%. Activating emergency data reduction.`);
        this.emergencyMemoryCleanup();
      } else if (usagePercentage < 50) {
        // Reset warning flag when memory usage drops significantly
        this.memoryWarningIssued = false;
      }
    }
  } catch (error) {
    this.homey.error(`Error checking memory usage: ${error}`);
  }
}

// ADD NEW METHOD: Emergency memory cleanup
private emergencyMemoryCleanup(): void {
  try {
    this.homey.error('EMERGENCY: Performing aggressive memory cleanup');
    
    // Keep only the most recent 100 data points
    if (this.dataPoints.length > 100) {
      const originalCount = this.dataPoints.length;
      this.dataPoints = this.dataPoints.slice(-100);
      this.homey.error(`Emergency cleanup: Reduced data points from ${originalCount} to ${this.dataPoints.length}`);
    }

    // Force aggregation of all remaining older data
    this.aggregateOlderData();
    
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
      this.homey.log('Forced garbage collection');
    }

    // Save reduced dataset immediately
    this.saveData();
    
    this.homey.error('Emergency memory cleanup completed');
  } catch (error) {
    this.homey.error(`Error during emergency memory cleanup: ${error}`);
  }
}
```

#### Verification Steps:
- [ ] Test memory warnings trigger at 60% instead of 80%
- [ ] Test emergency cleanup triggers at 75%
- [ ] Verify data points are aggressively reduced during emergency

**Completion Notes:**
```
Date Completed: ___________
Developer: ___________
Issues Encountered: ___________
```

---

## 🔧 PHASE 2: ENHANCED MONITORING (Week 2)
**Priority:** P1 - Implement after Phase 1 is complete

### Task 2.1: Add Memory Usage Trending and Prediction
- [ ] **File:** `src/services/thermal-model/data-collector.ts`
- [ ] **Estimated Time:** 2 hours
- [ ] **Risk Level:** 🟡 Medium

#### Implementation Steps:
1. [ ] Add memory usage history tracking
2. [ ] Implement trend analysis
3. [ ] Add predictive warnings

#### Code Changes Required:
```typescript
// ADD to ThermalDataCollector class
interface MemoryUsageHistory {
  timestamp: number;
  heapUsedMB: number;
  dataPointCount: number;
}

export class ThermalDataCollector {
  // ADD these properties
  private memoryHistory: MemoryUsageHistory[] = [];
  private maxMemoryHistoryLength: number = 144; // 24 hours of 10-minute intervals

  // MODIFY checkMemoryUsage to include trending
  private checkMemoryUsage(): void {
    // ... existing memory check code ...

    // ADD: Track memory usage history
    this.memoryHistory.push({
      timestamp: now,
      heapUsedMB,
      dataPointCount: this.dataPoints.length
    });

    // Keep only recent history
    if (this.memoryHistory.length > this.maxMemoryHistoryLength) {
      this.memoryHistory = this.memoryHistory.slice(-this.maxMemoryHistoryLength);
    }

    // ADD: Check for memory growth trends
    this.checkMemoryTrends();
  }

  // ADD: Memory trend analysis
  private checkMemoryTrends(): void {
    if (this.memoryHistory.length < 6) return; // Need at least 1 hour of data

    const recent = this.memoryHistory.slice(-6); // Last hour
    const older = this.memoryHistory.slice(-12, -6); // Previous hour

    const recentAvg = recent.reduce((sum, h) => sum + h.heapUsedMB, 0) / recent.length;
    const olderAvg = older.reduce((sum, h) => sum + h.heapUsedMB, 0) / older.length;

    const growthRate = (recentAvg - olderAvg) / olderAvg;

    if (growthRate > 0.1) { // 10% growth in an hour
      this.homey.warn(`Memory growing rapidly: ${(growthRate * 100).toFixed(1)}% in last hour`);
      this.homey.warn(`Predicted memory exhaustion in ${this.predictMemoryExhaustion()} hours`);
    }
  }

  // ADD: Predict when memory will be exhausted
  private predictMemoryExhaustion(): number {
    if (this.memoryHistory.length < 12) return -1;

    const recent = this.memoryHistory.slice(-12);
    const growthPerHour = (recent[recent.length - 1].heapUsedMB - recent[0].heapUsedMB) / (recent.length / 6);
    
    if (growthPerHour <= 0) return -1; // Not growing

    const currentMemory = recent[recent.length - 1].heapUsedMB;
    const availableMemory = 100 - currentMemory; // Assume 100MB limit
    
    return availableMemory / growthPerHour;
  }

  // ADD: Get memory statistics for monitoring
  public getMemoryStatistics(): any {
    return {
      current: this.memoryHistory[this.memoryHistory.length - 1],
      trend: this.memoryHistory.length >= 6 ? this.calculateTrend() : null,
      prediction: this.predictMemoryExhaustion()
    };
  }

  private calculateTrend(): string {
    if (this.memoryHistory.length < 6) return 'insufficient_data';
    
    const recent = this.memoryHistory.slice(-3);
    const older = this.memoryHistory.slice(-6, -3);
    
    const recentAvg = recent.reduce((sum, h) => sum + h.heapUsedMB, 0) / recent.length;
    const olderAvg = older.reduce((sum, h) => sum + h.heapUsedMB, 0) / older.length;
    
    const diff = recentAvg - olderAvg;
    
    if (diff > 2) return 'increasing';
    if (diff < -2) return 'decreasing';
    return 'stable';
  }
}
```

#### Verification Steps:
- [ ] Test memory history is collected correctly
- [ ] Verify trend analysis provides useful insights
- [ ] Test prediction algorithm with simulated memory growth

**Completion Notes:**
```
Date Completed: ___________
Developer: ___________
Issues Encountered: ___________
```

---

### Task 2.2: Add Comprehensive Memory Leak Detection Tests
- [ ] **File:** `test/unit/memory-leak-detection.test.ts` (new file)
- [ ] **Estimated Time:** 3 hours
- [ ] **Risk Level:** 🟡 Medium

#### Implementation Steps:
1. [ ] Create new test file for memory leak detection
2. [ ] Add tests for interval cleanup
3. [ ] Add tests for data accumulation limits
4. [ ] Add long-running stress tests

#### Code Changes Required:
```typescript
// CREATE NEW FILE: test/unit/memory-leak-detection.test.ts
import { ThermalModelService } from '../../src/services/thermal-model/thermal-model-service';
import { ThermalDataCollector } from '../../src/services/thermal-model/data-collector';
import { createMockHomey } from '../mocks/homey.mock';

describe('Memory Leak Detection', () => {
  let mockHomey: any;
  let thermalService: ThermalModelService;

  beforeEach(() => {
    mockHomey = createMockHomey();
  });

  afterEach(() => {
    if (thermalService) {
      thermalService.stop();
    }
  });

  describe('Interval Cleanup', () => {
    it('should clear all intervals when service stops', async () => {
      // Track active handles before creating service
      const handlesBefore = process._getActiveHandles().length;
      
      thermalService = new ThermalModelService(mockHomey);
      
      // Wait for intervals to be created
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const handlesAfterStart = process._getActiveHandles().length;
      expect(handlesAfterStart).toBeGreaterThan(handlesBefore);
      
      // Stop service
      thermalService.stop();
      
      // Wait for cleanup
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const handlesAfterStop = process._getActiveHandles().length;
      expect(handlesAfterStop).toBeLessThanOrEqual(handlesBefore);
    });

    it('should handle stop() being called multiple times', () => {
      thermalService = new ThermalModelService(mockHomey);
      
      // Should not throw when called multiple times
      expect(() => {
        thermalService.stop();
        thermalService.stop();
        thermalService.stop();
      }).not.toThrow();
    });
  });

  describe('Data Accumulation Limits', () => {
    it('should not exceed maximum data points', async () => {
      const dataCollector = new ThermalDataCollector(mockHomey);
      
      // Add more data points than the limit
      for (let i = 0; i < 3000; i++) {
        dataCollector.addDataPoint({
          timestamp: new Date(Date.now() + i * 1000).toISOString(),
          indoorTemperature: 20,
          outdoorTemperature: 10,
          targetTemperature: 21,
          heatingActive: false,
          weatherConditions: {
            windSpeed: 5,
            humidity: 60,
            cloudCover: 30,
            precipitation: 0
          }
        });
      }
      
      const allDataPoints = dataCollector.getAllDataPoints();
      expect(allDataPoints.length).toBeLessThanOrEqual(2016);
    });

    it('should trigger emergency cleanup at high memory usage', async () => {
      const dataCollector = new ThermalDataCollector(mockHomey);
      
      // Mock high memory usage
      const originalMemoryUsage = process.memoryUsage;
      process.memoryUsage = () => ({
        rss: 100 * 1024 * 1024,
        heapTotal: 100 * 1024 * 1024,
        heapUsed: 80 * 1024 * 1024, // 80% usage
        external: 10 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024
      });
      
      // Add data to trigger memory check
      dataCollector.addDataPoint({
        timestamp: new Date().toISOString(),
        indoorTemperature: 20,
        outdoorTemperature: 10,
        targetTemperature: 21,
        heatingActive: false,
        weatherConditions: {
          windSpeed: 5,
          humidity: 60,
          cloudCover: 30,
          precipitation: 0
        }
      });
      
      // Restore original function
      process.memoryUsage = originalMemoryUsage;
      
      // Should have triggered memory warning
      expect(mockHomey.error).toHaveBeenCalledWith(
        expect.stringContaining('High memory usage detected')
      );
    });
  });

  describe('Memory Growth Stress Test', () => {
    it('should maintain stable memory usage over extended operation', async () => {
      if (!global.gc) {
        console.log('Skipping memory stress test - garbage collection not available');
        return;
      }

      const initialMemory = process.memoryUsage().heapUsed;
      thermalService = new ThermalModelService(mockHomey);
      
      // Simulate extended operation
      for (let i = 0; i < 1000; i++) {
        await thermalService.collectDataPoint({
          timestamp: new Date(Date.now() + i * 60000).toISOString(),
          indoorTemperature: 20 + Math.random() * 5,
          outdoorTemperature: 10 + Math.random() * 10,
          targetTemperature: 21,
          heatingActive: Math.random() > 0.5,
          weatherConditions: {
            windSpeed: Math.random() * 20,
            humidity: 50 + Math.random() * 30,
            cloudCover: Math.random() * 100,
            precipitation: Math.random() * 10
          }
        });
        
        // Periodic memory check
        if (i % 100 === 0) {
          global.gc();
          const currentMemory = process.memoryUsage().heapUsed;
          const memoryGrowth = currentMemory - initialMemory;
          
          // Should not grow by more than 20MB
          expect(memoryGrowth).toBeLessThan(20 * 1024 * 1024);
        }
      }
      
      thermalService.stop();
      global.gc();
      
      const finalMemory = process.memoryUsage().heapUsed;
      const totalGrowth = finalMemory - initialMemory;
      
      // Final memory should not have grown significantly
      expect(totalGrowth).toBeLessThan(10 * 1024 * 1024);
    }, 30000); // 30 second timeout
  });
});
```

#### Verification Steps:
- [ ] All tests pass successfully
- [ ] Tests detect actual memory leaks when introduced
- [ ] Stress test completes without memory growth

**Completion Notes:**
```
Date Completed: ___________
Developer: ___________
Issues Encountered: ___________
```

---

## 🚀 PHASE 3: ARCHITECTURAL IMPROVEMENTS (Week 3-4)
**Priority:** P2 - Implement after Phase 2 is complete

### Task 3.1: Standardize Service Lifecycle Management
- [ ] **File:** `src/util/service-lifecycle.ts` (new file)
- [ ] **Estimated Time:** 4 hours
- [ ] **Risk Level:** 🟢 Low

#### Implementation Steps:
1. [ ] Create service lifecycle interface
2. [ ] Implement central resource manager
3. [ ] Update existing services to use new interface

#### Code Changes Required:
```typescript
// CREATE NEW FILE: src/util/service-lifecycle.ts
export interface MemoryStats {
  heapUsedMB: number;
  dataPointCount: number;
  estimatedMemoryUsageKB: number;
}

export enum ServiceStatus {
  STOPPED = 'stopped',
  STARTING = 'starting',
  RUNNING = 'running',
  STOPPING = 'stopping',
  ERROR = 'error'
}

export interface ServiceLifecycle {
  start(): Promise<void>;
  stop(): Promise<void>;
  getStatus(): ServiceStatus;
  getMemoryUsage(): MemoryStats;
  getName(): string;
}

export class ResourceManager {
  private services: Map<string, ServiceLifecycle> = new Map();
  private logger: any;

  constructor(logger: any) {
    this.logger = logger;
  }

  public register(service: ServiceLifecycle): void {
    const name = service.getName();
    if (this.services.has(name)) {
      throw new Error(`Service ${name} is already registered`);
    }
    
    this.services.set(name, service);
    this.logger.log(`Service ${name} registered with resource manager`);
  }

  public async stopAll(): Promise<void> {
    this.logger.log('Stopping all registered services...');
    
    const stopPromises = Array.from(this.services.entries()).map(async ([name, service]) => {
      try {
        await service.stop();
        this.logger.log(`Service ${name} stopped successfully`);
      } catch (error) {
        this.logger.error(`Error stopping service ${name}:`, error);
        throw error;
      }
    });

    await Promise.allSettled(stopPromises);
    this.logger.log('All services stop attempts completed');
  }

  public getOverallMemoryUsage(): MemoryStats {
    let totalHeapUsed = 0;
    let totalDataPoints = 0;
    let totalEstimatedMemory = 0;

    for (const [name, service] of this.services) {
      try {
        const stats = service.getMemoryUsage();
        totalHeapUsed += stats.heapUsedMB;
        totalDataPoints += stats.dataPointCount;
        totalEstimatedMemory += stats.estimatedMemoryUsageKB;
      } catch (error) {
        this.logger.error(`Error getting memory usage for service ${name}:`, error);
      }
    }

    return {
      heapUsedMB: totalHeapUsed,
      dataPointCount: totalDataPoints,
      estimatedMemoryUsageKB: totalEstimatedMemory
    };
  }

  public getServiceStatuses(): Record<string, ServiceStatus> {
    const statuses: Record<string, ServiceStatus> = {};
    
    for (const [name, service] of this.services) {
      try {
        statuses[name] = service.getStatus();
      } catch (error) {
        this.logger.error(`Error getting status for service ${name}:`, error);
        statuses[name] = ServiceStatus.ERROR;
      }
    }

    return statuses;
  }
}
```

#### Verification Steps:
- [ ] Resource manager can register services
- [ ] `stopAll()` method stops all services successfully
- [ ] Memory usage aggregation works correctly

**Completion Notes:**
```
Date Completed: ___________
Developer: ___________
Issues Encountered: ___________
```

---

### Task 3.2: Update Thermal Model Service to Use Lifecycle Interface
- [ ] **File:** `src/services/thermal-model/thermal-model-service.ts`
- [ ] **Estimated Time:** 1 hour
- [ ] **Risk Level:** 🟢 Low

#### Implementation Steps:
1. [ ] Implement ServiceLifecycle interface
2. [ ] Add status tracking
3. [ ] Update memory usage reporting

#### Code Changes Required:
```typescript
// In src/services/thermal-model/thermal-model-service.ts
import { ServiceLifecycle, ServiceStatus, MemoryStats } from '../../util/service-lifecycle';

export class ThermalModelService implements ServiceLifecycle {
  // ADD status tracking
  private status: ServiceStatus = ServiceStatus.STOPPED;

  constructor(private homey: HomeyApp) {
    this.dataCollector = new ThermalDataCollector(homey);
    this.analyzer = new ThermalAnalyzer(homey);
    
    // Don't auto-start, wait for explicit start() call
  }

  // IMPLEMENT ServiceLifecycle interface
  public async start(): Promise<void> {
    if (this.status === ServiceStatus.RUNNING) {
      return; // Already running
    }

    this.status = ServiceStatus.STARTING;
    try {
      this.scheduleModelUpdates();
      this.status = ServiceStatus.RUNNING;
      this.homey.log('Thermal model service started successfully');
    } catch (error) {
      this.status = ServiceStatus.ERROR;
      throw error;
    }
  }

  public async stop(): Promise<void> {
    if (this.status === ServiceStatus.STOPPED) {
      return; // Already stopped
    }

    this.status = ServiceStatus.STOPPING;
    try {
      // Existing stop logic...
      
      this.status = ServiceStatus.STOPPED;
      this.homey.log('Thermal model service stopped successfully');
    } catch (error) {
      this.status = ServiceStatus.ERROR;
      throw error;
    }
  }

  public getStatus(): ServiceStatus {
    return this.status;
  }

  public getMemoryUsage(): MemoryStats {
    try {
      const stats = this.dataCollector.getMemoryUsage();
      const processMemory = process.memoryUsage();
      
      return {
        heapUsedMB: Math.round(processMemory.heapUsed / 1024 / 1024 * 100) / 100,
        dataPointCount: stats.dataPointCount,
        estimatedMemoryUsageKB: stats.estimatedMemoryUsageKB
      };
    } catch (error) {
      this.homey.error('Error getting thermal model memory usage:', error);
      return {
        heapUsedMB: 0,
        dataPointCount: 0,
        estimatedMemoryUsageKB: 0
      };
    }
  }

  public getName(): string {
    return 'ThermalModelService';
  }
}
```

#### Verification Steps:
- [ ] Service implements all interface methods
- [ ] Status is tracked correctly through lifecycle
- [ ] Memory usage is reported accurately

**Completion Notes:**
```
Date Completed: ___________
Developer: ___________
Issues Encountered: ___________
```

---

### Task 3.3: Integrate Resource Manager in App
- [ ] **File:** `src/app.ts`
- [ ] **Estimated Time:** 1 hour
- [ ] **Risk Level:** 🟢 Low

#### Implementation Steps:
1. [ ] Add ResourceManager to app
2. [ ] Register services with manager
3. [ ] Use manager for shutdown

#### Code Changes Required:
```typescript
// In src/app.ts
import { ResourceManager } from './util/service-lifecycle';

export default class HeatOptimizerApp extends App {
  // ADD resource manager
  private resourceManager: ResourceManager;

  async onInit() {
    // Initialize resource manager
    this.resourceManager = new ResourceManager(this.logger);

    // ... existing initialization ...

    // MODIFY service initialization to use lifecycle
    if (this.thermalModelService) {
      this.resourceManager.register(this.thermalModelService);
      await this.thermalModelService.start();
    }

    if (this.hotWaterService) {
      this.resourceManager.register(this.hotWaterService);
      await this.hotWaterService.start();
    }
  }

  async onUninit() {
    try {
      this.logger.marker('MELCloud Optimizer App shutting down');

      // REPLACE individual service stops with resource manager
      if (this.resourceManager) {
        await this.resourceManager.stopAll();
        this.logger.info('All services stopped via resource manager');
      }

      // ... rest of existing cleanup ...
    } catch (error) {
      this.logger.error('Error during app shutdown:', error);
    }
  }

  // ADD method to get overall system status
  public getSystemStatus(): any {
    return {
      app: 'running',
      services: this.resourceManager ? this.resourceManager.getServiceStatuses() : {},
      memory: this.resourceManager ? this.resourceManager.getOverallMemoryUsage() : null
    };
  }
}
```

#### Verification Steps:
- [ ] Services are registered correctly
- [ ] Resource manager stops all services on app shutdown
- [ ] System status provides useful information

**Completion Notes:**
```
Date Completed: ___________
Developer: ___________
Issues Encountered: ___________
```

---

## 📊 TESTING AND VALIDATION CHECKLIST

### Phase 1 Validation
- [ ] **Memory Usage Test:** Run app for 24 hours, verify memory usage stays below 60MB
- [ ] **Shutdown Test:** Stop and restart app 10 times, verify no interval leaks
- [ ] **Emergency Cleanup Test:** Simulate high memory usage, verify emergency cleanup works
- [ ] **Service Stop Test:** Call service stop methods directly, verify cleanup

### Phase 2 Validation  
- [ ] **Trend Analysis Test:** Generate memory growth patterns, verify trend detection
- [ ] **Memory Leak Test:** Run automated tests, verify all pass
- [ ] **Long-running Test:** Run stress test for 6+ hours, verify stability

### Phase 3 Validation
- [ ] **Lifecycle Test:** Start/stop services via resource manager, verify proper lifecycle
- [ ] **Status Reporting Test:** Verify service statuses are reported correctly
- [ ] **Integration Test:** Test full app with new architecture, verify functionality

---

## 📈 SUCCESS METRICS

### Performance Targets
- [ ] **Memory Usage:** < 60MB heap usage under normal operation
- [ ] **Memory Growth:** < 5MB growth per 24 hours
- [ ] **Cleanup Time:** All services stop within 5 seconds
- [ ] **Error Rate:** < 1% error rate in memory operations

### Monitoring Dashboards
- [ ] **Real-time Memory Usage:** Track current heap usage
- [ ] **Memory Trends:** 24-hour and 7-day memory usage trends  
- [ ] **Service Status:** Status of all registered services
- [ ] **Cleanup Events:** Log of memory cleanup operations

---

## 🚨 ROLLBACK PLAN

If any phase causes issues:

1. **Immediate Rollback Steps:**
   - [ ] Revert to previous commit
   - [ ] Restart all services
   - [ ] Monitor for stability

2. **Fallback Configuration:**
   - [ ] Disable thermal model service if needed
   - [ ] Increase memory thresholds temporarily
   - [ ] Enable debug logging

3. **Recovery Verification:**
   - [ ] Verify app starts successfully
   - [ ] Check all core functionality works
   - [ ] Monitor memory usage for 2 hours

---

## 📝 COMPLETION SUMMARY

### Phase 1 Completion (Fill when done)
```
Completion Date: ___________
Developer: ___________
Total Time Spent: ___________
Issues Encountered: ___________
Memory Usage Before: ___________
Memory Usage After: ___________
```

### Phase 2 Completion (Fill when done)
```
Completion Date: ___________
Developer: ___________
Total Time Spent: ___________
Issues Encountered: ___________
Test Coverage: ___________
```

### Phase 3 Completion (Fill when done)
```
Completion Date: ___________
Developer: ___________
Total Time Spent: ___________
Issues Encountered: ___________
Architecture Quality: ___________
```

### Overall Project Status
- [ ] All critical memory leaks fixed
- [ ] Memory monitoring implemented
- [ ] Architecture improvements complete
- [ ] All tests passing
- [ ] Documentation updated
- [ ] Production deployment ready

**Final Sign-off:**
```
Project Manager: ___________ Date: ___________
Lead Developer: ___________ Date: ___________
QA Engineer: ___________ Date: ___________
```
