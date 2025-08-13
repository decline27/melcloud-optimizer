# MELCloud Optimizer for Homey

This app connects your Mitsubishi Electric heat pump (via MELCloud) with Homey and optimizes its operation based on real-time electricity prices from Tibber and weather conditions.

## Features

- **Hourly Optimization**: Automatically adjusts your heat pump's target temperature based on current electricity prices
- **Price-Based Control**: Increases temperature during cheap hours and decreases during expensive hours
- **Advanced Thermal Learning Model**: Uses a data-driven thermal model that adapts to your home's specific characteristics
- **Weather Integration**: Incorporates weather data to adjust temperature based on outdoor conditions
- **Data Persistence**: Thermal model data persists across app reinstallations, ensuring continuous learning
- **Hot Water Tank Control**: Optimizes hot water tank temperature based on electricity prices
- **Comfort Profile**: Adjusts temperature based on time of day and sleep patterns
- **Notifications**: Keeps you informed about temperature changes and price levels
- **Manual Triggers**: Buttons in the settings page to manually trigger hourly optimization and weekly calibration for testing
- **Console Logging**: Detailed logs in the terminal for debugging and monitoring
- **API Integration**: Exposes API endpoints for integration with other apps and services

## Requirements

- Homey Pro (SDK 3.0 compatible)
- Mitsubishi Electric heat pump connected to MELCloud
- MELCloud account credentials
- Tibber account with API token

## Installation

1. Install the app from the Homey App Store
2. Configure your credentials in the app settings:
   - MELCloud email and password
   - Tibber API token
3. Configure temperature settings:
   - Minimum temperature (default: 19°C)
   - Maximum temperature (default: 21°C)
   - Maximum temperature step (default: 1°C)
   - Initial K factor (default: 0.5)

## How It Works

The app runs on two schedules:

1. **Hourly Optimization** (every hour at minute 5):
   - Fetches current electricity prices from Tibber
   - Determines the price level (VERY_CHEAP, CHEAP, NORMAL, EXPENSIVE, VERY_EXPENSIVE)
   - Retrieves weather data for your location
   - Reads the current indoor and outdoor temperatures from MELCloud
   - Applies comfort profile adjustments based on time of day
   - Calculates a new target temperature based on price level, weather, and thermal model
   - Optimizes hot water tank temperature if enabled
   - Stores the data in the thermal learning model
   - Logs the data for future analysis and creates timeline entries

2. **Weekly Calibration** (Sunday at 2:05 AM):
   - Analyzes the past week's temperature and price data using the thermal learning model
   - Calculates the relationship between temperature changes and price changes
   - Updates the thermal model's K-factor based on actual observed data
   - Improves future optimization accuracy
   - Persists the thermal model data to survive app reinstallations

## Settings

### MELCloud Credentials
- **Email**: Your MELCloud account email
- **Password**: Your MELCloud account password

### Tibber API
- **API Token**: Your Tibber API token (get it from [developer.tibber.com](https://developer.tibber.com/))

### Temperature Settings
- **Minimum Temperature**: Lowest allowed temperature (default: 19°C)
- **Maximum Temperature**: Highest allowed temperature (default: 21°C)
- **Temperature Step**: Temperature change increment (default: 1°C)
- **Initial K Factor**: Initial thermal response factor (default: 0.5)

### Zone2 Settings
- **Enable Zone2 Control**: Enable/disable control of Zone2 temperature
- **Minimum Temperature**: Lowest allowed Zone2 temperature
- **Maximum Temperature**: Highest allowed Zone2 temperature
- **Temperature Step**: Zone2 temperature change increment

### Hot Water Tank Settings
- **Enable Tank Control**: Enable/disable control of hot water tank temperature
- **Minimum Temperature**: Lowest allowed tank temperature (default: 41°C)
- **Maximum Temperature**: Highest allowed tank temperature (default: 53°C)
- **Temperature Step**: Tank temperature change increment (default: 2°C)

### Hot Water Usage Pattern Analysis
- **Enable Usage Pattern Analysis**: Enable/disable hot water usage pattern analysis and optimization
- **Maximum Data Points**: Maximum number of data points to store (default: 1000)
- **Data Retention**: Number of days to keep hot water usage data (default: 30 days)
- **Reset Usage Patterns**: Reset learned patterns to default values
- **Clear Data (Keep Patterns)**: Remove detailed data points but keep aggregated usage patterns
- **Clear All Data**: Remove all collected usage data and reset patterns

### Comfort Profile
- **Day Start Hour**: Hour when day mode begins (default: 7)
- **Day End Hour**: Hour when night mode begins (default: 23)
- **Night Temperature Reduction**: Temperature reduction during night hours (default: 2°C)
- **Pre-Heat Hours**: Hours to start pre-heating before day mode begins (default: 2)

### Weather Settings
- **Use Weather Data**: Enable/disable weather data integration
- **Location Coordinates**: Your location for weather data (automatically detected)

## Manual Triggers

The app provides multiple ways to manually trigger operations for testing:

### Settings Page Buttons

1. **Run Hourly Optimization**: Manually triggers the hourly optimization process
   - Use this to test temperature adjustments without waiting for the scheduled time
   - Click the button in the "Manual Triggers" section of the settings page
   - The operation will run in the background and show a success message when complete

2. **Run Weekly Calibration**: Manually triggers the weekly calibration process
   - Use this to test the thermal model calibration without waiting for Sunday
   - Click the button in the "Manual Triggers" section of the settings page
   - The operation will run in the background and show a success message when complete

3. **View Thermal Model Data**: Displays the current thermal model data
   - Shows the number of collected data points, current K-factor, and recent optimizations
   - Helps you understand how the thermal learning model is adapting to your home

4. **Manage Scheduled Jobs**: Checks and manages the status of scheduled cron jobs
   - Shows when the next hourly and weekly jobs will run
   - Allows you to restart the jobs if they've stopped for any reason

### API Endpoints

You can also trigger operations programmatically using the app's API endpoints:

1. **Hourly Optimization API**: `GET /api/runHourlyOptimizer`
   - Returns detailed JSON data about the optimization result
   - Example response:
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

2. **Weekly Calibration API**: `GET /api/runWeeklyCalibration`
   - Returns detailed JSON data about the calibration result
   - Example response:
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

3. **Thermal Model Data API**: `GET /api/getThermalModelData`
   - Returns detailed information about the thermal model's current state
   - Example response:
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
       "kFactor": 0.4979
     }
   }
   ```

4. **Hot Water Usage Statistics API**: `GET /api/getHotWaterUsageStatistics`
   - Returns detailed information about hot water usage patterns and statistics
   - Example response:
   ```json
   {
     "success": true,
     "data": {
       "statistics": {
         "dataPointCount": 720,
         "avgTankTemperature": 48.5,
         "avgTargetTankTemperature": 50.2,
         "totalHotWaterEnergyProduced": 42.8,
         "totalHotWaterEnergyConsumed": 12.4,
         "avgHotWaterCOP": 3.45,
         "heatingActivePercentage": 28.5
       },
       "patterns": {
         "hourlyUsagePattern": [0.8, 0.7, 0.5, 0.4, 0.3, 0.5, 1.8, 2.5, 1.9, 1.2, 1.0, 1.1, 1.2, 1.0, 0.9, 1.0, 1.1, 1.3, 1.8, 2.1, 1.7, 1.4, 1.2, 0.9],
         "dailyUsagePattern": [0.9, 1.1, 1.0, 1.0, 0.9, 1.2, 1.4],
         "confidence": 68,
         "lastUpdated": "2025-04-26T08:00:00.000Z"
       },
       "predictions": [1.0, 0.9, 0.8, 0.7, 0.6, 0.8, 2.0, 2.6, 2.0, 1.3, 1.1, 1.2, 1.3, 1.1, 1.0, 1.1, 1.2, 1.4, 1.9, 2.2, 1.8, 1.5, 1.3, 1.0]
     }
   }
   ```

5. **Reset Hot Water Patterns API**: `GET /api/resetHotWaterPatterns`
   - Resets hot water usage patterns to default values
   - Example response:
   ```json
   {
     "success": true,
     "message": "Hot water usage patterns have been reset to defaults"
   }
   ```

6. **Clear Hot Water Data API**: `POST /api/clearHotWaterData`
   - Clears hot water usage data with option to keep aggregated patterns
   - Request body: `{ "clearAggregated": true }` (optional, defaults to true)
   - Example response:
   ```json
   {
     "success": true,
     "message": "Hot water usage data has been cleared including aggregated data"
   }
   ```

## Logging and Timeline

The app provides comprehensive logging through multiple channels:

### Terminal Logging

The app logs detailed information to both the Homey logs and the terminal:

- **DEBUG**: Detailed diagnostic information
- **INFO**: General operational information
- **WARN**: Warning messages that don't prevent operation
- **ERROR**: Error messages that may affect operation
- **NOTIFICATION**: User notifications
- **TIMELINE**: Timeline entries
- **THERMAL MODEL**: Data about the thermal learning model
- **MARKERS**: Special markers for important events

All logs are visible in the terminal when running the app with `homey app run`.

To view these logs, run the app with:
```bash
homey app run
```

The app also logs special markers for important events:
```
===== HOURLY OPTIMIZATION STARTED =====
===== HOURLY OPTIMIZATION COMPLETED SUCCESSFULLY =====
===== WEEKLY CALIBRATION STARTED =====
===== WEEKLY CALIBRATION COMPLETED SUCCESSFULLY =====
===== THERMAL MODEL DATA =====
```

### Timeline Entries

The app creates detailed timeline entries in the Homey app for key events:

- **Hourly Optimization**: Shows price level, indoor temperature, target temperatures, K-factor, and weather adjustments
- **Weekly Calibration**: Shows previous and new K-factor, analysis of temperature/price relationship, and number of data points
- **Manual Triggers**: Records when manual operations are triggered from the settings page
- **Tank Temperature**: Shows hot water tank temperature adjustments based on price levels

### Thermal Model Data Viewer

The app includes a "View Thermal Model Data" button in the settings page that shows:

- Number of optimization data points collected
- Current K-factor value
- Last calibration details (timestamp, K-factor change, analysis)
- Last optimization details (temperatures, price)
- Recent data points with timestamps

This helps you understand how the thermal learning model is adapting to your home's specific characteristics over time.

### Hot Water Usage Pattern Viewer

The app includes hot water usage pattern visualization in the settings page that shows:

- Usage patterns by hour of day (0-23)
- Usage patterns by day of week (Sunday-Saturday)
- Confidence level in the learned patterns
- Predictions for the next 24 hours
- Memory usage statistics
- Data retention information

This helps you understand your household's hot water usage patterns and how the system is optimizing tank temperature based on these patterns.

## Troubleshooting

If the app isn't working as expected:

1. Check the app logs for error messages
2. Verify your MELCloud and Tibber credentials
3. Make sure your heat pump is online and accessible via MELCloud
4. Check that your Tibber subscription is active and providing price data
5. Use the "View Thermal Model Data" button to check if data is being collected
6. Use the "Manage Scheduled Jobs" button to ensure the cron jobs are running
7. Run the app in development mode to see detailed console logs

### Common Issues

- **Device ID or Building ID Reset**: If you notice these settings reset when opening the settings page, use the "Get Device List" button to automatically detect and set the correct values
- **No Temperature Changes**: Check your min/max temperature settings - if they're too close together, there won't be much room for optimization
- **Thermal Model Not Learning**: Make sure you have at least 24 hours of data collection before expecting significant learning

## Support

If you encounter any issues or have questions, please create an issue on the [GitHub repository](https://github.com/decline27/melcloud-optimizer/issues).

## Privacy

This app stores your MELCloud and Tibber credentials locally on your Homey. No data is shared with third parties except when making API calls to the respective services. The thermal model data is stored locally on your Homey and is not shared with any external services.

## Recent Updates

### Thermal Learning Model

The app now includes a sophisticated thermal learning model that:

- **Collects Data**: Gathers temperature, price, and weather data over time
- **Analyzes Patterns**: Identifies how your home responds to temperature changes
- **Adapts Automatically**: Adjusts the K-factor based on actual observed data
- **Persists Across Reinstalls**: Saves thermal model data to survive app reinstallations
- **Provides Transparency**: Allows you to view the thermal model data and understand how it's learning

### Hot Water Tank Control

- **Tank Temperature Optimization**: Adjusts hot water tank temperature based on electricity prices
- **Configurable Settings**: Set minimum and maximum tank temperatures and step size
- **Price-Based Control**: Increases tank temperature during cheap hours, decreases during expensive hours
- **Correct API Implementation**: Uses the proper effective flag value (`0x1000000000020`) for tank temperature control

### Hot Water Usage Pattern Analysis

- **Usage Pattern Detection**: Analyzes your hot water usage patterns based on time of day and day of week
- **Predictive Optimization**: Optimizes tank temperature based on predicted usage patterns
- **Data Management**: Options to manage data retention and memory usage
- **Selective Data Clearing**: Ability to clear detailed data points while preserving learned usage patterns
- **Pattern Visualization**: View and analyze your household's hot water usage patterns

### MELCloud API Integration Improvements

- **Automatic Device Detection**: Automatically detects your MELCloud devices and buildings
- **Zone Control**: Support for controlling multiple temperature zones
- **Fixed Temperature Control for ATW Devices**: Implemented proper temperature control for Air-to-Water heat pumps using the correct effective flags value (`0x200000080`)
- **Real-time Settings Updates**: The app now reads the latest settings before each optimization run
- **Improved Error Handling**: Better handling of API responses and error conditions
- **Enhanced Logging**: More detailed logging of API requests and responses for easier troubleshooting

### Weather Integration

- **Met.no Weather API**: Integrates with the Norwegian Meteorological Institute's API
- **Location-Based Weather**: Uses your location coordinates for accurate weather data
- **Weather-Adjusted Temperatures**: Adjusts target temperatures based on outdoor conditions
- **Wind, Humidity, and Cloud Cover**: Takes into account multiple weather factors

## Development

### TypeScript Implementation

The app has been rewritten in TypeScript for improved code quality and maintainability:

- **Type Safety**: Reduces runtime errors through static type checking
- **Better IDE Support**: Improved code completion and documentation
- **Modular Architecture**: Cleaner separation of concerns with dedicated services
- **Enhanced Testability**: Easier to write and maintain tests

### Running Tests

This app includes a comprehensive test suite. To run the tests:

```bash
# Run all tests
npm test

# Run tests with watch mode (for development)
npm run test:watch

# Run tests with coverage report
npm run test:coverage
```

The test suite includes:
- Unit tests for core functionality
- Unit tests for the thermal model
- Unit tests for the optimizer logic

### Building and Installing

```bash
# Build the app
homey app build

# Install the app to your Homey
homey app install
```

## Documentation

Comprehensive documentation is available in the [`/docs`](docs/) directory:

- **[Complete Documentation Index](docs/README.md)** - Overview of all documentation
- **[Technical Documentation](docs/technical-documentation.md)** - Comprehensive technical details
- **[API Guide](docs/api/api-guide.md)** - API endpoint reference
- **[Development Guide](docs/development/logging-guide.md)** - Logging and debugging
- **[Algorithm Details](docs/algorithms/)** - How the optimization algorithms work

## License

This app is licensed under the GNU General Public License v3.0.