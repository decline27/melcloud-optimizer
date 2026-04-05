import { PriceAnalyzer } from '../../src/services/price-analyzer';
import { HomeyLogger } from '../../src/util/logger';

function makeLogger(): HomeyLogger {
  return {
    log: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn()
  } as any;
}

function makeSettings(initial: Record<string, any> = {}) {
  const store: Record<string, any> = { ...initial };
  return {
    get: (key: string) => store[key],
    set: (key: string, value: any) => { store[key] = value; }
  };
}

/** Three days of price history stored in EUR */
function eurHistory() {
  return [
    { date: '2026-04-01', min: 0.04, max: 0.12, avg: 0.08, currency: 'EUR' },
    { date: '2026-04-02', min: 0.05, max: 0.14, avg: 0.09, currency: 'EUR' },
    { date: '2026-04-03', min: 0.06, max: 0.15, avg: 0.10, currency: 'EUR' }
  ];
}

function makePrices(price = 0.55, count = 4) {
  return Array.from({ length: count }, (_, i) => ({
    time: new Date(Date.now() + i * 3600_000).toISOString(),
    price
  }));
}

describe('PriceAnalyzer — currency change clears historical prices', () => {
  test('clears EUR history when first SEK prices are recorded', () => {
    const settings = makeSettings({
      historical_price_summaries: eurHistory()
    });
    const analyzer = new PriceAnalyzer(makeLogger(), undefined, settings);

    // Record SEK prices (currency changed from EUR stored history)
    analyzer.recordDailyPriceSummary(makePrices(0.55), 'SEK');

    // Historical avg should be unavailable — old EUR history was cleared
    expect(analyzer.getHistoricalAvgPrice()).toBeUndefined();
  });

  test('preserves history when same currency is used', () => {
    const settings = makeSettings({
      historical_price_summaries: eurHistory()
    });
    const analyzer = new PriceAnalyzer(makeLogger(), undefined, settings);

    // Record more EUR prices — should keep old history
    analyzer.recordDailyPriceSummary(makePrices(0.07), 'EUR');

    // Should have historical avg from the 3 days of EUR history (minus today)
    expect(analyzer.getHistoricalAvgPrice()).toBeDefined();
  });

  test('preserves history when no currency is passed (backward compat)', () => {
    const settings = makeSettings({
      historical_price_summaries: eurHistory()
    });
    const analyzer = new PriceAnalyzer(makeLogger(), undefined, settings);

    // Old call without currency arg — should not clear history
    analyzer.recordDailyPriceSummary(makePrices(0.07));

    expect(analyzer.getHistoricalAvgPrice()).toBeDefined();
  });
});
