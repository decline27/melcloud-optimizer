The hourly optimization algorithm adjusts heat pump temperatures based on electricity prices and a thermal model:

1. Data Collection:
   - Fetches current electricity prices from Tibber
   - Gets current indoor temperature from MELCloud
   - Retrieves current target temperatures (Zone1, Zone2, and tank) from heat pump
   - Calculates price statistics (current, average, min, max)
   - Retrieves weather data from Met.no API

2. Zone1 Temperature Calculation:
   - Normalizes price between 0 and 1: (currentPrice - minPrice) / (maxPrice - minPrice)
   - Inverts normalized price (1 - normalizedPrice) so lower prices = higher temperatures
   - Uses temperature constraints (minTemp=18°C, maxTemp=22°C, step=0.5°C)
   - Calculates target temperature:
     midTemp + (invertedPrice - 0.5) * tempRange
   - Applies K-factor from thermal model to adjust responsiveness
   - Applies weather adjustment based on outdoor conditions
   - Applies comfort profile adjustments based on time of day
   - Limits temperature change to the configured step size (e.g., 0.5°C)
   - Rounds to nearest 0.5°C increment (MELCloud supports 0.5°C increments)

3. Zone2 Temperature Calculation (if enabled):
   - Uses the same algorithm as Zone1 but with Zone2-specific constraints
   - Only applied if the device supports Zone2 and it's enabled in settings

4. Tank Temperature Calculation (if enabled):
   - Uses a simplified algorithm based on price levels
   - Sets tank temperature to minimum when prices are high
   - Sets tank temperature to maximum when prices are low
   - Uses tank-specific temperature constraints

5. Optimization Decision:
   - Compares new targets with current temperatures
   - Estimates energy savings (5% per degree reduction)
   - Calculates comfort impact
   - Only changes temperatures if differences are significant

6. Data Storage:
   - Stores optimization result in historical data
   - Keeps rolling 168-hour (1 week) history for calibration
   - Includes metrics like indoor/outdoor temperature, prices, savings
   - Logs to Homey timeline for user visibility