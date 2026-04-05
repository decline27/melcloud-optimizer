import { HousePriceContextResolver, HousePriceContextParams } from '../../src/services/house-price-context';

function makeParams(overrides: Partial<HousePriceContextParams> = {}): HousePriceContextParams {
  return {
    tibberPriceLevel: undefined,
    historicalAvgPrice: undefined,
    currentPrice: 0.1148,
    futurePrices: Array.from({ length: 6 }, (_, i) => ({
      time: new Date(Date.now() + (i + 1) * 3600_000).toISOString(),
      price: 0.14,
    })),
    coolingRate: 0.05,
    currentTemp: 21.5,
    outdoorTemp: 9.0,
    normalizedCOP: 0.6,
    ...overrides,
  };
}

const resolver = new HousePriceContextResolver();

describe('HousePriceContextResolver — provider resolution', () => {
  it('uses Tibber native level directly', () => {
    const ctx = resolver.resolve(makeParams({ tibberPriceLevel: 'VERY_CHEAP' }));
    expect(ctx.absoluteLevel).toBe('VERY_CHEAP');
    expect(ctx.priceSource).toBe('tibber_native');
  });

  it('derives VERY_CHEAP from historical ratio < 0.55', () => {
    const ctx = resolver.resolve(makeParams({ historicalAvgPrice: 0.22 }));
    expect(ctx.absoluteLevel).toBe('VERY_CHEAP');
    expect(ctx.priceSource).toBe('entsoe_historical');
  });

  it('derives CHEAP from historical ratio 0.55–0.70', () => {
    const ctx = resolver.resolve(makeParams({ historicalAvgPrice: 0.19 }));
    expect(ctx.absoluteLevel).toBe('CHEAP');
    expect(ctx.priceSource).toBe('entsoe_historical');
  });

  it('derives NORMAL from historical ratio 0.70–1.30', () => {
    const ctx = resolver.resolve(makeParams({ historicalAvgPrice: 0.13 }));
    expect(ctx.absoluteLevel).toBe('NORMAL');
  });

  it('derives EXPENSIVE from historical ratio 1.30–1.45', () => {
    const ctx = resolver.resolve(makeParams({ currentPrice: 0.18, historicalAvgPrice: 0.13 }));
    expect(ctx.absoluteLevel).toBe('EXPENSIVE');
  });

  it('derives VERY_EXPENSIVE from historical ratio > 1.45', () => {
    const ctx = resolver.resolve(makeParams({ currentPrice: 0.21, historicalAvgPrice: 0.13 }));
    expect(ctx.absoluteLevel).toBe('VERY_EXPENSIVE');
  });

  it('falls back to local percentile when no provider level and no history', () => {
    const prices = Array.from({ length: 24 }, (_, i) => ({
      time: new Date(Date.now() + i * 3600_000).toISOString(),
      price: i < 3 ? 0.05 : 0.20,
    }));
    const ctx = resolver.resolve(makeParams({ currentPrice: 0.05, futurePrices: prices }));
    expect(ctx.priceSource).toBe('local_percentile');
    expect(['VERY_CHEAP', 'CHEAP']).toContain(ctx.absoluteLevel);
  });
});

describe('HousePriceContextResolver — isCheapForThisHouse', () => {
  it('VERY_CHEAP is always cheap for this house', () => {
    const ctx = resolver.resolve(makeParams({ tibberPriceLevel: 'VERY_CHEAP' }));
    expect(ctx.isCheapForThisHouse).toBe(true);
  });

  it('EXPENSIVE is never cheap for this house', () => {
    const ctx = resolver.resolve(makeParams({ tibberPriceLevel: 'EXPENSIVE' }));
    expect(ctx.isCheapForThisHouse).toBe(false);
  });

  it('CHEAP is cheap for this house when economic spread exceeds half breakeven', () => {
    // coolingRate=0.05, diff=12.5 → heatLoss=0.625/h × 6h=3.75°C → savedFraction=1.0 → breakeven=0
    // future=0.18, current=0.1148 → spread≈56.8% → exceeds 0% × 0.5 ✓
    const ctx = resolver.resolve(makeParams({
      tibberPriceLevel: 'CHEAP',
      futurePrices: Array.from({ length: 6 }, (_, i) => ({
        time: new Date(Date.now() + (i + 1) * 3600_000).toISOString(),
        price: 0.18,
      })),
    }));
    expect(ctx.isCheapForThisHouse).toBe(true);
  });

  it('NORMAL requires excellent COP (>=0.8) AND high spread', () => {
    // leaky house (coolingRate=0.10) → breakeven near 0 → spread of 1.61 qualifies
    const ctxGood = resolver.resolve(makeParams({
      tibberPriceLevel: 'NORMAL',
      normalizedCOP: 0.9,
      futurePrices: Array.from({ length: 6 }, (_, i) => ({
        time: new Date(Date.now() + (i + 1) * 3600_000).toISOString(),
        price: 0.30,
      })),
      coolingRate: 0.10,
    }));
    expect(ctxGood.isCheapForThisHouse).toBe(true);

    const ctxBadCOP = resolver.resolve(makeParams({
      tibberPriceLevel: 'NORMAL',
      normalizedCOP: 0.6,
      futurePrices: Array.from({ length: 6 }, (_, i) => ({
        time: new Date(Date.now() + (i + 1) * 3600_000).toISOString(),
        price: 0.30,
      })),
      coolingRate: 0.10,
    }));
    expect(ctxBadCOP.isCheapForThisHouse).toBe(false);
  });
});

describe('HousePriceContextResolver — houseBreakevenSpread', () => {
  it('well-insulated house has high breakeven spread', () => {
    // coolingRate=0.005, diff=12.5 → heatLoss=0.0625/h × 6h=0.375°C
    // savedFraction = 0.375/1.5 = 0.25 → breakeven = 1/0.25 - 1 = 3.0
    const ctx = resolver.resolve(makeParams({ tibberPriceLevel: 'CHEAP', coolingRate: 0.005 }));
    expect(ctx.houseBreakevenSpread).toBeGreaterThan(2.0);
  });

  it('poorly-insulated house has near-zero breakeven spread', () => {
    // coolingRate=0.20, diff=12.5 → heatLoss=2.5/h × 6h=15°C
    // savedDegrees = min(1.5, 15) = 1.5 → savedFraction=1.0 → breakeven=0
    const ctx = resolver.resolve(makeParams({ tibberPriceLevel: 'CHEAP', coolingRate: 0.20 }));
    expect(ctx.houseBreakevenSpread).toBeLessThan(0.01);
  });
});
