// Minimal Weather API stub used by api.js when weather integration is enabled.
// Provides the required interface without external dependencies.

class WeatherApi {
  constructor(userAgent, logger) {
    this.userAgent = userAgent || 'MELCloudOptimizer';
    this.logger = logger || console;
  }

  // Return a minimal forecast structure expected by api.js
  async getForecast(latitude, longitude, options = {}) {
    const now = new Date();
    const hoursAhead = options.hoursAhead || 24;
    const hourly = Array.from({ length: hoursAhead }, (_, i) => ({
      time: new Date(now.getTime() + i * 3600000).toISOString(),
      temperature: null,
      humidity: null,
      windSpeed: null,
      cloudCover: null,
      symbol: 'na'
    }));
    return {
      current: {
        temperature: null,
        humidity: null,
        windSpeed: null,
        cloudCover: null,
        symbol: 'na'
      },
      hourly
    };
  }

  // Compute a neutral weather adjustment
  calculateWeatherBasedAdjustment(_forecast, _context = {}) {
    return { adjustment: 0, reason: 'No weather adjustment (stub)' };
  }

  // Report a neutral trend
  getWeatherTrend(_forecast) {
    return { trend: 'stable', details: 'No weather trend (stub)' };
  }
}

module.exports = WeatherApi;

