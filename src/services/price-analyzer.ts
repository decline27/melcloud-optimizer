import { HomeyLogger } from '../util/logger';
import { PricePoint, PriceProvider, TibberPriceInfo } from '../types';
import { classifyPriceUnified, PriceClassificationStats, PriceLevel, resolvePriceThresholds } from './price-classifier';
import { AdaptiveParametersLearner } from './adaptive-parameters';

/** Daily price summary for historical context */
interface DailyPriceSummary {
  date: string;
  min: number;
  max: number;
  avg: number;
}

/** Settings accessor interface for historical price storage */
interface SettingsAccessor {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

const HISTORICAL_PRICES_KEY = 'historical_price_summaries';
const MAX_HISTORICAL_DAYS = 14;

export class PriceAnalyzer {
  private priceProvider: PriceProvider | null = null;
  private preheatCheapPercentile: number = 0.25;
  private adaptiveLearner?: AdaptiveParametersLearner;
  private settings?: SettingsAccessor;
  private historicalPrices: DailyPriceSummary[] = [];

  constructor(
    private readonly logger: HomeyLogger,
    adaptiveLearner?: AdaptiveParametersLearner,
    settings?: SettingsAccessor
  ) {
    this.adaptiveLearner = adaptiveLearner;
    this.settings = settings;
    this.loadHistoricalPrices();
  }

  /** Load historical price summaries from settings */
  private loadHistoricalPrices(): void {
    if (!this.settings) return;
    try {
      const stored = this.settings.get(HISTORICAL_PRICES_KEY);
      if (Array.isArray(stored)) {
        this.historicalPrices = stored as DailyPriceSummary[];
        this.logger.debug?.(`Loaded ${this.historicalPrices.length} historical price summaries`);
      }
    } catch (e) {
      this.logger.warn?.(`Failed to load historical prices: ${e}`);
    }
  }

  /** Save historical price summaries to settings */
  private saveHistoricalPrices(): void {
    if (!this.settings) return;
    try {
      this.settings.set(HISTORICAL_PRICES_KEY, this.historicalPrices);
    } catch (e) {
      this.logger.warn?.(`Failed to save historical prices: ${e}`);
    }
  }

  /** Record today's price summary for historical context */
  public recordDailyPriceSummary(prices: PricePoint[]): void {
    if (!prices || prices.length === 0) return;

    const today = new Date().toISOString().split('T')[0];
    
    // Check if we already have today's summary
    const existingIndex = this.historicalPrices.findIndex(s => s.date === today);
    
    const numericPrices = prices.map(p => p.price).filter(p => Number.isFinite(p));
    if (numericPrices.length === 0) return;

    const summary: DailyPriceSummary = {
      date: today,
      min: Math.min(...numericPrices),
      max: Math.max(...numericPrices),
      avg: numericPrices.reduce((a, b) => a + b, 0) / numericPrices.length
    };

    if (existingIndex >= 0) {
      this.historicalPrices[existingIndex] = summary;
    } else {
      this.historicalPrices.push(summary);
    }

    // Keep only last N days
    this.historicalPrices = this.historicalPrices
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, MAX_HISTORICAL_DAYS);

    this.saveHistoricalPrices();
  }

  /** Get historical average price (excluding today) */
  public getHistoricalAvgPrice(): number | undefined {
    const today = new Date().toISOString().split('T')[0];
    const historical = this.historicalPrices.filter(s => s.date !== today);
    
    if (historical.length < 3) {
      // Need at least 3 days of history for meaningful context
      return undefined;
    }

    const totalAvg = historical.reduce((sum, s) => sum + s.avg, 0) / historical.length;
    return totalAvg;
  }

  public setPriceProvider(provider: PriceProvider | null): void {
    this.priceProvider = provider;
    this.logger.log(`Price provider updated: ${provider ? provider.constructor.name : 'none'}`);
  }

  public setThresholds(preheatCheapPercentile: number): void {
    if (preheatCheapPercentile >= 0.05 && preheatCheapPercentile <= 0.5) {
      this.preheatCheapPercentile = preheatCheapPercentile;
      this.logger.log(`Price thresholds updated - Cheap Percentile: ${this.preheatCheapPercentile}`);
    }
  }

  public getCheapPercentile(): number {
    return this.preheatCheapPercentile;
  }

  public hasPriceProvider(): boolean {
    return this.priceProvider !== null;
  }

  public async getCurrentPrice(): Promise<number | null> {
    if (!this.priceProvider) return null;
    const prices = await this.priceProvider.getPrices();
    return prices.current?.price ?? null;
  }

  public async getPriceData(): Promise<TibberPriceInfo> {
    if (!this.priceProvider) {
      return { current: { price: 0, time: new Date().toISOString() }, prices: [] };
    }
    return this.priceProvider.getPrices();
  }

  public analyzePrice(currentPrice: number, futurePrices: PricePoint[] | Pick<TibberPriceInfo, 'prices' | 'priceLevel'>): PriceClassificationStats {
    const priceList = Array.isArray(futurePrices) ? futurePrices : futurePrices.prices;
    const providerPriceLevel = !Array.isArray(futurePrices) ? futurePrices.priceLevel : undefined;

    // Record daily summary for historical context (used by ENTSO-E when no provider level)
    this.recordDailyPriceSummary(priceList);

    const adaptiveThresholds = this.adaptiveLearner?.getStrategyThresholds();
    const historicalAvgPrice = this.getHistoricalAvgPrice();

    const result = classifyPriceUnified(priceList, currentPrice, {
      cheapPercentile: this.preheatCheapPercentile,
      veryCheapMultiplier: adaptiveThresholds?.veryChepMultiplier,
      providerPriceLevel,
      historicalAvgPrice
    });

    // Log when floor is applied for transparency
    if (result.floorApplied) {
      this.logger.log(`Price floor applied: ${result.floorReason}`);
    }

    return result;
  }



  public getPriceLevel(percentile: number): PriceLevel {
    const adaptiveThresholds = this.adaptiveLearner?.getStrategyThresholds();
    const thresholds = resolvePriceThresholds({
      cheapPercentile: this.preheatCheapPercentile,
      veryCheapMultiplier: adaptiveThresholds?.veryChepMultiplier
    });

    if (percentile <= thresholds.veryCheap) return 'VERY_CHEAP';
    if (percentile <= thresholds.cheap) return 'CHEAP';
    if (percentile <= thresholds.expensive) return 'NORMAL';
    if (percentile <= thresholds.veryExpensive) return 'EXPENSIVE';
    return 'VERY_EXPENSIVE';
  }

  public isCheap(percentile: number): boolean {
    const adaptiveThresholds = this.adaptiveLearner?.getStrategyThresholds();
    const thresholds = resolvePriceThresholds({
      cheapPercentile: this.preheatCheapPercentile,
      veryCheapMultiplier: adaptiveThresholds?.veryChepMultiplier
    });
    return percentile <= thresholds.cheap;
  }

  public isExpensive(percentile: number): boolean {
    const adaptiveThresholds = this.adaptiveLearner?.getStrategyThresholds();
    const thresholds = resolvePriceThresholds({
      cheapPercentile: this.preheatCheapPercentile,
      veryCheapMultiplier: adaptiveThresholds?.veryChepMultiplier
    });
    return percentile >= thresholds.expensive;
  }
}
