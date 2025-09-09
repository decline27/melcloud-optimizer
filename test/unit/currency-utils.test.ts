import {
  getCurrencyDecimals,
  majorToMinor,
  minorToMajor,
  formatCurrency,
  isValidCurrencyCode,
  resolveCurrency,
  CURRENCY_DECIMALS,
  DEFAULT_DECIMALS
} from '../../src/util/currency-utils';

describe('Currency Utils', () => {
  describe('getCurrencyDecimals', () => {
    test('returns correct decimals for known currencies', () => {
      expect(getCurrencyDecimals('JPY')).toBe(0);
      expect(getCurrencyDecimals('KWD')).toBe(3);
      expect(getCurrencyDecimals('BHD')).toBe(3);
      expect(getCurrencyDecimals('CLF')).toBe(4);
      expect(getCurrencyDecimals('USD')).toBe(2);
      expect(getCurrencyDecimals('EUR')).toBe(2);
    });

    test('returns default decimals for unknown currencies', () => {
      expect(getCurrencyDecimals('XYZ')).toBe(DEFAULT_DECIMALS);
      expect(getCurrencyDecimals('UNKNOWN')).toBe(DEFAULT_DECIMALS);
    });

    test('handles case insensitive input', () => {
      expect(getCurrencyDecimals('jpy')).toBe(0);
      expect(getCurrencyDecimals('kwd')).toBe(3);
      expect(getCurrencyDecimals('usd')).toBe(2);
    });

    test('returns default for invalid input', () => {
      expect(getCurrencyDecimals('')).toBe(DEFAULT_DECIMALS);
      expect(getCurrencyDecimals(null as any)).toBe(DEFAULT_DECIMALS);
      expect(getCurrencyDecimals(undefined)).toBe(DEFAULT_DECIMALS);
      expect(getCurrencyDecimals(123 as any)).toBe(DEFAULT_DECIMALS);
    });
  });

  describe('majorToMinor', () => {
    test('converts major to minor units correctly', () => {
      // USD/EUR (2 decimals)
      expect(majorToMinor(12.34, 'USD')).toBe(1234);
      expect(majorToMinor(1, 'EUR')).toBe(100);
      expect(majorToMinor(0.01, 'USD')).toBe(1);

      // JPY (0 decimals)
      expect(majorToMinor(100, 'JPY')).toBe(100);
      expect(majorToMinor(1.5, 'JPY')).toBe(2); // rounds

      // KWD (3 decimals)
      expect(majorToMinor(1.234, 'KWD')).toBe(1234);
      expect(majorToMinor(12.345, 'KWD')).toBe(12345);
    });

    test('uses explicit decimals when provided', () => {
      expect(majorToMinor(12.34, 'USD', 3)).toBe(12340);
      expect(majorToMinor(1, 'JPY', 2)).toBe(100);
    });

    test('handles rounding for floating point precision', () => {
      expect(majorToMinor(0.1 + 0.2, 'USD')).toBe(30); // 0.30000000000000004 -> 30
      expect(majorToMinor(1.005, 'USD')).toBe(100); // rounds to nearest, not always up
    });

    test('returns 0 for invalid input', () => {
      expect(majorToMinor(NaN, 'USD')).toBe(0);
      expect(majorToMinor('invalid' as any, 'USD')).toBe(0);
      expect(majorToMinor(null as any, 'USD')).toBe(0);
    });
  });

  describe('minorToMajor', () => {
    test('converts minor to major units correctly', () => {
      // USD/EUR (2 decimals)
      expect(minorToMajor(1234, 'USD')).toBe(12.34);
      expect(minorToMajor(100, 'EUR')).toBe(1);
      expect(minorToMajor(1, 'USD')).toBe(0.01);

      // JPY (0 decimals)
      expect(minorToMajor(100, 'JPY')).toBe(100);
      expect(minorToMajor(1, 'JPY')).toBe(1);

      // KWD (3 decimals)
      expect(minorToMajor(1234, 'KWD')).toBe(1.234);
      expect(minorToMajor(12345, 'KWD')).toBe(12.345);
    });

    test('uses explicit decimals when provided', () => {
      expect(minorToMajor(12340, 'USD', 3)).toBe(12.34);
      expect(minorToMajor(100, 'JPY', 2)).toBe(1);
    });

    test('returns 0 for invalid input', () => {
      expect(minorToMajor(NaN, 'USD')).toBe(0);
      expect(minorToMajor('invalid' as any, 'USD')).toBe(0);
      expect(minorToMajor(null as any, 'USD')).toBe(0);
    });
  });

  describe('round trip conversions', () => {
    test('major->minor->major preserves values', () => {
      const testCases = [
        { amount: 12.34, currency: 'USD' },
        { amount: 1.234, currency: 'KWD' },
        { amount: 100, currency: 'JPY' },
        { amount: 0.01, currency: 'EUR' },
      ];

      testCases.forEach(({ amount, currency }) => {
        const minor = majorToMinor(amount, currency);
        const major = minorToMajor(minor, currency);
        expect(major).toBeCloseTo(amount, 10);
      });
    });

    test('minor->major->minor preserves values', () => {
      const testCases = [
        { amount: 1234, currency: 'USD' },
        { amount: 12345, currency: 'KWD' },
        { amount: 100, currency: 'JPY' },
        { amount: 1, currency: 'EUR' },
      ];

      testCases.forEach(({ amount, currency }) => {
        const major = minorToMajor(amount, currency);
        const minor = majorToMinor(major, currency);
        expect(minor).toBe(amount);
      });
    });
  });

  describe('formatCurrency', () => {
    test('formats currency with valid currency codes', () => {
      // Note: Exact format depends on system locale, so we test basic structure
      const usdFormatted = formatCurrency(12.34, 'USD');
      expect(typeof usdFormatted).toBe('string');
      expect(usdFormatted).toMatch(/12[.,]34/); // Should contain the amount

      const jpyFormatted = formatCurrency(100, 'JPY');
      expect(typeof jpyFormatted).toBe('string');
      expect(jpyFormatted).toMatch(/100/); // JPY has no decimals
    });

    test('falls back to number formatting for invalid currency', () => {
      const formatted = formatCurrency(12.34, 'INVALID');
      expect(typeof formatted).toBe('string');
      expect(formatted).toMatch(/12[.,]34/);
    });

    test('handles invalid amounts', () => {
      expect(formatCurrency(NaN, 'USD')).toBe('0');
      expect(formatCurrency(null as any, 'USD')).toBe('0');
    });
  });

  describe('isValidCurrencyCode', () => {
    test('validates correct currency codes', () => {
      expect(isValidCurrencyCode('USD')).toBe(true);
      expect(isValidCurrencyCode('EUR')).toBe(true);
      expect(isValidCurrencyCode('JPY')).toBe(true);
      expect(isValidCurrencyCode('KWD')).toBe(true);
    });

    test('rejects invalid currency codes', () => {
      expect(isValidCurrencyCode('usd')).toBe(false); // lowercase
      expect(isValidCurrencyCode('US')).toBe(false); // too short
      expect(isValidCurrencyCode('USDD')).toBe(false); // too long
      expect(isValidCurrencyCode('123')).toBe(false); // numbers
      expect(isValidCurrencyCode('')).toBe(false); // empty
      expect(isValidCurrencyCode(null as any)).toBe(false); // null
    });
  });

  describe('resolveCurrency', () => {
    test('returns first valid currency from sources', () => {
      expect(resolveCurrency('USD', 'EUR')).toBe('USD');
      expect(resolveCurrency(null, undefined, 'EUR')).toBe('EUR');
      expect(resolveCurrency('invalid', 'USD')).toBe('USD');
      expect(resolveCurrency('usd', 'EUR')).toBe('USD'); // normalized
    });

    test('handles mixed case by normalizing', () => {
      expect(resolveCurrency('usd')).toBe('USD');
      expect(resolveCurrency('eur')).toBe('EUR');
      expect(resolveCurrency(' JPY ')).toBe('JPY');
    });

    test('returns empty string when no valid currency found', () => {
      expect(resolveCurrency()).toBe('');
      expect(resolveCurrency(null, undefined, '')).toBe('');
      expect(resolveCurrency('invalid', 'bad2', '12')).toBe('');
    });
  });

  describe('CURRENCY_DECIMALS constant', () => {
    test('contains expected currencies', () => {
      expect(CURRENCY_DECIMALS).toHaveProperty('JPY', 0);
      expect(CURRENCY_DECIMALS).toHaveProperty('KWD', 3);
      expect(CURRENCY_DECIMALS).toHaveProperty('BHD', 3);
      expect(CURRENCY_DECIMALS).toHaveProperty('CLF', 4);
    });

    test('DEFAULT_DECIMALS is reasonable', () => {
      expect(DEFAULT_DECIMALS).toBe(2);
      expect(typeof DEFAULT_DECIMALS).toBe('number');
    });
  });
});