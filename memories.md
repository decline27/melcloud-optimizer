# Time Management
- The system needs to use the local time of where it's running rather than UTC time.
- The system should automatically detect time zones rather than requiring manual configuration by the user.

# Optimization Algorithm
- The optimization algorithm should incorporate house thermal information in its calculations.
- The optimization algorithm should incorporate COP (Coefficient of Performance) as an optimization factor.
- The optimization algorithm should prioritize using actual COP data from the MELCloud API rather than estimating it.
- The system should implement daily, weekly, and monthly COP (Coefficient of Performance) calculations for heating and hot water using the MELCloud API data, store snapshots for aggregation, and incorporate seasonal changes to optimize differently in summer (hot water only) versus winter (heating and hot water).
- The system correctly uses the user's configured K-factor and COP weight values from the settings page.
- The hot water tank temperature optimization functionality is implemented in the current TypeScript version of the codebase.

# Optimization Effectiveness
- The system should consider using COP (Coefficient of Performance) data from the MELCloud API to measure and display optimization effectiveness in the timeline or weekly data views.
- The MELCloud Optimizer has implemented a getWeeklyAverageCOP function to support displaying COP data for measuring optimization effectiveness.
- Low heating COP values may be normal during summer months when the system is primarily used for hot water rather than space heating.

# API Integration and Caching
- The system has implemented caching for Weather and Tibber API data to reduce the number of API calls.
- The system should not implement caching for MELCloud API data.
- The MELCloud API provides COP (Coefficient of Performance) data that is properly retrieved and used in the optimization algorithm.
- The MELCloud API provides COP (Coefficient of Performance) data in several timeframes including daily and weekly views, which the system is successfully retrieving and using.
- The MELCloud API provides detailed heat pump data including energy metrics (DailyHeatingEnergyConsumed/Produced, DailyHotWaterEnergyConsumed/Produced) that can be used to calculate COP values for both heating and hot water functions.
- The system correctly saves and uses building ID and device ID values from the MELCloud API.
- The MELCloud API integration includes formatted logging of API output during login and device listing to make the data more readable.
- The MELCloud device detection logic has been improved to prioritize 'Boiler', then first numeric ID, then fallback to the first device found.
- The MELCloud API requires different specific data entries in requests for changing hot water temperature versus heating temperature.
- The MELCloud API uses specific effective flags for different temperature controls: Zone1 temperature: 0x200000080 (8589934720), Zone2 temperature: 0x800000200 (34359738880), and Tank temperature: 0x400000000 (17179869184).
- The MELCloud API returns the original tank temperature value (47°C) instead of the requested value (50°C) when using the SetAtw endpoint, suggesting a potential limitation in the API's tank temperature control capabilities.
- The Weather and Tibber APIs provide forecast data for 24+ hours.
- For Homey applications, use Homey's built-in HTTP request capabilities instead of standard fetch() for better compatibility and performance.

# Data Persistence
- The system needs to ensure data persistence across app updates and reinstalls to maintain collected thermal model data.
- The system should use the original implementation of Homey persistent memory to ensure data persistence between app installations and updates.
- The system implements a dual-storage approach for thermal data, using both Homey settings (primary) and a backup file (secondary) to ensure data persistence.
- The system implements automatic data reduction if the full dataset becomes too large for Homey settings storage, keeping the most recent 500 data points.
- The system stores COP snapshots in Homey settings with a rolling 31-day retention policy to maintain performance while preserving recent history.
- Thermal model characteristics are saved to Homey settings after each analysis to ensure persistence across app reinstalls.

# Codebase and Homey Environment
- The codebase has been fully migrated to TypeScript.
- The project should use TypeScript exclusively.
- The Homey runtime environment only supports JavaScript, not TypeScript.
- The user prefers a hybrid approach for TypeScript/JavaScript integration and wants to use the Homey CLI (homey app build) for building and running the application.
- The user exclusively wants to use the Homey CLI (homey app build, homey app run) for building and running the application, not custom scripts or other build tools.
- The Homey platform has official documentation for TypeScript migration at https://apps.developer.homey.app/guides/tools/typescript.
- Follow the official Homey TypeScript documentation rather than creating custom solutions.
- The Homey runtime environment requires node-fetch to be bundled with the app rather than listed as a dependency.
- The system should implement timeline entries according to the Homey SDK 3.0 documentation.
- The timeline functionality should be implemented by using the approach from other branches that is known to work, rather than creating new implementations.
- Timeline entries functionality is working correctly and provides logs, notifications, and timeline entries for operations and errors.
- Timeline entries should be more explanatory about optimization decisions while remaining concise due to token limits.
- The correct URI for creating Homey notifications is 'homey:flowcardaction:homey:manager:notifications:create_notification' with id 'homey:manager:notifications:create_notification'.
- The homey.flow.runFlowCardAction method is not available in certain contexts and should be replaced with an alternative approach.
- The system should not use the Homey Insights API as it's not needed for the application.
- The system should not attempt to set Zone 2 temperature when Zone 2 control is disabled in the settings.
- The system should require users to manually press the 'Manage Scheduled Jobs' button to start the cron jobs rather than starting them automatically.
- The system uses a data-driven thermal learning model for weekly calibration of the thermal model parameters without relying on external AI services.
- The user wants to exclusively use the Advanced Thermal Learning Model (TypeScript implementation).
- The system stores cron job status information in Homey settings, including running state, next run time, timezone information, and DST status.

# Development Workflow
- The user prefers to sync code to GitHub before making changes to the codebase.
- The user prefers to move code from the develop branch to all branches and overwrite existing code when synchronizing branches.
- The user prefers to overwrite local code with the remote repository code rather than pushing local changes when synchronizing branches.
- The user prefers step-by-step implementation with separate messages for each major step, clear indications of which part of the plan is being implemented.
- The user prefers to start fresh from the develop branch on GitHub rather than continuing with partial migrations.
- The user prefers to receive implementation plans as separate Markdown files for each batch of improvements, with detailed steps, code examples, and testing procedures that can serve as standalone implementation guides.
- The user prefers to commit changes to the develop branch before creating new feature branches.

# User Interface
- Add helpful default value suggestions in settings page help text to guide users with optimal values that balance cost savings and temperature comfort.
- The user wants a UI setting for COP weight in the app's settings page.
- The user wants to consider exposing COP weight and Auto Seasonal Mode settings in the settings page (index.html) rather than keeping them automated.
- The user has set the initial k factor to 0.3 in the settings page and wants to ensure this value is being used by the system.

# Logging and Performance
- The system should only use verbose logging when running via the Homey CLI ('homey app run') and not when installed as a production app.
- The user is concerned about memory usage and performance impact of verbose logging when the app is installed.
- The user is concerned about memory usage of the app when running.

# Display and Localization
- The system should display savings in local currency rather than euros and use a lower threshold (0.02) for showing savings information.
- The system should display savings in local currency in timeline entries from the Advanced Learning Model, similar to the minimal-build implementation.
- The system should display projected daily savings rather than hourly savings in timeline entries to better show the cumulative financial impact of optimization.
- The system should consider using historical data from the previous hours when calculating projected daily savings rather than just multiplying the current hour's savings by 24.

# Testing
- The MELCloud Optimizer codebase needs improved test coverage, particularly for critical components with 0% coverage like melcloud-api.ts, optimizer.ts, and tibber-api.ts, with targets of 80% for statements/functions/lines and 60% for branches.
- The MELCloud Optimizer test coverage plan includes fixing TypeScript errors in optimizer tests, implementing tests for thermal model components, enhancing app.ts coverage, and adjusting Jest coverage thresholds to a phased approach (starting at 50% statements/lines, 40% branches, 50% functions and gradually increasing).
- The MELCloud Optimizer test coverage plan includes fixing failing tests in optimizer.real.test.ts and optimizer.enhanced.test.ts, prioritizing coverage for critical components (optimizer.ts, melcloud-api.ts, tibber-api.ts, thermal-model.ts), and implementing a phased coverage threshold approach (Phase 1: 50% statements/lines, 40% branches, 50% functions; Phase 2: 65%/50%/65%; Phase 3: 80%/60%/80%).
