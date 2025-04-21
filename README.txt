# MELCloud Optimizer for Homey

This app connects your Mitsubishi Electric heat pump (via MELCloud) with Homey and optimizes its operation based on real-time electricity prices from Tibber.

## Features

- **Hourly Optimization**: Automatically adjusts your heat pump's target temperature based on current electricity prices
- **Price-Based Control**: Increases temperature during cheap hours and decreases during expensive hours
- **Self-Learning**: Uses a thermal model that adapts to your home's characteristics
- **Weekly Calibration**: Uses AI (via OpenAI) to analyze historical data and improve the thermal model
- **Notifications**: Keeps you informed about temperature changes and price levels
- **Manual Triggers**: Buttons in the settings page to manually trigger hourly optimization and weekly calibration for testing
- **Terminal Logging**: Detailed logs in the terminal for debugging and monitoring
- **Timeline Entries**: Detailed operation history in the Homey app timeline

## Requirements

- Homey Pro (SDK 3.0 compatible)
- Mitsubishi Electric heat pump connected to MELCloud
- MELCloud account credentials
- Tibber account with API token
- OpenAI API key (for weekly calibration)

## Installation

1. Install the app from the Homey App Store
2. Configure your credentials in the app settings:
   - MELCloud email and password
   - Tibber API token
   - OpenAI API key
3. Configure temperature settings:
   - Minimum temperature (default: 18°C)
   - Maximum temperature (default: 24°C)
   - Maximum temperature step (default: 0.5°C)
   - Initial K factor (default: 0.3)

## How It Works

The app runs on two schedules:

1. **Hourly Optimization** (every hour at minute 0):
   - Fetches current electricity prices from Tibber
   - Determines the price level (VERY_CHEAP, CHEAP, NORMAL, EXPENSIVE, VERY_EXPENSIVE)
   - Reads the current indoor temperature from MELCloud
   - Calculates a new target temperature based on price level and thermal model
   - Updates the thermal model based on observed temperature changes
   - Logs the data for future analysis

2. **Weekly Calibration** (Monday at 3:00 AM):
   - Analyzes the past week's temperature and price data using OpenAI
   - Updates the thermal model parameters (K and S values)
   - Improves future optimization accuracy

## Settings

### MELCloud Credentials
- **Email**: Your MELCloud account email
- **Password**: Your MELCloud account password

### Tibber API
- **API Token**: Your Tibber API token (get it from [developer.tibber.com](https://developer.tibber.com/))

### OpenAI API
- **API Key**: Your OpenAI API key (get it from [platform.openai.com/api-keys](https://platform.openai.com/api-keys))

### Temperature Settings
- **Minimum Temperature**: Lowest allowed temperature (default: 18°C)
- **Maximum Temperature**: Highest allowed temperature (default: 24°C)
- **Maximum Temperature Step**: Maximum change per hour (default: 0.5°C)
- **Initial K Factor**: Initial thermal response factor (default: 0.3)

## Manual Triggers

The app provides buttons in the settings page to manually trigger operations for testing:

1. **Run Hourly Optimization**: Manually triggers the hourly optimization process
   - Use this to test temperature adjustments without waiting for the scheduled time
   - Click the button in the "Manual Triggers" section of the settings page
   - The operation will run in the background and show a success message when complete

2. **Run Weekly Calibration**: Manually triggers the weekly calibration process
   - Use this to test the thermal model calibration without waiting for Monday
   - Click the button in the "Manual Triggers" section of the settings page
   - The operation will run in the background and show a success message when complete

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
```

### Timeline Entries

The app creates detailed timeline entries in the Homey app for key events:

- **Hourly Optimization**: Shows price level, indoor temperature, target temperatures, K-factor, and temperature step
- **Weekly Calibration**: Shows previous and new K-factor, S-factor, number of data points, and average error
- **Manual Triggers**: Records when manual operations are triggered from the settings page

Timeline entries make it easy to track the app's operation history directly in the Homey app.

## Troubleshooting

If the app isn't working as expected:

1. Check the app logs for error messages
2. Verify your MELCloud, Tibber, and OpenAI credentials
3. Make sure your heat pump is online and accessible via MELCloud
4. Check that your Tibber subscription is active and providing price data
5. Run the app in development mode to see detailed console logs

## Support

If you encounter any issues or have questions, please create an issue on the [GitHub repository](https://github.com/decline27/com.melcloud.optimize/issues).

## Privacy

This app stores your MELCloud, Tibber, and OpenAI credentials locally on your Homey. No data is shared with third parties except when making API calls to the respective services.

## Development

### Running Tests

This app includes a comprehensive test suite using Jest. To run the tests:

```bash
# Run all tests
npm test

# Run tests with watch mode (for development)
npm run test:watch

# Run tests with coverage report
npm run test:coverage
```

The test suite includes:
- Unit tests for the Logger utility
- Unit tests for the app's core functionality
- Unit tests for the temperature optimization logic

### Code Coverage

The test suite aims to maintain high code coverage:
- Lines: >80%
- Functions: >80%
- Statements: >80%
- Branches: >60%

## License

This app is licensed under the GNU General Public License v3.0.