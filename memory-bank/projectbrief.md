# Project Brief: Heat Pump Optimizer Homey App

**Core Goal:** Develop a Homey SDK 3.0 TypeScript application named "Heat Pump Optimizer" (`com.melcloud.optimize`) that autonomously adjusts a heat pump's target temperature based on real-time electricity prices from Tibber and indoor temperature readings from MELCloud.

**Key Features:**
1.  **Hourly Optimization:** Adjust the heat pump target temperature every hour based on the current Tibber price level (categorized from VERY_CHEAP to VERY_EXPENSIVE) and a simple thermal model (K factor).
2.  **Weekly Calibration:** Use OpenAI's GPT model (specifically `gpt-4o-mini`) once a week (Monday 3 AM) to refine the thermal model parameters (K and S) based on the past week's logged data (timestamp, price, indoor temp, target temp).
3.  **MELCloud Integration:** Fetch indoor temperature and potentially control the heat pump via the MELCloud API. Requires user email and password.
4.  **Tibber Integration:** Fetch hourly electricity prices via the Tibber API. Requires user API token.
5.  **OpenAI Integration:** Use the OpenAI API for weekly model calibration. Requires user API key.
6.  **Homey Integration:**
    *   Store configuration (API keys, credentials, model parameters, logs) in Homey settings.
    *   Use Homey's cron scheduling for hourly and weekly tasks.
    *   Provide user feedback via Homey notifications and timeline logs.
    *   Define necessary permissions (`settings`, `flow`, `notifications`).
    *   Categorize the app under "climate".

**Target Platform:** Homey (using SDK 3.0)
**Primary Language:** TypeScript
