# MELCloud Optimizer Logging Guide

This document explains how to use and test the logging functionality in the MELCloud Optimizer app.

## Terminal Logging

The app uses Homey's built-in logging methods (`this.log()` and `this.error()`) to log information to the terminal when running with `homey app run`. This is the recommended approach according to the Homey SDK 3.0 documentation.

## Testing Logging

### Method 1: Using the Run Script

1. Run the app with the provided script:
   ```bash
   ./run-test-manual.sh
   ```

2. In another terminal, trigger the test logging:
   ```bash
   homey app settings set com.melcloud.optimize test_logging true
   ```

3. Check the terminal where the app is running for log output.

### Method 2: Using the Settings Page

1. Run the app:
   ```bash
   homey app run
   ```

2. Open the app settings in the Homey app.

3. Click the "Test Logging" button.

4. Check the terminal where the app is running for log output.

## Log Levels

The app supports different log levels:
- 0: Debug (most verbose)
- 1: Info (normal)
- 2: Warning (minimal)
- 3: Error (only errors)

You can change the log level in the app settings.

## Timeline Logging

Important events are also logged to the Homey timeline for easy monitoring.

## Troubleshooting

If you don't see any logs in the terminal:

1. Make sure you're running the app with `homey app run` and not `homey app install`.
2. Check if there are any errors in the terminal output.
3. Try restarting the app.
4. Verify that the app is properly installed on your Homey.
