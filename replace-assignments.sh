#!/bin/bash
# Replace state assignments to use StateManager methods

FILE="/Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize/src/services/optimizer.ts"

# Replace Zone 1 state assignments
# Pattern: this.lastSetpointChangeMs = Date.now() becomes this.stateManager.recordZone1Change(setpoint)
# We need to be more careful with assignments

# For now, let's create a comprehensive list of patterns to replace
# Assignment operators: =, +=, -=, *=, /=

# Zone 1 assignments (these need manual review)
sed -i '' 's/this\.getZone1State()\.timestamp = Date\.now()/\/\/ MANUAL: this.stateManager.recordZone1Change(setpoint)/g' "$FILE"
sed -i '' 's/this\.getZone1State()\.timestamp = /\/\/ MANUAL: Check this.stateManager.recordZone1Change - Original: this.getZone1State().timestamp = /g' "$FILE"
sed -i '' 's/this\.getZone1State()\.setpoint = /\/\/ MANUAL: Check this.stateManager.recordZone1Change - Original: this.getZone1State().setpoint = /g' "$FILE"

# Zone 2 assignments
sed -i '' 's/this\.getZone2State()\.timestamp = /\/\/ MANUAL: Check this.stateManager.recordZone2Change - Original: this.getZone2State().timestamp = /g' "$FILE"
sed -i '' 's/this\.getZone2State()\.setpoint = /\/\/ MANUAL: Check this.stateManager.recordZone2Change - Original: this.getZone2State().setpoint = /g' "$FILE"

# Tank assignments  
sed -i '' 's/this\.getTankState()\.timestamp = /\/\/ MANUAL: Check this.stateManager.recordTankChange - Original: this.getTankState().timestamp = /g' "$FILE"
sed -i '' 's/this\.getTankState()\.setpoint = /\/\/ MANUAL: Check this.stateManager.recordTankChange - Original: this.getTankState().setpoint = /g' "$FILE"

echo "Assignment replacements marked for manual review"
