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
import { applySetpointConstraints } from '../util/setpoint-constraints';

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
const PREHEAT_CONFIDENCE_THRESHOLD = 0.35;
const PRICE_WINDOW_HOURS = 6;
const MIN_NORMALIZED_PRICE_POINTS = 6;
const MIN_EFFECTIVE_COP = 1.2;
const HOURLY_BUCKET_MS = 60 * 60 * 1000;

interface ConstraintContextForGate {
    currentTargetC: number;
    minC: number;
    maxC: number;
    stepC: number;
    deadbandC: number;
    minChangeMinutes: number;
    lastChangeMs?: number;
    maxDeltaPerChangeC?: number;
}

interface PreheatGateResult {
    decision: 'allow' | 'block' | 'skip';
    reason?: string;
    confidence?: number;
    netBenefit?: number;
    constrainedTarget?: number;
}

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
    private thermalModelService?: ThermalModelService;
    private adaptiveLearner?: AdaptiveParametersLearner;
    private copNormalizer?: CopNormalizer;

    constructor(
        private readonly logger: HomeyLogger,
        thermalModelService?: ThermalModelService,
        adaptiveLearner?: AdaptiveParametersLearner,
        copNormalizer?: CopNormalizer
    ) {
        this.thermalModelService = thermalModelService;
        this.adaptiveLearner = adaptiveLearner;
        this.copNormalizer = copNormalizer;
    }

    public setThermalModelService(service?: ThermalModelService): void {
        this.thermalModelService = service;
    }

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
        futurePrices: PricePoint[],
        copData: { heating: number; hotWater: number; outdoor: number },
        priceAnalyzer: PriceAnalyzer,
        preheatCheapPercentile: number,
        comfortBand: { minTemp: number; maxTemp: number },
        referenceTimeMs?: number,
        constraintContext?: ConstraintContextForGate
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

            const heatingEfficiency = this.normalizeHeatingEfficiency(copData.heating);

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

            const gateContext = {
                constraintContext,
                comfortBand,
                currentTemp,
                baselineTarget: targetTemp,
                currentPrice,
                futurePrices: next24hSource,
                heatingCop: copData.heating,
                outdoorTemp: copData.outdoor,
                referenceTimeMs: nowMs
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

                const gateResult = this.evaluatePreheatGate({
                    ...gateContext,
                    proposedTarget: preheatingTarget,
                    path: 'very-cheap'
                });

                if (gateResult.decision === 'block') {
                    return {
                        action: 'maintain',
                        targetTemp: targetTemp,
                        reasoning: gateResult.reason ?? 'Preheat blocked by cost/benefit gate',
                        estimatedSavings: 0,
                        duration: 0,
                        confidenceLevel: Math.min(heatingEfficiency, gateResult.confidence ?? heatingEfficiency)
                    };
                }

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

                const gateResult = this.evaluatePreheatGate({
                    ...gateContext,
                    proposedTarget: preheatingTarget,
                    path: 'preemptive'
                });

                if (gateResult.decision === 'block') {
                    return {
                        action: 'maintain',
                        targetTemp: targetTemp,
                        reasoning: gateResult.reason ?? 'Preheat blocked by cost/benefit gate',
                        estimatedSavings: 0,
                        duration: 0,
                        confidenceLevel: Math.min(heatingEfficiency, gateResult.confidence ?? heatingEfficiency)
                    };
                }

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

    private normalizeHeatingEfficiency(cop?: number): number {
        if (typeof cop === 'number' && Number.isFinite(cop)) {
            if (this.copNormalizer) {
                return this.copNormalizer.normalize(cop);
            }
            return CopNormalizer.roughNormalize(cop);
        }
        return 0;
    }

    private evaluatePreheatGate(params: {
        proposedTarget: number;
        baselineTarget: number;
        currentTemp: number;
        currentPrice: number;
        futurePrices: PricePoint[];
        heatingCop?: number;
        outdoorTemp?: number;
        comfortBand: { minTemp: number; maxTemp: number };
        constraintContext?: ConstraintContextForGate;
        referenceTimeMs: number;
        path: string;
    }): PreheatGateResult {
        try {
            const characteristics = this.thermalModelService?.getThermalCharacteristics?.();
            const baseLog = {
                path: params.path,
                proposedTarget: Number(params.proposedTarget.toFixed(2)),
                baselineTarget: Number(params.baselineTarget.toFixed(2)),
                currentTemp: Number(params.currentTemp.toFixed(2)),
                comfortMax: params.comfortBand.maxTemp
            };

            if (!characteristics) {
                this.logger.log('Preheat cost-benefit gate', {
                    ...baseLog,
                    decision: 'skip',
                    reason: 'thermal-model-unavailable'
                });
                return { decision: 'skip', reason: 'thermal-model-unavailable' };
            }

            const confidence = Number.isFinite(characteristics.modelConfidence) ? characteristics.modelConfidence : 0;
            if (confidence < PREHEAT_CONFIDENCE_THRESHOLD) {
                this.logger.log('Preheat cost-benefit gate', {
                    ...baseLog,
                    decision: 'skip',
                    reason: 'low-thermal-confidence',
                    confidence
                });
                return { decision: 'skip', reason: 'low-thermal-confidence', confidence };
            }

            const normalizedPrices = this.normalizePricesForGate(params.futurePrices, params.referenceTimeMs);
            if (!normalizedPrices || normalizedPrices.buckets.length < MIN_NORMALIZED_PRICE_POINTS) {
                this.logger.log('Preheat cost-benefit gate', {
                    ...baseLog,
                    decision: 'skip',
                    reason: 'insufficient-price-data',
                    confidence,
                    normalizedPoints: normalizedPrices?.buckets.length || 0
                });
                return { decision: 'skip', reason: 'insufficient-price-data', confidence };
            }

            const expensiveWindow = normalizedPrices.buckets.slice(0, PRICE_WINDOW_HOURS);
            if (expensiveWindow.length === 0) {
                this.logger.log('Preheat cost-benefit gate', {
                    ...baseLog,
                    decision: 'skip',
                    reason: 'empty-price-window',
                    confidence
                });
                return { decision: 'skip', reason: 'empty-price-window', confidence };
            }
            const expensiveAvgPrice = expensiveWindow.reduce((sum, p) => sum + p.price, 0) / expensiveWindow.length;

            const cop = this.getEffectiveCop(params.heatingCop);
            if (!cop) {
                this.logger.log('Preheat cost-benefit gate', {
                    ...baseLog,
                    decision: 'skip',
                    reason: 'missing-cop',
                    confidence
                });
                return { decision: 'skip', reason: 'missing-cop', confidence };
            }

            const constrainedTarget = this.getConstrainedTargetForGate(
                params.proposedTarget,
                params.comfortBand,
                params.constraintContext
            );
            const deltaC = Math.max(0, constrainedTarget - params.currentTemp);
            if (deltaC <= 0) {
                this.logger.log('Preheat cost-benefit gate', {
                    ...baseLog,
                    decision: 'skip',
                    reason: 'non-positive-delta',
                    confidence,
                    constrainedTarget
                });
                return { decision: 'skip', reason: 'non-positive-delta', confidence, constrainedTarget };
            }

            const thermalCapacity = this.thermalMassModel.thermalCapacity ?? 2.5;
            const heatKwh = deltaC * thermalCapacity;
            const coolingRate = Math.max(characteristics.coolingRate ?? 0, 0);
            const tempDiffFromOutdoor = Math.max(params.currentTemp - (params.outdoorTemp ?? params.currentTemp), 0);
            const heatLossPerHour = coolingRate * tempDiffFromOutdoor;
            const windowHours = expensiveWindow.length;
            const lostDegrees = heatLossPerHour * windowHours;
            const savedDegrees = Math.min(deltaC, lostDegrees);
            const savedHeatKwh = savedDegrees * thermalCapacity;

            const extraCostNow = (heatKwh / cop.effectiveCop) * params.currentPrice;
            const savedCostLater = (savedHeatKwh / cop.effectiveCop) * expensiveAvgPrice;
            const netBenefit = savedCostLater - extraCostNow;
            const decision: 'allow' | 'block' = netBenefit > 0 ? 'allow' : 'block';

            this.logger.log('Preheat cost-benefit gate', {
                ...baseLog,
                decision,
                reason: decision === 'block' ? 'non-positive-net-benefit' : 'positive-net-benefit',
                confidence,
                constrainedTarget: Number(constrainedTarget.toFixed(2)),
                deltaUsed: Number(deltaC.toFixed(2)),
                extraCostNow: Number(extraCostNow.toFixed(3)),
                savedCostLater: Number(savedCostLater.toFixed(3)),
                netBenefit: Number(netBenefit.toFixed(3)),
                priceWindowHours: windowHours,
                priceCadenceMinutes: normalizedPrices.cadenceMinutes,
                priceWindow: expensiveWindow.map(p => ({
                    time: new Date(p.time).toISOString(),
                    price: Number(p.price.toFixed(5))
                })),
                normalizedCop: Number(cop.normalizedCop.toFixed(3)),
                effectiveCop: Number(cop.effectiveCop.toFixed(3))
            });

            if (decision === 'block') {
                return {
                    decision,
                    reason: 'Preheat skipped: non-positive netBenefit',
                    confidence,
                    netBenefit,
                    constrainedTarget
                };
            }

            return { decision, confidence, netBenefit, constrainedTarget };
        } catch (error) {
            this.logger.warn('Preheat cost-benefit gate failed, falling back to heuristic', { error });
            return { decision: 'skip', reason: 'gate-error' };
        }
    }

    private getEffectiveCop(heatingCop?: number): { effectiveCop: number; normalizedCop: number; referenceCop: number } | null {
        const referenceCop = this.copNormalizer?.getRange().max ?? DEFAULT_REFERENCE_COP;

        if (typeof heatingCop === 'number' && Number.isFinite(heatingCop)) {
            const normalizedCop = this.copNormalizer
                ? this.copNormalizer.normalize(heatingCop)
                : CopNormalizer.roughNormalize(heatingCop);
            const effectiveCop = Math.max(MIN_EFFECTIVE_COP, referenceCop * normalizedCop);
            if (!Number.isFinite(effectiveCop) || effectiveCop <= 0) {
                return null;
            }
            return { effectiveCop, normalizedCop, referenceCop };
        }

        if (this.copNormalizer?.hasReliableData()) {
            const normalizedCop = 0.5;
            const effectiveCop = Math.max(MIN_EFFECTIVE_COP, referenceCop * normalizedCop);
            return { effectiveCop, normalizedCop, referenceCop };
        }

        return null;
    }

    private normalizePricesForGate(prices: PricePoint[], referenceTimeMs: number): { buckets: Array<{ time: number; price: number }>; cadenceMinutes: number } | null {
        const parsed = prices
            .map(pricePoint => {
                const ts = Date.parse(pricePoint.time);
                if (!Number.isFinite(ts) || !Number.isFinite(pricePoint.price)) {
                    return null;
                }
                return { ts, price: pricePoint.price };
            })
            .filter((entry): entry is { ts: number; price: number } => Boolean(entry))
            .filter(entry => entry.ts >= referenceTimeMs);

        if (parsed.length === 0) {
            return null;
        }

        parsed.sort((a, b) => a.ts - b.ts);

        const buckets = new Map<number, { sum: number; count: number }>();
        for (const entry of parsed) {
            const bucketKey = Math.floor(entry.ts / HOURLY_BUCKET_MS) * HOURLY_BUCKET_MS;
            const agg = buckets.get(bucketKey) || { sum: 0, count: 0 };
            agg.sum += entry.price;
            agg.count += 1;
            buckets.set(bucketKey, agg);
        }

        const normalized = Array.from(buckets.entries())
            .sort((a, b) => a[0] - b[0])
            .map(([time, agg]) => ({ time, price: agg.sum / agg.count }));

        if (normalized.length === 0) {
            return null;
        }

        const cadenceMs = normalized.length > 1 ? normalized[1].time - normalized[0].time : HOURLY_BUCKET_MS;
        return {
            buckets: normalized,
            cadenceMinutes: Math.max(1, Math.round(cadenceMs / 60000))
        };
    }

    private getConstrainedTargetForGate(
        proposedTarget: number,
        comfortBand: { minTemp: number; maxTemp: number },
        constraintContext?: ConstraintContextForGate
    ): number {
        const comfortClamped = Math.min(Math.max(proposedTarget, comfortBand.minTemp), comfortBand.maxTemp);

        if (!constraintContext) {
            return comfortClamped;
        }

        try {
            const constraints = applySetpointConstraints({
                proposedC: comfortClamped,
                currentTargetC: constraintContext.currentTargetC,
                minC: constraintContext.minC,
                maxC: constraintContext.maxC,
                stepC: constraintContext.stepC,
                deadbandC: constraintContext.deadbandC,
                minChangeMinutes: constraintContext.minChangeMinutes,
                lastChangeMs: constraintContext.lastChangeMs,
                maxDeltaPerChangeC: constraintContext.maxDeltaPerChangeC
            });
            return constraints.constrainedC;
        } catch {
            return comfortClamped;
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
