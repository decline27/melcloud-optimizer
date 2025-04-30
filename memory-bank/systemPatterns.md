# System Patterns: Heat Pump Optimizer

**Architecture:** Single Homey App (`App` class extending `Homey.App`).

**Project Structure:**
*   **`src/`**: Contains the core TypeScript source code.
    *   `app.ts`: Main application class (`HeatOptimizerApp`).
    *   `services/`: Houses API clients (MELCloud, Tibber) and the `Optimizer` logic.
    *   `services/thermal-model/`: Contains components related to thermal modeling (`DataCollector`, `ThermalAnalyzer`, `ThermalModelService`).
    *   `util/`: Utility functions, primarily logging (`logger.ts`).
*   **`test/`**: Contains Jest tests (`unit/`, `mocks/`).
*   **`settings/`**: HTML/frontend code for the app's settings interface in the Homey mobile app.
*   **`locales/`**: Localization files (e.g., `en.json`) for different languages.
*   **`assets/`**: Static files like icons (`icon.svg`) and images (`images/`).
*   **`explanation/`**: Markdown documents providing detailed explanations of specific parts of the system (e.g., algorithms, API usage).
*   **`memory-bank/`**: Markdown files storing contextual information about the project (like this file).
*   **`logs/`**: Directory where runtime logs are stored.
*   **`minimal-build/`**: Output directory for a specific build process defined in `build-minimal.sh`.
*   **Root Files**: Configuration (`app.json`, `tsconfig.json`, `package.json`), entry point (`index.ts`), API definition (`api.js`), scripts, and documentation.

**Core Components:**
1.  **`HeatOptimizerApp` Class (`src/app.ts`):**
    *   Main application entry point (TypeScript).
    *   Extends `Homey.App`.
    *   Handles initialization (`onInit`), settings changes (`onSettingsChanged`), cron job scheduling, and manual triggers.
    *   Acts as an orchestrator, calling API functions in `api.js` for core tasks (`getRunHourlyOptimizer`, `getRunWeeklyCalibration`).
    *   Manages cron job status updates in Homey settings.
2.  **`api.js` (JavaScript):**
    *   Contains the primary service implementations:
        *   `MelCloudApi`: Handles login, device listing/finding (ATW/ATA differentiation), state retrieval, and setting temperatures for Zone 1, Zone 2, and Tank Water using appropriate `EffectiveFlags` and API endpoints (`SetAta`, `SetAtw`). Includes robust device finding and dummy device support.
        *   `TibberApi`: Handles fetching price data, caching, advanced forecasting (using Tibber price levels, statistics, patterns), and calculating price position.
        *   `Optimizer`: Orchestrates the optimization logic using MelCloud, Tibber, and Weather APIs. Calculates optimal temperatures for multiple zones/tank based on price, forecast, comfort profile, and weather.
    *   Includes a helper `httpRequest` function with retry logic for API calls.
    *   Exports functions callable by Homey's API system (e.g., `getRunHourlyOptimizer`, `getDeviceList`).
3.  **`weather.js` (JavaScript):**
    *   Implements `WeatherApi` service using the Met.no API.
    *   Fetches forecasts, processes data, calculates heat loss/solar gain coefficients, and provides weather-based temperature adjustments and trends to the `Optimizer`. Includes caching.
4.  **Cron Jobs (Managed in `src/app.ts`):**
    *   Uses the `cron` npm package.
    *   Two jobs scheduled in `initializeCronJobs`:
        *   Hourly (at minute 5): Triggers `runHourlyOptimizer` via `api.js`.
        *   Weekly (Sunday 2:05 AM): Triggers `runWeeklyCalibration` via `api.js`.
    *   Status (running state, next run time) is stored in Homey settings (`cron_status`).
3.  **State Management (Homey Settings):**
    *   Uses `this.homey.settings` to persist:
        *   Credentials/Tokens: `melcloud_user`, `melcloud_pass`, `tibber_token`.
        *   Configuration: `device_id`, `building_id`, `min/max_temp` (Zone1, Zone2, Tank), `temp_step`, feature flags (`enable_zone2`, `enable_tank_control`, `use_weather_data`), comfort profile (`day_start/end_hour`, `night_temp_reduction`, `pre_heat_hours`), `initial_k`.
        *   Runtime State: `cron_status`, `last_hourly_run`, `last_weekly_run`.
        *   Historical Data: `thermal_model_data` (array of past optimization results, last calibration details) used for the thermal learning model. Loaded/saved in `api.js`.
4.  **External API Interaction (Implemented in `api.js`, `weather.js`):**
    *   Uses Node.js `https` module via `httpRequest` helper (in `api.js`) with retry logic.
    *   **Tibber API (`https://api.tibber.com/v1-beta/gql`):**
        *   GraphQL query to fetch current/today/tomorrow price info, including Tibber's price levels (`VERY_CHEAP`, `NORMAL`, `EXPENSIVE`, etc.).
        *   Provides advanced forecasting, statistics, and pattern analysis.
        *   Requires `Authorization: Bearer <tibber_token>`.
    *   **MELCloud API (`https://app.melcloud.com`):**
        *   Login (`/ClientLogin/ClientLogin`) to get `ContextKey`. Requires email/password.
        *   List Devices (`/User/ListDevices`) using `X-MitsContextKey`. Differentiates ATW/ATA devices.
        *   Get State (`/Device/Get`) using device/building IDs.
        *   Set State (`/Device/SetAta`, `/Device/SetAtw`) using specific `EffectiveFlags` to control Zone 1, Zone 2, and Tank temperatures.
    *   **Met.no API (`https://api.met.no/weatherapi/locationforecast/2.0`):**
        *   Fetches compact location forecast.
        *   Requires `User-Agent` header.
        *   Used by `WeatherApi` in `weather.js`.
5.  **Homey Platform Integration:**
    *   **Settings:** Read/write user config and app state.
    *   **Notifications (`this.homey.notifications`):** Send updates/errors to the user.
    *   **Flow Actions (`this.homey.flow`):** Log messages to the Homey timeline using the built-in `homey:manager:timeline:log` action card.
6.  **Thermal Modeling & Optimization (Implemented in `Optimizer` class in `api.js`):**
    *   **Hourly Optimization (`runHourlyOptimization`):**
        *   Fetches current device state (MELCloud), prices/forecast (Tibber), and weather (Met.no via `WeatherApi`).
        *   Calculates optimal target temperature for Zone 1 (and optionally Zone 2, Tank) based on:
            *   **Price:** Normalized price (min/max range), Tibber price levels (`VERY_CHEAP`, etc.).
            *   **Forecast:** Adjustments for significant upcoming price changes (pre-heat/cool).
            *   **Comfort Profile:** Time-based factor (0.5-1.0) using configurable day/night hours, night reduction, and pre-heat window. Adjusts target temperature range. Includes wake-up pre-heating logic.
            *   **Weather:** Adjustment based on outdoor temp, wind, cloud cover (solar gain) calculated by `WeatherApi`.
        *   Applies constraints (min/max temps, max step change per hour).
        *   Rounds target to nearest 0.5°C.
        *   Sends commands to MELCloud via `MelCloudApi`.
        *   Stores result in `thermal_model_data`.
    *   **Weekly Calibration (`runWeeklyCalibration`):**
        *   Uses historical optimization data from `thermal_model_data` (requires >= 24 points).
        *   Calculates average temperature response to price changes over the history.
        *   Adjusts the `K` factor (thermal responsiveness) based on this observed response, aiming for a target response level (Thermal Learning Model).
        *   Updates the `K` factor in the optimizer and saves the calibration result to `thermal_model_data`.
        *   *Replaces the previous OpenAI-based calibration.*

**Error Handling:**
*   Uses `try...catch` blocks extensively in `src/app.ts` and `api.js`.
*   Logs errors using `homey.app.log()` and `homey.app.error()`.
*   Sends error messages to the user via Homey notifications (`homey.notifications.createNotification`).
*   Uses `httpRequest` helper in `api.js` with retry logic for network/transient API errors.
*   Includes validation for settings (`validateSettings` in `src/app.ts`) and API responses within service methods.

**Dependencies:**
*   `homey`: Core SDK.
*   `cron`: For scheduling tasks.
*   `https`: Node.js built-in module for HTTP requests.
