/**
 * Currency utilities for handling major/minor unit conversions
 * Supports integer minor units with configurable decimals per currency
 */

/**
 * Currency decimal places configuration
 * Most currencies use 2 decimal places, but some exceptions exist
 */
export const CURRENCY_DECIMALS: Record<string, number> = {
  'JPY': 0,  // Japanese Yen has no fractional units
  'KWD': 3,  // Kuwaiti Dinar has 3 decimal places
  'BHD': 3,  // Bahraini Dinar has 3 decimal places
  'CLF': 4,  // Chilean Unit of Account has 4 decimal places
  'TND': 3,  // Tunisian Dinar has 3 decimal places
  'OMR': 3,  // Omani Rial has 3 decimal places
  'IQD': 3,  // Iraqi Dinar has 3 decimal places
  'JOD': 3,  // Jordanian Dinar has 3 decimal places
  'LYD': 3,  // Libyan Dinar has 3 decimal places
  // Add more as needed
};

/**
 * Default number of decimal places for currencies not in the map
 */
export const DEFAULT_DECIMALS = 2;

/**
 * Get the number of decimal places for a currency
 * @param currency ISO 4217 currency code (e.g., 'USD', 'EUR', 'JPY')
 * @returns Number of decimal places for the currency
 */
export function getCurrencyDecimals(currency?: string): number {
  if (!currency || typeof currency !== 'string') {
    return DEFAULT_DECIMALS;
  }
  
  const upperCurrency = currency.toUpperCase();
  return CURRENCY_DECIMALS[upperCurrency] ?? DEFAULT_DECIMALS;
}

/**
 * Convert major units to minor units (multiply by 10^decimals)
 * @param majorAmount Amount in major units (e.g., 12.34 EUR)
 * @param currency ISO 4217 currency code
 * @param decimals Optional override for decimal places
 * @returns Amount in minor units as integer (e.g., 1234 cents)
 */
export function majorToMinor(majorAmount: number, currency?: string, decimals?: number): number {
  if (typeof majorAmount !== 'number' || isNaN(majorAmount)) {
    return 0;
  }
  
  const actualDecimals = decimals ?? getCurrencyDecimals(currency);
  const multiplier = Math.pow(10, actualDecimals);
  
  // Round to handle floating point precision issues
  return Math.round(majorAmount * multiplier);
}

/**
 * Convert minor units to major units (divide by 10^decimals)
 * @param minorAmount Amount in minor units as integer (e.g., 1234 cents)
 * @param currency ISO 4217 currency code
 * @param decimals Optional override for decimal places
 * @returns Amount in major units (e.g., 12.34 EUR)
 */
export function minorToMajor(minorAmount: number, currency?: string, decimals?: number): number {
  if (typeof minorAmount !== 'number' || isNaN(minorAmount)) {
    return 0;
  }
  
  const actualDecimals = decimals ?? getCurrencyDecimals(currency);
  const divisor = Math.pow(10, actualDecimals);
  
  return minorAmount / divisor;
}

/**
 * Format an amount for display using the appropriate currency formatting
 * @param amount Amount in major units
 * @param currency ISO 4217 currency code
 * @param locale Optional locale for formatting (defaults to system locale)
 * @returns Formatted currency string
 */
export function formatCurrency(amount: number, currency?: string, locale?: string): string {
  if (typeof amount !== 'number' || isNaN(amount)) {
    return '0';
  }
  
  try {
    if (currency && /^[A-Z]{3}$/.test(currency)) {
      const decimals = getCurrencyDecimals(currency);
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: currency,
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
      }).format(amount);
    } else {
      // Fallback to number formatting without currency symbol
      return new Intl.NumberFormat(locale, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(amount);
    }
  } catch (error) {
    // Fallback to simple string formatting
    return amount.toFixed(2);
  }
}

/**
 * Validate that a currency code is properly formatted
 * @param currency Currency code to validate
 * @returns True if valid ISO 4217 format (3 uppercase letters)
 */
export function isValidCurrencyCode(currency: string): boolean {
  return typeof currency === 'string' && /^[A-Z]{3}$/.test(currency);
}

/**
 * Resolve currency from multiple possible sources, with validation
 * @param sources Array of possible currency values to check in order
 * @returns First valid currency code found, or empty string if none valid
 */
export function resolveCurrency(...sources: (string | null | undefined)[]): string {
  for (const source of sources) {
    if (source && typeof source === 'string') {
      const normalized = source.toUpperCase().trim();
      if (isValidCurrencyCode(normalized)) {
        return normalized;
      }
    }
  }
  return '';
}