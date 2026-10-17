import moment from 'moment-timezone';
import { HomeyApp } from '../types';
import { getHomeLocation } from './home-location';
import { getTimeZoneName } from './time-zone-helper';

/**
 * Currency detection utility using GPS coordinates
 */
export class CurrencyDetector {
  private static readonly COUNTRY_CURRENCY_MAP: Record<string, string> = {
    // Europe
    'AT': 'EUR', 'BE': 'EUR', 'CY': 'EUR', 'EE': 'EUR', 'FI': 'EUR', 'FR': 'EUR',
    'DE': 'EUR', 'GR': 'EUR', 'IE': 'EUR', 'IT': 'EUR', 'LV': 'EUR', 'LT': 'EUR',
    'LU': 'EUR', 'MT': 'EUR', 'NL': 'EUR', 'PT': 'EUR', 'SK': 'EUR', 'SI': 'EUR',
    'ES': 'EUR', 'AD': 'EUR', 'MC': 'EUR', 'SM': 'EUR', 'VA': 'EUR',

    // Nordic countries
    'NO': 'NOK', 'SE': 'SEK', 'DK': 'DKK', 'IS': 'ISK',

    // Other European
    'GB': 'GBP', 'CH': 'CHF', 'PL': 'PLN', 'CZ': 'CZK', 'HU': 'HUF',
    'RO': 'RON', 'BG': 'BGN', 'HR': 'HRK',

    // North America
    'US': 'USD', 'CA': 'CAD', 'MX': 'MXN',

    // Asia Pacific
    'JP': 'JPY', 'AU': 'AUD', 'NZ': 'NZD', 'CN': 'CNY', 'KR': 'KRW',
    'IN': 'INR', 'SG': 'SGD', 'HK': 'HKD',

    // Others
    'BR': 'BRL', 'ZA': 'ZAR', 'RU': 'RUB'
  };

  private static readonly COORDINATE_RANGES: Array<{
    name: string;
    code: string;
    lat: [number, number];
    lng: [number, number];
  }> = [
    // Nordic countries (common for heat pumps)
    { name: 'Norway', code: 'NO', lat: [57.0, 71.5], lng: [4.0, 31.5] },
    { name: 'Sweden', code: 'SE', lat: [55.0, 69.5], lng: [10.0, 24.5] },
    { name: 'Denmark', code: 'DK', lat: [54.5, 57.8], lng: [8.0, 15.5] },
    { name: 'Finland', code: 'FI', lat: [59.5, 70.5], lng: [19.0, 31.5] },
    { name: 'Iceland', code: 'IS', lat: [63.0, 67.0], lng: [-25.0, -13.0] },

    // Major European countries
    { name: 'Germany', code: 'DE', lat: [47.0, 55.5], lng: [5.5, 15.5] },
    { name: 'France', code: 'FR', lat: [41.0, 51.5], lng: [-5.5, 10.0] },
    { name: 'United Kingdom', code: 'GB', lat: [49.5, 61.0], lng: [-8.5, 2.0] },
    { name: 'Netherlands', code: 'NL', lat: [50.5, 54.0], lng: [3.0, 7.5] },
    { name: 'Belgium', code: 'BE', lat: [49.5, 51.5], lng: [2.5, 6.5] },
    { name: 'Switzerland', code: 'CH', lat: [45.5, 48.0], lng: [5.5, 11.0] },
    { name: 'Austria', code: 'AT', lat: [46.0, 49.5], lng: [9.5, 17.5] },
    { name: 'Poland', code: 'PL', lat: [49.0, 55.0], lng: [14.0, 24.5] },

    // North America
    { name: 'United States', code: 'US', lat: [24.0, 72.0], lng: [-180.0, -66.0] },
    { name: 'Canada', code: 'CA', lat: [41.5, 84.0], lng: [-141.0, -52.0] },

    // Other regions
    { name: 'Japan', code: 'JP', lat: [24.0, 46.0], lng: [123.0, 146.0] },
    { name: 'Australia', code: 'AU', lat: [-44.0, -10.0], lng: [113.0, 154.0] }
  ];

  /**
   * Detect currency based on GPS coordinates
   * @param latitude Latitude coordinate
   * @param longitude Longitude coordinate
   * @returns Currency code (ISO 4217) or null if not detected
   */
  static detectCurrency(latitude: number, longitude: number): string | null {
    const country = this.detectCountry(latitude, longitude);
    return country ? this.COUNTRY_CURRENCY_MAP[country] || null : null;
  }

  /**
   * Detect the ISO2 country based on GPS coordinates (rough bounding boxes, first match wins)
   */
  static detectCountry(latitude: number, longitude: number): string | null {
    if (!latitude || !longitude ||
        latitude < -90 || latitude > 90 ||
        longitude < -180 || longitude > 180) {
      return null;
    }

    // Find matching country based on coordinates
    for (const region of this.COORDINATE_RANGES) {
      const [latMin, latMax] = region.lat;
      const [lngMin, lngMax] = region.lng;

      if (latitude >= latMin && latitude <= latMax &&
          longitude >= lngMin && longitude <= lngMax) {
        return region.code;
      }
    }

    return null;
  }

  /**
   * The home's ISO2 country. The time zone names the country exactly for most zones
   * (Europe/Stockholm, Europe/Copenhagen); the coordinates' rough boxes overlap near borders
   * (Malmö sits in the Danish box too), so they only pick between countries sharing a zone,
   * or decide when no zone is known.
   */
  static detectHomeCountry(homey: HomeyApp): string | null {
    const home = getHomeLocation(homey as any);
    const fromLocation = home ? this.detectCountry(home.latitude, home.longitude) : null;
    const zoneName = getTimeZoneName(homey as any);
    const zone = zoneName ? moment.tz.zone(zoneName) : null;
    const zoneCountries: string[] = (zone as any)?.countries?.() ?? [];
    if (fromLocation && zoneCountries.includes(fromLocation)) return fromLocation;
    const known = zoneCountries.find(code => this.COUNTRY_CURRENCY_MAP[code]);
    return known ?? fromLocation;
  }

  /**
   * Get currency with fallback chain
   * @param homey Homey app instance
   * @returns Currency code
   */
  static getCurrencyWithFallback(homey: HomeyApp): string {
    // 1. Try manual currency setting (if exists; currency_code is the older key)
    const manualCurrency = homey.settings?.get('currency') || homey.settings?.get('currency_code');
    if (typeof manualCurrency === 'string' && manualCurrency.trim()) {
      return manualCurrency.trim().toUpperCase();
    }

    // 2. Try the home country (Homey's time zone and location)
    const country = this.detectHomeCountry(homey);
    const detectedCurrency = country ? this.COUNTRY_CURRENCY_MAP[country] : undefined;
    if (detectedCurrency) {
      return detectedCurrency;
    }

    // 3. Try Homey's i18n currency
    if (homey.i18n?.getCurrency) {
      const i18nCurrency = homey.i18n.getCurrency();
      if (i18nCurrency) {
        return i18nCurrency;
      }
    }

    // 4. Default fallback
    return 'EUR';
  }
}
