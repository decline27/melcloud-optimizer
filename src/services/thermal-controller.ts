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

/**
 * Thermal Controller Constants
 * 
 * These values control thermal mass strategy behavior. Some are fixed constants
 * while others serve as DEFAULT caps that scale with learned thermal characteristics.
 * 
 * @remarks
 * Fixed Constants:
 * - CHEAPEST_HOURS_COUNT: 6 hours represents ~25% of a 24h window, matching
 *   the default cheap percentile threshold.
 * 
 * - PREHEAT_TEMP_DELTA_THRESHOLD: 0.5°C minimum temperature difference
 *   required to trigger preheating.
 * 
 * - BOOST_DURATION_HOURS: 1 hour boost when conditions are excellent.
 * 
 * - BOOST_SAVINGS_FACTOR: 0.15 multiplier for boost value estimation.
 * 
 * Derived/Scalable Constants (scale with learned thermal capacity):
 * - MAX_COASTING_HOURS_CAP: 6 hours safety cap. Actual max coasting is derived
 *   from thermalCapacity * COASTING_HOURS_PER_CAPACITY (typically 1.5-6h).
 * 
 * - PREHEAT_DURATION_CAP: 3 hours safety cap. Actual duration is derived
 *   from thermalCapacity * PREHEAT_HOURS_PER_CAPACITY (typically 1-3h).
 * 
 * - DEFAULT_HEATING_POWER_KW: 2.0 kW fallback. When thermal model is available,
 *   heating power can be estimated from heatLossRate.
 * 
 * - DEFAULT_REFERENCE_COP: 4.0 fallback. When COP history is available,
 *   maxObserved COP from CopNormalizer should be used instead.
 */
const CHEAPEST_HOURS_COUNT = 6;
const PREHEAT_TEMP_DELTA_THRESHOLD = 0.5;
const BOOST_DURATION_HOURS = 1;
const BOOST_SAVINGS_FACTOR = 0.15;

// Scalable constants - these are caps/defaults, actual values derived from thermal model
const MAX_COASTING_HOURS_CAP = 6;
const COASTING_HOURS_PER_CAPACITY = 1.5;  // Hours of coasting per unit thermal capacity
const PREHEAT_DURATION_CAP = 3;
const PREHEAT_HOURS_PER_CAPACITY = 0.8;   // Hours of preheat per unit thermal capacity
const MIN_PREHEAT_DURATION = 1;
const DEFAULT_HEATING_POWER_KW = 2.0;
const DEFAULT_REFERENCE_COP = 4.0;

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
            const cheapest6Hours = sortedPrices.slice(0, CHEAPEST_HOURS_COUNT);

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
                boostIncrease: 0.5,
                // Timing multipliers - default to 1.0 for no change
                maxCoastingHoursMultiplier: 1.0,
                preheatDurationMultiplier: 1.0
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
                heatingEfficiency > adaptiveThresholds.goodCOPThreshold && tempDelta > PREHEAT_TEMP_DELTA_THRESHOLD) {

                const preheatingTarget = Math.min(
                    targetTemp + (heatingEfficiency * adaptiveThresholds.preheatAggressiveness),
                    comfortBand.maxTemp  // Use user's max temp instead of hardcoded 23°C
                );

                const estimatedSavings = this.calculatePreheatingValue(
                    preheatingTarget,
                    cheapest6Hours,
                    copData.heating,
                    currentPrice,
                    comfortBand.minTemp
                );

                // Derive preheat duration from thermal capacity: higher capacity = longer preheat
                // Apply learned multiplier for fine-tuning based on actual thermal response
                const basePreheatDuration = Math.max(MIN_PREHEAT_DURATION, this.thermalMassModel.thermalCapacity * PREHEAT_HOURS_PER_CAPACITY);
                const preheatDuration = Math.min(
                    basePreheatDuration * adaptiveThresholds.preheatDurationMultiplier,
                    PREHEAT_DURATION_CAP
                );

                return {
                    action: 'preheat',
                    targetTemp: preheatingTarget,
                    reasoning: `Excellent conditions for preheating: price ${(currentPricePercentile * 100).toFixed(0)}th percentile`,
                    estimatedSavings,
                    duration: preheatDuration,
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

                // Derive preheat duration from thermal capacity
                // Apply learned multiplier for fine-tuning based on actual thermal response
                const basePreheatDuration = Math.max(MIN_PREHEAT_DURATION, this.thermalMassModel.thermalCapacity * PREHEAT_HOURS_PER_CAPACITY);
                const preheatDuration = Math.min(
                    basePreheatDuration * adaptiveThresholds.preheatDurationMultiplier,
                    PREHEAT_DURATION_CAP
                );

                return {
                    action: 'preheat',
                    targetTemp: preheatingTarget,
                    reasoning: `Preemptive preheat: ${(currentPricePercentile * 100).toFixed(0)}% now, expensive coming (×${preheatMultiplier.toFixed(1)})`,
                    estimatedSavings,
                    duration: preheatDuration,
                    confidenceLevel: Math.min(heatingEfficiency + 0.1, 0.8)
                };

            } else if (currentPricePercentile >= (1.0 - preheatCheapPercentile * adaptiveThresholds.veryChepMultiplier) && currentTemp > targetTemp - 0.5) {
                // Coasting logic - scale max coasting with thermal capacity
                const coastingTarget = Math.max(targetTemp - adaptiveThresholds.coastingReduction, comfortBand.minTemp);
                // Derive max coasting hours from thermal capacity: higher capacity = longer safe coasting
                // Apply learned multiplier for fine-tuning based on actual thermal response
                const baseCoastingHours = this.thermalMassModel.thermalCapacity * COASTING_HOURS_PER_CAPACITY;
                const maxCoastingForBuilding = Math.min(
                    baseCoastingHours * adaptiveThresholds.maxCoastingHoursMultiplier,
                    MAX_COASTING_HOURS_CAP
                );
                const coastingHours = Math.min(
                    (currentTemp - coastingTarget) / this.thermalMassModel.heatLossRate,
                    maxCoastingForBuilding
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
                const estimatedSavings = this.calculateBoostValue(boostTarget, copData.heating, comfortBand.minTemp);

                return {
                    action: 'boost',
                    targetTemp: boostTarget,
                    reasoning: `Cheap electricity + high COP: boosting`,
                    estimatedSavings,
                    duration: BOOST_DURATION_HOURS,
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
        currentPrice: number,
        baselineTemp: number = 20
    ): number {
        try {
            const avgCheapPrice = cheapestHours.reduce((sum: number, h: any) => sum + h.price, 0) / cheapestHours.length;
            const priceDifference = currentPrice - avgCheapPrice;
            const extraEnergy = (preheatingTarget - baselineTemp) * this.thermalMassModel.thermalCapacity;
            const energyWithCOP = extraEnergy / heatingCOP;
            const savings = energyWithCOP * priceDifference;
            return Math.max(savings, 0);
        } catch {
            return 0;
        }
    }

    private calculateCoastingSavings(currentPrice: number, coastingHours: number): number {
        return DEFAULT_HEATING_POWER_KW * coastingHours * currentPrice;
    }

    /**
     * Calculate the estimated value of boosting temperature during cheap electricity.
     * @param boostTarget Target temperature for boost
     * @param heatingCOP Current heating COP
     * @param baselineTemp Baseline temperature (user's comfort minimum)
     * @param referenceCOP Reference COP for efficiency normalization. When COP history
     *                     is available, pass CopNormalizer.maxObserved for better accuracy.
     */
    private calculateBoostValue(
        boostTarget: number, 
        heatingCOP: number, 
        baselineTemp: number = 20,
        referenceCOP: number = DEFAULT_REFERENCE_COP
    ): number {
        const extraEnergy = (boostTarget - baselineTemp) * this.thermalMassModel.thermalCapacity;
        return extraEnergy * BOOST_SAVINGS_FACTOR * (heatingCOP / referenceCOP);
    }
}
