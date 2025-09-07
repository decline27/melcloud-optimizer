// Weather API integration used by api.js and optimizer.
// Fetches forecast from Met.no Locationforecast API and computes
// a simple, safe adjustment used during optimization.

const https = require('https');

class WeatherApi {
  constructor(userAgent, logger) {
    this.userAgent = userAgent || 'MELCloudOptimizer (+https://homey.app/)';
    this.logger = logger || console;
    this._lastForecast = null;
    this._lastFetchTs = 0;
  }

  // Internal: simple HTTPS GET returning parsed JSON
  _getJSON(url) {
    const headers = {
      'User-Agent': this.userAgent,
      'Accept': 'application/json'
    };
    return new Promise((resolve, reject) => {
      const req = https.get(url, { headers }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve(json);
          } catch (err) {
            reject(err);
          }
        });
      });
      req.on('error', reject);
      req.setTimeout(15000, () => {
        req.destroy(new Error('Weather request timed out'));
      });
    });
  }

  // Convert Met.no compact response to the structure expected by the app
  _mapMetNoToForecast(json) {
    try {
      const ts = json && json.properties && Array.isArray(json.properties.timeseries) ? json.properties.timeseries : [];
      if (!ts.length) {
        return this._emptyForecast();
      }

      const first = ts[0];
      const instant = (first.data && first.data.instant && first.data.instant.details) || {};
      const nextSymbol = (first.data && first.data.next_1_hours && first.data.next_1_hours.summary && first.data.next_1_hours.summary.symbol_code) || 'na';

      const current = {
        temperature: this._numOrNull(instant.air_temperature),
        humidity: this._numOrNull(instant.relative_humidity),
        windSpeed: this._numOrNull(instant.wind_speed),
        cloudCover: this._numOrNull(instant.cloud_area_fraction),
        symbol: nextSymbol
      };

      const hourly = ts.slice(0, 48).map(entry => {
        const det = (entry.data && entry.data.instant && entry.data.instant.details) || {};
        const sym = (entry.data && entry.data.next_1_hours && entry.data.next_1_hours.summary && entry.data.next_1_hours.summary.symbol_code) || 'na';
        return {
          time: entry.time,
          temperature: this._numOrNull(det.air_temperature),
          humidity: this._numOrNull(det.relative_humidity),
          windSpeed: this._numOrNull(det.wind_speed),
          cloudCover: this._numOrNull(det.cloud_area_fraction),
          symbol: sym
        };
      });

      return { current, hourly };
    } catch (err) {
      this._log('Error mapping Met.no response', err);
      return this._emptyForecast();
    }
  }

  _numOrNull(v) { return typeof v === 'number' ? v : null; }
  _emptyForecast() {
    return {
      current: { temperature: null, humidity: null, windSpeed: null, cloudCover: null, symbol: 'na' },
      hourly: []
    };
  }
  _log(msg, ...args) { try { (this.logger && this.logger.log ? this.logger.log : console.log)(msg, ...args); } catch (_) {} }
  _error(msg, err) { try { (this.logger && this.logger.error ? this.logger.error : console.error)(msg, err); } catch (_) {} }

  // Fetch forecast from Met.no (with 5-minute cache)
  async getForecast(latitude, longitude, _options) {
    try {
      const now = Date.now();
      if (this._lastForecast && (now - this._lastFetchTs) < 5 * 60 * 1000) {
        return this._lastForecast;
      }

      const lat = Number(latitude);
      const lon = Number(longitude);
      if (!isFinite(lat) || !isFinite(lon)) {
        // Fallback to Homey settings if not provided
        const h = this.logger && this.logger.homey;
        const userLat = h && h.settings && h.settings.get('latitude');
        const userLon = h && h.settings && h.settings.get('longitude');
        const fLat = Number(userLat) || 59.9; // Oslo fallback
        const fLon = Number(userLon) || 10.7;
        return await this.getForecast(fLat, fLon);
      }

      const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`;
      const json = await this._getJSON(url);
      const mapped = this._mapMetNoToForecast(json);
      this._lastForecast = mapped;
      this._lastFetchTs = now;
      return mapped;
    } catch (err) {
      this._error('Weather forecast fetch failed', err);
      return this._emptyForecast();
    }
  }

  // Provide immediate current conditions; derive from forecast if necessary
  async getCurrentWeather() {
    try {
      const h = this.logger && this.logger.homey;
      const userLat = h && h.settings && h.settings.get('latitude');
      const userLon = h && h.settings && h.settings.get('longitude');
      const lat = Number(userLat) || 59.9;
      const lon = Number(userLon) || 10.7;
      const forecast = await this.getForecast(lat, lon);
      return forecast.current;
    } catch (err) {
      this._error('getCurrentWeather failed', err);
      return { temperature: null, humidity: null, windSpeed: null, cloudCover: null, precipitation: null };
    }
  }

  // Calculate a bounded adjustment using near-term forecast and price context
  // Signature compatible with api.js: (forecast, currentTemp, targetTemp, currentPrice, avgPrice)
  calculateWeatherBasedAdjustment(forecast, currentTemp, targetTemp, currentPrice, avgPrice) {
    try {
      if (!forecast || !forecast.hourly || forecast.hourly.length === 0) {
        return { adjustment: 0, reason: 'No weather forecast available' };
      }

      const curr = forecast.current || {};
      const nowTemp = typeof curr.temperature === 'number' ? curr.temperature : (typeof currentTemp === 'number' ? currentTemp : null);
      const wind = typeof curr.windSpeed === 'number' ? curr.windSpeed : 0;

      // Average of next 6 hours
      const next6 = forecast.hourly.slice(0, 6).map(h => h && typeof h.temperature === 'number' ? h.temperature : nowTemp).filter(v => typeof v === 'number');
      if (!next6.length || nowTemp === null) {
        return { adjustment: 0, reason: 'Insufficient weather data' };
      }
      const avg6 = next6.reduce((a, b) => a + b, 0) / next6.length;
      const delta6h = avg6 - nowTemp; // >0 warming, <0 cooling expected

      // Base adjustment policy
      let adj = 0;
      let why = [];
      const absDelta = Math.abs(delta6h);

      if (delta6h <= -3) {
        // Imminent cooling: preheat modestly
        adj = Math.min(0.2 + absDelta * 0.1, 0.8);
        why.push('incoming cold front');
      } else if (delta6h >= 3) {
        // Imminent warming: allow coasting
        adj = -Math.min(0.2 + absDelta * 0.08, 0.6);
        why.push('incoming warm period');
      } else {
        // Small changes -> no adjustment
        adj = 0;
        why.push('stable weather');
      }

      // Wind amplifies heat loss during cooling periods
      if (adj > 0) { // only when preheating
        const windFactor = 1 + Math.min(wind / 15, 0.5); // up to +50%
        adj *= windFactor;
        if (wind > 6) why.push(`wind ${wind.toFixed(1)}m/s`);
      }

      // Price context: favor preheating when cheap, coasting when expensive
      if (typeof currentPrice === 'number' && typeof avgPrice === 'number' && avgPrice > 0) {
        const ratio = currentPrice / avgPrice;
        if (adj > 0 && ratio <= 0.7) { // cheap now, preheat more
          adj *= 1.2;
          why.push('cheap price');
        } else if (adj < 0 && ratio >= 1.3) { // expensive now, coast more
          adj *= 1.2;
          why.push('expensive price');
        }
      }

      // Bound the adjustment and round lightly
      adj = Math.max(-1.0, Math.min(1.0, adj));
      adj = Math.round(adj * 10) / 10; // 0.1°C precision here; final clamping/rules applied downstream

      const reason = `${why.join(', ')}` || 'weather-based adjustment';
      return { adjustment: adj, reason };
    } catch (err) {
      this._error('calculateWeatherBasedAdjustment failed', err);
      return { adjustment: 0, reason: 'Weather adjustment error' };
    }
  }

  // Simple trend classification using next-6h average vs now
  getWeatherTrend(forecast) {
    try {
      if (!forecast || !forecast.hourly || forecast.hourly.length === 0) {
        return { trend: 'unknown', details: 'No forecast' };
      }
      const curr = forecast.current || {};
      const nowTemp = typeof curr.temperature === 'number' ? curr.temperature : null;
      const next6 = forecast.hourly.slice(0, 6).map(h => h && typeof h.temperature === 'number' ? h.temperature : nowTemp).filter(v => typeof v === 'number');
      if (!next6.length || nowTemp === null) return { trend: 'unknown', details: 'Insufficient data' };
      const avg6 = next6.reduce((a, b) => a + b, 0) / next6.length;
      const d = avg6 - nowTemp;
      if (d <= -3) return { trend: 'cooling', details: 'Significant cooling in next 6h' };
      if (d >= 3) return { trend: 'warming', details: 'Significant warming in next 6h' };
      return { trend: 'stable', details: 'Minor temperature change in next 6h' };
    } catch (err) {
      this._error('getWeatherTrend failed', err);
      return { trend: 'unknown', details: 'Error computing trend' };
    }
  }
}

module.exports = WeatherApi;
