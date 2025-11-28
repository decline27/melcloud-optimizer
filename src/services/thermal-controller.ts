import { HomeyLogger } from '../util/logger';
import { ThermalModelService } from './thermal-model';
import { AdaptiveParametersLearner } from './adaptive-parameters';
import { CopNormalizer } from './cop-normalizer';
import {
    ThermalModel,
    ThermalMassModel,
    ThermalStrategy,
    OptimizationMetrics,
    PricePoint
} from '../types';
import { PriceAnalyzer } from './price-analyzer';

export class ThermalController {
    private thermalModel: ThermalModel = { K: 0.5 };
    private thermalMassModel: ThermalMassModel = {
        thermalCapacity: 2.5,
        heatLossRate: 0.8,
        maxPreheatingTemp: 23,
        preheatingEfficiency: 0.85,
        lastCalibration: new Date()
    };
    private thermalStrategyHistory: ThermalStrategy[] = [];

    constructor(
        private readonly logger: HomeyLogger,
        private readonly thermalModelService?: ThermalModelService,
        private readonly adaptiveLearner?: AdaptiveParametersLearner
    ) { }

    public setThermalModel(K: number, S?: number): void {
        this.thermalModel = { K, S };
        this.logger.log(`Thermal model updated - K: ${K}${S !== undefined ? `, S: ${S}` : ''}`);
    }

    public getThermalModel(): ThermalModel {
        return { ...this.thermalModel };
    }

    public setThermalMassModel(model: Partial<ThermalMassModel>): void {
        this.thermalMassModel = { ...this.thermalMassModel, ...model };
        this.logger.log('Thermal mass model updated');
    }

    public getThermalMassModel(): ThermalMassModel {
        return { ...this.thermalMassModel };
    }

    public calculateThermalMassStrategy(
        currentTemp: number,
        targetTemp: number,
        currentPrice: number,
        futurePrices: any[],
        copData: { heating: number; hotWater: number; outdoor: number },
        priceAnalyzer: PriceAnalyzer,
        preheatCheapPercentile: number,
        referenceTimeMs?: number
    ): ThermalStrategy {
        try {
            // Find cheapest periods in next 24 hours
            const nowMs = typeof referenceTimeMs === 'number' && Number.isFinite(referenceTimeMs)
                ? referenceTimeMs
                : Date.now();
            const upcomingPrices = futurePrices.filter(pricePoint => {
                const ts = Date.parse(pricePoint.time);
                if (!Number.isFinite(ts)) {
                    return true;
                }
                return ts >= nowMs;
            });
            const next24hSource = upcomingPrices.length > 0 ? upcomingPrices : futurePrices;
            const next24h = next24hSource.slice(0, 24);
            const sortedPrices = [...next24h].sort((a, b) => a.price - b.price);
            const cheapest6Hours = sortedPrices.slice(0, 6); // Top 6 cheapest hours

            // Calculate current price percentile
            const currentPricePercentile = next24h.filter(p => p.price <= currentPrice).length / next24h.length;

            // Get normalized COP efficiency (simplified here, ideally use COPHelper or similar)
            // Assuming copData.heating is raw COP. We need normalization logic.
            // Use CopNormalizer.roughNormalize for consistent COP normalization
            // When a full CopNormalizer instance is available (e.g., from Optimizer),
            // the normalized value should be passed directly
            const heatingEfficiency = CopNormalizer.roughNormalize(copData.heating);

            // Calculate thermal mass capacity for preheating
            const tempDelta = this.thermalMassModel.maxPreheatingTemp - currentTemp;

            // Get adaptive strategy thresholds
            const adaptiveThresholds = this.adaptiveLearner?.getStrategyThresholds() || {
                excellentCOPThreshold: 0.8,
                goodCOPThreshold: 0.5,
                minimumCOPThreshold: 0.2,
                veryChepMultiplier: 0.8,
                preheatAggressiveness: 2.0,
                coastingReduction: 1.5,
                boostIncrease: 0.5
            };

            // Strategy decision logic
            if (currentPricePercentile <= (preheatCheapPercentile * adaptiveThresholds.veryChepMultiplier) &&
                heatingEfficiency > adaptiveThresholds.goodCOPThreshold && tempDelta > 0.5) {

                const preheatingTarget = Math.min(
                    targetTemp + (heatingEfficiency * adaptiveThresholds.preheatAggressiveness),
                    this.thermalMassModel.maxPreheatingTemp
                );

                const estimatedSavings = this.calculatePreheatingValue(
                    preheatingTarget,
                    cheapest6Hours,
                    copData.heating,
                    currentPrice
                );

                return {
                    action: 'preheat',
                    targetTemp: preheatingTarget,
                    reasoning: `Excellent conditions for preheating: price ${(currentPricePercentile * 100).toFixed(0)}th percentile`,
                    estimatedSavings,
                    duration: 2,
                    confidenceLevel: Math.min(heatingEfficiency + 0.2, 0.9)
                };

            } else if (currentPricePercentile >= (1.0 - preheatCheapPercentile * adaptiveThresholds.veryChepMultiplier) && currentTemp > targetTemp - 0.5) {
                // Coasting logic
                const coastingTarget = Math.max(targetTemp - adaptiveThresholds.coastingReduction, 16); // Min temp hardcoded for now
                const coastingHours = Math.min(
                    (currentTemp - coastingTarget) / this.thermalMassModel.heatLossRate,
                    4
                );

                const estimatedSavings = this.calculateCoastingSavings(currentPrice, coastingHours);

                return {
                    action: 'coast',
                    targetTemp: coastingTarget,
                    reasoning: `Expensive period: coasting for ${coastingHours.toFixed(1)}h`,
                    estimatedSavings,
                    duration: coastingHours,
                    confidenceLevel: 0.8
                };

            } else if (currentPricePercentile <= preheatCheapPercentile && heatingEfficiency > adaptiveThresholds.excellentCOPThreshold && currentTemp < targetTemp - 1.0) {
                // Boost logic
                const boostTarget = Math.min(targetTemp + adaptiveThresholds.boostIncrease, 26); // Max temp hardcoded
                const estimatedSavings = this.calculateBoostValue(boostTarget, copData.heating);

                return {
                    action: 'boost',
                    targetTemp: boostTarget,
                    reasoning: `Cheap electricity + high COP: boosting`,
                    estimatedSavings,
                    duration: 1,
                    confidenceLevel: heatingEfficiency
                };
            }

            return {
                action: 'maintain',
                targetTemp: targetTemp,
                reasoning: 'Normal operation',
                estimatedSavings: 0,
                confidenceLevel: 0.7
            };

        } catch (error) {
            this.logger.error('Error calculating thermal mass strategy:', error);
            return {
                action: 'maintain',
                targetTemp: targetTemp,
                reasoning: 'Error in calculation',
                estimatedSavings: 0,
                confidenceLevel: 0.3
            };
        }
    }

    private calculatePreheatingValue(
        preheatingTarget: number,
        cheapestHours: any[],
        heatingCOP: number,
        currentPrice: number
    ): number {
        try {
            const avgCheapPrice = cheapestHours.reduce((sum: number, h: any) => sum + h.price, 0) / cheapestHours.length;
            const priceDifference = currentPrice - avgCheapPrice;
            const extraEnergy = (preheatingTarget - 20) * this.thermalMassModel.thermalCapacity;
            const energyWithCOP = extraEnergy / heatingCOP;
            const savings = energyWithCOP * priceDifference;
            return Math.max(savings, 0);
        } catch {
            return 0;
        }
    }

    private calculateCoastingSavings(currentPrice: number, coastingHours: number): number {
        const avgHeatingPower = 2.0;
        return avgHeatingPower * coastingHours * currentPrice;
    }

    private calculateBoostValue(boostTarget: number, heatingCOP: number): number {
        const extraEnergy = (boostTarget - 20) * this.thermalMassModel.thermalCapacity;
        // Simplified value calculation
        return extraEnergy * 0.15 * (heatingCOP / 5);
    }
}
