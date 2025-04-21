# MELCloud Optimizer API Guide

This document explains how the API endpoints work in the MELCloud Optimizer app.

## How API Endpoints Work in Homey SDK 3.0

In Homey SDK 3.0, API endpoints are exposed by:
1. Creating an `api.js` file in the root directory of the app that exports methods
2. Adding an `api` section to the app.json manifest file

### Flow:

1. **Button Press in Settings Page**:
   When you press a button (like "Test Logging"), it calls `Homey.api('GET', '/testLogging', {}, callback)` to directly call a function in the app.

2. **API Request Sent to App**:
   The API request is sent to the app.

3. **App Executes Function**:
   The app receives the API request and executes the corresponding function.

4. **Response Sent Back to Settings Page**:
   The app sends a response back to the settings page indicating success or failure.

## API Endpoints

### Test Logging
- **Endpoint**: `/testLogging`
- **Method**: GET
- **API Method**: `getTestLogging`
- **Description**: Runs the test logging function
- **Response**: `{ success: true, message: 'Test logging completed' }`

### Run Hourly Optimization
- **Endpoint**: `/runHourlyOptimizer`
- **Method**: GET
- **API Method**: `getRunHourlyOptimizer`
- **Description**: Runs the hourly optimization function
- **Response**: `{ success: true, message: 'Hourly optimization completed' }`

### Run Weekly Calibration
- **Endpoint**: `/runWeeklyCalibration`
- **Method**: GET
- **API Method**: `getRunWeeklyCalibration`
- **Description**: Runs the weekly calibration function
- **Response**: `{ success: true, message: 'Weekly calibration completed' }`

## Example Code

### Settings Page (index.html):
```javascript
// Test logging button
// When clicked, this directly calls the testLogging method on the app
testLogElement.addEventListener("click", function (e) {
  // Call the API to directly execute the testLogging method
  Homey.api('GET', 'testLogging', {}, function(err, result) {
    if (err) {
      console.error('Error calling testLogging:', err);
      return Homey.alert(err.message);
    }

    console.log('testLogging called successfully:', result);
  });
});
```

### API File (api.js):
```javascript
module.exports = {
  async testLogging({ homey }) {
    homey.app.log('API method testLogging called');
    homey.app.testLogging();
    return { success: true, message: 'Test logging completed' };
  }
};
```

## Testing

To test the API endpoints:

1. Run the app with the provided script:
   ```bash
   ./run-with-api.sh
   ```

2. Open the settings page and click the buttons.

3. Check the terminal for log output showing that the API endpoints were called and the functions were executed.
