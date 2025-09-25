import * as https from 'https';

type NullableNumber = number | null;

type WeatherLogger = {
  log(message: string, ...args: any[]): void;
  error(message: string, error?: unknown, ...args: any[]): void;
  homey?: {
    settings?: {
      get(key: string): any;
    };
  };
};

interface ForecastInstant {
  temperature: NullableNumber;
  humidity: NullableNumber;
  windSpeed: NullableNumber;
  cloudCover: NullableNumber;
  symbol: string | null;
}

interface HourlyForecast extends ForecastInstant {
  time: string;
}

interface WeatherForecast {
  current: ForecastInstant;
  hourly: HourlyForecast[];
}

interface WeatherAdjustment {
  adjustment: number;
  reason: string;
}

interface WeatherTrend {
  trend: 'unknown' | 'cooling' | 'warming' | 'stable';
  details: string;
}

class WeatherApi {
  private readonly userAgent: string;
  private readonly logger: WeatherLogger;
  private lastForecast: WeatherForecast | null;
  private lastFetchTs: number;

  constructor(userAgent?: string, logger?: WeatherLogger) {
    this.userAgent = userAgent || 'MELCloudOptimizer (+https://homey.app/)';
    this.logger = logger || console;
    this.lastForecast = null;
    this.lastFetchTs = 0;
  }

  private getJSON(url: string): Promise<any> {
    const headers = {
      'User-Agent': this.userAgent,
      Accept: 'application/json'
    };

    return new Promise((resolve, reject) => {
      const req = https.get(url, { headers }, (res) => {
        let data = '';
        res.on('data', (chunk: Buffer | string) => {
          data += chunk.toString();
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(error);
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(15000, () => {
        req.destroy(new Error('Weather request timed out'));
      });
    });
  }

  private mapMetNoToForecast(json: any): WeatherForecast {
    try {
      const timeSeries = json?.properties?.timeseries;
      const series: any[] = Array.isArray(timeSeries) ? timeSeries : [];
      if (series.length === 0) {
        return this.emptyForecast();
      }

      const first = series[0];
      const instant = first?.data?.instant?.details ?? {};
      const nextSymbol = first?.data?.next_1_hours?.summary?.symbol_code ?? 'na';

      const current: ForecastInstant = {
        temperature: this.numOrNull(instant.air_temperature),
        humidity: this.numOrNull(instant.relative_humidity),
        windSpeed: this.numOrNull(instant.wind_speed),
        cloudCover: this.numOrNull(instant.cloud_area_fraction),
        symbol: nextSymbol
      };

      const hourly = series.slice(0, 48).map<HourlyForecast>((entry) => {
        const details = entry?.data?.instant?.details ?? {};
        const symbol = entry?.data?.next_1_hours?.summary?.symbol_code ?? 'na';
        return {
          time: entry.time,
          temperature: this.numOrNull(details.air_temperature),
          humidity: this.numOrNull(details.relative_humidity),
          windSpeed: this.numOrNull(details.wind_speed),
          cloudCover: this.numOrNull(details.cloud_area_fraction),
          symbol
        };
      });

      return { current, hourly };
    } catch (error) {
      this.log('Error mapping Met.no response', error);
      return this.emptyForecast();
    }
  }

  private numOrNull(value: unknown): NullableNumber {
    return typeof value === 'number' ? value : null;
  }

  private emptyForecast(): WeatherForecast {
    return {
      current: {
        temperature: null,
        humidity: null,
        windSpeed: null,
        cloudCover: null,
        symbol: 'na'
      },
      hourly: []
    };
  }

  private log(message: string, ...args: unknown[]): void {
    try {
      if (typeof this.logger.log === 'function') {
        this.logger.log(message, ...args);
      } else {
        // eslint-disable-next-line no-console
        console.log(message, ...args);
      }
    } catch (_) {
      // ignore logging errors
    }
  }

  private error(message: string, error: unknown): void {
    try {
      if (typeof this.logger.error === 'function') {
        this.logger.error(message, error);
      } else {
        // eslint-disable-next-line no-console
        console.error(message, error);
      }
    } catch (_) {
      // ignore logging errors
    }
  }

  async getForecast(latitude?: number, longitude?: number): Promise<WeatherForecast> {
    try {
      const now = Date.now();
      if (this.lastForecast && now - this.lastFetchTs < 5 * 60 * 1000) {
        return this.lastForecast;
      }

      const lat = Number(latitude);
      const lon = Number(longitude);

      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        const homeySettings = this.logger.homey?.settings;
        const userLat = Number(homeySettings?.get?.('latitude')) || 59.9;
        const userLon = Number(homeySettings?.get?.('longitude')) || 10.7;
        return this.getForecast(userLat, userLon);
      }

      const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`;
      const json = await this.getJSON(url);
      const mapped = this.mapMetNoToForecast(json);
      this.lastForecast = mapped;
      this.lastFetchTs = now;
      return mapped;
    } catch (error) {
      this.error('Weather forecast fetch failed', error);
      return this.emptyForecast();
    }
  }

  async getCurrentWeather(): Promise<ForecastInstant> {
    try {
      const homeySettings = this.logger.homey?.settings;
      const userLat = Number(homeySettings?.get?.('latitude')) || 59.9;
      const userLon = Number(homeySettings?.get?.('longitude')) || 10.7;
      const forecast = await this.getForecast(userLat, userLon);
      return forecast.current;
    } catch (error) {
      this.error('getCurrentWeather failed', error);
      return {
        temperature: null,
        humidity: null,
        windSpeed: null,
        cloudCover: null,
        symbol: 'na'
      };
    }
  }

  calculateWeatherBasedAdjustment(
    forecast: WeatherForecast,
    currentTemp: NullableNumber,
    targetTemp: NullableNumber,
    currentPrice: number | null,
    avgPrice: number | null
  ): WeatherAdjustment {
    try {
      if (!forecast?.hourly?.length) {
        return { adjustment: 0, reason: 'No weather forecast available' };
      }

      const curr = forecast.current || {};
      const nowTemp = typeof curr.temperature === 'number' ? curr.temperature : (typeof currentTemp === 'number' ? currentTemp : null);
      const wind = typeof curr.windSpeed === 'number' ? curr.windSpeed : 0;

      const next6 = forecast.hourly
        .slice(0, 6)
        .map((h) => (typeof h?.temperature === 'number' ? h.temperature : nowTemp))
        .filter((v): v is number => typeof v === 'number');

      if (!next6.length || nowTemp === null) {
        return { adjustment: 0, reason: 'Insufficient weather data' };
      }

      const avg6 = next6.reduce((a, b) => a + b, 0) / next6.length;
      const delta6h = avg6 - nowTemp;

      let adjustment = 0;
      const reasons: string[] = [];
      const absDelta = Math.abs(delta6h);

      if (delta6h <= -3) {
        adjustment = Math.min(0.2 + absDelta * 0.1, 0.8);
        reasons.push('incoming cold front');
      } else if (delta6h >= 3) {
        adjustment = -Math.min(0.2 + absDelta * 0.08, 0.6);
        reasons.push('incoming warm period');
      } else {
        adjustment = 0;
        reasons.push('stable weather');
      }

      if (adjustment > 0) {
        const windFactor = 1 + Math.min(wind / 15, 0.5);
        adjustment *= windFactor;
        if (wind > 6) {
          reasons.push(`wind ${wind.toFixed(1)}m/s`);
        }
      }

      if (typeof currentPrice === 'number' && typeof avgPrice === 'number' && avgPrice > 0) {
        const ratio = currentPrice / avgPrice;
        if (adjustment > 0 && ratio <= 0.7) {
          adjustment *= 1.2;
          reasons.push('cheap price');
        } else if (adjustment < 0 && ratio >= 1.3) {
          adjustment *= 1.2;
          reasons.push('expensive price');
        }
      }

      adjustment = Math.max(-1, Math.min(1, adjustment));
      adjustment = Math.round(adjustment * 10) / 10;

      return {
        adjustment,
        reason: reasons.join(', ') || 'weather-based adjustment'
      };
    } catch (error) {
      this.error('calculateWeatherBasedAdjustment failed', error);
      return { adjustment: 0, reason: 'Weather adjustment error' };
    }
  }

  getWeatherTrend(forecast: WeatherForecast): WeatherTrend {
    try {
      if (!forecast?.hourly?.length) {
        return { trend: 'unknown', details: 'No forecast' };
      }
      const curr = forecast.current || {};
      const nowTemp = typeof curr.temperature === 'number' ? curr.temperature : null;
      const next6 = forecast.hourly
        .slice(0, 6)
        .map((h) => (typeof h?.temperature === 'number' ? h.temperature : nowTemp))
        .filter((v): v is number => typeof v === 'number');

      if (!next6.length || nowTemp === null) {
        return { trend: 'unknown', details: 'Insufficient data' };
      }

      const avg6 = next6.reduce((a, b) => a + b, 0) / next6.length;
      const delta = avg6 - nowTemp;
      if (delta <= -3) return { trend: 'cooling', details: 'Significant cooling in next 6h' };
      if (delta >= 3) return { trend: 'warming', details: 'Significant warming in next 6h' };
      return { trend: 'stable', details: 'Minor temperature change in next 6h' };
    } catch (error) {
      this.error('getWeatherTrend failed', error);
      return { trend: 'unknown', details: 'Error computing trend' };
    }
  }

}

export = WeatherApi;
