/**
 * Built-in consumer price components for ENTSO-E wholesale prices, per country.
 * Amounts are EUR per kWh; vatRate is a multiplier. Typical residential values, used when the
 * user has not entered their own table. The settings page shows this table via
 * /getSettingDefaults, so there is one copy.
 */
export interface MarkupComponents {
  gridFee: number;
  energyTax: number;
  retailMarkup: number;
  vatRate: number;
  description?: string;
}

export const DEFAULT_CONSUMER_MARKUP: Readonly<Record<string, MarkupComponents>> = {
  SE: { gridFee: 0.03, energyTax: 0.036, retailMarkup: 0.01, vatRate: 1.25, description: 'Sweden - typical residential' },
  DE: { gridFee: 0.07, energyTax: 0.025, retailMarkup: 0.015, vatRate: 1.19, description: 'Germany - typical residential' },
  NO: { gridFee: 0.035, energyTax: 0.017, retailMarkup: 0.008, vatRate: 1.25, description: 'Norway - typical residential' },
  DK: { gridFee: 0.045, energyTax: 0.089, retailMarkup: 0.012, vatRate: 1.25, description: 'Denmark - typical residential' },
  FR: { gridFee: 0.045, energyTax: 0.022, retailMarkup: 0.012, vatRate: 1.2, description: 'France - typical residential' },
  NL: { gridFee: 0.055, energyTax: 0.03, retailMarkup: 0.018, vatRate: 1.21, description: 'Netherlands - typical residential' },
  BE: { gridFee: 0.048, energyTax: 0.028, retailMarkup: 0.015, vatRate: 1.21, description: 'Belgium - typical residential' },
  AT: { gridFee: 0.038, energyTax: 0.015, retailMarkup: 0.012, vatRate: 1.2, description: 'Austria - typical residential' },
  CH: { gridFee: 0.065, energyTax: 0.023, retailMarkup: 0.02, vatRate: 1.077, description: 'Switzerland - typical residential' },
  FI: { gridFee: 0.042, energyTax: 0.027, retailMarkup: 0.015, vatRate: 1.24, description: 'Finland - typical residential' },
  PL: { gridFee: 0.025, energyTax: 0.012, retailMarkup: 0.008, vatRate: 1.23, description: 'Poland - typical residential' },
  CZ: { gridFee: 0.03, energyTax: 0.018, retailMarkup: 0.01, vatRate: 1.21, description: 'Czech Republic - typical residential' },
  IT: { gridFee: 0.055, energyTax: 0.035, retailMarkup: 0.018, vatRate: 1.22, description: 'Italy - typical residential' },
  ES: { gridFee: 0.045, energyTax: 0.051, retailMarkup: 0.015, vatRate: 1.21, description: 'Spain - typical residential' },
  PT: { gridFee: 0.042, energyTax: 0.034, retailMarkup: 0.013, vatRate: 1.23, description: 'Portugal - typical residential' },
  GB: { gridFee: 0.05, energyTax: 0.006, retailMarkup: 0.02, vatRate: 1.05, description: 'United Kingdom - typical residential' },
  EE: { gridFee: 0.035, energyTax: 0.007, retailMarkup: 0.012, vatRate: 1.2, description: 'Estonia - typical residential' },
  LV: { gridFee: 0.038, energyTax: 0.009, retailMarkup: 0.014, vatRate: 1.21, description: 'Latvia - typical residential' },
  LT: { gridFee: 0.04, energyTax: 0.011, retailMarkup: 0.016, vatRate: 1.21, description: 'Lithuania - typical residential' },
  SK: { gridFee: 0.028, energyTax: 0.015, retailMarkup: 0.009, vatRate: 1.2, description: 'Slovakia - typical residential' },
  SI: { gridFee: 0.045, energyTax: 0.03, retailMarkup: 0.012, vatRate: 1.22, description: 'Slovenia - typical residential' },
  HU: { gridFee: 0.022, energyTax: 0.008, retailMarkup: 0.007, vatRate: 1.27, description: 'Hungary - typical residential' },
  IE: { gridFee: 0.048, energyTax: 0.009, retailMarkup: 0.018, vatRate: 1.135, description: 'Ireland - typical residential' },
  RO: { gridFee: 0.028, energyTax: 0.012, retailMarkup: 0.01, vatRate: 1.19, description: 'Romania - typical residential' },
  BG: { gridFee: 0.025, energyTax: 0.008, retailMarkup: 0.008, vatRate: 1.2, description: 'Bulgaria - typical residential' },
  HR: { gridFee: 0.032, energyTax: 0.014, retailMarkup: 0.012, vatRate: 1.25, description: 'Croatia - typical residential' },
  GR: { gridFee: 0.038, energyTax: 0.025, retailMarkup: 0.015, vatRate: 1.24, description: 'Greece - typical residential' },
  RS: { gridFee: 0.02, energyTax: 0.006, retailMarkup: 0.008, vatRate: 1.2, description: 'Serbia - typical residential' },
  BA: { gridFee: 0.022, energyTax: 0.008, retailMarkup: 0.009, vatRate: 1.17, description: 'Bosnia and Herzegovina - typical residential' },
  ME: { gridFee: 0.025, energyTax: 0.005, retailMarkup: 0.01, vatRate: 1.21, description: 'Montenegro - typical residential' },
  MK: { gridFee: 0.018, energyTax: 0.004, retailMarkup: 0.007, vatRate: 1.18, description: 'North Macedonia - typical residential' },
  AL: { gridFee: 0.015, energyTax: 0.003, retailMarkup: 0.006, vatRate: 1.2, description: 'Albania - typical residential' },
  TR: { gridFee: 0.012, energyTax: 0.005, retailMarkup: 0.008, vatRate: 1.18, description: 'Turkey - typical residential' },
  default: { gridFee: 0.04, energyTax: 0.02, retailMarkup: 0.01, vatRate: 1.2, description: 'EU average approximation' }
};

const FIELDS: Array<keyof MarkupComponents> = ['gridFee', 'energyTax', 'retailMarkup', 'vatRate'];

/**
 * True when a stored table is just the built-in one. Older settings pages saved a copy of it
 * on first open; such a copy is in EUR whatever the markup currency setting says.
 */
export function isBuiltInMarkupTable(config: Record<string, any>): boolean {
  const keys = Object.keys(config);
  if (keys.length !== Object.keys(DEFAULT_CONSUMER_MARKUP).length) return false;
  return keys.every(key => {
    const builtIn = DEFAULT_CONSUMER_MARKUP[key];
    const entry = config[key];
    return !!builtIn && !!entry && FIELDS.every(field => Number(entry[field]) === builtIn[field]);
  });
}
