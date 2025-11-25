# Service Integration Progress

## Completed
- ✅ Added service imports
- ✅ Added service properties to Optimizer class
- ✅ Initialized services in constructor
- ✅ Replaced `loadSettings()` method (reduced from ~93 lines to ~44 lines)
- ✅ Updated TimeZone initialization to use SettingsLoader

## In Progress
Must systematically replace ~80+ property references:

### State/LastChange Properties → StateManager
- `lastSetpointChangeMs` → `stateManager.getZone1LastChange().timestamp`
- `lastIssuedSetpointC` → `stateManager.getZone1LastChange().setpoint`
- `lastZone2SetpointChangeMs` → `stateManager.getZone2LastChange().timestamp`
- `lastZone2IssuedSetpointC` → `stateManager.getZone2LastChange().setpoint`
- `lastTankSetpointChangeMs` → `stateManager.getTankLastChange().timestamp`
- `lastTankIssuedSetpointC` → `stateManager.getTankLastChange().setpoint`

### Zone 1 Constraints → ConstraintManager
- `minTemp` → `constraintManager.getZone1Constraints().minTemp`
- `maxTemp` → `constraintManager.getZone1Constraints().maxTemp`
- `tempStep` → `constraintManager.getZone1Constraints().tempStep`
- `deadband` → `constraintManager.getZone1Constraints().deadband`

### Zone 2 Constraints → ConstraintManager
- `enableZone2` → `constraintManager.getZone2Constraints().enabled`
- `minTempZone2` → `constraintManager.getZone2Constraints().minTemp`
- `maxTempZone2` → `constraintManager.getZone2Constraints().maxTemp`
- `tempStepZone2` → `constraintManager.getZone2Constraints().tempStep`

### Tank Constraints → ConstraintManager
- `enableTankControl` → `constraintManager.getTankConstraints().enabled`
- `minTankTemp` → `constraintManager.getTankConstraints().minTemp`
- `maxTankTemp` → `constraintManager.getTankConstraints().maxTemp`
- `tankTempStep` → `constraintManager.getTankConstraints().tempStep`

## Files Affected
- `src/services/optimizer.ts` - Main integration (IN PROGRESS)
- Test files - Will need mock updates AFTER optimizer changes

## Estimated Completion
This large-scale refactoring requires systematic replacement of references throughout the file.
Next: Create helper methods to reduce verbosity and continue with replacements.
