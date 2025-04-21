# MELCloud Optimizer Settings Buttons Guide

This document explains how the settings buttons work in the MELCloud Optimizer app.

## How Settings Buttons Work

The buttons in the settings page don't directly call functions in the app. Instead, they set settings that the app listens for and responds to. This is a common pattern in Homey apps.

### Flow:

1. **Button Press in Settings Page**:
   When you press a button (like "Test Logging"), it calls `Homey.set('test_logging', true)` to set a setting value.

2. **Setting Value Changed**:
   The setting value is changed in Homey's settings storage.

3. **Setting Change Detected by App**:
   The app detects this change through the settings change listener that's registered in the `onInit` method:
   ```typescript
   this.homey.settings.on('set', this.onSettingsChanged.bind(this));
   ```

4. **App Runs Appropriate Function**:
   The `onSettingsChanged` method checks which setting was changed and runs the appropriate function:
   ```typescript
   else if (key === 'test_logging') {
     // Run the test logging function
     this.testLogging();
   }
   ```

## Button Functions

### Test Logging Button
- Sets the `test_logging` setting to true
- Triggers the `testLogging()` function in the app
- Logs various information to the terminal

### Run Hourly Optimization Button
- Sets the `trigger_hourly_optimization` setting to true
- Triggers the `runHourlyOptimizer()` function in the app
- Optimizes the heat pump based on current electricity prices

### Run Weekly Calibration Button
- Sets the `trigger_weekly_calibration` setting to true
- Triggers the `runWeeklyCalibration()` function in the app
- Calibrates the thermal model of your home

## Troubleshooting

If the buttons don't seem to be triggering functionality:

1. **Check the Terminal Logs**:
   - Run the app with `homey app run`
   - Look for logs indicating that the settings change was detected
   - Look for logs from the functions that should be triggered

2. **Check the Settings**:
   - Make sure the settings are being set correctly
   - Look for any errors in the settings change process

3. **Check the App Code**:
   - Make sure the app is correctly listening for settings changes
   - Make sure the app is running the appropriate functions when settings change

## Example Code

### Settings Page (index.html):
```javascript
// Test logging button
// When clicked, this sets the 'test_logging' setting to true
// The app detects this setting change and runs the testLogging() function
testLogElement.addEventListener("click", function (e) {
  // Set the test_logging setting to true
  Homey.set('test_logging', true, function(err) {
    if (err) {
      console.error('Error triggering test logging:', err);
      return Homey.alert(err.message);
    }
    
    console.log('Test logging trigger set successfully');
  });
});
```

### App Code (app.ts):
```typescript
// Register settings change listener
this.homey.settings.on('set', this.onSettingsChanged.bind(this));

// Handle settings changes
private async onSettingsChanged(key: string) {
  this.log(`Setting changed: ${key}`);
  
  // Handle test logging trigger
  if (key === 'test_logging') {
    const trigger = this.homey.settings.get('test_logging') as boolean;
    
    if (trigger === true) {
      try {
        // Run the test logging
        this.testLogging();
      } finally {
        // Clear the trigger flag
        await this.homey.settings.unset('test_logging');
      }
    }
  }
}
```
