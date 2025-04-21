#!/bin/bash

# Script to run the app with Homey CLI and capture logs
echo "===== MELCloud Optimizer Debug Run ====="
echo "Building app..."
npm run build

echo "Creating logs directory..."
mkdir -p logs

echo "Running app with Homey CLI and capturing logs..."
echo "Press Ctrl+C to stop the app"

# Run the app with Homey CLI and capture logs
homey app run 2>&1 | tee logs/homey-run.log
