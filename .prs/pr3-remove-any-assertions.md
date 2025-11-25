# PR #3: Remove Remaining `any` Type Assertions

## Problem Statement

Despite recent type safety improvements, the codebase still contains `any` type assertions that bypass TypeScript's type checking. These present security and reliability risks:

1. **Energy Metrics:** `(enhancedCOPData.daily as any)?.heatingCOP` (line 1012)
2. **Type Guards:** `typeof (homey as any).hotWaterService?.getUsageStatistics === 'function'` (line 32 in homey-extensions.ts)
3. **Settings Access:** Unvalidated `any` returns from `homey.settings.get()`
4. **Logger Methods:** `(this.logger as any).warn` (line 193)

These `any` usages can lead to runtime errors if API contracts change or settings contain unexpected values.

> [!CAUTION]
> **Security Risk:** Type assertions bypass compile-time safety and can cause production crashes.

## Proposed Changes

Create proper TypeScript interfaces and type-safe accessors to eliminate all `any` usages.

---

### Component 1: Enhanced COP Data Types

#### [NEW] [enhanced-cop-data.ts](file:///Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize/src/types/enhanced-cop-data.ts)

Create proper interfaces for the enhanced COP data structure:

```typescript
/**
 * Enhanced COP data structure returned by MELCloud API
 */
export interface EnhancedCOPData {
  current: {
    heating: number;
    hotWater: number;
    cooling: number;
  };
  
  daily: DailyCOPData;
  
  historical: {
    heating: number;
    hotWater: number;
    cooling: number;
  };
  
  trends: {
    heatingTrend: 'improving' | 'stable' | 'declining';
    hotWaterTrend: 'improving' | 'stable' | 'declining';
    coolingTrend: 'improving' | 'stable' | 'declining';
  };
}

/**
 * Daily COP data with optional fields
 */
export interface DailyCOPData {
  // Energy totals
  TotalHeatingConsumed: number;
  TotalHeatingProduced: number;
  TotalHotWaterConsumed: number;
  TotalHotWaterProduced: number;
  TotalCoolingConsumed: number;
  TotalCoolingProduced: number;
  
  // COP values (optional as they may not always be present)
  heatingCOP?: number;
  hotWaterCOP?: number;
  coolingCOP?: number;
  averageCOP?: number;
  
  // Legacy fields for backward compatibility
  AverageHeatingCOP?: number;
  AverageHotWaterCOP?: number;
  
  // CoP array (time-series data)
  CoP: Array<{ hour: number; value: number }>;
  
  // Metadata
  SampledDays?: number;
  Date?: string;
}

/**
 * Type guard to validate EnhancedCOPData structure
 */
export function isEnhancedCOPData(data: unknown): data is EnhancedCOPData {
  if (!data || typeof data !== 'object') return false;
  
  const d = data as any;
  return (
    d.current && typeof d.current === 'object' &&
    typeof d.current.heating === 'number' &&
    typeof d.current.hotWater === 'number' &&
    d.daily && typeof d.daily === 'object' &&
    d.historical && typeof d.historical === 'object' &&
    d.trends && typeof d.trends === 'object'
  );
}

/**
 * Safe accessor for COP values with fallback chain
 */
export function getCOPValue(
  daily: DailyCOPData,
  type: 'heating' | 'hotWater',
  fallback: number = 0
): number {
  if (type === 'heating') {
    return daily.heatingCOP ?? 
           daily.averageCOP ?? 
           daily.AverageHeatingCOP ?? 
           fallback;
  } else {
    return daily.hotWaterCOP ?? 
           daily.averageCOP ?? 
           daily.AverageHotWaterCOP ?? 
           fallback;
  }
}
```

#### [MODIFY] [optimizer.ts](file:///Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize/src/services/optimizer.ts)

Update energy metrics retrieval (lines 1006-1056):

```typescript
// Before (with any):
const derivedHeatingCOP = (enhancedCOPData.daily as any)?.heatingCOP
  ?? (enhancedCOPData.daily as any)?.averageCOP
  ?? enhancedCOPData.historical.heating
  ?? 0;

// After (type-safe):
import { EnhancedCOPData, DailyCOPData, getCOPValue } from '../types/enhanced-cop-data';

const derivedHeatingCOP = getCOPValue(
  enhancedCOPData.daily,
  'heating',
  enhancedCOPData.historical.heating || 0
);
const derivedHotWaterCOP = getCOPValue(
  enhancedCOPData.daily,
  'hotWater',
  enhancedCOPData.historical.hotWater || 0
);
```

---

### Component 2: Type-Safe Settings Accessor

#### [NEW] [settings-accessor.ts](file:///Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize/src/util/settings-accessor.ts)

Create a type-safe wrapper for Homey settings:

```typescript
import { HomeyApp } from '../types';

/**
 * Type-safe settings accessor with validation and defaults
 */
export class SettingsAccessor {
  constructor(private readonly homey: HomeyApp) {}

  /**
   * Get setting with type safety and default value
   */
  get<T>(key: string, defaultValue: T): T {
    const value = this.homey.settings.get(key);
    
    // Return default if value is null or undefined
    if (value === null || value === undefined) {
      return defaultValue;
    }
    
    // Type validation based on default value type
    const defaultType = typeof defaultValue;
    const valueType = typeof value;
    
    if (defaultType !== valueType) {
      console.warn(
        `Setting '${key}' has unexpected type: expected ${defaultType}, got ${valueType}. Using default.`
      );
      return defaultValue;
    }
    
    return value as T;
  }

  /**
   * Get number setting with range validation
   */
  getNumber(
    key: string,
    defaultValue: number,
    options?: { min?: number; max?: number }
  ): number {
    const value = this.get(key, defaultValue);
    
    if (!Number.isFinite(value)) {
      return defaultValue;
    }
    
    if (options) {
      if (options.min !== undefined && value < options.min) return defaultValue;
      if (options.max !== undefined && value > options.max) return defaultValue;
    }
    
    return value;
  }

  /**
   * Get boolean setting
   */
  getBoolean(key: string, defaultValue: boolean): boolean {
    return this.get(key, defaultValue);
  }

  /**
   * Get string setting
   */
  getString(key: string, defaultValue: string): string {
    const value = this.get(key, defaultValue);
    return typeof value === 'string' && value.length > 0 ? value : defaultValue;
  }

  /**
   * Get object setting with validation
   */
  getObject<T>(key: string, defaultValue: T, validator?: (obj: unknown) => obj is T): T {
    const value = this.homey.settings.get(key);
    
    if (!value || typeof value !== 'object') {
      return defaultValue;
    }
    
    if (validator && !validator(value)) {
      console.warn(`Setting '${key}' failed validation. Using default.`);
      return defaultValue;
    }
    
    return value as T;
  }

  /**
   * Set setting with type safety
   */
  set<T>(key: string, value: T): void {
    this.homey.settings.set(key, value);
  }
}
```

#### [MODIFY] [optimizer.ts](file:///Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize/src/services/optimizer.ts)

Update settings loading:

```typescript
// Add to constructor
private settingsAccessor?: SettingsAccessor;

constructor(...) {
  if (homey) {
    this.settingsAccessor = new SettingsAccessor(homey);
  }
}

// Update loadSettings method:
private loadSettings(): void {
  if (!this.settingsAccessor) return;

  // Before:
  this.copWeight = this.homey.settings.get('cop_weight') || 0.3;

  // After:
  this.copWeight = this.settingsAccessor.getNumber('cop_weight', 0.3, { min: 0, max: 1 });
  this.autoSeasonalMode = this.settingsAccessor.getBoolean('auto_seasonal_mode', true);
  this.summerMode = this.settingsAccessor.getBoolean('summer_mode', false);
}
```

---

### Component 3: Logger Interface

#### [MODIFY] [logger.ts](file:///Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize/src/util/logger.ts)

Add `warn` method to the logger interface:

```typescript
export interface HomeyLogger {
  log(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
  warn?(message: string, ...args: any[]): void; // Make optional for backward compatibility
}

/**
 * Create a logger that supports warn with fallback
 */
export function createLogger(baseLogger: any): HomeyLogger {
  return {
    log: baseLogger.log.bind(baseLogger),
    error: baseLogger.error?.bind(baseLogger) || baseLogger.log.bind(baseLogger),
    warn: baseLogger.warn?.bind(baseLogger) || baseLogger.log.bind(baseLogger),
  };
}
```

#### [MODIFY] [optimizer.ts](file:///Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize/src/services/optimizer.ts)

Remove the custom `warn` method (lines 191-197) and use logger directly:

```typescript
// Before:
private warn(message: string, ...args: any[]): void {
  if (this.logger && typeof (this.logger as any).warn === 'function') {
    (this.logger as any).warn(message, ...args);
  } else if (this.logger && typeof this.logger.log === 'function') {
    this.logger.log(message, ...args);
  }
}

// After (direct usage):
this.logger.warn?.('COP outlier rejected', cop) || this.logger.log('COP outlier rejected', cop);

// Or even better, with optional chaining in logger interface:
this.logger.warn('COP outlier rejected', cop); // Falls back to log if warn undefined
```

---

### Component 4: Type Guard Improvements

#### [MODIFY] [homey-extensions.ts](file:///Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize/src/types/homey-extensions.ts)

Remove `any` from type guard:

```typescript
// Before:
export function hasHotWaterService(
  homey: HomeyApp | undefined
): homey is HomeyWithOptimizer {
  return Boolean(
    homey &&
    'hotWaterService' in homey &&
    typeof (homey as any).hotWaterService?.getUsageStatistics === 'function'
  );
}

// After:
export function hasHotWaterService(
  homey: HomeyApp | undefined
): homey is HomeyWithOptimizer {
  if (!homey || !('hotWaterService' in homey)) {
    return false;
  }
  
  const service = (homey as HomeyWithOptimizer).hotWaterService;
  return Boolean(
    service &&
    typeof service.getUsageStatistics === 'function'
  );
}
```

---

## Verification Plan

### Type Checking

```bash
# Should pass with no errors
npm run type-check

# Verify no any usages in key files
grep -n "as any" src/services/optimizer.ts
grep -n "as any" src/types/homey-extensions.ts
# Should return empty
```

### Unit Tests

#### [NEW] [enhanced-cop-data.test.ts](file:///Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize/test/unit/enhanced-cop-data.test.ts)

```typescript
describe('Enhanced COP Data Types', () => {
  test('getCOPValue returns correct value with fallback chain');
  test('isEnhancedCOPData validates structure');
  test('handles missing optional fields');
});
```

#### [NEW] [settings-accessor.test.ts](file:///Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize/test/unit/settings-accessor.test.ts)

```typescript
describe('SettingsAccessor', () => {
  test('returns default for missing setting');
  test('validates number ranges');
  test('handles type mismatches');
  test('validates objects with custom validator');
});
```

### Integration Tests

Run full test suite to ensure no regressions:
```bash
npm test
```

---

## Implementation Steps

1. **Create Type Definitions** (45 min)
   - Create enhanced-cop-data.ts
   - Add interfaces and type guards
   - Write unit tests

2. **Create Settings Accessor** (45 min)
   - Create settings-accessor.ts
   - Implement type-safe methods
   - Write unit tests

3. **Update Logger Interface** (15 min)
   - Add warn to HomeyLogger
   - Create logger factory
   - Update usages

4. **Update Type Guards** (15 min)
   - Remove any from homey-extensions
   - Test type guard behavior

5. **Update Optimizer** (60 min)
   - Replace all any usages
   - Use new type-safe accessors
   - Update imports

6. **Update Tests** (30 min)
   - Update mocks for new types
   - Add new test files
   - Verify all tests pass

7. **Verification** (30 min)
   - Run type checker
   - Search for remaining any usages
   - Manual testing

**Total Estimated Time:** 4 hours

---

## Success Criteria

- ✅ Zero `any` type assertions in optimizer.ts
- ✅ Zero `any` type assertions in type files
- ✅ All TypeScript compilation passes
- ✅ 100% test coverage for new utilities
- ✅ No functional regressions
- ✅ Improved IDE autocomplete and type hints

---

## Benefits

1. **Compile-Time Safety:** Catch errors before runtime
2. **Better IDE Support:** Improved autocomplete and type hints
3. **Easier Refactoring:** TypeScript can track usages accurately
4. **Self-Documenting:** Types serve as inline documentation
5. **Production Reliability:** Prevents runtime type errors

---

## Future Considerations

After this PR:
- Consider strictNullChecks in tsconfig.json
- Add runtime validation for external API responses
- Create Zod schemas for complex data structures
