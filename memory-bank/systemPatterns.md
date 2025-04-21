# System Patterns: Heat Pump Optimizer

**Architecture:** Single Homey App (`App` class extending `Homey.App`).

**Core Components:**
1.  **`HeatOptimizerApp` Class (`src/app.ts`):**
    *   Main application entry point.
    *   Extends `Homey.App`.
    *   Handles initialization (`onInit`).
    *   Contains the core logic for hourly optimization (`runHourlyOptimizer`) and weekly calibration (`runWeeklyCalibration`).
2.  **Cron Jobs:**
    *   Uses the `cron` npm package.
    *   Two jobs scheduled in `onInit`:
        *   Hourly (at minute 0, second 0): Triggers `runHourlyOptimizer`.
        *   Weekly (Monday 3:00 AM): Triggers `runWeeklyCalibration`.
    *   Timezone is based on `this.homey.env.CRONTIMEZONE`.
3.  **State Management:**
    *   Uses Homey Settings (`this.homey.settings`) to persist:
        *   User credentials/tokens (`melcloud_user`, `melcloud_pass`, `tibber_token`, `openai_api_key`). Defined in `app.json`.
        *   Internal application state (`MEM_KEY = 'heatPumpOptimizerMem'`), including:
            *   `model`: Thermal model parameters (`K`, optional `S`). Initialized with `K=0.3`.
            *   `lastIndoor`: Last recorded indoor temperature.
            *   `lastTarget`: Last set target temperature.
            *   `logs`: Array of recent log entries (`{ ts, price, indoor, target }`), capped at 168 entries (1 week).
4.  **External API Interaction:**
    *   Uses standard `fetch` API for all external communication.
    *   **Tibber API (`https://api.tibber.com/v1-beta/gql`):**
        *   GraphQL query to fetch today's price info.
        *   Requires `Authorization: Bearer <tibber_token>`.
    *   **MELCloud API (`https://app.melcloud.com`):**
        *   Login (`/ClientLogin/ClientLogin`) to get `ContextKey`. Requires email/password.
        *   List Devices (`/User/ListDevices`) using `X-MitsContextKey` header.
        *   *Note: Currently only reads `RoomTemperatureZone1`. Does not yet implement setting the target temperature.*
    *   **OpenAI API (`https://api.openai.com/v1/chat/completions`):**
        *   Uses `gpt-4o-mini` model.
        *   Sends past week's logs as context.
        *   Expects response in "K=x.xx, S=y.yy" format.
        *   Requires `Authorization: Bearer <openai_api_key>`.
5.  **Homey Platform Integration:**
    *   **Settings:** Read/write user config and app state.
    *   **Notifications (`this.homey.notifications`):** Send updates/errors to the user.
    *   **Flow Actions (`this.homey.flow`):** Log messages to the Homey timeline using the built-in `homey:manager:timeline:log` action card.
6.  **Thermal Modeling:**
    *   **Hourly Update:** Simple proportional adjustment based on the difference between the last target and last indoor temperature (`dSet`), and the actual change (`dAct`). `K` represents the system's responsiveness. `new_K = old_K + 0.1 * error / dSet`, clamped between 0 and 1.
    *   **Target Calculation:** Adjusts the last target temperature up or down based on price level (`VERY_CHEAP` or `VERY_EXPENSIVE`) by a step size calculated as `TEMP_STEP_MAX / K`. Clamped between `MIN_TEMP` and `MAX_TEMP`.
    *   **Weekly Calibration (LLM):** Sends log data to OpenAI to get updated `K` and `S` values. *Note: The `S` value is parsed but not currently used in the hourly calculation.*

**Error Handling:**
*   Uses `try...catch` blocks within `runHourlyOptimizer` and `runWeeklyCalibration`.
*   Logs errors using `this.log()`.
*   Sends error messages to the user via Homey notifications and timeline logs.
*   Checks for `ok` status on `fetch` responses and throws errors on failure.
*   Validates presence of expected data in API responses (e.g., `priceInfo.today`, `ContextKey`, `RoomTemperatureZone1`, LLM response format).

**Dependencies:**
*   `homey`: Core SDK.
*   `cron`: For scheduling tasks.
