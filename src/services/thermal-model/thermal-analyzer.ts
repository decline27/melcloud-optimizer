/**
 * Thermal Model Analyzer
 *
 * This service analyzes collected thermal data to build a model of the home's
 * thermal characteristics and make predictions about heating behavior.
 */

import { DateTime } from 'luxon';
import { ThermalDataPoint } from './data-collector';

export interface ThermalCharacteristics {
  // How quickly the home heats up (°C per hour per °C difference)
  heatingRate: number;

  // How quickly the home cools down (°C per hour per °C difference)
  coolingRate: number;

  // Impact of outdoor temperature on indoor temperature (°C change per °C outdoor change)
  outdoorTempImpact: number;

  // Impact of wind on heat loss (additional °C loss per m/s wind speed)
  windImpact: number;

  // Thermal mass indicator (0-1, higher means more stable temperature)
  thermalMass: number;

  // Confidence in the model (0-1)
  modelConfidence: number;

  // Last updated timestamp
  lastUpdated: string;

  /**
   * Curve/Flow mode only: net room warming (°C/h) while heating runs, by outdoor temperature.
   * In those modes the weather curve, not the setpoint, sets heating power, so "how fast does the
   * house warm when the curve runs at X °C outside" is the meaningful heating characteristic.
   * Rebuilt from the stored data at each update; bounded by the outdoor range (2 °C bins).
   */
  curveWarming?: CurveWarmingBin[];
}

export interface CurveWarmingBin {
  /** Bin centre, °C outdoor. */
  outdoorC: number;
  /** Mean net room warming while heating ran, °C per hour. Can be ≤ 0 (curve only holding). */
  ratePerHour: number;
  /** Heating-on stretches behind the mean. */
  samples: number;
}

export interface HeatingPrediction {
  // Predicted indoor temperature after the specified time
  predictedTemperature: number;

  // Time required to reach target temperature (in minutes)
  timeToTarget: number;

  // Estimated energy usage to reach target (if available)
  estimatedEnergy?: number;

  // Confidence in the prediction (0-1)
  confidence: number;
}

// Settings key for thermal characteristics storage
const THERMAL_CHARACTERISTICS_SETTINGS_KEY = 'thermal_model_characteristics';

/**
 * Shortest heating-off stretch used for a cooling-rate sample. MELCloud reports room temperature
 * in 0.5 °C steps, so over a single hour most real cooling reads as "no change"; a pairwise
 * method then keeps only the pairs that happened to tick down, which overstates the rate.
 */
const MIN_COOLING_STRETCH_HOURS = 2;

/** Points further apart than this break a stretch (a missed run means unknown heating state). */
const MAX_STRETCH_GAP_HOURS = 1.5;

const CURVE_WARMING_BIN_C = 2;
/** A prediction looks this far either side of the requested outdoor temperature. */
const CURVE_WARMING_MATCH_C = 2;
/** Stretches needed near an outdoor temperature before predicting at it. */
const CURVE_WARMING_MIN_SAMPLES = 2;

const hoursBetween = (a: ThermalDataPoint, b: ThermalDataPoint) =>
  (DateTime.fromISO(b.timestamp).toMillis() - DateTime.fromISO(a.timestamp).toMillis()) / 3600000;

/**
 * Contiguous stretches of at least MIN_COOLING_STRETCH_HOURS whose points all satisfy
 * `eligible`. MELCloud reports room temperature in 0.5 °C steps, so a single hour mostly reads as
 * "no change"; measuring over whole stretches keeps that quantisation from biasing rates.
 */
function stretchesWhere(sortedData: ThermalDataPoint[], eligible: (p: ThermalDataPoint) => boolean): ThermalDataPoint[][] {
  const result: ThermalDataPoint[][] = [];
  const flush = (stretch: ThermalDataPoint[]) => {
    if (stretch.length >= 2 && hoursBetween(stretch[0], stretch[stretch.length - 1]) >= MIN_COOLING_STRETCH_HOURS) {
      result.push(stretch);
    }
  };

  let stretch: ThermalDataPoint[] = [];
  for (const point of sortedData) {
    const ok = eligible(point);
    const contiguous = stretch.length === 0 || hoursBetween(stretch[stretch.length - 1], point) <= MAX_STRETCH_GAP_HOURS;
    if (ok && contiguous) {
      stretch.push(point);
      continue;
    }
    flush(stretch);
    stretch = ok ? [point] : [];
  }
  flush(stretch);
  return result;
}

/**
 * Cooling rates (h⁻¹ per °C of indoor-outdoor difference) from whole heating-off stretches of
 * non-Room-mode points. A stretch that warmed (sun, cooking) is skipped: it measures free gains,
 * not heat loss. A stretch with no measurable drop counts as zero rather than being dropped, so
 * sensor quantisation does not bias the rate upwards.
 */
export function coolingRatesFromStretches(sortedData: ThermalDataPoint[]): number[] {
  const rates: number[] = [];
  for (const stretch of stretchesWhere(sortedData, p => p.roomTargetMode === false && !p.heatingActive)) {
    const first = stretch[0];
    const last = stretch[stretch.length - 1];
    const drop = first.indoorTemperature - last.indoorTemperature;
    if (drop < 0) continue;
    const meanGradient = stretch.reduce((sum, p) => sum + (p.indoorTemperature - p.outdoorTemperature), 0) / stretch.length;
    if (meanGradient <= 0) continue;
    const rate = (drop / hoursBetween(first, last)) / meanGradient;
    if (Number.isFinite(rate)) rates.push(rate);
  }
  return rates;
}

/**
 * Curve/Flow mode: net room warming (°C/h) while heating ran, from whole heating-on stretches,
 * binned by the stretch's mean outdoor temperature. Flat and falling stretches are kept: "the
 * curve only just holds the room at 3 °C" is exactly what a preheat decision needs to know.
 */
export function curveWarmingFromStretches(sortedData: ThermalDataPoint[]): CurveWarmingBin[] {
  const bins = new Map<number, { sum: number; samples: number }>();
  for (const stretch of stretchesWhere(sortedData, p => p.roomTargetMode === false && p.heatingActive)) {
    const first = stretch[0];
    const last = stretch[stretch.length - 1];
    const rate = (last.indoorTemperature - first.indoorTemperature) / hoursBetween(first, last);
    if (!Number.isFinite(rate)) continue;
    const meanOutdoor = stretch.reduce((sum, p) => sum + p.outdoorTemperature, 0) / stretch.length;
    const centre = Math.round(meanOutdoor / CURVE_WARMING_BIN_C) * CURVE_WARMING_BIN_C;
    const bin = bins.get(centre) ?? { sum: 0, samples: 0 };
    bins.set(centre, { sum: bin.sum + rate, samples: bin.samples + 1 });
  }
  return [...bins.entries()]
    .sort(([a], [b]) => a - b)
    .map(([outdoorC, { sum, samples }]) => ({ outdoorC, ratePerHour: sum / samples, samples }));
}

/**
 * Predicted net warming (°C/h) when the curve runs at `outdoorC`, from bins within
 * CURVE_WARMING_MATCH_C, weighted by their sample counts. Null when there is not enough data near
 * that temperature: the caller must then fall back to its own behaviour rather than guess.
 */
export function predictCurveWarming(bins: CurveWarmingBin[] | undefined, outdoorC: number): number | null {
  if (!bins || bins.length === 0 || !Number.isFinite(outdoorC)) return null;
  const near = bins.filter(b => Math.abs(b.outdoorC - outdoorC) <= CURVE_WARMING_MATCH_C);
  const samples = near.reduce((sum, b) => sum + b.samples, 0);
  if (samples < CURVE_WARMING_MIN_SAMPLES) return null;
  return near.reduce((sum, b) => sum + b.ratePerHour * b.samples, 0) / samples;
}

export class ThermalAnalyzer {
  private thermalCharacteristics!: ThermalCharacteristics; // Using definite assignment assertion
  private minimumDataPointsRequired: number = 24; // Require at least 24 data points for initial model

  constructor(private homey: any) {
    // Try to load saved characteristics from settings
    const savedCharacteristics = this.homey.settings.get(THERMAL_CHARACTERISTICS_SETTINGS_KEY);

    if (savedCharacteristics) {
      try {
        this.thermalCharacteristics = JSON.parse(savedCharacteristics);
        this.homey.log('Loaded thermal characteristics from settings:', this.thermalCharacteristics);
      } catch (error) {
        this.homey.error('Error parsing saved thermal characteristics, using defaults:', error);
        this.initializeDefaultCharacteristics();
      }
    } else {
      this.homey.log('No saved thermal characteristics found, using defaults');
      this.initializeDefaultCharacteristics();
    }
  }

  /**
   * Initialize default thermal characteristics
   */
  private initializeDefaultCharacteristics(): void {
    this.thermalCharacteristics = {
      heatingRate: 0.5,        // Default: 0.5°C per hour per °C difference
      coolingRate: 0.2,        // Default: 0.2°C per hour per °C difference
      outdoorTempImpact: 0.1,  // Default: 0.1°C indoor change per 1°C outdoor change
      windImpact: 0.05,        // Default: 0.05°C additional loss per m/s wind
      thermalMass: 0.7,        // Default: medium-high thermal mass
      modelConfidence: 0,      // Start with zero confidence
      lastUpdated: DateTime.now().toISO()
    };
  }

  /**
   * Reset the learned thermal characteristics back to defaults with zero confidence.
   *
   * Needed when the model was trained on data that cannot represent room dynamics — most
   * notably a device in Flow/Curve mode, where the zone setpoint is not a room target and the
   * heating-rate regression collects samples of the room drifting for unrelated reasons. Such a
   * model reports high confidence while holding a physically impossible negative heating rate,
   * and there is no path for it to recover on its own once the bad data stops arriving.
   */
  public resetCharacteristics(): ThermalCharacteristics {
    this.initializeDefaultCharacteristics();
    try {
      this.homey.settings.set(THERMAL_CHARACTERISTICS_SETTINGS_KEY, JSON.stringify(this.thermalCharacteristics));
    } catch (error) {
      this.homey.error('Error persisting reset thermal characteristics:', error);
    }
    this.homey.log('Thermal characteristics reset to defaults with zero confidence');
    return { ...this.thermalCharacteristics };
  }

  /**
   * Update the thermal model based on collected data
   */
  public updateModel(dataPoints: ThermalDataPoint[]): ThermalCharacteristics {
    if (dataPoints.length < this.minimumDataPointsRequired) {
      this.homey.log(`Not enough data points to update thermal model. Have ${dataPoints.length}, need ${this.minimumDataPointsRequired}`);
      return this.thermalCharacteristics;
    }

    this.homey.log(`Updating thermal model with ${dataPoints.length} data points`);

    // Sort data points by timestamp
    const sortedData = [...dataPoints].sort((a, b) =>
      DateTime.fromISO(a.timestamp).toMillis() - DateTime.fromISO(b.timestamp).toMillis()
    );

    // Calculate heating and cooling rates
    const heatingRates: number[] = [];
    const coolingRates: number[] = [];
    const outdoorImpacts: number[] = [];
    const windImpacts: number[] = [];

    for (let i = 1; i < sortedData.length; i++) {
      const current = sortedData[i];
      const previous = sortedData[i - 1];

      // Calculate time difference in hours
      const timeDiff = (DateTime.fromISO(current.timestamp).toMillis() -
        DateTime.fromISO(previous.timestamp).toMillis()) / (1000 * 60 * 60);

      if (timeDiff < 0.1) continue; // Skip if less than 6 minutes apart

      // Temperature change
      const tempChange = current.indoorTemperature - previous.indoorTemperature;

      // Outdoor temperature difference
      const outdoorTempDiff = current.outdoorTemperature - previous.outdoorTemperature;

      // Target-indoor temperature difference
      const targetDiff = previous.targetTemperature - previous.indoorTemperature;

      // Calculate rates. Pairwise rates are only taken from Room-mode points; Curve/Flow points
      // contribute cooling from whole heating-off stretches below (see coolingRatesFromStretches).
      if (previous.roomTargetMode === false) {
        // fall through to the outdoor/wind impact terms only
      } else if (previous.heatingActive && targetDiff > 0) {
        // Heating rate calculation
        const rate = (tempChange / timeDiff) / targetDiff;
        if (!isNaN(rate) && isFinite(rate)) {
          heatingRates.push(rate);
        }
      } else if (!previous.heatingActive && tempChange < 0) {
        // Cooling rate calculation
        const indoorOutdoorDiff = previous.indoorTemperature - previous.outdoorTemperature;
        if (indoorOutdoorDiff > 0) {
          const rate = (Math.abs(tempChange) / timeDiff) / indoorOutdoorDiff;
          if (!isNaN(rate) && isFinite(rate)) {
            coolingRates.push(rate);
          }
        }
      }

      // Calculate outdoor temperature impact
      if (Math.abs(outdoorTempDiff) > 0.5) {
        const impact = tempChange / outdoorTempDiff;
        if (!isNaN(impact) && isFinite(impact)) {
          outdoorImpacts.push(impact);
        }
      }

      // Calculate wind impact
      if (previous.weatherConditions && previous.weatherConditions.windSpeed > 2) {
        const expectedCooling = this.thermalCharacteristics.coolingRate *
          (previous.indoorTemperature - previous.outdoorTemperature) *
          timeDiff;
        const actualCooling = Math.max(0, -tempChange);
        const extraCooling = actualCooling - expectedCooling;

        if (extraCooling > 0) {
          const windImpact = extraCooling / previous.weatherConditions.windSpeed;
          if (!isNaN(windImpact) && isFinite(windImpact)) {
            windImpacts.push(windImpact);
          }
        }
      }
    }

    coolingRates.push(...coolingRatesFromStretches(sortedData));

    // Rebuilt from all stored points each update (not accumulated), so a stretch is never
    // counted twice. Left untouched when there is no Curve/Flow data, e.g. a Room-mode house.
    const curveWarming = curveWarmingFromStretches(sortedData);
    if (curveWarming.length > 0) {
      this.thermalCharacteristics.curveWarming = curveWarming;
    }

    // Update the model with new calculated values
    // Adaptive blend factor: increases with confidence to reduce anchor bias
    // At low confidence (0): 60% new, 40% old (stable but allows learning)
    // At high confidence (1): 95% new, 5% old (trusts measured data)
    const adaptiveBlendFactor = Math.min(0.95, 0.6 + (this.thermalCharacteristics.modelConfidence * 0.35));

    if (heatingRates.length > 0) {
      const avgHeatingRate = heatingRates.reduce((sum, rate) => sum + rate, 0) / heatingRates.length;
      this.thermalCharacteristics.heatingRate = adaptiveBlendFactor * avgHeatingRate + (1 - adaptiveBlendFactor) * this.thermalCharacteristics.heatingRate;
    }

    if (coolingRates.length > 0) {
      const avgCoolingRate = coolingRates.reduce((sum, rate) => sum + rate, 0) / coolingRates.length;
      this.thermalCharacteristics.coolingRate = adaptiveBlendFactor * avgCoolingRate + (1 - adaptiveBlendFactor) * this.thermalCharacteristics.coolingRate;
    }

    if (outdoorImpacts.length > 0) {
      const avgOutdoorImpact = outdoorImpacts.reduce((sum, impact) => sum + impact, 0) / outdoorImpacts.length;
      this.thermalCharacteristics.outdoorTempImpact = adaptiveBlendFactor * avgOutdoorImpact + (1 - adaptiveBlendFactor) * this.thermalCharacteristics.outdoorTempImpact;
    }

    if (windImpacts.length > 0) {
      const avgWindImpact = windImpacts.reduce((sum, impact) => sum + impact, 0) / windImpacts.length;
      this.thermalCharacteristics.windImpact = adaptiveBlendFactor * avgWindImpact + (1 - adaptiveBlendFactor) * this.thermalCharacteristics.windImpact;
    }

    // Calculate thermal mass based on temperature stability
    const tempVariations: number[] = [];
    for (let i = 1; i < sortedData.length; i++) {
      const tempChange = Math.abs(sortedData[i].indoorTemperature - sortedData[i - 1].indoorTemperature);
      const timeDiff = (DateTime.fromISO(sortedData[i].timestamp).toMillis() -
        DateTime.fromISO(sortedData[i - 1].timestamp).toMillis()) / (1000 * 60 * 60);

      if (timeDiff > 0) {
        tempVariations.push(tempChange / timeDiff);
      }
    }

    if (tempVariations.length > 0) {
      const avgVariation = tempVariations.reduce((sum, var_) => sum + var_, 0) / tempVariations.length;
      // Convert to thermal mass indicator (0-1)
      // Lower variation = higher thermal mass
      const newThermalMass = Math.max(0, Math.min(1, 1 - (avgVariation / 0.5)));
      this.thermalCharacteristics.thermalMass = adaptiveBlendFactor * newThermalMass + (1 - adaptiveBlendFactor) * this.thermalCharacteristics.thermalMass;
    }

    // Update confidence based on amount of data
    const maxConfidencePoints = 168; // 1 week of hourly data
    this.thermalCharacteristics.modelConfidence = Math.min(1, dataPoints.length / maxConfidencePoints);

    // Update timestamp
    this.thermalCharacteristics.lastUpdated = DateTime.now().toISO();

    // Save updated characteristics to settings for persistence across app reinstalls
    try {
      this.homey.settings.set(THERMAL_CHARACTERISTICS_SETTINGS_KEY, JSON.stringify(this.thermalCharacteristics));
      this.homey.log('Saved thermal characteristics to settings storage');
    } catch (error) {
      this.homey.error('Error saving thermal characteristics to settings:', error);
    }

    this.homey.log('Thermal model updated:', this.thermalCharacteristics);

    return this.thermalCharacteristics;
  }

  /**
   * Predict future indoor temperature
   * @param currentTemp Current indoor temperature
   * @param targetTemp Target temperature
   * @param outdoorTemp Current outdoor temperature
   * @param heatingActive Whether heating is currently active
   * @param weatherConditions Current weather conditions
   * @param minutes Minutes into the future to predict
   */
  public predictTemperature(
    currentTemp: number,
    targetTemp: number,
    outdoorTemp: number,
    heatingActive: boolean,
    weatherConditions: { windSpeed: number; humidity: number; cloudCover: number },
    minutes: number
  ): number {
    const hours = minutes / 60;
    let predictedTemp = currentTemp;

    if (heatingActive && targetTemp > currentTemp) {
      // Heating scenario
      const tempDiff = targetTemp - currentTemp;
      const heatingEffect = this.thermalCharacteristics.heatingRate * tempDiff * hours;
      predictedTemp += heatingEffect;
    } else {
      // Cooling scenario
      const tempDiff = currentTemp - outdoorTemp;
      const baseCooling = this.thermalCharacteristics.coolingRate * tempDiff * hours;

      // Additional cooling from wind
      const windCooling = this.thermalCharacteristics.windImpact * weatherConditions.windSpeed * hours;

      predictedTemp -= (baseCooling + windCooling);
    }

    // Account for outdoor temperature changes
    const outdoorEffect = this.thermalCharacteristics.outdoorTempImpact * (outdoorTemp - currentTemp) * hours;
    predictedTemp += outdoorEffect;

    return predictedTemp;
  }

  /**
   * Calculate time needed to reach target temperature
   */
  public calculateTimeToTarget(
    currentTemp: number,
    targetTemp: number,
    outdoorTemp: number,
    weatherConditions: { windSpeed: number; humidity: number; cloudCover: number }
  ): HeatingPrediction {
    if (Math.abs(currentTemp - targetTemp) < 0.1) {
      return {
        predictedTemperature: currentTemp,
        timeToTarget: 0,
        confidence: 1
      };
    }

    const isHeating = targetTemp > currentTemp;
    const tempDiff = Math.abs(targetTemp - currentTemp);

    if (isHeating) {
      const effectiveHeatingRate = Math.max(this.thermalCharacteristics.heatingRate, 0.01); // °C per hour
      const hoursToTarget = tempDiff / effectiveHeatingRate;
      const minutesToTarget = Math.ceil(hoursToTarget * 60);

      return {
        predictedTemperature: targetTemp,
        timeToTarget: minutesToTarget,
        confidence: this.thermalCharacteristics.modelConfidence
      };
    }

    if (outdoorTemp >= targetTemp) {
      return {
        predictedTemperature: outdoorTemp,
        timeToTarget: Infinity,
        confidence: this.thermalCharacteristics.modelConfidence
      };
    }

    const baseCoolingRate = Math.max(this.thermalCharacteristics.coolingRate, 0.005);
    const windAssistedRate = Math.max(this.thermalCharacteristics.windImpact * weatherConditions.windSpeed, 0);
    const effectiveCoolingRate = baseCoolingRate + windAssistedRate;
    const hoursToCool = tempDiff / effectiveCoolingRate;
    const minutesToCool = Math.ceil(hoursToCool * 60);

    return {
      predictedTemperature: targetTemp,
      timeToTarget: minutesToCool,
      confidence: this.thermalCharacteristics.modelConfidence
    };
  }

  /**
   * Get the current thermal characteristics
   */
  public getThermalCharacteristics(): ThermalCharacteristics {
    return this.thermalCharacteristics;
  }
}
