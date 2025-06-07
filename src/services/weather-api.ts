import { HomeyLogger } from '../types'; // Assuming HomeyLogger is in types
import { WeatherData } from '../types';

export class WeatherApi {
  private logger: HomeyLogger;
  private apiKey: string | null;

  constructor(logger: HomeyLogger, apiKey?: string) {
    this.logger = logger;
    this.apiKey = apiKey || null;
    if (!this.apiKey) {
      this.logger.warn?.('WeatherApi: API key not provided. Using mock data.');
    }
    this.logger.log?.('WeatherApi initialized.');
  }

  async getCurrentWeather(): Promise<WeatherData> {
    this.logger.warn?.('WeatherApi: getCurrentWeather() called, returning mock data as API integration is not fully implemented.');

    // Return mock data that conforms to the WeatherData interface
    const mockWeatherData: WeatherData = {
      temperature: 15, // Celsius
      windSpeed: 5,    // m/s
      humidity: 60,    // %
      cloudCover: 40,  // %
      precipitation: 0 // mm
    };

    return Promise.resolve(mockWeatherData);
  }

  // Placeholder for a forecast method if needed later
  // async getForecast(): Promise<WeatherData[]> {
  //   this.logger.warn?.('WeatherApi: getForecast() called, returning mock data.');
  //   return Promise.resolve([await this.getCurrentWeather()]); // Example: array with current weather
  // }
}
