import { getHomeLocation } from '../../src/util/home-location';
import { getTimeZoneName } from '../../src/util/time-zone-helper';
import { CurrencyDetector } from '../../src/util/currency-detector';
import { consumerMarkupInPrices, getPriceSource, getZone2Settings, gridFeeOnTopOfPrices } from '../../src/services/settings-loader';
import { automaticZone, countryForZone, resolveZoneToEic } from '../../src/entsoe';
import { zoneAreaForLocation } from '../../src/util/entsoe-zone-locator';
import { DEFAULT_CONSUMER_MARKUP, isBuiltInMarkupTable } from '../../src/services/consumer-markup-defaults';
import { EntsoePriceService } from '../../src/services/entsoe-price-service';

/**
 * Settings a new user can leave empty: location, time zone, currency, ENTSO-E consumer markup.
 */

function homey(stored: Record<string, unknown>, extra: Record<string, unknown> = {}): any {
  return {
    settings: { get: (key: string) => stored[key], set: jest.fn(), unset: jest.fn() },
    ...extra
  };
}

const malmo = { getLatitude: () => 55.58, getLongitude: () => 12.95 };
const copenhagen = { getLatitude: () => 55.68, getLongitude: () => 12.57 };

describe('home location', () => {
  test('typed coordinates win over Homey location', () => {
    const h = homey({ latitude: 59.9, longitude: 10.7 }, { geolocation: malmo });
    expect(getHomeLocation(h)).toEqual({ latitude: 59.9, longitude: 10.7, source: 'settings' });
  });

  test('empty settings fall back to the location set in Homey', () => {
    expect(getHomeLocation(homey({ latitude: '', longitude: null }, { geolocation: malmo })))
      .toEqual({ latitude: 55.58, longitude: 12.95, source: 'homey' });
  });

  test('0,0 and missing geolocation give no location', () => {
    expect(getHomeLocation(homey({}, { geolocation: { getLatitude: () => 0, getLongitude: () => 0 } }))).toBeNull();
    expect(getHomeLocation(homey({}))).toBeNull();
    expect(getHomeLocation(homey({}, { geolocation: { getLatitude: () => { throw new Error('no permission'); } } }))).toBeNull();
  });
});

describe('time zone', () => {
  test('typed zone wins, else Homey clock zone', () => {
    expect(getTimeZoneName(homey({ time_zone_name: 'Europe/Oslo' }, { clock: { getTimezone: () => 'Europe/Stockholm' } }))).toBe('Europe/Oslo');
    expect(getTimeZoneName(homey({ time_zone_name: '' }, { clock: { getTimezone: () => 'Europe/Stockholm' } }))).toBe('Europe/Stockholm');
    expect(getTimeZoneName(homey({}))).toBeUndefined();
  });
});

describe('home country and currency', () => {
  test('time zone separates countries whose coordinate boxes overlap', () => {
    expect(CurrencyDetector.detectHomeCountry(homey({}, { geolocation: malmo, clock: { getTimezone: () => 'Europe/Stockholm' } }))).toBe('SE');
    expect(CurrencyDetector.detectHomeCountry(homey({}, { geolocation: copenhagen, clock: { getTimezone: () => 'Europe/Copenhagen' } }))).toBe('DK');
  });

  test('a shared zone uses the coordinates to choose', () => {
    // Europe/Berlin lists DE, DK, NO, SE; Malmö's box is Sweden.
    expect(CurrencyDetector.detectHomeCountry(homey({}, { geolocation: malmo, clock: { getTimezone: () => 'Europe/Berlin' } }))).toBe('SE');
  });

  test('currency: typed value, older key, home country, then EUR', () => {
    expect(CurrencyDetector.getCurrencyWithFallback(homey({ currency: 'nok' }))).toBe('NOK');
    expect(CurrencyDetector.getCurrencyWithFallback(homey({ currency_code: 'DKK' }))).toBe('DKK');
    expect(CurrencyDetector.getCurrencyWithFallback(homey({}, { geolocation: malmo, clock: { getTimezone: () => 'Europe/Stockholm' } }))).toBe('SEK');
    expect(CurrencyDetector.getCurrencyWithFallback(homey({}))).toBe('EUR');
  });
});

describe('ENTSO-E zone country', () => {
  test('zone EICs, ISO area codes and unknown zones', () => {
    expect(countryForZone(homey({}), '10Y1001A1001A47J')).toBe('SE');
    expect(countryForZone(homey({}), 'SE3')).toBe('SE');
    expect(countryForZone(homey({}), '10YNO-1--------2')).toBe('NO');
    expect(countryForZone(homey({}), 'XX')).toBeNull();
    expect(countryForZone(homey({}), 'IT_NORD')).toBe('IT');
    expect(countryForZone(homey({}))).toBeNull();
  });
});

describe('consumer markup', () => {
  test('on by default for ENTSO-E; the grid fee setting is then not added on top', () => {
    expect(consumerMarkupInPrices(homey({}).settings)).toBe(true);
    expect(gridFeeOnTopOfPrices(homey({ grid_fee_per_kwh: 1.04 }).settings)).toBe(0);
    expect(consumerMarkupInPrices(homey({ enable_consumer_markup: false }).settings)).toBe(false);
    expect(gridFeeOnTopOfPrices(homey({ enable_consumer_markup: false, grid_fee_per_kwh: 1.04 }).settings)).toBe(1.04);
    expect(gridFeeOnTopOfPrices(homey({ price_data_source: 'tibber', grid_fee_per_kwh: 1.04 }).settings)).toBe(1.04);
  });

  test('a saved copy of the built-in table is recognised, an edited one is not', () => {
    const copy = JSON.parse(JSON.stringify(DEFAULT_CONSUMER_MARKUP));
    expect(isBuiltInMarkupTable(copy)).toBe(true);
    copy.SE.gridFee = 0.05;
    expect(isBuiltInMarkupTable(copy)).toBe(false);
  });

  const markup = (stored: Record<string, unknown>, price: number, country: string, eurToTarget: number) =>
    (new EntsoePriceService(homey(stored)) as any).applyConsumerMarkup(price, country, eurToTarget);

  test('built-in values are EUR and converted at the price rate', () => {
    // SE: (1 + (0.03 + 0.036 + 0.01) * 11) * 1.25
    expect(markup({}, 1, 'SE', 11)).toBeCloseTo((1 + 0.076 * 11) * 1.25, 6);
    // An older page's copy with a "SEK" unit is still the EUR table.
    const copy = JSON.stringify(DEFAULT_CONSUMER_MARKUP);
    expect(markup({ consumer_markup_config: copy, markup_currency_unit: 'SEK' }, 1, 'SE', 11)).toBeCloseTo((1 + 0.076 * 11) * 1.25, 6);
  });

  test("the user's grid fee replaces the table's, added as on the bill", () => {
    expect(markup({ grid_fee_per_kwh: 1.04 }, 1, 'SE', 11)).toBeCloseTo((1 + 0.046 * 11) * 1.25 + 1.04, 6);
  });

  test('a custom table uses its own currency; turning the markup off gives wholesale', () => {
    const custom = JSON.stringify({ SE: { gridFee: 0.3, energyTax: 0.4, retailMarkup: 0.1, vatRate: 1.25 } });
    expect(markup({ consumer_markup_config: custom }, 1, 'SE', 11)).toBeCloseTo((1 + 0.8) * 1.25, 6);
    expect(markup({ enable_consumer_markup: false }, 1, 'SE', 11)).toBe(1);
  });
});

describe('automatic ENTSO-E zone', () => {
  test.each([
    ['SE', 55.6, 13.0, 'SE4'], ['SE', 56.88, 14.81, 'SE4'], ['SE', 59.33, 18.07, 'SE3'],
    ['SE', 57.71, 11.97, 'SE3'], ['SE', 62.39, 17.31, 'SE2'], ['SE', 65.58, 22.15, 'SE1'],
    ['NO', 59.91, 10.75, 'NO1'], ['NO', 58.97, 5.73, 'NO2'], ['NO', 63.43, 10.4, 'NO3'],
    ['NO', 69.65, 18.96, 'NO4'], ['NO', 60.39, 5.32, 'NO5'],
    ['DK', 55.68, 12.57, 'DK2'], ['DK', 56.16, 10.2, 'DK1'], ['DK', 55.4, 10.39, 'DK1'],
    ['IT', 45.46, 9.19, 'IT_NORD'], ['IT', 41.9, 12.5, 'IT_CSUD'], ['IT', 38.12, 13.36, 'IT_SICI'],
    ['DE', 52.52, 13.4, 'DE']
  ])('%s %f,%f is %s', (country, lat, lon, area) => {
    expect(zoneAreaForLocation(country as string, lat as number, lon as number)).toBe(area);
  });

  test('no stored zone: the zone of the home is used', () => {
    const h = homey({}, { geolocation: malmo, clock: { getTimezone: () => 'Europe/Stockholm' } });
    expect(automaticZone(h)).toBe('SE4');
    expect(resolveZoneToEic(h)).toBe('10Y1001A1001A47J');
    // A chosen zone still wins.
    expect(resolveZoneToEic(homey({ entsoe_area_eic: 'SE3' }, { geolocation: malmo }))).toBe('10Y1001A1001A46L');
  });

  test('no zone and no known home: a clear error instead of another country\'s prices', () => {
    expect(automaticZone(homey({}))).toBeNull();
    expect(() => resolveZoneToEic(homey({}))).toThrow(/location in Homey/);
  });
});

describe('price source from the Tibber token', () => {
  test('token means Tibber, none means ENTSO-E; a stored choice wins', () => {
    expect(getPriceSource(homey({}).settings)).toBe('entsoe');
    expect(getPriceSource(homey({ tibber_token: 'abc' }).settings)).toBe('tibber');
    expect(getPriceSource(homey({ tibber_token: '  ' }).settings)).toBe('entsoe');
    expect(getPriceSource(homey({ tibber_token: 'abc', price_data_source: 'entsoe' }).settings)).toBe('entsoe');
    expect(getPriceSource(homey({ price_data_source: 'tibber' }).settings)).toBe('tibber');
  });

  test('the markup follows the derived source', () => {
    expect(consumerMarkupInPrices(homey({ tibber_token: 'abc' }).settings)).toBe(false);
  });
});

describe('Zone 2 defaults', () => {
  test('on unless turned off; limits fall back to the Home comfort range', () => {
    expect(getZone2Settings(homey({ comfort_lower_occupied: 21, comfort_upper_occupied: 23 }).settings))
      .toEqual({ enabled: true, min: 21, max: 23 });
    expect(getZone2Settings(homey({ enable_zone2: false, min_temp_zone2: 18, max_temp_zone2: 24 }).settings))
      .toEqual({ enabled: false, min: 18, max: 24 });
  });
});

