# MELCloud Optimizer Logging Guide

This document explains how to use and test the logging functionality in the MELCloud Optimizer app.

## Terminal Logging

The app uses Homey's built-in logging methods (`this.log()` and `this.error()`) to log information to the terminal when running with `homey app run`. This is the recommended approach according to the Homey SDK 3.0 documentation.

## Testing Logging

### Method 1: Using the Run and Check Logs Script

1. Run the app with the provided script:
   ```bash
   ./run-and-check-logs.sh
   ```

2. Check the terminal for log output.
   - You should see both Homey's built-in logging output and direct console.log output.
   - The app is configured to run test logging on startup.

### Method 2: Manual Testing

1. Run the app with the Homey CLI:
   ```bash
   homey app run
   ```

2. Check the terminal for log output.

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

## Notes on Settings Buttons

The buttons in the settings page are set up to trigger settings changes using `Homey.set()`. The app is configured to handle these settings changes and run the appropriate functions when the settings are changed.

However, there might be issues with how Homey CLI handles settings changes or how it displays logs in the terminal. If the buttons don't seem to be triggering functionality, try using the run-and-check-logs.sh script to see if the app is logging correctly on startup.
