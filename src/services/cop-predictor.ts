import { DateTime } from 'luxon';
import type { COPPrediction, COPCalibrationPoint, COPCalibrationResult } from '../types';

/**
 * COP Predictor Service
 * Predicts heat pump COP using Carnot efficiency model
 */
export class COPPredictor {
    private homey: any;
    private logger: any;
    private carnotEfficiency: number = 0.40; // Default η, will be calibrated
    private calibrationData: COPCalibrationPoint[] = [];
    private lastCalibration?: COPCalibrationResult;

    // Storage keys
    private readonly CARNOT_EFFICIENCY_KEY = 'cop_predictor_carnot_efficiency';
    private readonly CALIBRATION_RESULT_KEY = 'cop_predictor_calibration_result';
    private readonly CALIBRATION_DATA_KEY = 'cop_predictor_calibration_data';

    // Constants
    private readonly MIN_CARNOT_EFFICIENCY = 0.25;
    private readonly MAX_CARNOT_EFFICIENCY = 0.60;
    private readonly MIN_COP = 1.0;
    private readonly MAX_COP = 6.0;
    private readonly KELVIN_OFFSET = 273.15;
    private readonly MIN_CALIBRATION_SAMPLES = 7;

    constructor(homey: any, logger: any) {
        this.homey = homey;
        this.logger = logger;
        this.loadCalibrationData();
    }

    /**
     * Predict COP based on flow temperature setpoint and outdoor temperature
     * @param flowTempSetpoint Target flow temperature in °C
     * @param outdoorTemp Current outdoor temperature in °C
     * @returns COP prediction
     */
    public predictCOP(flowTempSetpoint: number, outdoorTemp: number): COPPrediction {
        // Validate inputs
        if (!Number.isFinite(flowTempSetpoint) || !Number.isFinite(outdoorTemp)) {
            this.logger.warn(`Invalid input for COP prediction: flow=${flowTempSetpoint}, outdoor=${outdoorTemp}`);
            return this.createFallbackPrediction(flowTempSetpoint, outdoorTemp);
        }

        // Calculate temperature lift
        const temperatureLift = flowTempSetpoint - outdoorTemp;

        // Check for unrealistic conditions
        if (temperatureLift <= 0) {
            this.logger.warn(`Invalid temperature lift: ${temperatureLift}°C (flow setpoint must be > outdoor temp)`);
            return this.createFallbackPrediction(flowTempSetpoint, outdoorTemp);
        }

        if (temperatureLift < 5) {
            this.logger.warn(`Very low temperature lift: ${temperatureLift}°C - prediction may be unreliable`);
        }

        // Convert to Kelvin
        const T_sink = flowTempSetpoint + this.KELVIN_OFFSET;
        const T_source = outdoorTemp + this.KELVIN_OFFSET;

        // Calculate Carnot COP (theoretical maximum)
        const carnotCOP = T_sink / temperatureLift;

        // Calculate real-world COP using calibrated efficiency
        let predictedCOP = this.carnotEfficiency * carnotCOP;

        // Apply safety bounds
        predictedCOP = Math.max(this.MIN_COP, Math.min(this.MAX_COP, predictedCOP));

        // Calculate confidence based on calibration quality
        const confidence = this.calculatePredictionConfidence(temperatureLift);

        const prediction: COPPrediction = {
            predictedCOP,
            carnotCOP,
            carnotEfficiency: this.carnotEfficiency,
            flowTempSetpoint,
            outdoorTemp,
            temperatureLift,
            confidence,
            method: 'carnot_calibrated',
            timestamp: DateTime.now().toISO()!
        };

        this.logger.log(`COP Prediction: ${predictedCOP.toFixed(2)} (Carnot: ${carnotCOP.toFixed(2)}, η=${this.carnotEfficiency.toFixed(3)}, lift=${temperatureLift}°C, confidence=${(confidence * 100).toFixed(0)}%)`);

        return prediction;
    }

    /**
     * Add a calibration data point
     * @param flowSetpoint Flow temperature setpoint in °C
     * @param outdoorTemp Outdoor temperature in °C
     * @param actualCOP Actual measured COP
     */
    public addCalibrationPoint(flowSetpoint: number, outdoorTemp: number, actualCOP: number): void {
        if (!Number.isFinite(flowSetpoint) || !Number.isFinite(outdoorTemp) || !Number.isFinite(actualCOP)) {
            this.logger.warn(`Invalid calibration point: flow = ${flowSetpoint}, outdoor = ${outdoorTemp}, COP = ${actualCOP} `);
            return;
        }

        if (actualCOP < this.MIN_COP || actualCOP > this.MAX_COP) {
            this.logger.warn(`Unrealistic COP value: ${actualCOP} - skipping calibration point`);
            return;
        }

        const point: COPCalibrationPoint = {
            flowSetpoint,
            outdoorTemp,
            actualCOP,
            timestamp: DateTime.now().toISO()!
        };

        this.calibrationData.push(point);

        // Keep only last 30 days of data
        const thirtyDaysAgo = DateTime.now().minus({ days: 30 });
        this.calibrationData = this.calibrationData.filter(p =>
            DateTime.fromISO(p.timestamp) > thirtyDaysAgo
        );

        this.saveCalibrationData();
        this.logger.log(`Added COP calibration point: flow = ${flowSetpoint}°C, outdoor = ${outdoorTemp}°C, COP = ${actualCOP.toFixed(2)} (${this.calibrationData.length} points)`);
    }

    /**
     * Calibrate Carnot efficiency using historical data
     * @returns Calibration result
     */
    public calibrate(): COPCalibrationResult | null {
        if (this.calibrationData.length < this.MIN_CALIBRATION_SAMPLES) {
            this.logger.log(`Insufficient calibration data: ${this.calibrationData.length}/${this.MIN_CALIBRATION_SAMPLES} points`);
            return null;
        }

        const efficiencies: number[] = [];
        const errors: number[] = [];

        // Calculate efficiency for each data point
        for (const point of this.calibrationData) {
            const temperatureLift = point.flowSetpoint - point.outdoorTemp;

            if (temperatureLift <= 0) {
                continue; // Skip invalid data
            }

            const T_sink = point.flowSetpoint + this.KELVIN_OFFSET;
            const carnotCOP = T_sink / temperatureLift;

            // Back-calculate what efficiency would give the actual COP
            const efficiency = point.actualCOP / carnotCOP;

            // Filter outliers (efficiency should be reasonable)
            if (efficiency >= this.MIN_CARNOT_EFFICIENCY && efficiency <= this.MAX_CARNOT_EFFICIENCY) {
                efficiencies.push(efficiency);

                // Calculate prediction error for this point
                const predictedCOP = efficiency * carnotCOP;
                const error = Math.abs((predictedCOP - point.actualCOP) / point.actualCOP) * 100;
                errors.push(error);
            }
        }

        if (efficiencies.length === 0) {
            this.logger.warn('No valid efficiency calculations - calibration failed');
            return null;
        }

        // Calculate average efficiency
        const avgEfficiency = efficiencies.reduce((a, b) => a + b, 0) / efficiencies.length;

        // Clamp to realistic range
        const calibratedEfficiency = Math.max(
            this.MIN_CARNOT_EFFICIENCY,
            Math.min(this.MAX_CARNOT_EFFICIENCY, avgEfficiency)
        );

        // Calculate average error
        const avgError = errors.length > 0
            ? errors.reduce((a, b) => a + b, 0) / errors.length
            : 0;

        // Calculate confidence (better with more samples, lower error)
        const sampleConfidence = Math.min(1.0, efficiencies.length / 30); // Max confidence at 30 samples
        const errorConfidence = Math.max(0, 1.0 - (avgError / 100)); // Lower error = higher confidence
        const confidence = (sampleConfidence + errorConfidence) / 2;

        const result: COPCalibrationResult = {
            carnotEfficiency: calibratedEfficiency,
            sampleCount: efficiencies.length,
            averageError: avgError,
            lastCalibration: DateTime.now().toISO()!,
            confidence
        };

        // Update the current efficiency
        this.carnotEfficiency = calibratedEfficiency;
        this.lastCalibration = result;

        // Save to settings
        this.saveCalibrationResult();

        this.logger.log(`COP Predictor calibrated: η=${calibratedEfficiency.toFixed(3)} (${efficiencies.length} samples, ${avgError.toFixed(1)}% error, ${(confidence * 100).toFixed(0)}% confidence)`);

        return result;
    }

    /**
     * Get calibration status
     */
    public getCalibrationStatus(): COPCalibrationResult | null {
        return this.lastCalibration || null;
    }

    /**
     * Get number of calibration data points
     */
    public getCalibrationDataCount(): number {
        return this.calibrationData.length;
    }

    /**
     * Calculate prediction confidence based on calibration quality and conditions
     */
    private calculatePredictionConfidence(temperatureLift: number): number {
        let confidence = 1.0;

        // Reduce confidence if calibration is weak
        if (this.lastCalibration) {
            confidence *= this.lastCalibration.confidence;
        } else {
            confidence *= 0.5; // No calibration = 50% confidence
        }

        // Reduce confidence for extreme temperature lifts
        if (temperatureLift > 40) {
            confidence *= 0.8; // High lift less reliable
        } else if (temperatureLift < 10) {
            confidence *= 0.7; // Very low lift less reliable
        }

        return Math.max(0, Math.min(1.0, confidence));
    }

    /**
     * Create fallback prediction when calculation fails
     */
    private createFallbackPrediction(flowTempSetpoint: number, outdoorTemp: number): COPPrediction {
        return {
            predictedCOP: 2.5, // Conservative fallback
            carnotCOP: 0,
            carnotEfficiency: this.carnotEfficiency,
            flowTempSetpoint,
            outdoorTemp,
            temperatureLift: flowTempSetpoint - outdoorTemp,
            confidence: 0.3, // Low confidence for fallback
            method: 'historical_fallback',
            timestamp: DateTime.now().toISO()!
        };
    }

    /**
     * Load calibration data from settings
     */
    private loadCalibrationData(): void {
        try {
            // Load Carnot efficiency
            const savedEfficiency = this.homey.settings.get(this.CARNOT_EFFICIENCY_KEY);
            if (typeof savedEfficiency === 'number') {
                this.carnotEfficiency = savedEfficiency;
                this.logger.log(`Loaded Carnot efficiency: ${this.carnotEfficiency.toFixed(3)}`);
            }

            // Load calibration result
            const savedResult = this.homey.settings.get(this.CALIBRATION_RESULT_KEY);
            if (savedResult) {
                this.lastCalibration = savedResult;
                this.logger.log(`Loaded calibration result: ${savedResult.sampleCount} samples, ${savedResult.averageError.toFixed(1)}% error`);
            }

            // Load calibration data points
            const savedData = this.homey.settings.get(this.CALIBRATION_DATA_KEY);
            if (Array.isArray(savedData)) {
                this.calibrationData = savedData;
                this.logger.log(`Loaded ${this.calibrationData.length} calibration data points`);
            }
        } catch (error) {
            this.logger.error(`Failed to load calibration data: ${error}`);
        }
    }

    /**
     * Save calibration data to settings
     */
    private saveCalibrationData(): void {
        try {
            this.homey.settings.set(this.CALIBRATION_DATA_KEY, this.calibrationData);
        } catch (error) {
            this.logger.error(`Failed to save calibration data: ${error}`);
        }
    }

    /**
     * Save calibration result to settings
     */
    private saveCalibrationResult(): void {
        try {
            this.homey.settings.set(this.CARNOT_EFFICIENCY_KEY, this.carnotEfficiency);
            this.homey.settings.set(this.CALIBRATION_RESULT_KEY, this.lastCalibration);
        } catch (error) {
            this.logger.error(`Failed to save calibration result: ${error}`);
        }
    }
}
