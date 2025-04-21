# Tech Context: Heat Pump Optimizer

**Core Technology:** Homey SDK 3.0 App

**Language:** TypeScript (compiled to JavaScript for runtime)
*   Target: ESNext (as per standard Homey app setup)
*   Compiler: `typescript` (v4.x specified in `package.json`)

**Runtime Environment:** Node.js environment provided by the Homey Pro/Bridge.

**Key Dependencies:**
*   `homey`: Athom's official SDK for Homey Apps (v3.0.0 specified). Provides access to Homey core functionalities (settings, flow, notifications, device management - though no specific device driver is implemented here).
*   `cron`: Standard cron job scheduler for Node.js (v1.8.2 specified). Used for hourly and weekly task execution.

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
*   **MELCloud:** REST-like JSON API (`https://app.melcloud.com`). Requires session key (`X-MitsContextKey`) obtained via a login endpoint using email/password.
*   **OpenAI:** REST API (`https://api.openai.com/v1/chat/completions`). Requires Bearer token authentication.

**Technical Constraints & Considerations:**
*   **Homey Environment:** Runs within the constraints of the Homey platform (memory, CPU limits).
*   **API Rate Limits:** Potential rate limits on Tibber, MELCloud, and OpenAI APIs need to be considered, although current usage (hourly/weekly) is low.
*   **MELCloud API Stability:** Relies on an unofficial/internal MELCloud API which could change without notice. Robust error handling is important.
*   **Network Reliability:** Assumes stable internet connectivity for API calls.
*   **TypeScript Compilation:** Code must compile successfully using `tsc` before running.
*   **State Persistence:** Relies entirely on Homey Settings for storing credentials and application state. Size limits for settings values might be a factor if logs become very large, but the current 168-entry limit should be well within bounds.
*   **Heat Pump Control:** The current implementation *reads* the indoor temperature but *does not send commands* to set the target temperature on the heat pump. This is a critical missing piece for the optimizer to actually control the device.
