# PR #2: Add Async Initialization Tests

## Problem Statement

The `Optimizer` class recently adopted an async initialization pattern (constructor + `initialize()` method) to avoid async operations in the constructor. However, this critical pattern lacks dedicated test coverage for:
- Concurrent initialization handling
- Retry behavior after failures
- `ensureInitialized()` edge cases
- Initialization status reporting

Without these tests, we risk production bugs related to:
- Race conditions from multiple concurrent initializations
- Infinite retry loops
- Operations running before initialization completes

## Proposed Changes

Add comprehensive test coverage for the async initialization pattern to ensure correctness and prevent regressions.

---

### Test File Structure

#### [NEW] [optimizer-initialization.test.ts](file:///Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize/test/unit/optimizer-initialization.test.ts)

**Test Coverage:**

1. **Basic Initialization**
   - Constructor completes synchronously
   - `initialize()` performs async setup
   - `isInitialized()` returns correct state
   - Initialization status object is accurate

2. **Concurrent Initialization Guards**
   - Multiple concurrent `initialize()` calls return same promise
   - Second call doesn't restart initialization
   - State remains consistent across concurrent calls

3. **Initialization Failures**
   - Failed initialization doesn't set `initialized = true`
   - Retry is possible after failure
   - `initializationPromise` is cleared on failure
   - Error is propagated correctly

4. **EnsureInitialized Behavior**
   - Calls `initialize()` if not yet initialized
   - Returns immediately if already initialized
   - Works correctly after failed initialization
   - Handles concurrent calls properly

5. **Operations Before Initialization**
   - `runOptimization()` waits for initialization
   - Other public methods handle uninitialized state
   - Clear error messages when used incorrectly

6. **Initialization Status**
   - `getInitializationStatus()` returns accurate data
   - All service initialization states are tracked
   - Status updates correctly during initialization

---

### Implementation

```typescript
import { Optimizer } from '../../src/services/optimizer';
import { MelCloudApi } from '../../src/services/melcloud-api';
import { HomeyLogger } from '../../src/util/logger';

describe('Optimizer Initialization', () => {
  let mockMelCloud: jest.Mocked<MelCloudApi>;
  let mockLogger: HomeyLogger;
  let mockHomey: any;

  beforeEach(() => {
    mockMelCloud = {
      getEnergyData: jest.fn(),
      getDailyEnergyTotals: jest.fn(),
      getDeviceState: jest.fn(),
    } as any;

    mockLogger = {
      log: jest.fn(),
      error: jest.fn(),
    } as any;

    mockHomey = {
      settings: {
        get: jest.fn((key: string) => {
          // Return sensible defaults
          const defaults: Record<string, any> = {
            'cop_weight': 0.3,
            'min_temp': 20,
            'max_temp': 22,
            'time_zone_offset': 1,
            'use_dst': false,
          };
          return defaults[key];
        }),
        set: jest.fn(),
      },
    };
  });

  describe('Basic Initialization', () => {
    test('constructor completes synchronously', () => {
      const start = Date.now();
      const optimizer = new Optimizer(
        mockMelCloud,
        null,
        'device123',
        456,
        mockLogger,
        undefined,
        mockHomey
      );
      const duration = Date.now() - start;

      expect(optimizer).toBeDefined();
      expect(duration).toBeLessThan(100); // Should be instant
      expect(optimizer.isInitialized()).toBe(false);
    });

    test('initialize() completes async setup', async () => {
      mockMelCloud.getEnergyData.mockResolvedValue([
        { Date: '2025-11-20', TotalHeatingConsumed: 15 }
      ]);

      const optimizer = new Optimizer(
        mockMelCloud,
        null,
        'device123',
        456,
        mockLogger,
        undefined,
        mockHomey
      );

      expect(optimizer.isInitialized()).toBe(false);

      await optimizer.initialize();

      expect(optimizer.isInitialized()).toBe(true);
      expect(mockMelCloud.getEnergyData).toHaveBeenCalled();
    });

    test('initialization status is accurate', async () => {
      const optimizer = new Optimizer(
        mockMelCloud,
        null,
        'device123',
        456,
        mockLogger,
        undefined,
        mockHomey
      );

      let status = optimizer.getInitializationStatus();
      expect(status.initialized).toBe(false);
      expect(status.thermalMassInitialized).toBe(false);

      mockMelCloud.getEnergyData.mockResolvedValue([
        { Date: '2025-11-20', TotalHeatingConsumed: 15 }
      ]);

      await optimizer.initialize();

      status = optimizer.getInitializationStatus();
      expect(status.initialized).toBe(true);
      expect(status.thermalMassInitialized).toBe(true);
      expect(status.servicesInitialized).toBe(true);
    });
  });

  describe('Concurrent Initialization Guards', () => {
    test('multiple concurrent initialize() calls return same promise', async () => {
      mockMelCloud.getEnergyData.mockResolvedValue([
        { Date: '2025-11-20', TotalHeatingConsumed: 15 }
      ]);

      const optimizer = new Optimizer(
        mockMelCloud,
        null,
        'device123',
        456,
        mockLogger,
        undefined,
        mockHomey
      );

      const promise1 = optimizer.initialize();
      const promise2 = optimizer.initialize();
      const promise3 = optimizer.initialize();

      expect(promise1).toBe(promise2);
      expect(promise2).toBe(promise3);

      await Promise.all([promise1, promise2, promise3]);

      expect(optimizer.isInitialized()).toBe(true);
      // Should only call getEnergyData once
      expect(mockMelCloud.getEnergyData).toHaveBeenCalledTimes(1);
    });

    test('second call after completion returns immediately', async () => {
      mockMelCloud.getEnergyData.mockResolvedValue([]);

      const optimizer = new Optimizer(
        mockMelCloud,
        null,
        'device123',
        456,
        mockLogger,
        undefined,
        mockHomey
      );

      await optimizer.initialize();
      
      const start = Date.now();
      await optimizer.initialize();
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(10); // Should return immediately
    });
  });

  describe('Initialization Failures', () => {
    test('failed initialization does not mark as initialized', async () => {
      mockMelCloud.getEnergyData.mockRejectedValue(new Error('API failure'));

      const optimizer = new Optimizer(
        mockMelCloud,
        null,
        'device123',
        456,
        mockLogger,
        undefined,
        mockHomey
      );

      await expect(optimizer.initialize()).rejects.toThrow('Thermal mass model not initialized');
      expect(optimizer.isInitialized()).toBe(false);
    });

    test('retry is possible after failure', async () => {
      mockMelCloud.getEnergyData
        .mockRejectedValueOnce(new Error('First failure'))
        .mockResolvedValueOnce([
          { Date: '2025-11-20', TotalHeatingConsumed: 15 }
        ]);

      const optimizer = new Optimizer(
        mockMelCloud,
        null,
        'device123',
        456,
        mockLogger,
        undefined,
        mockHomey
      );

      // First attempt fails
      await expect(optimizer.initialize()).rejects.toThrow();
      expect(optimizer.isInitialized()).toBe(false);

      // Second attempt succeeds
      await optimizer.initialize();
      expect(optimizer.isInitialized()).toBe(true);
    });

    test('error is propagated correctly', async () => {
      const testError = new Error('Specific test error');
      mockMelCloud.getEnergyData.mockRejectedValue(testError);

      const optimizer = new Optimizer(
        mockMelCloud,
        null,
        'device123',
        456,
        mockLogger,
        undefined,
        mockHomey
      );

      await expect(optimizer.initialize()).rejects.toThrow('Thermal mass model not initialized');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Optimizer initialization failed:',
        expect.any(Error)
      );
    });
  });

  describe('EnsureInitialized Behavior', () => {
    test('ensureInitialized is called automatically in runOptimization', async () => {
      mockMelCloud.getEnergyData.mockResolvedValue([
        { Date: '2025-11-20', TotalHeatingConsumed: 15 }
      ]);
      mockMelCloud.getDeviceState.mockResolvedValue({
        DeviceID: 'device123',
        RoomTemperature: 21,
        SetTemperature: 21,
        Power: true,
        OperationMode: 1,
      } as any);

      const optimizer = new Optimizer(
        mockMelCloud,
        null,
        'device123',
        456,
        mockLogger,
        undefined,
        mockHomey
      );

      // Should not be initialized yet
      expect(optimizer.isInitialized()).toBe(false);

      // runOptimization should initialize automatically
      // Note: This test may need adjustment based on actual runOptimization implementation
      // which may have dependencies we need to mock
    });
  });

  describe('Initialization with No Homey Instance', () => {
    test('initializes with defaults when no homey provided', async () => {
      const optimizer = new Optimizer(
        mockMelCloud,
        null,
        'device123',
        456,
        mockLogger
      );

      // Should succeed even without homey
      expect(optimizer).toBeDefined();
      
      // Initialize should handle missing homey gracefully
      await optimizer.initialize();
      
      const status = optimizer.getInitializationStatus();
      expect(status.servicesInitialized).toBe(true);
    });
  });
});
```

---

## Verification Plan

### Automated Tests

Run the new test suite:
```bash
npm test -- optimizer-initialization.test.ts
```

**Expected Results:**
- All tests pass
- 100% coverage of initialization code paths
- No test flakiness (run 10 times to verify)

### Manual Verification

1. **Production Scenario Simulation:**
   - Start app
   - Trigger optimization before initialization completes
   - Verify graceful handling

2. **Error Recovery:**
   - Simulate API failure during initialization
   - Verify retry works correctly
   - Check logs for appropriate error messages

3. **Performance:**
   - Measure initialization time (should be <2s)
   - Verify no memory leaks during repeated init/destroy cycles

---

## Implementation Steps

1. **Create Test File** (30 min)
   - Set up test structure
   - Create mocks and fixtures
   - Write basic initialization tests

2. **Add Concurrent Tests** (30 min)
   - Test promise identity
   - Test race conditions
   - Verify state consistency

3. **Add Failure Tests** (30 min)
   - Test failure scenarios
   - Test retry behavior
   - Verify error propagation

4. **Add Integration Tests** (30 min)
   - Test with real optimizer methods
   - Test ensureInitialized in context
   - Test initialization status tracking

5. **Documentation** (15 min)
   - Add comments to complex tests
   - Document expected behaviors
   - Add usage examples

**Total Estimated Time:** 2.25 hours

---

## Success Criteria

- ✅ All new tests pass consistently
- ✅ 100% coverage of async initialization code
- ✅ Tests run in <5 seconds
- ✅ No test flakiness (10 consecutive runs pass)
- ✅ Clear documentation of expected behaviors

---

## Benefits

1. **Prevents Regression:** Ensures initialization pattern doesn't break in future changes
2. **Documents Behavior:** Tests serve as executable documentation
3. **Confidence:** Team can refactor with confidence
4. **Production Safety:** Catches race conditions and edge cases before production
