# Product Context: Heat Pump Optimizer

**Problem Solved:** Managing heat pump settings manually to optimize for fluctuating electricity prices (like those from Tibber) is tedious and often suboptimal. Users may run the heat pump during expensive hours or fail to pre-heat/cool during cheap hours, leading to higher energy costs and potentially less comfort.

**How it Works (User Perspective):**
1.  The user installs the "Heat Pump Optimizer" app on their Homey.
2.  They configure the app with their MELCloud credentials, Tibber API token, and OpenAI API key via the Homey app settings.
3.  Once configured, the app runs autonomously in the background.
4.  **Hourly:** The app checks the current Tibber electricity price, compares it to the day's price range, and determines if it's cheap, normal, or expensive. It also fetches the current indoor temperature from the MELCloud-connected heat pump (assumed to be named 'Boiler' or the first numeric ID device). Based on the price level and a learned thermal model of the house, it calculates a new target temperature for the heat pump, aiming to slightly increase the target during cheap hours and decrease it during expensive hours, within defined comfort bounds (18-24°C) and gradual steps (max 0.5°C change based on model).
5.  **Weekly:** Every Monday morning, the app sends the last week's worth of hourly data (price, indoor temp, target temp) to OpenAI. OpenAI analyzes this data to refine the parameters (K and S) of the thermal model, improving the accuracy of the hourly adjustments over time.
6.  **Feedback:** The user receives notifications and timeline entries in the Homey app detailing the hourly price level, current indoor temperature, the newly calculated target temperature, and the current model parameter (K). Weekly calibration results (new K and S values) are also logged.

**User Experience Goals:**
*   **Autonomous Operation:** Set-and-forget functionality after initial configuration.
*   **Cost Savings:** Reduce heating/cooling costs by intelligently shifting energy usage to cheaper hours.
*   **Comfort Maintenance:** Maintain indoor temperature within a comfortable range (18-24°C) while optimizing.
*   **Transparency:** Provide clear feedback on actions taken and model parameters via Homey notifications and timeline.
*   **Simplicity:** Easy setup through standard Homey app settings.
