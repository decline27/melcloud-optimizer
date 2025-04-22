# MELCloud Optimizer Logging Guide

This document explains how to use and test the logging functionality in the MELCloud Optimizer app.

## Terminal Logging

The app uses Homey's built-in logging methods (`this.log()` and `this.error()`) to log information to the terminal when running with `homey app run`. This is the recommended approach according to the Homey SDK 3.0 documentation.

## Testing Logging

### Method 1: Using the Debug Script

1. Run the app with the provided debug script:
   ```bash
   ./run-debug.sh
   ```

2. Check the terminal for log output.

### Method 2: Using the Settings Test Script

1. Run the app and test the settings change functionality:
   ```bash
   ./run-and-test-settings.sh
   ```

2. Check the terminal for log output.

### Method 3: Manual Testing

1. Run the app with the Homey CLI:
   ```bash
   homey app run
   ```

2. Open the app settings in the Homey app.

3. Click the "Test Logging" button.

4. Check the terminal where the app is running for log output.

## Troubleshooting

If you don't see any logs in the terminal:

1. Make sure you're running the app with `homey app run` and not `homey app install`.
2. Try running with the `--debug` flag: `homey app run --debug`
3. Check if there are any errors in the terminal output.
4. Try restarting the app.
5. Verify that the app is properly installed on your Homey.

## Homey Developer Documentation

According to the Homey SDK 3.0 documentation, the App class provides built-in logging methods:

- `this.log()` - For standard logging (visible in the terminal when running with `homey app run`)
- `this.error()` - For error logging (visible in the terminal when running with `homey app run`)

These methods should output to the terminal when running with `homey app run`.
