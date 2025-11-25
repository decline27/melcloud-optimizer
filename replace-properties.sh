#!/bin/bash
# Bulk replacement script for Optimizer service integration

FILE="/Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize/src/services/optimizer.ts"

# Backup original file
cp "$FILE" "$FILE.backup"

# Replace Zone 1 constraint properties
sed -i '' 's/this\.minTemp\([^a-zA-Z]\)/this.getZone1Constraints().minTemp\1/g' "$FILE"
sed -i '' 's/this\.maxTemp\([^a-zA-Z]\)/this.getZone1Constraints().maxTemp\1/g' "$FILE"
sed -i '' 's/this\.tempStep\([^a-zA-Z]\)/this.getZone1Constraints().tempStep\1/g' "$FILE"
sed -i '' 's/this\.deadband\([^a-zA-Z]\)/this.getZone1Constraints().deadband\1/g' "$FILE"

# Replace Zone 2 constraint properties
sed -i '' 's/this\.enableZone2\([^a-zA-Z]\)/this.getZone2Constraints().enabled\1/g' "$FILE"
sed -i '' 's/this\.minTempZone2\([^a-zA-Z]\)/this.getZone2Constraints().minTemp\1/g' "$FILE"
sed -i '' 's/this\.maxTempZone2\([^a-zA-Z]\)/this.getZone2Constraints().maxTemp\1/g' "$FILE"
sed -i '' 's/this\.tempStepZone2\([^a-zA-Z]\)/this.getZone2Constraints().tempStep\1/g' "$FILE"

# Replace Tank constraint properties
sed -i '' 's/this\.enableTankControl\([^a-zA-Z]\)/this.getTankConstraints().enabled\1/g' "$FILE"
sed -i '' 's/this\.minTankTemp\([^a-zA-Z]\)/this.getTankConstraints().minTemp\1/g' "$FILE"
sed -i '' 's/this\.maxTankTemp\([^a-zA-Z]\)/this.getTankConstraints().maxTemp\1/g' "$FILE"
sed -i '' 's/this\.tankTempStep\([^a-zA-Z]\)/this.getTankConstraints().tempStep\1/g' "$FILE"

# Replace Zone 1 state properties
sed -i '' 's/this\.lastSetpointChangeMs\([^a-zA-Z]\)/this.getZone1State().timestamp\1/g' "$FILE"
sed -i '' 's/this\.lastIssuedSetpointC\([^a-zA-Z]\)/this.getZone1State().setpoint\1/g' "$FILE"

# Replace Zone 2 state properties
sed -i '' 's/this\.lastZone2SetpointChangeMs\([^a-zA-Z]\)/this.getZone2State().timestamp\1/g' "$FILE"
sed -i '' 's/this\.lastZone2IssuedSetpointC\([^a-zA-Z]\)/this.getZone2State().setpoint\1/g' "$FILE"

# Replace Tank state properties
sed -i '' 's/this\.lastTankSetpointChangeMs\([^a-zA-Z]\)/this.getTankState().timestamp\1/g' "$FILE"
sed -i '' 's/this\.lastTankIssuedSetpointC\([^a-zA-Z]\)/this.getTankState().setpoint\1/g' "$FILE"

echo "Replacements complete. Backup saved to $FILE.backup"
