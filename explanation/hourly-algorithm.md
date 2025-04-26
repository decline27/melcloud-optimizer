The hourly optimization algorithm adjusts heat pump temperatures based on electricity prices and a thermal learning model:

1. Data Collection:
   - Fetches current electricity prices from Tibber
   - Gets current indoor temperature from MELCloud
   - Retrieves current target temperatures (Zone1, Zone2, and tank) from heat pump
   - Calculates price statistics (current, average, min, max)
   - Retrieves weather data from Met.no API
   - Considers time of day for comfort profile adjustments

2. Zone1 Temperature Calculation:
   - Normalizes price between 0 and 1: (currentPrice - minPrice) / (maxPrice - minPrice)
   - Inverts normalized price (1 - normalizedPrice) so lower prices = higher temperatures
   - Uses temperature constraints (minTemp=19°C, maxTemp=21°C, step=1°C)
   - Calculates target temperature:
     midTemp + (invertedPrice - 0.5) * tempRange
   - Applies K-factor from thermal learning model to adjust responsiveness
   - Applies weather adjustment based on outdoor conditions
   - Applies comfort profile adjustments based on time of day
   - Limits temperature change to the configured step size
   - Rounds to nearest supported increment (MELCloud supports 0.5°C increments)

3. Zone2 Temperature Calculation (if enabled):
   - Uses the same algorithm as Zone1 but with Zone2-specific constraints
   - Only applied if the device supports Zone2 and it's enabled in settings

4. Tank Temperature Calculation (if enabled):
   - Uses a simplified algorithm based on price levels
   - Sets tank temperature to minimum when prices are high (EXPENSIVE, VERY_EXPENSIVE)
   - Sets tank temperature to maximum when prices are low (CHEAP, VERY_CHEAP)
   - Uses medium temperature for normal prices (NORMAL)
   - Uses tank-specific temperature constraints (default: min=41°C, max=53°C, step=2°C)

5. Optimization Decision:
   - Compares new targets with current temperatures
   - Considers price trend for the next hours
   - Provides recommendation based on current and upcoming prices
   - Only changes temperatures if differences are significant

6. Data Storage:
   - Stores optimization result in thermal model data
   - Persists data to survive app reinstallations
   - Includes metrics like indoor/outdoor temperature, prices, weather conditions
   - Logs to Homey timeline for user visibility
   - Creates detailed timeline entries with optimization results