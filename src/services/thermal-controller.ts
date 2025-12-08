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
        comfortBand: { minTemp: number; maxTemp: number },
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

            // Detect upcoming expensive hours in next 6h for preemptive preheat decisions
            const expensiveThreshold = 1.0 - preheatCheapPercentile; // e.g., 0.75 if cheap is 0.25
            const next6h = next24hSource.slice(0, 6);
            const expensivePriceLevel = sortedPrices[Math.floor(sortedPrices.length * expensiveThreshold)]?.price ?? currentPrice * 1.3;
            const hasUpcomingExpensive = next6h.some(p => p.price > expensivePriceLevel);

            // Check if current price is in "normal" range (between cheap and expensive thresholds)
            const isCurrentNormal = currentPricePercentile > preheatCheapPercentile && 
                                    currentPricePercentile < expensiveThreshold;

            // Debug logging for strategy decision
            this.logger.log('Thermal strategy decision inputs:', {
                currentPrice: currentPrice.toFixed(4),
                currentPricePercentile: (currentPricePercentile * 100).toFixed(1) + '%',
                preheatCheapPercentile: (preheatCheapPercentile * 100).toFixed(1) + '%',
                expensiveThreshold: (expensiveThreshold * 100).toFixed(1) + '%',
                isCurrentNormal: isCurrentNormal,
                hasUpcomingExpensive: hasUpcomingExpensive,
                next6hPrices: next6h.map(p => p.price.toFixed(3)).join(', '),
                expensivePriceLevel: expensivePriceLevel.toFixed(4),
                heatingEfficiency: heatingEfficiency.toFixed(2),
                minimumCOPThreshold: adaptiveThresholds.minimumCOPThreshold,
                tempDelta: tempDelta.toFixed(1),
                currentTemp: currentTemp.toFixed(1),
                targetTemp: targetTemp.toFixed(1),
                comfortBand: `${comfortBand.minTemp}-${comfortBand.maxTemp}°C`
            });

            // Strategy decision logic
            // Check 1: Very cheap preheat conditions
            const veryChepThreshold = preheatCheapPercentile * adaptiveThresholds.veryChepMultiplier;
            const meetsVeryChepPreheat = currentPricePercentile <= veryChepThreshold &&
                heatingEfficiency > adaptiveThresholds.goodCOPThreshold && tempDelta > 0.5;
            
            // Check 2: Preemptive preheat conditions
            const meetsPreemptivePreheat = isCurrentNormal && hasUpcomingExpensive && 
                heatingEfficiency > adaptiveThresholds.minimumCOPThreshold && tempDelta > 0;

            this.logger.log('Thermal strategy condition checks:', {
                veryChepThreshold: (veryChepThreshold * 100).toFixed(1) + '%',
                meetsVeryChepPreheat: meetsVeryChepPreheat,
                veryChepDetails: {
                    priceCheck: `${(currentPricePercentile * 100).toFixed(1)}% <= ${(veryChepThreshold * 100).toFixed(1)}% = ${currentPricePercentile <= veryChepThreshold}`,
                    copCheck: `${heatingEfficiency.toFixed(2)} > ${adaptiveThresholds.goodCOPThreshold} = ${heatingEfficiency > adaptiveThresholds.goodCOPThreshold}`,
                    tempDeltaCheck: `${tempDelta.toFixed(1)} > 0.5 = ${tempDelta > 0.5}`
                },
                meetsPreemptivePreheat: meetsPreemptivePreheat,
                preemptiveDetails: {
                    isCurrentNormal: isCurrentNormal,
                    hasUpcomingExpensive: hasUpcomingExpensive,
                    copCheck: `${heatingEfficiency.toFixed(2)} > ${adaptiveThresholds.minimumCOPThreshold} = ${heatingEfficiency > adaptiveThresholds.minimumCOPThreshold}`,
                    tempDeltaCheck: `${tempDelta.toFixed(1)} > 0 = ${tempDelta > 0}`
                }
            });

            if (currentPricePercentile <= (preheatCheapPercentile * adaptiveThresholds.veryChepMultiplier) &&
                heatingEfficiency > adaptiveThresholds.goodCOPThreshold && tempDelta > 0.5) {

                const preheatingTarget = Math.min(
                    targetTemp + (heatingEfficiency * adaptiveThresholds.preheatAggressiveness),
                    comfortBand.maxTemp  // Use user's max temp instead of hardcoded 23°C
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

            } else if (isCurrentNormal && hasUpcomingExpensive && 
                       heatingEfficiency > adaptiveThresholds.minimumCOPThreshold && tempDelta > 0) {
                // Preemptive preheat: Normal price now, but expensive hours coming soon
                // Scale preheat aggressiveness based on how close current price is to cheap threshold
                // Closer to cheap = more aggressive preheating
                const normalRange = expensiveThreshold - preheatCheapPercentile;
                const positionInNormalRange = (currentPricePercentile - preheatCheapPercentile) / normalRange;
                const preheatMultiplier = Math.max(0.2, 1.0 - positionInNormalRange); // 0.2 minimum, 1.0 when near cheap

                const preheatingTarget = Math.min(
                    targetTemp + (heatingEfficiency * adaptiveThresholds.preheatAggressiveness * preheatMultiplier),
                    comfortBand.maxTemp  // Respect user's max comfort temperature
                );

                const estimatedSavings = this.calculatePreheatingValue(
                    preheatingTarget,
                    cheapest6Hours,
                    copData.heating,
                    currentPrice
                );

                this.logger.log('Preemptive preheat triggered:', {
                    currentPercentile: (currentPricePercentile * 100).toFixed(0) + '%',
                    preheatMultiplier: preheatMultiplier.toFixed(2),
                    targetTemp: preheatingTarget.toFixed(1),
                    reason: 'Normal price now, expensive hours coming'
                });

                return {
                    action: 'preheat',
                    targetTemp: preheatingTarget,
                    reasoning: `Preemptive preheat: ${(currentPricePercentile * 100).toFixed(0)}% now, expensive coming (×${preheatMultiplier.toFixed(1)})`,
                    estimatedSavings,
                    duration: 2,
                    confidenceLevel: Math.min(heatingEfficiency + 0.1, 0.8)
                };

            } else if (currentPricePercentile >= (1.0 - preheatCheapPercentile * adaptiveThresholds.veryChepMultiplier) && currentTemp > targetTemp - 0.5) {
                // Coasting logic
                const coastingTarget = Math.max(targetTemp - adaptiveThresholds.coastingReduction, comfortBand.minTemp);
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
                const boostTarget = Math.min(targetTemp + adaptiveThresholds.boostIncrease, comfortBand.maxTemp);
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
