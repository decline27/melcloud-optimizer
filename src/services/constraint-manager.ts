import { HomeyLogger } from '../util/logger';
import { validateNumber } from '../util/validation';
import { COMFORT_CONSTANTS } from '../constants';

/**
 * Zone 1 (main zone) temperature constraints
 */
export interface Zone1Constraints {
    minTemp: number;
    maxTemp: number;
    tempStep: number;
    deadband: number;
}

/**
 * Zone 2 (secondary zone) temperature constraints
 */
export interface Zone2Constraints {
    enabled: boolean;
    minTemp: number;
    maxTemp: number;
    tempStep: number;
}

/**
 * Hot water tank temperature constraints
 */
export interface TankConstraints {
    enabled: boolean;
    minTemp: number;
    maxTemp: number;
    tempStep: number;
}

/**
 * Comfort band for occupancy-aware temperature control
 */
export interface ComfortBand {
    minTemp: number;
    maxTemp: number;
}

/**
 * ConstraintManager Service
 * 
 * Centralizes all temperature constraint logic and validation.
 * Manages constraints for Zone 1, Zone 2, and hot water tank.
 */
export class ConstraintManager {
    private zone1: Zone1Constraints;
    private zone2: Zone2Constraints;
    private tank: TankConstraints;

    constructor(private readonly logger: HomeyLogger) {
        // Initialize with defaults from constants
        this.zone1 = {
            minTemp: COMFORT_CONSTANTS.DEFAULT_MIN_TEMP,
            maxTemp: COMFORT_CONSTANTS.DEFAULT_MAX_TEMP,
            tempStep: COMFORT_CONSTANTS.DEFAULT_TEMP_STEP,
            deadband: COMFORT_CONSTANTS.DEFAULT_DEADBAND
        };

        this.zone2 = {
            enabled: false,
            minTemp: COMFORT_CONSTANTS.DEFAULT_MIN_TEMP_ZONE2,
            maxTemp: COMFORT_CONSTANTS.DEFAULT_MAX_TEMP_ZONE2,
            tempStep: COMFORT_CONSTANTS.DEFAULT_TEMP_STEP_ZONE2
        };

        this.tank = {
            enabled: false,
            minTemp: COMFORT_CONSTANTS.DEFAULT_MIN_TANK_TEMP,
            maxTemp: COMFORT_CONSTANTS.DEFAULT_MAX_TANK_TEMP,
            tempStep: COMFORT_CONSTANTS.DEFAULT_TANK_TEMP_STEP
        };
    }

    /**
     * Set Zone 1 temperature constraints
     * @param minTemp Minimum temperature (10-30°C)
     * @param maxTemp Maximum temperature (10-30°C)
     * @param tempStep Temperature step (0.1-1°C)
     * @throws Error if validation fails
     */
    setZone1Constraints(minTemp: number, maxTemp: number, tempStep: number): void {
        const validatedMin = validateNumber(minTemp, 'minTemp', { min: 10, max: 30 });
        const validatedMax = validateNumber(maxTemp, 'maxTemp', { min: 10, max: 30 });

        if (validatedMax <= validatedMin) {
            throw new Error(`Invalid Zone 1 temperature range: maxTemp(${maxTemp}) must be greater than minTemp(${minTemp})`);
        }

        const validatedStep = validateNumber(tempStep, 'tempStep', { min: 0.1, max: 1 });

        this.zone1.minTemp = validatedMin;
        this.zone1.maxTemp = validatedMax;
        this.zone1.tempStep = validatedStep;

        this.logger.log(`Zone 1 constraints updated - Min: ${validatedMin}°C, Max: ${validatedMax}°C, Step: ${validatedStep}°C`);
    }

    /**
     * Set Zone 1 deadband
     * @param deadband Deadband value (0.1-2°C)
     */
    setZone1Deadband(deadband: number): void {
        const validated = validateNumber(deadband, 'deadband', { min: 0.1, max: 2 });
        this.zone1.deadband = validated;
        this.logger.log(`Zone 1 deadband updated - ${validated}°C`);
    }

    /**
     * Get Zone 1 constraints
     */
    getZone1Constraints(): Zone1Constraints {
        return { ...this.zone1 };
    }

    /**
     * Apply Zone 1 constraints to a target temperature
     * Clamps value to min/max and rounds to step
     */
    applyZone1Constraints(targetTemp: number): number {
        const clamped = Math.max(this.zone1.minTemp, Math.min(this.zone1.maxTemp, targetTemp));
        return Math.round(clamped / this.zone1.tempStep) * this.zone1.tempStep;
    }

    /**
     * Set Zone 2 temperature constraints
     * @param enabled Whether Zone 2 optimization is enabled
     * @param minTemp Minimum temperature (10-30°C)
     * @param maxTemp Maximum temperature (10-30°C)
     * @param tempStep Temperature step (0.1-2°C)
     * @throws Error if validation fails
     */
    setZone2Constraints(enabled: boolean, minTemp: number, maxTemp: number, tempStep: number): void {
        const validatedMin = validateNumber(minTemp, 'minTempZone2', { min: 10, max: 30 });
        const validatedMax = validateNumber(maxTemp, 'maxTempZone2', { min: 10, max: 30 });

        if (validatedMax <= validatedMin) {
            throw new Error(`Invalid Zone 2 temperature range: maxTemp(${maxTemp}) must be greater than minTemp(${minTemp})`);
        }

        const validatedStep = validateNumber(tempStep, 'tempStepZone2', { min: 0.1, max: 2 });

        this.zone2.enabled = enabled;
        this.zone2.minTemp = validatedMin;
        this.zone2.maxTemp = validatedMax;
        this.zone2.tempStep = validatedStep;

        this.logger.log(`Zone 2 constraints updated - Enabled: ${enabled}, Min: ${validatedMin}°C, Max: ${validatedMax}°C, Step: ${validatedStep}°C`);
    }

    /**
     * Get Zone 2 constraints
     */
    getZone2Constraints(): Zone2Constraints {
        return { ...this.zone2 };
    }

    /**
     * Apply Zone 2 constraints to a target temperature
     * Clamps value to min/max and rounds to step
     */
    applyZone2Constraints(targetTemp: number): number {
        const clamped = Math.max(this.zone2.minTemp, Math.min(this.zone2.maxTemp, targetTemp));
        return Math.round(clamped / this.zone2.tempStep) * this.zone2.tempStep;
    }

    /**
     * Set hot water tank temperature constraints
     * @param enabled Whether tank control is enabled
     * @param minTemp Minimum temperature (30-70°C)
     * @param maxTemp Maximum temperature (30-70°C)
     * @param tempStep Temperature step (0.5-5°C)
     * @throws Error if validation fails
     */
    setTankConstraints(enabled: boolean, minTemp: number, maxTemp: number, tempStep: number): void {
        const validatedMin = validateNumber(minTemp, 'minTankTemp', { min: 30, max: 70 });
        const validatedMax = validateNumber(maxTemp, 'maxTankTemp', { min: 30, max: 70 });

        if (validatedMax <= validatedMin) {
            throw new Error(`Invalid tank temperature range: maxTemp(${maxTemp}) must be greater than minTemp(${minTemp})`);
        }

        const validatedStep = validateNumber(tempStep, 'tankTempStep', { min: 0.5, max: 5 });

        this.tank.enabled = enabled;
        this.tank.minTemp = validatedMin;
        this.tank.maxTemp = validatedMax;
        this.tank.tempStep = validatedStep;

        this.logger.log(`Tank constraints updated - Enabled: ${enabled}, Min: ${validatedMin}°C, Max: ${validatedMax}°C, Step: ${validatedStep}°C`);
    }

    /**
     * Get hot water tank constraints
     */
    getTankConstraints(): TankConstraints {
        return { ...this.tank };
    }

    /**
     * Apply tank constraints to a target temperature
     * Clamps value to min/max and rounds to step
     */
    applyTankConstraints(targetTemp: number): number {
        const clamped = Math.max(this.tank.minTemp, Math.min(this.tank.maxTemp, targetTemp));
        return Math.round(clamped / this.tank.tempStep) * this.tank.tempStep;
    }

    /**
     * Get current comfort band based on occupancy state
     * @param occupied Whether home is occupied
     * @param settings Settings object with comfort band values
     * @returns Comfort band with min/max temperatures
     */
    getCurrentComfortBand(occupied: boolean, settings?: {
        get(key: string): unknown;
    }): ComfortBand {
        if (!settings) {
            // Fallback to Zone 1 constraints if no settings available
            return {
                minTemp: this.zone1.minTemp,
                maxTemp: this.zone1.maxTemp
            };
        }

        const toNumber = (value: unknown): number | null => {
            if (value === null || value === undefined) return null;
            const numeric = Number(value);
            return Number.isFinite(numeric) ? numeric : null;
        };

        if (occupied) {
            // Use occupied (home) comfort band - defaults match settings page HTML
            const comfortLowerOccupied = toNumber(settings.get('comfort_lower_occupied')) ?? 20.0;
            const comfortUpperOccupied = toNumber(settings.get('comfort_upper_occupied')) ?? 21.0;
            return {
                minTemp: Math.max(comfortLowerOccupied, 16),
                maxTemp: Math.min(comfortUpperOccupied, 26)
            };
        } else {
            // Use away comfort band - defaults match settings page HTML
            const comfortLowerAway = toNumber(settings.get('comfort_lower_away')) ?? 19.0;
            const comfortUpperAway = toNumber(settings.get('comfort_upper_away')) ?? 20.5;
            return {
                minTemp: Math.max(comfortLowerAway, 16),
                maxTemp: Math.min(comfortUpperAway, 26)
            };
        }
    }
}
