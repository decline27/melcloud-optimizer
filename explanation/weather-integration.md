Current Weather Integration:

1. Weather Data Collection (via WeatherApi class):
   - Uses Met.no API for weather forecasts
   - Fetches data based on location (latitude, longitude, altitude)
   - Caches forecasts for 1 hour to reduce API calls
   - Includes temperature, humidity, wind speed, cloud cover, and precipitation

2. Weather Impact on Optimization:
   - Calculates weather-based temperature adjustment considering:
     * Outdoor temperature
     * Wind speed (for heat loss calculation)
     * Cloud cover (for solar gain calculation)
     * Current vs average electricity prices
   - Provides weather trend analysis for next 24 hours
   - Includes weather data in optimization history

3. Integration Points:
   - Weather adjustments are applied after price-based optimization
   - Affects final target temperature calculation
   - Weather impact is logged and analyzed in weekly calibration