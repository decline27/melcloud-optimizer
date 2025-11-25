# PR #1: Extract Services from Optimizer Class

## Problem Statement

The `Optimizer` class has grown to **3,055 lines**, making it difficult to maintain, test, and understand. It violates the Single Responsibility Principle by managing multiple concerns: optimization logic, constraint management, state tracking, and settings loading.

## Proposed Changes

Extract three focused services from the `Optimizer` class to reduce its size by ~50% and improve maintainability.

---

### Service 1: ConstraintManager

**Purpose:** Centralize all temperature constraint logic and validation.

#### [NEW] [constraint-manager.ts](file:///Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize/src/services/constraint-manager.ts)

Responsibilities:
- Zone 1 temperature constraints (min, max, step)
- Zone 2 temperature constraints
- Hot water tank temperature constraints
- Constraint validation and bounds checking
- Constraint application logic

**Interface:**
```typescript
class ConstraintManager {
  // Zone 1
  setZone1Constraints(min: number, max: number, step: number): void
  getZone1Constraints(): { min: number; max: number; step: number }
  applyZone1Constraints(target: number): number
  
  // Zone 2
  setZone2Constraints(enabled: boolean, min: number, max: number, step: number): void
  getZone2Constraints(): { enabled: boolean; min: number; max: number; step: number }
  
  // Tank
  setTankConstraints(enabled: boolean, min: number, max: number, step: number): void
  getTankConstraints(): { enabled: boolean; min: number; max: number; step: number }
  
  // Comfort bands (occupancy-aware)
  getCurrentComfortBand(occupied: boolean, settings: any): { minTemp: number; maxTemp: number }
}
```

**Extracted from Optimizer:**
- Lines 138-142: Zone 1 constraint properties
- Lines 152-156: Zone 2 constraint properties
- Lines 158-162: Tank constraint properties
- Lines 609-622: `setTemperatureConstraints()`
- Lines 627-639: `setZone2TemperatureConstraints()`
- Lines 716-728: `setTankTemperatureConstraints()`
- Lines 683-711: `getCurrentComfortBand()`

**Benefits:**
- Reduces Optimizer by ~200 lines
- Single source of truth for constraints
- Easier to test constraint logic in isolation

---

### Service 2: StateManager

**Purpose:** Manage setpoint change tracking and lockout timing across all zones.

#### [NEW] [state-manager.ts](file:///Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize/src/services/state-manager.ts)

Responsibilities:
- Track last setpoint changes for all zones
- Enforce lockout periods
- Persist state to Homey settings
- Provide lockout status for optimization decisions

**Interface:**
```typescript
class StateManager {
  // Zone 1
  recordZone1Change(setpoint: number, timestamp: number): void
  getZone1LastChange(): { setpoint: number | null; timestamp: number | null }
  isZone1LockedOut(minChangeMinutes: number): boolean
  
  // Zone 2
  recordZone2Change(setpoint: number, timestamp: number): void
  getZone2LastChange(): { setpoint: number | null; timestamp: number | null }
  isZone2LockedOut(minChangeMinutes: number): boolean
  
  // Tank
  recordTankChange(setpoint: number, timestamp: number): void
  getTankLastChange(): { setpoint: number | null; timestamp: number | null }
  isTankLockedOut(minChangeMinutes: number): boolean
  
  // Persistence
  saveToSettings(homey: HomeyApp): void
  loadFromSettings(homey: HomeyApp): void
}
```

**Extracted from Optimizer:**
- Lines 145-150: Last setpoint tracking properties
- Lockout checking logic scattered throughout optimization methods
- Settings persistence for `last_setpoint_change_ms`

**Benefits:**
- Reduces Optimizer by ~100 lines
- Cleaner separation of state management
- Easier to test lockout logic

---

### Service 3: SettingsLoader

**Purpose:** Handle all Homey settings loading and type-safe access.

#### [NEW] [settings-loader.ts](file:///Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize/src/services/settings-loader.ts)

Responsibilities:
- Load all optimizer settings from Homey
- Provide type-safe getters with defaults
- Validate settings values
- Group related settings into configuration objects

**Interface:**
```typescript
interface OptimizerSettings {
  cop: { weight: number; autoSeasonalMode: boolean; summerMode: boolean }
  constraints: { minChangeMinutes: number; deadband: number }
  temperature: { zone1: ConstraintConfig; zone2: ConstraintConfig; tank: TankConfig }
  price: { cheapPercentile: number }
  timezone: { offset: number; useDST: boolean; name?: string }
  occupancy: { occupied: boolean }
}

class SettingsLoader {
  loadAllSettings(homey: HomeyApp): OptimizerSettings
  getSetting<T>(key: string, defaultValue: T): T
  saveSetting<T>(key: string, value: T): void
  
  // Grouped loaders
  loadCOPSettings(): COPSettings
  loadConstraintSettings(): ConstraintSettings
  loadTemperatureSettings(): TemperatureSettings
}
```

**Extracted from Optimizer:**
- Lines 299-392: Entire `loadSettings()` method
- Lines 491-500: `getCurrency()` method
- Lines 506-513: `getGridFee()` method
- Settings access scattered throughout the class

**Benefits:**
- Reduces Optimizer by ~150 lines
- Type-safe settings access
- Single source of truth for settings
- Easier to test settings logic
- Better error handling for missing/invalid settings

---

### Updated Optimizer Class

#### [MODIFY] [optimizer.ts](file:///Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize/src/services/optimizer.ts)

**Constructor changes:**
```typescript
constructor(
  private readonly melCloud: MelCloudApi,
  priceProvider: PriceProvider | null,
  private readonly deviceId: string,
  private readonly buildingId: number,
  private readonly logger: HomeyLogger,
  private readonly weatherApi?: { getCurrentWeather(): Promise<WeatherData> },
  private readonly homey?: HomeyApp
) {
  // Initialize new services
  this.constraintManager = new ConstraintManager(this.logger);
  this.stateManager = new StateManager(this.logger);
  
  if (homey) {
    this.settingsLoader = new SettingsLoader(homey, this.logger);
    const settings = this.settingsLoader.loadAllSettings();
    
    // Apply loaded settings
    this.constraintManager.setZone1Constraints(
      settings.temperature.zone1.min,
      settings.temperature.zone1.max,
      settings.temperature.zone1.step
    );
    this.stateManager.loadFromSettings(homey);
  }
  
  // ... rest of initialization
}
```

**Method updates:**
- Replace direct constraint access with `constraintManager` calls
- Replace direct state access with `stateManager` calls
- Replace settings access with `settingsLoader` calls

---

## Verification Plan

### Unit Tests

#### [NEW] [constraint-manager.test.ts](file:///Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize/test/unit/constraint-manager.test.ts)

```typescript
describe('ConstraintManager', () => {
  test('validates zone 1 constraints');
  test('rejects invalid temperature ranges');
  test('applies constraints correctly');
  test('handles comfort band calculation');
  test('supports occupancy-aware bands');
});
```

#### [NEW] [state-manager.test.ts](file:///Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize/test/unit/state-manager.test.ts)

```typescript
describe('StateManager', () => {
  test('tracks setpoint changes');
  test('calculates lockout correctly');
  test('persists to settings');
  test('loads from settings');
  test('handles multi-zone state');
});
```

#### [NEW] [settings-loader.test.ts](file:///Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize/test/unit/settings-loader.test.ts)

```typescript
describe('SettingsLoader', () => {
  test('loads all settings with defaults');
  test('handles missing settings gracefully');
  test('validates loaded values');
  test('groups related settings');
  test('provides type-safe access');
});
```

#### [MODIFY] Existing optimizer tests
- Update mocks to include new services
- Verify optimizer still functions correctly
- Ensure no regressions

### Integration Tests

Run full optimization workflow to ensure:
- Constraints are still enforced correctly
- Lockout periods work as before
- Settings loading is successful
- No performance degradation

---

## Implementation Steps

1. **Create ConstraintManager** (60 min)
   - Create new file with interface
   - Extract constraint properties
   - Extract constraint methods
   - Write unit tests

2. **Create StateManager** (45 min)
   - Create new file with interface
   - Extract state tracking properties
   - Extract lockout logic
   - Write unit tests

3. **Create SettingsLoader** (60 min)
   - Create new file with interface
   - Extract loadSettings method
   - Create type-safe getters
   - Write unit tests

4. **Update Optimizer** (90 min)
   - Inject new services in constructor
   - Replace direct property access with service calls
   - Update all affected methods
   - Remove extracted code

5. **Update Tests** (45 min)
   - Update optimizer test mocks
   - Run all tests
   - Fix any failures

6. **Verification** (30 min)
   - Run full test suite
   - Manual testing
   - Performance check

**Total Estimated Time:** 5.5 hours

---

## Success Criteria

- ✅ Optimizer.ts reduced from 3,055 to <1,600 lines
- ✅ All existing tests pass
- ✅ New services have 100% test coverage
- ✅ No functional regressions
- ✅ Code is more maintainable and testable

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Breaking existing functionality | High | Comprehensive test suite, careful extraction |
| Performance overhead from service calls | Low | Service calls are negligible overhead |
| Increased complexity from more files | Low | Clear service boundaries, better organization |

---

## Future Considerations

After this PR, consider:
- Extracting COP range tracking into `COPTracker` service
- Extracting thermal mass learning into existing `ThermalModelService`
- Creating `OptimizationOrchestrator` to coordinate services
