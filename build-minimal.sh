#!/bin/bash

# Create a minimal build directory
mkdir -p minimal-build
mkdir -p minimal-build/node_modules
mkdir -p minimal-build/assets/images
mkdir -p minimal-build/locales
mkdir -p minimal-build/settings

# Copy only essential files
cp api.js minimal-build/
cp app.json minimal-build/
cp .homeybuild/index.js minimal-build/
cp -r assets/images/*.png minimal-build/assets/images/
cp -r locales/*.json minimal-build/locales/
cp -r settings/*.html minimal-build/settings/

# Copy only required node modules
mkdir -p minimal-build/node_modules/cron
cp -r node_modules/cron/dist minimal-build/node_modules/cron/
cp node_modules/cron/package.json minimal-build/node_modules/cron/

mkdir -p minimal-build/node_modules/luxon
cp -r node_modules/luxon/build minimal-build/node_modules/luxon/
cp node_modules/luxon/package.json minimal-build/node_modules/luxon/

# Create a minimal package.json
cat > minimal-build/package.json << EOF
{
  "name": "com.melcloud.optimize",
  "version": "1.0.0",
  "description": "Heat Pump Optimizer for Homey SDK 3.0",
  "main": "index.js",
  "dependencies": {
    "cron": "^3.1.7"
  }
}
EOF

# Create a zip file
cd minimal-build
zip -r ../com.melcloud.optimize.zip .
cd ..

echo "Minimal build created at com.melcloud.optimize.zip"
