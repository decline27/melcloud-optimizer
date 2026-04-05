# House-Calibrated Economic Optimizer (HousePriceContext) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the generic local-percentile preheat trigger with a house-calibrated `HousePriceContext` that works identically for Tibber and ENTSO-E, uses real COP and thermal model data, and drives Zone 1 heating, hot water setpoint, and planning bias from a single authoritative signal.

**Architecture:** A new `HousePriceContextResolver` class is created inside `calculateThermalMassStrategy` (which already has all required inputs: COP, thermal capacity, cooling rate, prices, historical average). It resolves provider-agnostic `absoluteLevel` and computes `isCheapForThisHouse` from house thermics. The resolved context is returned in `ThermalStrategy.houseContext` and consumed by the optimizer for hot water and planning.

**Tech Stack:** TypeScript, Jest 29 + ts-jest, existing MELCloud service classes

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/types/index.ts` | Modify | Add `HousePriceContext` interface; add `houseContext?` to `ThermalStrategy` |
| `src/services/house-price-context.ts` | **Create** | `HousePriceContextResolver` class — provider resolution + house economics |
| `src/services/thermal-controller.ts` | Modify | Fix COP bug; add params; create context; update trigger conditions; return context |
| `src/services/optimizer.ts` | Modify | Pass `historicalAvgPrice` to strategy call; use `houseContext` for tank + planning |
| `src/services/planning-utils.ts` | Modify | Add `absolutePriceLevel` option; apply absolute override to bias |
| `test/unit/house-price-context.test.ts` | **Create** | Tests for provider resolution and house economics |
| `test/unit/thermal-controller.gate.test.ts` | Modify | Add tests for new trigger conditions |

---

## Task 1: Add Types

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: Add `HousePriceContext` interface after the `TibberPriceInfo` interface (after line 90)**

```typescript
export type AbsolutePriceLevel =
  | 'VERY_CHEAP'
  | 'CHEAP'
  | 'NORMAL'
  | 'EXPENSIVE'
  | 'VERY_EXPENSIVE';

export interface HousePriceContext {
  absoluteLevel: AbsolutePriceLevel;
  isCheapForThisHouse: boolean;
  houseBreakevenSpread: number;
  economicSpread: number;
  priceSource: 'tibber_native' | 'entsoe_historical' | 'local_percentile';
}
```

- [ ] **Step 2: Add `houseContext` to `ThermalStrategy` interface (lines 239-246)**

```typescript
export interface ThermalStrategy {
  action: 'preheat' | 'coast' | 'maintain' | 'boost';
  targetTemp: number;
  reasoning: string;
  estimatedSavings: number;
  duration?: number;
  confidenceLevel: number;
  houseContext?: HousePriceContext;  // ← ADD THIS
}
```

- [ ] **Step 3: Build and verify no errors**

```bash
cd /Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize && npm run build 2>&1 | head -30
```
Expected: no errors about new types (they're additive only)

- [ ] **Step 4: Commit**

```bash
cd /Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize
git add src/types/index.ts
git commit -m "feat: add HousePriceContext interface and houseContext to ThermalStrategy"
```

---

## Task 2: Fix COP Normalization Bug

**Files:**
- Modify: `src/services/thermal-controller.ts` (lines 424-432)
- Modify: `test/unit/thermal-controller.gate.test.ts`

- [ ] **Step 1: Write failing test in `test/unit/thermal-controller.gate.test.ts`**

Find the describe block in the file and add this test inside it:

```typescript
describe('normalizeHeatingEfficiency stale range fix', () => {
  it('returns roughNormalize fallback when copNormalizer returns 0 for valid COP', () => {
    // Simulate a stale CopNormalizer range (summer range: min=3.5, max=5.0)
    // When winter COP = 2.97, normalize() returns 0 (below learned min)
    const staleCopNormalizer = new CopNormalizer();
    // Force a stale range by directly updating with high summer values
    for (let i = 0; i < 10; i++) staleCopNormalizer.update(3.5 + (i * 0.15));
    // Now normalized COP of 2.97 should be 0 from the stale normalizer
    expect(staleCopNormalizer.normalize(2.97)).toBe(0);

    const controller = makeThermalController();
    (controller as any).copNormalizer = staleCopNormalizer;

    // normalizeHeatingEfficiency must NOT return 0 for cop=2.97 (a physically valid COP)
    const result = (controller as any).normalizeHeatingEfficiency(2.97);
    expect(result).toBeGreaterThan(0.2);  // roughNormalize(2.97) ≈ 0.494
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize
npx jest test/unit/thermal-controller.gate.test.ts --testNamePattern="stale range fix" -t "stale" 2>&1 | tail -20
```
Expected: FAIL — test fails because current code returns 0

- [ ] **Step 3: Fix `normalizeHeatingEfficiency` in `thermal-controller.ts` (lines 424-432)**

Replace the existing method:

```typescript
private normalizeHeatingEfficiency(cop?: number): number {
    if (typeof cop === 'number' && Number.isFinite(cop) && cop > 0) {
        if (this.copNormalizer) {
            const normalized = this.copNormalizer.normalize(cop);
            // Stale range protection: if copNormalizer returns 0 for a valid COP > 1.0,
            // the learned range is from a different season. Fall back to rough normalization
            // so preheat is not silently blocked.
            if (normalized <= 0 && cop > 1.0) {
                return CopNormalizer.roughNormalize(cop);
            }
            return normalized;
        }
        return CopNormalizer.roughNormalize(cop);
    }
    return 0;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize
npx jest test/unit/thermal-controller.gate.test.ts --testNamePattern="stale range" 2>&1 | tail -15
```
Expected: PASS

- [ ] **Step 5: Run full unit suite to confirm no regressions**

```bash
cd /Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize
npm run test:unit 2>&1 | tail -20
```
Expected: all tests pass (or same failures as before this task)

- [ ] **Step 6: Commit**

```bash
cd /Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize
git add src/services/thermal-controller.ts test/unit/thermal-controller.gate.test.ts
git commit -m "fix: normalizeHeatingEfficiency falls back to roughNormalize on stale COP range"
```

---

## Task 3: Create HousePriceContextResolver

**Files:**
- Create: `src/services/house-price-context.ts`
- Create: `test/unit/house-price-context.test.ts`

- [ ] **Step 1: Write failing tests in `test/unit/house-price-context.test.ts`**

```typescript
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
    coolingRate: 0.05,       // °C/hour per °C of temp diff
    currentTemp: 21.5,
    outdoorTemp: 9.0,
    normalizedCOP: 0.6,      // above goodCOPThreshold
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
    // currentPrice 0.1148, historicalAvg = 0.22 → ratio = 0.522 < 0.55
    const ctx = resolver.resolve(makeParams({ historicalAvgPrice: 0.22 }));
    expect(ctx.absoluteLevel).toBe('VERY_CHEAP');
    expect(ctx.priceSource).toBe('entsoe_historical');
  });

  it('derives CHEAP from historical ratio 0.55–0.70', () => {
    // currentPrice 0.1148, historicalAvg = 0.19 → ratio = 0.604
    const ctx = resolver.resolve(makeParams({ historicalAvgPrice: 0.19 }));
    expect(ctx.absoluteLevel).toBe('CHEAP');
    expect(ctx.priceSource).toBe('entsoe_historical');
  });

  it('derives NORMAL from historical ratio 0.70–1.30', () => {
    // currentPrice 0.1148, historicalAvg = 0.13 → ratio = 0.883
    const ctx = resolver.resolve(makeParams({ historicalAvgPrice: 0.13 }));
    expect(ctx.absoluteLevel).toBe('NORMAL');
  });

  it('derives EXPENSIVE from historical ratio 1.30–1.45', () => {
    // currentPrice 0.18, historicalAvg = 0.13 → ratio = 1.384
    const ctx = resolver.resolve(makeParams({ currentPrice: 0.18, historicalAvgPrice: 0.13 }));
    expect(ctx.absoluteLevel).toBe('EXPENSIVE');
  });

  it('derives VERY_EXPENSIVE from historical ratio > 1.45', () => {
    // currentPrice 0.21, historicalAvg = 0.13 → ratio = 1.615
    const ctx = resolver.resolve(makeParams({ currentPrice: 0.21, historicalAvgPrice: 0.13 }));
    expect(ctx.absoluteLevel).toBe('VERY_EXPENSIVE');
  });

  it('falls back to local percentile when no provider level and no history', () => {
    const prices = Array.from({ length: 24 }, (_, i) => ({
      time: new Date(Date.now() + i * 3600_000).toISOString(),
      price: i < 3 ? 0.05 : 0.20,  // current 0.05 is in bottom 12.5%
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

  it('CHEAP is cheap for this house when spread exceeds half breakeven', () => {
    // future prices 0.18, current 0.1148 → spread = (0.18 - 0.1148)/0.1148 ≈ 0.568 (56.8%)
    // With cooling 0.05, diff=12.5, heatLoss=0.625/h × 6h = 3.75°C → savedFraction = 1.0
    // houseBreakevenSpread = 1/1.0 - 1 = 0 → any spread qualifies
    const ctx = resolver.resolve(makeParams({
      tibberPriceLevel: 'CHEAP',
      futurePrices: Array.from({ length: 6 }, (_, i) => ({
        time: new Date(Date.now() + (i + 1) * 3600_000).toISOString(),
        price: 0.18,
      })),
    }));
    expect(ctx.isCheapForThisHouse).toBe(true);
  });

  it('NORMAL requires high spread AND excellent COP', () => {
    // normalizedCOP = 0.9 (excellent), large spread
    const ctxGood = resolver.resolve(makeParams({
      tibberPriceLevel: 'NORMAL',
      normalizedCOP: 0.9,
      futurePrices: Array.from({ length: 6 }, (_, i) => ({
        time: new Date(Date.now() + (i + 1) * 3600_000).toISOString(),
        price: 0.30,  // very expensive future
      })),
      coolingRate: 0.10,  // leaky house → high heatLoss → low breakeven
    }));
    // With leaky house, savedFraction ≈ 1.0 → breakevenSpread ≈ 0
    // houseBreakevenSpread * 1.5 ≈ 0 → spread (1.61) qualifies → AND cop 0.9 >= 0.8 ✓
    expect(ctxGood.isCheapForThisHouse).toBe(true);

    const ctxBadCOP = resolver.resolve(makeParams({
      tibberPriceLevel: 'NORMAL',
      normalizedCOP: 0.6,  // below 0.8 excellent threshold
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
  it('well-insulated house has low breakeven (large spread needed)', () => {
    // Low coolingRate → saves little heat → needs big price advantage
    const ctx = resolver.resolve(makeParams({
      tibberPriceLevel: 'CHEAP',
      coolingRate: 0.005,  // very well insulated
      currentTemp: 21.5,
      outdoorTemp: 9.0,    // diff = 12.5
      // heatLoss/h = 0.005 * 12.5 = 0.0625°C/h × 6h = 0.375°C → savedFraction = 0.375/1.5 = 0.25
      // breakeven = 1/0.25 - 1 = 3.0 (need 300% price advantage) → high
    }));
    expect(ctx.houseBreakevenSpread).toBeGreaterThan(2.0);
  });

  it('poorly-insulated house has near-zero breakeven (any spread profitable)', () => {
    // High coolingRate → saves all heat → any price advantage works
    const ctx = resolver.resolve(makeParams({
      tibberPriceLevel: 'CHEAP',
      coolingRate: 0.20,   // leaky house
      currentTemp: 21.5,
      outdoorTemp: 9.0,    // diff = 12.5
      // heatLoss/h = 0.20 * 12.5 = 2.5°C/h × 6h = 15°C → savedDegrees = min(1.5, 15) = 1.5
      // savedFraction = 1.0 → breakeven = 0
    }));
    expect(ctx.houseBreakevenSpread).toBeLessThan(0.01);
  });
});
```

- [ ] **Step 2: Run to verify tests fail (module not found)**

```bash
cd /Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize
npx jest test/unit/house-price-context.test.ts 2>&1 | tail -10
```
Expected: FAIL with "Cannot find module '../../src/services/house-price-context'"

- [ ] **Step 3: Create `src/services/house-price-context.ts`**

```typescript
import { AbsolutePriceLevel, HousePriceContext, PricePoint } from '../types';

const ENTSO_E_VERY_CHEAP_RATIO = 0.55;
const ENTSO_E_CHEAP_RATIO = 0.70;
const ENTSO_E_EXPENSIVE_RATIO = 1.30;
const ENTSO_E_VERY_EXPENSIVE_RATIO = 1.45;

const TYPICAL_PREHEAT_DELTA_C = 1.5;
const BREAKEVEN_WINDOW_HOURS = 6;
const EXCELLENT_COP_NORMALIZED = 0.8;

export interface HousePriceContextParams {
  tibberPriceLevel: string | undefined;
  historicalAvgPrice: number | undefined;
  currentPrice: number;
  futurePrices: PricePoint[];
  coolingRate: number;          // °C per hour per °C of (indoor - outdoor) temp diff
  currentTemp: number;
  outdoorTemp: number;
  normalizedCOP: number;        // 0-1 normalized COP from CopNormalizer/roughNormalize
}

export class HousePriceContextResolver {
  resolve(params: HousePriceContextParams): HousePriceContext {
    const absoluteLevel = this.resolveAbsoluteLevel(params);
    const { houseBreakevenSpread, economicSpread } = this.computeEconomics(params);
    const isCheapForThisHouse = this.computeIsCheap(
      absoluteLevel, economicSpread, houseBreakevenSpread, params.normalizedCOP
    );
    return {
      absoluteLevel,
      isCheapForThisHouse,
      houseBreakevenSpread,
      economicSpread,
      priceSource: this.determinePriceSource(params),
    };
  }

  private resolveAbsoluteLevel(params: HousePriceContextParams): AbsolutePriceLevel {
    if (params.tibberPriceLevel) {
      return normalizeProviderLevel(params.tibberPriceLevel);
    }
    if (params.historicalAvgPrice && params.historicalAvgPrice > 0) {
      return deriveFromHistoricalRatio(params.currentPrice, params.historicalAvgPrice);
    }
    return deriveFromLocalPercentile(params.currentPrice, params.futurePrices);
  }

  private computeEconomics(params: HousePriceContextParams): {
    houseBreakevenSpread: number;
    economicSpread: number;
  } {
    const tempDiff = Math.max(params.currentTemp - params.outdoorTemp, 0);
    const heatLossPerHour = params.coolingRate * tempDiff;
    const lostDegrees = heatLossPerHour * BREAKEVEN_WINDOW_HOURS;
    const savedDegrees = Math.min(TYPICAL_PREHEAT_DELTA_C, lostDegrees);
    const savedFraction = savedDegrees / TYPICAL_PREHEAT_DELTA_C;
    const houseBreakevenSpread = savedFraction > 0.05
      ? Math.max(0, (1 / savedFraction) - 1)
      : 1.0;

    const nowMs = Date.now();
    const next6h = params.futurePrices
      .filter(p => {
        const ts = Date.parse(p.time);
        return Number.isFinite(ts) && ts > nowMs;
      })
      .slice(0, 6);
    const avgFuturePrice = next6h.length > 0
      ? next6h.reduce((sum, p) => sum + p.price, 0) / next6h.length
      : params.currentPrice;
    const economicSpread = params.currentPrice > 0
      ? (avgFuturePrice - params.currentPrice) / params.currentPrice
      : 0;

    return { houseBreakevenSpread, economicSpread };
  }

  private computeIsCheap(
    absoluteLevel: AbsolutePriceLevel,
    economicSpread: number,
    houseBreakevenSpread: number,
    normalizedCOP: number
  ): boolean {
    if (absoluteLevel === 'VERY_CHEAP') return true;
    if (absoluteLevel === 'CHEAP') return economicSpread >= houseBreakevenSpread * 0.5;
    if (absoluteLevel === 'NORMAL') {
      return economicSpread >= houseBreakevenSpread * 1.5
        && normalizedCOP >= EXCELLENT_COP_NORMALIZED;
    }
    return false;
  }

  private determinePriceSource(
    params: HousePriceContextParams
  ): HousePriceContext['priceSource'] {
    if (params.tibberPriceLevel) return 'tibber_native';
    if (params.historicalAvgPrice && params.historicalAvgPrice > 0) return 'entsoe_historical';
    return 'local_percentile';
  }
}

function normalizeProviderLevel(level: string): AbsolutePriceLevel {
  const map: Record<string, AbsolutePriceLevel> = {
    VERY_CHEAP: 'VERY_CHEAP',
    VERYCHEAP: 'VERY_CHEAP',
    CHEAP: 'CHEAP',
    NORMAL: 'NORMAL',
    EXPENSIVE: 'EXPENSIVE',
    VERY_EXPENSIVE: 'VERY_EXPENSIVE',
    VERYEXPENSIVE: 'VERY_EXPENSIVE',
  };
  return map[level.toUpperCase()] ?? 'NORMAL';
}

function deriveFromHistoricalRatio(
  currentPrice: number,
  historicalAvg: number
): AbsolutePriceLevel {
  const ratio = currentPrice / historicalAvg;
  if (ratio < ENTSO_E_VERY_CHEAP_RATIO) return 'VERY_CHEAP';
  if (ratio < ENTSO_E_CHEAP_RATIO) return 'CHEAP';
  if (ratio <= ENTSO_E_EXPENSIVE_RATIO) return 'NORMAL';
  if (ratio <= ENTSO_E_VERY_EXPENSIVE_RATIO) return 'EXPENSIVE';
  return 'VERY_EXPENSIVE';
}

function deriveFromLocalPercentile(
  currentPrice: number,
  prices: PricePoint[]
): AbsolutePriceLevel {
  if (prices.length === 0) return 'NORMAL';
  const percentile = prices.filter(p => p.price <= currentPrice).length / prices.length;
  if (percentile <= 0.10) return 'VERY_CHEAP';
  if (percentile <= 0.30) return 'CHEAP';
  if (percentile <= 0.70) return 'NORMAL';
  if (percentile <= 0.90) return 'EXPENSIVE';
  return 'VERY_EXPENSIVE';
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize
npx jest test/unit/house-price-context.test.ts 2>&1 | tail -20
```
Expected: all tests PASS

- [ ] **Step 5: Build to confirm no TypeScript errors**

```bash
cd /Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize && npm run build 2>&1 | head -20
```
Expected: no errors

- [ ] **Step 6: Commit**

```bash
cd /Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize
git add src/services/house-price-context.ts test/unit/house-price-context.test.ts
git commit -m "feat: add HousePriceContextResolver — provider-agnostic, house-calibrated price signal"
```

---

## Task 4: Wire HousePriceContext into ThermalController

**Files:**
- Modify: `src/services/thermal-controller.ts`
- Modify: `test/unit/thermal-controller.gate.test.ts`

- [ ] **Step 1: Add import of `HousePriceContextResolver` and `HousePriceContextParams` at top of `thermal-controller.ts`**

After the existing imports, add:
```typescript
import { HousePriceContextResolver, HousePriceContextParams } from './house-price-context';
import { AbsolutePriceLevel } from '../types';
```

Also add a module-level resolver instance just before the class definition:
```typescript
const housePriceContextResolver = new HousePriceContextResolver();
```

- [ ] **Step 2: Add two new parameters to `calculateThermalMassStrategy` signature (after `constraintContext?` at line 141)**

```typescript
public calculateThermalMassStrategy(
    currentTemp: number,
    targetTemp: number,
    currentPrice: number,
    futurePrices: PricePoint[],
    copData: { heating: number; hotWater: number; outdoor: number },
    priceAnalyzer: PriceAnalyzer,
    preheatCheapPercentile: number,
    comfortBand: { minTemp: number; maxTemp: number },
    referenceTimeMs?: number,
    constraintContext?: ConstraintContextForGate,
    tibberPriceLevel?: string,           // ← NEW
    historicalAvgPrice?: number          // ← NEW
): ThermalStrategy {
```

- [ ] **Step 3: Resolve HousePriceContext at the start of the try block, after line 163 (after `heatingEfficiency` is set)**

Insert after `const heatingEfficiency = this.normalizeHeatingEfficiency(copData.heating);`:

```typescript
// Resolve house-calibrated price context
const characteristics = this.thermalModelService?.getThermalCharacteristics?.();
const coolingRate = Math.max(characteristics?.coolingRate ?? 0, 0);
const houseContextParams: HousePriceContextParams = {
    tibberPriceLevel: tibberPriceLevel,
    historicalAvgPrice: historicalAvgPrice,
    currentPrice: currentPrice,
    futurePrices: futurePrices,
    coolingRate: coolingRate,
    currentTemp: currentTemp,
    outdoorTemp: copData.outdoor,
    normalizedCOP: heatingEfficiency,
};
const houseContext = housePriceContextResolver.resolve(houseContextParams);
```

- [ ] **Step 4: Replace `meetsVeryCheapPreheat` and `meetsPreemptivePreheat` computed vars (lines 224-230)**

Replace:
```typescript
const veryCheapThreshold = preheatCheapPercentile * adaptiveThresholds.veryCheapMultiplier;
const meetsVeryCheapPreheat = currentPricePercentile <= veryCheapThreshold &&
    heatingEfficiency > adaptiveThresholds.goodCOPThreshold && tempDelta > 0.5;

const meetsPreemptivePreheat = isCurrentNormal && hasUpcomingExpensive && 
    heatingEfficiency > adaptiveThresholds.minimumCOPThreshold && tempDelta > 0;
```

With:
```typescript
const veryCheapThreshold = preheatCheapPercentile * adaptiveThresholds.veryCheapMultiplier;
const meetsVeryCheapPreheat =
    houseContext.isCheapForThisHouse &&
    heatingEfficiency > adaptiveThresholds.goodCOPThreshold &&
    tempDelta > PREHEAT_TEMP_DELTA_THRESHOLD;

const meetsPreemptivePreheat =
    houseContext.absoluteLevel !== 'EXPENSIVE' &&
    houseContext.absoluteLevel !== 'VERY_EXPENSIVE' &&
    hasUpcomingExpensive &&
    heatingEfficiency > adaptiveThresholds.minimumCOPThreshold &&
    tempDelta > 0;
```

- [ ] **Step 5: Add `houseContext` fields to the debug log object (lines 205-220)**

Inside the `this.logger.log('Thermal strategy decision inputs:', {...})` call, add:
```typescript
tibberPriceLevel: tibberPriceLevel ?? 'none',
absoluteLevel: houseContext.absoluteLevel,
isCheapForThisHouse: houseContext.isCheapForThisHouse,
houseBreakevenSpread: houseContext.houseBreakevenSpread.toFixed(2),
economicSpread: houseContext.economicSpread.toFixed(2),
priceSource: houseContext.priceSource,
```

- [ ] **Step 6: Replace the if/else-if branch conditions (lines 249 and 299) with the computed variables**

Replace line 249:
```typescript
if (currentPricePercentile <= (preheatCheapPercentile * adaptiveThresholds.veryCheapMultiplier) &&
    heatingEfficiency > adaptiveThresholds.goodCOPThreshold && tempDelta > PREHEAT_TEMP_DELTA_THRESHOLD) {
```
With:
```typescript
if (meetsVeryCheapPreheat) {
```

Replace line 299:
```typescript
} else if (isCurrentNormal && hasUpcomingExpensive && 
           heatingEfficiency > adaptiveThresholds.minimumCOPThreshold && tempDelta > 0) {
```
With:
```typescript
} else if (meetsPreemptivePreheat) {
```

- [ ] **Step 7: Update reasoning strings to show which signal triggered**

At line 293 (very cheap preheat return), change reasoning to:
```typescript
reasoning: `Preheat (${houseContext.priceSource}:${houseContext.absoluteLevel}, spread ${(houseContext.economicSpread * 100).toFixed(0)}%)`,
```

At line 357 (preemptive preheat return), change reasoning to:
```typescript
reasoning: `Preemptive preheat (${houseContext.absoluteLevel}→expensive ×${preheatMultiplier.toFixed(1)})`,
```

- [ ] **Step 8: Add `houseContext` to all four strategy return objects**

Each `return { action: '...', ... }` in the function needs `houseContext` added. There are 5 return paths inside the main try block (preheat, preemptive preheat, coast, boost, maintain). Add to each:

```typescript
houseContext,
```

Also add to the catch block's return (line ~415):
```typescript
return {
    action: 'maintain',
    targetTemp: targetTemp,
    reasoning: 'Error in calculation',
    estimatedSavings: 0,
    confidenceLevel: 0.3,
    // houseContext omitted — it may not have been created if error happened early
};
```

- [ ] **Step 9: Write new tests in `test/unit/thermal-controller.gate.test.ts`**

Add this describe block to the file:

```typescript
describe('calculateThermalMassStrategy — HousePriceContext integration', () => {
  function makeExpensiveFuturePrices(count = 6, expensivePrice = 0.25): Array<{time: string; price: number}> {
    return Array.from({ length: count }, (_, i) => ({
      time: new Date(Date.now() + (i + 1) * 3600_000).toISOString(),
      price: expensivePrice,
    }));
  }

  function makeNormalFuturePrices(count = 24): Array<{time: string; price: number}> {
    return Array.from({ length: count }, (_, i) => ({
      time: new Date(Date.now() + (i + 1) * 3600_000).toISOString(),
      price: 0.12,
    }));
  }

  it('triggers preheat when Tibber says VERY_CHEAP even if local percentile is NORMAL', () => {
    const controller = makeThermalController({ coolingRate: 0.05 });
    const result = controller.calculateThermalMassStrategy(
      21.5,  // currentTemp — below max comfort (23), so tempDelta > 0
      20,    // targetTemp
      0.1148, // currentPrice — 53rd percentile locally (NORMAL by percentile)
      makeExpensiveFuturePrices(24, 0.14),  // future slightly more expensive
      { heating: 2.97, hotWater: 2.6, outdoor: 9 },
      makeMockPriceAnalyzer(),
      0.3,   // cheapPercentile
      { minTemp: 20, maxTemp: 23 },
      undefined,
      undefined,
      'VERY_CHEAP',      // tibberPriceLevel ← key input
      undefined
    );
    expect(result.action).toBe('preheat');
    expect(result.houseContext?.absoluteLevel).toBe('VERY_CHEAP');
    expect(result.houseContext?.isCheapForThisHouse).toBe(true);
    expect(result.houseContext?.priceSource).toBe('tibber_native');
  });

  it('triggers preheat via ENTSO-E historical ratio (price at 0.52× avg)', () => {
    const controller = makeThermalController({ coolingRate: 0.08 });
    const result = controller.calculateThermalMassStrategy(
      21.5, 20, 0.1148,
      makeExpensiveFuturePrices(24, 0.14),
      { heating: 2.97, hotWater: 2.6, outdoor: 9 },
      makeMockPriceAnalyzer(),
      0.3,
      { minTemp: 20, maxTemp: 23 },
      undefined, undefined,
      undefined,       // no Tibber level
      0.22             // historicalAvgPrice: 0.1148/0.22 = 0.522 < 0.55 → VERY_CHEAP
    );
    expect(result.action).toBe('preheat');
    expect(result.houseContext?.absoluteLevel).toBe('VERY_CHEAP');
    expect(result.houseContext?.priceSource).toBe('entsoe_historical');
  });

  it('does NOT preheat when Tibber says EXPENSIVE', () => {
    const controller = makeThermalController({ coolingRate: 0.05 });
    // Make future prices cheaper to set up hasUpcomingExpensive = false
    const result = controller.calculateThermalMassStrategy(
      21.5, 20, 0.25,
      makeNormalFuturePrices(24),  // future cheaper than current
      { heating: 2.97, hotWater: 2.6, outdoor: 9 },
      makeMockPriceAnalyzer(),
      0.3,
      { minTemp: 20, maxTemp: 23 },
      undefined, undefined,
      'EXPENSIVE',
      undefined
    );
    expect(result.action).not.toBe('preheat');
    expect(result.houseContext?.isCheapForThisHouse).toBe(false);
  });
});
```

- [ ] **Step 10: Run tests**

```bash
cd /Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize
npx jest test/unit/thermal-controller.gate.test.ts 2>&1 | tail -25
```
Expected: all new tests PASS (existing tests still pass)

- [ ] **Step 11: Build to confirm no TypeScript errors**

```bash
cd /Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize && npm run build 2>&1 | head -20
```
Expected: no errors

- [ ] **Step 12: Commit**

```bash
cd /Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize
git add src/services/thermal-controller.ts test/unit/thermal-controller.gate.test.ts
git commit -m "feat: wire HousePriceContext into calculateThermalMassStrategy preheat trigger"
```

---

## Task 5: Wire into Optimizer — Pass historicalAvgPrice, Use houseContext for Tank + Planning

**Files:**
- Modify: `src/services/optimizer.ts`

- [ ] **Step 1: Get historicalAvgPrice and pass it to calculateThermalMassStrategy (lines 1480-1506)**

Before the `calculateThermalMassStrategy` call (around line 1481), add:
```typescript
const historicalAvgPrice = this.priceAnalyzer.getHistoricalAvgPrice();
```

Then add `priceData.priceLevel` and `historicalAvgPrice` as the two new last arguments:
```typescript
thermalStrategy = this.thermalController.calculateThermalMassStrategy(
    currentTemp || 20,
    targetTemp,
    priceStats.currentPrice,
    priceData.prices,
    {
        heating: optimizationResult.metrics.realHeatingCOP,
        hotWater: optimizationResult.metrics.realHotWaterCOP,
        outdoor: outdoorTemp
    },
    this.priceAnalyzer,
    this.priceAnalyzer.getCheapPercentile(),
    constraintsBand,
    planningReferenceTimeMs,
    {
        currentTargetC: safeCurrentTarget,
        minC: constraintsBand.minTemp,
        maxC: constraintsBand.maxTemp,
        stepC: this.getZone1Constraints().tempStep,
        deadbandC: this.getZone1Constraints().deadband,
        minChangeMinutes: this.minSetpointChangeMinutes,
        lastChangeMs: this.getZone1State().timestamp ?? undefined,
        maxDeltaPerChangeC: this.getZone1Constraints().tempStep
    },
    priceData.priceLevel,       // ← NEW: Tibber native level or undefined
    historicalAvgPrice          // ← NEW: ENTSO-E fallback
);
```

- [ ] **Step 2: Use `houseContext.absoluteLevel` for tank temperature (line 1889)**

Find:
```typescript
tankTarget = hotWaterService.getOptimalTankTemperature(
  this.getTankConstraints().minTemp,
  this.getTankConstraints().maxTemp,
  inputs.priceStats.currentPrice,
  inputs.priceStats.priceLevel
);
```

Replace with:
```typescript
const tankPriceLevel = thermalStrategy?.houseContext?.absoluteLevel ?? inputs.priceStats.priceLevel;
tankTarget = hotWaterService.getOptimalTankTemperature(
  this.getTankConstraints().minTemp,
  this.getTankConstraints().maxTemp,
  inputs.priceStats.currentPrice,
  tankPriceLevel
);
```

- [ ] **Step 3: Use `houseContext.absoluteLevel` for planning bias (line 1374)**

Find the `computePlanningBias` call and add `absolutePriceLevel`:
```typescript
const planningBiasResult = computePlanningBias(planningPrices, planningReferenceTime, {
  windowHours: baseWindowHours,
  lookaheadHours: baseLookaheadHours,
  cheapPercentile,
  expensivePercentile: priceThresholds.expensive,
  cheapBiasC: 0.5,
  expensiveBiasC: 0.3,
  maxAbsBiasC: 0.7,
  logger,
  absolutePriceLevel: thermalStrategy?.houseContext?.absoluteLevel,  // ← NEW
});
```

Note: `thermalStrategy` might be undefined at line 1374 if it hasn't been computed yet. Check the ordering in the function. If `computePlanningBias` is called BEFORE `calculateThermalMassStrategy`, you may need to compute a lightweight context first OR reorder the calls. If needed, use `priceData.priceLevel` as a simpler fallback: 
```typescript
absolutePriceLevel: (thermalStrategy?.houseContext?.absoluteLevel 
    ?? (priceData.priceLevel ? normalizeProviderLevel(priceData.priceLevel) : undefined)),
```
Import `normalizeProviderLevel` or replicate its logic inline as a simple map lookup.

- [ ] **Step 4: Build to confirm no TypeScript errors**

```bash
cd /Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize && npm run build 2>&1 | head -30
```
Expected: no errors

- [ ] **Step 5: Run full unit suite**

```bash
cd /Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize
npm run test:unit 2>&1 | tail -20
```
Expected: all tests pass (or same pre-existing failures)

- [ ] **Step 6: Commit**

```bash
cd /Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize
git add src/services/optimizer.ts
git commit -m "feat: pass historicalAvgPrice to strategy, use houseContext for tank and planning bias"
```

---

## Task 6: Update planning-utils to honour absolutePriceLevel

**Files:**
- Modify: `src/services/planning-utils.ts`

- [ ] **Step 1: Add `absolutePriceLevel` to `PlanningBiasOptions`**

Find the `PlanningBiasOptions` interface in `planning-utils.ts` and add:
```typescript
/** Provider-agnostic absolute price level from HousePriceContext.
 * When set, overrides local-window bias to ensure VERY_CHEAP days get
 * full positive bias and VERY_EXPENSIVE days get full negative bias. */
absolutePriceLevel?: 'VERY_CHEAP' | 'CHEAP' | 'NORMAL' | 'EXPENSIVE' | 'VERY_EXPENSIVE';
```

- [ ] **Step 2: Apply absolute override after the existing bias clamp in `computePlanningBias`**

Find the line that applies the final clamp (`bias = clamp(bias, -maxAbsBias, maxAbsBias)` or similar) and add immediately after it:

```typescript
// Absolute level override: ensure provider/house signal always anchors the bias
// direction, even if local window prices look flat.
if (options.absolutePriceLevel === 'VERY_CHEAP' && bias < cheapBias) {
    bias = cheapBias;
}
if (options.absolutePriceLevel === 'VERY_EXPENSIVE' && bias > -expensiveBias) {
    bias = -expensiveBias;
}
```

- [ ] **Step 3: Build to confirm no TypeScript errors**

```bash
cd /Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize && npm run build 2>&1 | head -20
```
Expected: no errors

- [ ] **Step 4: Run full unit suite**

```bash
cd /Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize
npm run test:unit 2>&1 | tail -20
```
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
cd /Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize
git add src/services/planning-utils.ts
git commit -m "feat: planning bias respects absolutePriceLevel from HousePriceContext"
```

---

## Task 7: Save spec and verify end-to-end

- [ ] **Step 1: Run complete build + test suite**

```bash
cd /Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize
npm run build && npm run test:unit 2>&1 | tail -30
```
Expected: build succeeds, all tests pass

- [ ] **Step 2: Manually trigger optimization and verify logs contain HousePriceContext fields**

After deploying, trigger the hourly optimizer and check the Homey logs for:
- `absoluteLevel:` field in "Thermal strategy decision inputs" log
- `isCheapForThisHouse:` field
- `priceSource: 'tibber_native'` (for Tibber users) or `'entsoe_historical'` (for ENTSO-E)
- When Tibber says VERY_CHEAP: `action: 'preheat'` in strategy result
- `heatingEfficiency` > 0 in logs (COP bug fixed)

- [ ] **Step 3: Final commit with version bump if needed**

```bash
cd /Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize
git log --oneline -8
```

---

## Self-Review Checklist

- [x] **Spec coverage:** All four spec sections covered: provider resolution (Task 3), house economics (Task 3), zone 1 trigger (Task 4), hot water + planning (Tasks 5-6)
- [x] **COP bug fix:** Task 2 covers `normalizeHeatingEfficiency` with test-first
- [x] **No placeholders:** All code blocks are complete
- [x] **Type consistency:** `AbsolutePriceLevel` defined in types/index.ts (Task 1), used in house-price-context.ts (Task 3) and planning-utils (Task 6) — same type name throughout
- [x] **`houseContext` field:** Added to `ThermalStrategy` in Task 1, populated in Task 4, consumed in Task 5
- [x] **`historicalAvgPrice`:** `PriceAnalyzer.getHistoricalAvgPrice()` already exists at line 97 — no new method needed
- [x] **Hot water:** `getOptimalTankTemperature` already accepts a string level and has 5-level logic — only the call site changes (Task 5)
- [x] **ENTSO-E users:** Get proper 5-level absoluteLevel via historicalAvgPrice path in HousePriceContextResolver
- [x] **Tibber users:** Get native priceLevel wired to preheat trigger for first time
