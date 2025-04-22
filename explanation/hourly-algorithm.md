The hourly optimization algorithm adjusts heat pump temperature based on electricity prices and a thermal model:

1. Data Collection:
   - Fetches current electricity prices from Tibber
   - Gets current indoor temperature from MELCloud
   - Retrieves current target temperature from heat pump
   - Calculates price statistics (current, average, min, max)

2. Temperature Calculation:
   - Normalizes price between 0 and 1: (currentPrice - minPrice) / (maxPrice - minPrice)
   - Inverts normalized price (1 - normalizedPrice) so lower prices = higher temperatures
   - Uses temperature constraints (minTemp=18°C, maxTemp=22°C, step=0.5°C)
   - Calculates target temperature:
     midTemp + (invertedPrice - 0.5) * tempRange
   - Applies K-factor from thermal model to adjust responsiveness
   - Limits temperature change to the configured step size (e.g., 0.5°C)
   - Rounds to nearest whole number (MELCloud only accepts whole numbers)

3. Optimization Decision:
   - Compares new target with current temperature
   - Estimates energy savings (5% per degree reduction)
   - Calculates comfort impact
   - Only changes temperature if difference is significant

4. Data Storage:
   - Stores optimization result in historical data
   - Keeps rolling 168-hour (1 week) history for calibration
   - Includes metrics like indoor/outdoor temperature, prices, savings