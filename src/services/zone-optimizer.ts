import { HomeyLogger } from '../util/logger';
import { MelCloudApi } from './melcloud-api';
import { SecondaryZoneResult as Zone2Result, OptimizationMetrics, ThermalStrategy } from '../types/index';
import { PriceAnalyzer } from './price-analyzer';
import { ThermalController } from './thermal-controller';

/**
 * Service for optimizing zones (Zone 1 and Zone 2)
 * Uses unified optimization logic for both zones
 */
export class ZoneOptimizer {
    constructor(
        private readonly logger: HomeyLogger,
        private readonly melCloud: MelCloudApi,
        private readonly priceAnalyzer: PriceAnalyzer,
        private readonly thermalController: ThermalController
    ) { }

    /**
     * Optimize Zone 2 temperature with enhanced logic
     * Uses Zone 1's target as baseline and applies thermal strategies, COP optimization, and planning bias
     */
    public async optimizeZone2(
        deviceId: string,
        buildingId: number,
        currentTemp: number,
        currentTarget: number,
        zone1Target: number, // Zone 1's calculated target as baseline
        weatherAdjustment: { adjustment: number; reason: string } | null,
        priceLevel: string,
        thermalStrategy: any | null, // Thermal strategy from Zone 1
        metrics: any | null, // COP and energy metrics
        constraints: {
            minTemp: number;
            maxTemp: number;
            tempStep: number;
            deadband: number;
            minChangeMinutes: number;
            lastChangeMs: number;
        }
    ): Promise<Zone2Result> {
        // Start with Zone 1's target as baseline (coordinated approach)
        let adjustedTarget = zone1Target;

        // Apply thermal strategy if available
        if (thermalStrategy) {
            // Apply strategy-based adjustments
            if (thermalStrategy.action === 'preheat') {
                // During preheat, Zone 2 can match or slightly exceed Zone 1
                adjustedTarget = zone1Target;
            } else if (thermalStrategy.action === 'coast') {
                // During coast, Zone 2 can reduce slightly more than Zone 1
                adjustedTarget = zone1Target - 0.5;
            } else if (thermalStrategy.action === 'boost') {
                // During boost, match Zone 1's aggressive heating
                adjustedTarget = zone1Target;
            }
        }

        // Apply weather adjustment if significant
        if (weatherAdjustment && Math.abs(weatherAdjustment.adjustment) >= 0.1) {
            adjustedTarget += weatherAdjustment.adjustment;
        }

        // Apply COP-aware adjustment: if COP is poor, be more conservative
        if (metrics?.realHeatingCOP) {
            const heatingCOP = metrics.realHeatingCOP;
            if (heatingCOP < 2.0) {
                // Poor COP: reduce target slightly to minimize energy waste
                adjustedTarget -= 0.5;
            } else if (heatingCOP > 3.5) {
                // Excellent COP: can afford to heat more efficiently
                adjustedTarget += 0.3;
            }
        }

        // Apply constraints
        adjustedTarget = Math.max(constraints.minTemp, Math.min(constraints.maxTemp, adjustedTarget));
        adjustedTarget = Math.round(adjustedTarget / constraints.tempStep) * constraints.tempStep;

        const delta = adjustedTarget - currentTarget;
        const absDelta = Math.abs(delta);
        const changed = absDelta >= constraints.deadband;

        // Check lockout
        const now = Date.now();
        const timeSinceLastChange = (now - constraints.lastChangeMs) / 60000;
        const lockoutActive = timeSinceLastChange < constraints.minChangeMinutes;

        // Build reason string with thermal context
        let reason = 'No change needed';
        const strategyNote = thermalStrategy ? ` (${thermalStrategy.action} strategy)` : '';
        const copNote = metrics?.realHeatingCOP ? ` [COP: ${metrics.realHeatingCOP.toFixed(2)}]` : '';

        if (adjustedTarget < currentTarget) {
            reason = weatherAdjustment
                ? `Price ${priceLevel}${strategyNote} and ${weatherAdjustment.reason.toLowerCase()} – reducing Zone2${copNote}`
                : `Price ${priceLevel}${strategyNote} – reducing Zone2${copNote}`;
        } else if (adjustedTarget > currentTarget) {
            reason = weatherAdjustment
                ? `Price ${priceLevel}${strategyNote} and ${weatherAdjustment.reason.toLowerCase()} – increasing Zone2${copNote}`
                : `Price ${priceLevel}${strategyNote} – increasing Zone2${copNote}`;
        }

        if (changed && !lockoutActive) {
            try {
                await this.melCloud.setZoneTemperature(deviceId, buildingId, adjustedTarget, 2);
                this.logger.log(
                    `Zone2 enhanced: ${currentTarget.toFixed(1)}°C → ${adjustedTarget.toFixed(1)}°C ` +
                    `(Zone1: ${zone1Target.toFixed(1)}°C${strategyNote}${copNote})`
                );
                return {
                    fromTemp: currentTarget,
                    toTemp: adjustedTarget,
                    reason,
                    targetOriginal: currentTarget,
                    targetTemp: adjustedTarget,
                    indoorTemp: currentTemp,
                    success: true,
                    changed: true
                };
            } catch (error) {
                this.logger.error('Zone2 optimization failed', error);
                return {
                    fromTemp: currentTarget,
                    toTemp: currentTarget,
                    reason: `Failed to set Zone2 temperature: ${error}`,
                    targetOriginal: currentTarget,
                    targetTemp: adjustedTarget,
                    indoorTemp: currentTemp,
                    success: false,
                    changed: true
                };
            }
        } else {
            const holdReason = lockoutActive
                ? `lockout ${constraints.minChangeMinutes}m`
                : `change ${absDelta.toFixed(2)}°C below deadband ${constraints.deadband.toFixed(2)}°C`;

            this.logger.log(`Zone2 hold (${holdReason}) – keeping ${currentTarget.toFixed(1)}°C`);

            return {
                fromTemp: currentTarget,
                toTemp: currentTarget,
                reason: reason + ` | ${holdReason}`,
                targetOriginal: currentTarget,
                targetTemp: adjustedTarget,
                indoorTemp: currentTemp,
                success: true,
                changed: false
            };
        }
    }
}
