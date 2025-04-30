# Tech Context: Heat Pump Optimizer

**Core Technology:** Homey SDK 3.0 App

**Language:** TypeScript (`src/`) and JavaScript (`api.js`, `weather.js`)
*   `src/app.ts` (TypeScript): Handles initialization, settings, cron scheduling, and acts as an orchestrator calling `api.js`.
*   `api.js` (JavaScript): Contains the core implementations of `MelCloudApi`, `TibberApi`, and `Optimizer` services.
*   `weather.js` (JavaScript): Implements the `WeatherApi` service.
*   TypeScript Target: ESNext (as per standard Homey app setup)
*   Compiler: `typescript` (v4.x specified in `package.json`) used for `src/` files.

**Runtime Environment:** Node.js environment provided by the Homey Pro/Bridge.

**Key Dependencies:**
*   `homey`: Athom's official SDK for Homey Apps (v3.0.0 specified). Provides access to Homey core functionalities (settings, flow, notifications, device management - though no specific device driver is implemented here).
*   `cron`: Standard cron job scheduler for Node.js (v1.8.2 specified). Used for hourly (minute 5) and weekly (Sunday 2:05 AM) task execution, managed in `src/app.ts`.
*   `https`: Node.js built-in module used for API requests in `api.js` and `weather.js`.

**Development Setup:**
*   Requires Node.js and npm installed.
*   Standard Homey CLI tools (`homey`) are used for development:
    *   `homey app run`: Runs the app locally for testing.
    *   `homey app build`: Compiles TypeScript to JavaScript (output to `lib/`).
    *   `homey app install`: Installs the app on a connected Homey.
*   TypeScript compilation is configured via `tsconfig.json`.
*   Linting is configured via `.eslintrc.json`.

**API Integrations:**
*   **Tibber:** GraphQL API (`https://api.tibber.com/v1-beta/gql`). Requires Bearer token authentication.
*   **Tibber:** GraphQL API (`https://api.tibber.com/v1-beta/gql`). Requires Bearer token authentication. Fetches current/today/tomorrow prices, including Tibber's price levels (e.g., `VERY_CHEAP`). Implemented in `api.js` with caching and advanced forecasting.
*   **MELCloud:** REST-like JSON API (`https://app.melcloud.com`). Requires session key (`X-MitsContextKey`). Implemented in `api.js` with detailed handling for ATW vs. ATA devices, Zone 1/2 temperature setting, Tank temperature setting, specific `EffectiveFlags`, robust device finding, and HTTP request retry logic.
*   **Met.no (Norwegian Meteorological Institute):** REST API (`https://api.met.no/weatherapi/locationforecast/2.0`). Requires User-Agent header. Used for weather forecasts if enabled. Implemented in `weather.js`.

**Technical Constraints & Considerations:**
*   **Homey Environment:** Runs within the constraints of the Homey platform (memory, CPU limits).
*   **API Rate Limits:** Potential rate limits on Tibber, MELCloud, and OpenAI APIs need to be considered, although current usage (hourly/weekly) is low.
*   **MELCloud API Stability:** Relies on an unofficial/internal MELCloud API which could change without notice. Robust error handling is important.
*   **Network Reliability:** Assumes stable internet connectivity for API calls.
*   **TypeScript Compilation:** Code must compile successfully using `tsc` before running.
*   **State Persistence:** Uses Homey Settings (`this.homey.settings`) for:
    *   Credentials (`melcloud_user`, `melcloud_pass`, `tibber_token`).
    *   Configuration (`device_id`, `building_id`, temperature limits, feature flags like `enable_zone2`, `enable_tank_control`, `use_weather_data`, comfort profile settings).
    *   Internal state (`cron_status`, `last_hourly_run`, `last_weekly_run`).
    *   Historical optimization data (`thermal_model_data`) used for weekly calibration.
*   **Heat Pump Control:** Temperature setting commands *are implemented* in `api.js` (`MelCloudApi.setDeviceTemperature`, `MelCloudApi.setDeviceTankTemperature`) for Zone 1, Zone 2, and the hot water tank, using appropriate API endpoints (`SetAta`, `SetAtw`) and `EffectiveFlags`.
