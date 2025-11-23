import { HomeyLogger } from '../util/logger';
import { PriceProvider, TibberPriceInfo } from '../types';
import { classifyPriceUnified, PriceClassificationStats, PriceLevel, resolvePriceThresholds } from './price-classifier';
import { AdaptiveParametersLearner } from './adaptive-parameters';

export class PriceAnalyzer {
    private priceProvider: PriceProvider | null = null;
    private preheatCheapPercentile: number = 0.25;
    private adaptiveLearner?: AdaptiveParametersLearner;

    constructor(
        private readonly logger: HomeyLogger,
        adaptiveLearner?: AdaptiveParametersLearner
    ) {
        this.adaptiveLearner = adaptiveLearner;
    }

    public setPriceProvider(provider: PriceProvider | null): void {
        this.priceProvider = provider;
        this.logger.info(`Price provider updated: ${provider ? provider.constructor.name : 'none'}`);
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

    public analyzePrice(currentPrice: number, futurePrices: any[]): PriceClassificationStats {
        const adaptiveThresholds = this.adaptiveLearner?.getStrategyThresholds();

        return classifyPriceUnified(futurePrices, currentPrice, {
            cheapPercentile: this.preheatCheapPercentile,
            veryCheapMultiplier: adaptiveThresholds?.veryChepMultiplier
        });
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
