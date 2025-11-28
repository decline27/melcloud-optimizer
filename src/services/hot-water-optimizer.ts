import { HomeyLogger } from '../util/logger';
import { PriceAnalyzer } from './price-analyzer';
import { OptimizationMetrics, SchedulePoint } from '../types';
import { COP_THRESHOLDS } from '../constants';
import { CopNormalizer } from './cop-normalizer';

export interface HotWaterAction {
    action: 'heat_now' | 'delay' | 'maintain';
    reason: string;
    scheduledTime?: string;
}

export class HotWaterOptimizer {
    constructor(
        private readonly logger: HomeyLogger,
        private readonly priceAnalyzer: PriceAnalyzer
    ) { }

    /**
     * Optimize hot water scheduling based on price and COP
     */
    public async optimizeHotWaterScheduling(
        currentPrice: number,
        priceData: any,
        metrics: OptimizationMetrics | null,
        lastEnergyData: any
    ): Promise<HotWaterAction> {
        if (!metrics || !lastEnergyData) {
            return { action: 'maintain', reason: 'No real energy data available for hot water optimization' };
        }

        // Calculate hot water efficiency score
        const hotWaterCOP = metrics.realHotWaterCOP;

        // Find cheapest hours in the next 24 hours
        const referenceTimeMs = priceData.current?.time ? Date.parse(priceData.current.time) : NaN;
        const nowMs = Number.isFinite(referenceTimeMs) ? referenceTimeMs : Date.now();
        const upcomingPrices = priceData.prices.filter((pricePoint: any) => {
            const ts = Date.parse(pricePoint.time);
            if (!Number.isFinite(ts)) {
                return true;
            }
            return ts >= nowMs;
        });
        const prices = (upcomingPrices.length > 0 ? upcomingPrices : priceData.prices).slice(0, 24); // Next 24 hours
        const sortedPrices = [...prices].sort((a: any, b: any) => a.price - b.price);
        const cheapestHours = sortedPrices.slice(0, 4); // Top 4 cheapest hours

        // Use CopNormalizer.roughNormalize for consistent COP normalization
        // Hot water COP typically ranges lower than heating, so use 4.0 as assumedMax
        const hotWaterEfficiency = CopNormalizer.roughNormalize(hotWaterCOP, 4.0);

        // Current price percentile
        const currentPercentile = prices.filter((p: any) => p.price <= currentPrice).length / prices.length;
        const cheapThreshold = this.priceAnalyzer.getCheapPercentile();

        // Improved COP-based hot water optimization
        if (hotWaterEfficiency > COP_THRESHOLDS.EXCELLENT) {
            // Excellent hot water COP: More flexible timing  
            if (currentPercentile <= (cheapThreshold * 1.6)) {
                return {
                    action: 'heat_now',
                    reason: `Excellent hot water COP (${hotWaterCOP.toFixed(2)}) + reasonable electricity price`
                };
            } else if (currentPercentile >= (1.0 - cheapThreshold * 0.8)) {
                const nextCheapHour = cheapestHours[0];
                return {
                    action: 'delay',
                    reason: `High COP but very expensive electricity - delay to ${nextCheapHour.time}`,
                    scheduledTime: nextCheapHour.time
                };
            }
        } else if (hotWaterEfficiency > COP_THRESHOLDS.GOOD) {
            // Good hot water COP: Moderate optimization
            if (currentPercentile <= 0.3) { // Only during cheapest 30%
                return {
                    action: 'heat_now',
                    reason: `Good hot water COP (${hotWaterCOP.toFixed(2)}) + cheap electricity`
                };
            }
        } else if (hotWaterEfficiency > COP_THRESHOLDS.POOR) {
            // Poor hot water COP: Conservative approach
            if (currentPercentile <= 0.15) { // Only during cheapest 15%
                return {
                    action: 'heat_now',
                    reason: `Poor hot water COP (${hotWaterCOP.toFixed(2)}) - only during cheapest electricity`
                };
            } else {
                const nextCheapHour = cheapestHours[0];
                return {
                    action: 'delay',
                    reason: `Poor COP - wait for cheapest electricity at ${nextCheapHour.time}`,
                    scheduledTime: nextCheapHour.time
                };
            }
        } else if (hotWaterCOP > 0) {
            // Very poor hot water COP: Emergency heating only
            if (currentPercentile <= 0.1) { // Only during cheapest 10%
                return {
                    action: 'heat_now',
                    reason: `Very poor hot water COP (${hotWaterCOP.toFixed(2)}) - emergency heating during absolute cheapest electricity`
                };
            } else {
                const nextCheapHour = cheapestHours[0];
                return {
                    action: 'delay',
                    reason: `Very poor COP - critical: wait for absolute cheapest electricity at ${nextCheapHour.time}`,
                    scheduledTime: nextCheapHour.time
                };
            }
        }

        return { action: 'maintain', reason: 'Maintaining current hot water schedule' };
    }

    /**
     * Calculate estimated savings from pattern-based scheduling
     * Compares scheduled cheap-hour heating vs on-demand heating cost
     */
    private calculatePatternSavings(
        schedulePoints: SchedulePoint[],
        currentHour: number,
        priceData: any[],
        options: { gridFeePerKwh?: number; estimatedDailyHotWaterKwh?: number } = {}
    ): number {
        if (schedulePoints.length === 0 || priceData.length === 0) {
            return 0;
        }

        const gridFee = Number.isFinite(options.gridFeePerKwh) ? (options.gridFeePerKwh as number) : 0;

        // Derive a kWh scale from pattern priorities to avoid hard-coded constants.
        // Treat priorities as relative weights and scale by an estimated daily kWh if provided.
        const totalPriority = schedulePoints.reduce((sum, p) => sum + Math.max(p.priority, 0), 0);
        const dailyKwh = Number.isFinite(options.estimatedDailyHotWaterKwh)
            ? (options.estimatedDailyHotWaterKwh as number)
            : 0;
        if (totalPriority === 0 || dailyKwh <= 0) {
            return 0; // No meaningful estimate available
        }

        // Calculate cost of scheduled heating (during cheap hours)
        let scheduledCost = 0;
        let totalDemand = 0;

        for (const point of schedulePoints) {
            const hoursAhead = (point.hour - currentHour + 24) % 24;

            if (hoursAhead < priceData.length) {
                const hourPrice = priceData[hoursAhead].price;
                const estimatedKWh = (Math.max(point.priority, 0) / totalPriority) * dailyKwh;

                scheduledCost += (hourPrice + gridFee) * estimatedKWh;
                totalDemand += estimatedKWh;
            }
        }

        if (totalDemand === 0) {
            return 0;
        }

        // Calculate cost of on-demand heating at average price
        const avgPrice = priceData.reduce((sum, p) => sum + p.price, 0) / priceData.length;
        const onDemandCost = (avgPrice + gridFee) * totalDemand;

        // Savings = what it would cost on-demand minus scheduled cost
        const savings = Math.max(0, onDemandCost - scheduledCost);

        return Number(savings.toFixed(3));
    }

    /**
     * Optimize hot water scheduling based on usage patterns
     */
    public optimizeHotWaterSchedulingByPattern(
        currentHour: number,
        priceData: any[],
        hotWaterCOP: number,
        usagePattern: { peakHours: number[], hourlyDemand: number[] },
        referenceTimeMs?: number,
        options: { currencyCode?: string; gridFeePerKwh?: number; estimatedDailyHotWaterKwh?: number } = {}
    ): {
        schedulePoints: SchedulePoint[];
        currentAction: 'heat_now' | 'delay' | 'maintain';
        reasoning: string;
        estimatedSavings: number;
    } {
        try {
            const nowMs = typeof referenceTimeMs === 'number' && Number.isFinite(referenceTimeMs)
                ? referenceTimeMs
                : Date.now();
            const upcomingPrices = priceData.filter(pricePoint => {
                const ts = Date.parse(pricePoint.time);
                if (!Number.isFinite(ts)) {
                    return true;
                }
                return ts >= nowMs;
            });
            const priceWindow = upcomingPrices.length > 0 ? upcomingPrices : priceData;
            const next24h = priceWindow.slice(0, 24);
            const schedulePoints: SchedulePoint[] = [];

            // For each peak demand hour, find optimal heating time
            usagePattern.peakHours.forEach(peakHour => {
                // Find valid heating window (4 hours before peak)
                const validHours = [];
                for (let i = 0; i < 4; i++) {
                    const hour = (peakHour - i + 24) % 24;
                    if (hour >= currentHour || hour < currentHour - 12) { // Future hours only
                        validHours.push(hour);
                    }
                }

                if (validHours.length > 0) {
                    // Find cheapest hour in valid window
                    const cheapestHour = validHours.reduce((min, hour) => {
                        const priceIndex = (hour - currentHour + 24) % 24;
                        const minPriceIndex = (min - currentHour + 24) % 24;

                        if (priceIndex < next24h.length && minPriceIndex < next24h.length) {
                            return next24h[priceIndex].price < next24h[minPriceIndex].price ? hour : min;
                        }
                        return min;
                    });

                    const priceIndex = (cheapestHour - currentHour + 24) % 24;
                    const pricePercentile = next24h.filter((p: any) => p.price <= next24h[priceIndex].price).length / next24h.length;

                    schedulePoints.push({
                        hour: cheapestHour,
                        reason: `Prepare for peak demand at ${peakHour}:00`,
                        priority: usagePattern.hourlyDemand[peakHour],
                        cop: hotWaterCOP,
                        pricePercentile
                    });
                }
            });

            // Sort by priority (highest first)
            schedulePoints.sort((a, b) => b.priority - a.priority);

            // Determine current action
            let currentAction: 'heat_now' | 'delay' | 'maintain' = 'maintain';

            // Check if current hour is a scheduled heating time
            const isScheduledNow = schedulePoints.some(point => point.hour === currentHour);

            if (isScheduledNow) {
                currentAction = 'heat_now';
            } else {
                // Check if we're approaching a peak and haven't heated yet
                const nextPeak = usagePattern.peakHours.find(peak => {
                    const hoursUntilPeak = (peak - currentHour + 24) % 24;
                    return hoursUntilPeak <= 2 && hoursUntilPeak > 0;
                });

                if (nextPeak && hotWaterCOP > 0) {
                    // Emergency heating before peak
                    currentAction = 'heat_now';
                } else {
                    // Check if current price is exceptional
                    const currentPrice = next24h[0]?.price || 0;
                    const avgPrice = next24h.reduce((sum: number, p: any) => sum + p.price, 0) / next24h.length;

                    // Convert user's cheap percentile to price ratio threshold
                    const priceRatioThreshold = 1.0 - (this.priceAnalyzer.getCheapPercentile() * 1.2);

                    if (currentPrice < avgPrice * priceRatioThreshold && hotWaterCOP > 2.5) {
                        currentAction = 'heat_now';
                    }
                }
            }

            // Calculate estimated savings
            const estimatedSavings = this.calculatePatternSavings(
                schedulePoints,
                currentHour,
                next24h,
                {
                    gridFeePerKwh: options.gridFeePerKwh,
                    estimatedDailyHotWaterKwh: options.estimatedDailyHotWaterKwh
                }
            );

            const currencyCode = options.currencyCode || 'NOK';

            this.logger.log('Pattern-based hot water savings calculated', {
                schedulePoints: schedulePoints.length,
                totalDemand: schedulePoints.reduce((sum, p) => sum + Math.max(p.priority, 0), 0),
                estimatedSavings
            });

            return {
                schedulePoints,
                currentAction,
                reasoning: `Predictive scheduling based on usage pattern (peaks: ${usagePattern.peakHours.join(', ')}h, saves ${estimatedSavings.toFixed(2)} ${currencyCode})`,
                estimatedSavings
            };

        } catch (error) {
            this.logger.error('Error optimizing hot water scheduling:', error);
            return {
                schedulePoints: [],
                currentAction: 'maintain',
                reasoning: 'Error in scheduling - maintaining current operation',
                estimatedSavings: 0
            };
        }
    }
}
