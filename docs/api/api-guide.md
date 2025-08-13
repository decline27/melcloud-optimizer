# MELCloud Optimizer API Endpoints

This document explains how the API endpoints work in the MELCloud Optimizer app.

## How API Endpoints Work

The app exposes API endpoints that can be called directly from the settings page. This allows the buttons to directly trigger functions in the app without going through the settings change mechanism.

### Current API Endpoints

1. **runHourlyOptimizer** - Runs the hourly optimization process
2. **runWeeklyCalibration** - Runs the weekly calibration process
3. **getCheckCronStatus** - Checks the status of cron jobs
4. **getUpdateCronStatus** - Updates and checks cron status
5. **getStartCronJobs** - Starts the cron jobs

### Flow:

1. **Button Press in Settings Page**:
   When you press a button (like "Run Hourly Optimization"), it calls `Homey.api('GET', '/runHourlyOptimizer', {}, callback)` to directly call a function in the app.

2. **API Request Sent to App**:
   The API request is sent to the app.

3. **App Executes Function**:
   The app receives the API request and executes the corresponding function.

4. **Response Sent Back to Settings Page**:
   The app sends a response back to the settings page indicating success or failure.

## API Endpoints

### Run Optimizer

### Run Hourly Optimization
- **Endpoint**: `/runHourlyOptimizer`
- **Method**: GET
- **Description**: Runs the hourly optimization function
- **Response**:
  ```json
  {
    "success": true,
    "message": "Hourly optimization completed",
    "data": {
      "targetTemp": 21,
      "reason": "Price is low",
      "priceNow": 0.1246,
      "priceAvg": 0.6524,
      "indoorTemp": 21.5,
      "outdoorTemp": 12,
      "targetOriginal": 21,
      "timestamp": "2025-04-26T08:33:47.073Z",
      "kFactor": 0.5468,
      "tankTemperature": {
        "targetTemp": 53,
        "reason": "Tibber price level is VERY_CHEAP, increasing tank temperature to maximum",
        "targetOriginal": 53
      },
      "weather": {
        "current": {
          "temperature": 9.8,
          "humidity": 71.4,
          "windSpeed": 2.7,
          "cloudCover": 97.6
        },
        "adjustment": 1,
        "reason": "Cold and/or windy conditions, increasing temperature"
      }
    }
  }
  ```

### Run Weekly Calibration
- **Endpoint**: `/runWeeklyCalibration`
- **Method**: GET
- **Description**: Runs the weekly calibration function using the thermal learning model
- **Response**:
  ```json
  {
    "success": true,
    "message": "Weekly calibration completed successfully",
    "oldK": 0.5468,
    "newK": 0.4979,
    "analysis": "Thermal learning model calibration. Average temperature change per price change: 0.0000. Adjusted K factor from 0.55 to 0.50.",
    "timestamp": "2025-04-26T08:50:55.082Z"
  }
  ```

### Get Device List
- **Endpoint**: `/getDeviceList`
- **Method**: GET
- **Description**: Retrieves a list of available devices and buildings from MELCloud
- **Response**: `{ success: true, devices: [...], buildings: [...] }`

### Get Thermal Model Data
- **Endpoint**: `/getThermalModelData`
- **Method**: GET
- **Description**: Retrieves the current thermal model data
- **Response**:
  ```json
  {
    "success": true,
    "data": {
      "optimizationCount": 24,
      "lastOptimization": {
        "targetTemp": 21,
        "indoorTemp": 21.5,
        "outdoorTemp": 12,
        "priceNow": 0.1246,
        "timestamp": "2025-04-26T08:49:53.000Z"
      },
      "lastCalibration": {
        "timestamp": "2025-04-26T08:49:56.000Z",
        "oldK": 0.5468,
        "newK": 0.4979,
        "analysis": "Thermal learning model calibration..."
      },
      "kFactor": 0.4979,
      "recentDataPoints": [
        {
          "timestamp": "2025-04-26T08:49:42.000Z",
          "indoorTemp": 21.5,
          "outdoorTemp": 12,
          "targetTemp": 21,
          "price": 0.1246
        },
        // More data points...
      ]
    }
  }
  ```

## Example Code

### Settings Page (index.html):
```javascript
// Run Hourly Optimization button
runHourlyElement.addEventListener("click", function (e) {
  // Call the API to directly execute the runHourlyOptimizer method
  Homey.api('GET', '/runHourlyOptimizer', {}, function(err, result) {
    if (err) {
      console.error('Error calling runHourlyOptimizer:', err);
      return Homey.alert(err.message);
    }

    console.log('runHourlyOptimizer called successfully:', result);
    Homey.alert('Hourly optimization completed successfully!');
  });
});
```

### App Code (api.ts):
```typescript
// API class for the MELCloud Optimizer app
export class Api {
  private app: HeatOptimizerApp;

  constructor(app: HeatOptimizerApp) {
    this.app = app;
  }

  // Run hourly optimization function
  async runHourlyOptimizer() {
    this.app.log('API method runHourlyOptimizer called');
    const result = await this.app.runHourlyOptimizer();
    return result;
  }
}
```

## Testing

To test the API endpoints:

1. Run the app with the Homey CLI:
   ```bash
   homey app run
   ```

2. Open the settings page and click the buttons.

3. Check the terminal for log output showing that the API endpoints were called and the functions were executed.
