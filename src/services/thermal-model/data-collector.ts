/**
 * Thermal Model Data Collector
 *
 * This service collects and stores thermal data from the MELCloud device
 * to build a learning model of the home's thermal characteristics.
 *
 * Data is stored in Homey's settings storage, which persists across app updates and reinstallations.
 * Implements data retention policies and memory management to prevent memory leaks.
 */

import { DateTime } from 'luxon';
import * as path from 'path';

// Settings key for thermal data storage
const THERMAL_DATA_SETTINGS_KEY = 'thermal_model_data';
// Settings key for aggregated historical data
const AGGREGATED_DATA_SETTINGS_KEY = 'thermal_model_aggregated_data';
// Default retention settings (overridden by Homey settings)
const DEFAULT_RETENTION_DAYS = 60;
const MIN_RETENTION_DAYS = 14;
const MAX_RETENTION_DAYS = 365;

const DEFAULT_FULL_RES_DAYS = 14;
const MIN_FULL_RES_DAYS = 3;

const DEFAULT_MAX_POINTS = 10000;
const MIN_MAX_POINTS = 2000;
const MAX_MAX_POINTS = 20000;

const DEFAULT_TARGET_KB = 500;
const MIN_TARGET_KB = 300;
const MAX_TARGET_KB = 900;

const MIN_FULL_RES_POINTS = 100;
const LOW_RES_BOUNDARY_DAYS = 30;

// Maximum size of data to store in settings (bytes) - hard safety limit
const MAX_SETTINGS_DATA_SIZE = 500000; // ~500KB

type AggregationBucket = 'hour' | 'day' | '2day';

interface RetentionConfig {
  retentionDays: number;
  fullResDays: number;
  maxPoints: number;
  targetKB: number;
}

export interface ThermalDataPoint {
  timestamp: string;
  indoorTemperature: number;
  outdoorTemperature: number;
  targetTemperature: number;
  heatingActive: boolean;
  weatherConditions?: {
    windSpeed: number;
    humidity: number;
    cloudCover: number;
    precipitation: number;
  };
  energyUsage?: number; // Optional if available from MELCloud
}

export interface AggregatedDataPoint {
  date: string; // bucket start timestamp (ISO string for hourly, ISO date for daily)
  bucket: AggregationBucket;
  bucketSpanHours?: number;
  avgIndoorTemp: number;
  avgOutdoorTemp: number;
  avgTargetTemp: number;
  heatingHours: number;
  avgWindSpeed: number;
  avgHumidity: number;
  totalEnergyUsage?: number;
  dataPointCount: number;
}

export class ThermalDataCollector {
  private dataPoints: ThermalDataPoint[] = [];
  private aggregatedData: AggregatedDataPoint[] = [];
  private maxDataPoints: number = DEFAULT_MAX_POINTS;
  private initialized: boolean = false;
  private lastMemoryCheck: number = 0;
  private memoryWarningIssued: boolean = false;

  constructor(private homey: any) {
    const userDataPath = (homey?.env && typeof homey.env.userDataPath === 'string' && homey.env.userDataPath.trim().length > 0)
      ? homey.env.userDataPath
      : path.join(process.cwd(), '.homey-data');

    if (!homey?.env) {
      homey.env = {};
    }
    if (!homey.env.userDataPath) {
      homey.env.userDataPath = userDataPath;
    }
    this.loadStoredData();
  }

  private normalizeAggregatedEntry(entry: any): AggregatedDataPoint {
    if (!entry || typeof entry !== 'object') {
      const now = DateTime.now();
      return {
        date: now.toISO(),
        bucket: 'day',
        bucketSpanHours: 24,
        avgIndoorTemp: 0,
        avgOutdoorTemp: 0,
        avgTargetTemp: 0,
        heatingHours: 0,
        avgWindSpeed: 0,
        avgHumidity: 0,
        totalEnergyUsage: undefined,
        dataPointCount: 0
      };
    }

    const dateValue = typeof entry.date === 'string' && entry.date.trim().length > 0
      ? entry.date
      : DateTime.now().toISO();

    let bucket: AggregationBucket;
    switch (entry.bucket) {
      case 'hour':
      case 'day':
      case '2day':
        bucket = entry.bucket;
        break;
      default:
        bucket = 'day';
    }

    let bucketSpanHours: number | undefined = undefined;
    if (typeof entry.bucketSpanHours === 'number' && !isNaN(entry.bucketSpanHours) && entry.bucketSpanHours > 0) {
      bucketSpanHours = entry.bucketSpanHours;
    } else {
      bucketSpanHours = bucket === 'hour'
        ? 1
        : bucket === '2day'
          ? 48
          : 24;
    }

    return {
      date: dateValue,
      bucket,
      bucketSpanHours,
      avgIndoorTemp: Number(entry.avgIndoorTemp) || 0,
      avgOutdoorTemp: Number(entry.avgOutdoorTemp) || 0,
      avgTargetTemp: Number(entry.avgTargetTemp) || 0,
      heatingHours: Number(entry.heatingHours) || 0,
      avgWindSpeed: Number(entry.avgWindSpeed) || 0,
      avgHumidity: Number(entry.avgHumidity) || 0,
      totalEnergyUsage: typeof entry.totalEnergyUsage === 'number' ? entry.totalEnergyUsage : undefined,
      dataPointCount: Number(entry.dataPointCount) || 0
    };
  }

  private applyRetentionPolicy(trigger: string): void {
    const config = this.getRetentionConfig();
    this.maxDataPoints = config.maxPoints;

    const summary = this.rebalanceTiers(config);
    this.enforceCapsByAggregationAndTrim(config, trigger, summary);
  }

  private rebalanceTiers(config: RetentionConfig): {
    promotedToFullRes: number;
    aggregatedMid: number;
    aggregatedLow: number;
    droppedRaw: number;
  } {
    const now = DateTime.now();
    const retentionCutoff = now.minus({ days: config.retentionDays });
    const fullResCutoff = now.minus({ days: config.fullResDays });
    const lowResBoundaryCutoff = now.minus({ days: Math.min(LOW_RES_BOUNDARY_DAYS, config.retentionDays) });

    const newFullRes: ThermalDataPoint[] = [];
    const midCandidates: ThermalDataPoint[] = [];
    const lowCandidates: ThermalDataPoint[] = [];
    let droppedRaw = 0;

    for (const point of this.dataPoints) {
      const pointDate = DateTime.fromISO(point.timestamp);
      if (!pointDate.isValid) {
        continue;
      }

      if (pointDate < retentionCutoff) {
        droppedRaw += 1;
        continue;
      }

      if (pointDate >= fullResCutoff) {
        newFullRes.push(point);
        continue;
      }

      if (pointDate >= lowResBoundaryCutoff) {
        midCandidates.push(point);
      } else {
        lowCandidates.push(point);
      }
    }

    const olderForPromotion = [...midCandidates, ...lowCandidates].sort((a, b) => {
      return DateTime.fromISO(b.timestamp).toMillis() - DateTime.fromISO(a.timestamp).toMillis();
    });

    const promotedSet = new Set<ThermalDataPoint>();
    while ((newFullRes.length + promotedSet.size) < MIN_FULL_RES_POINTS && olderForPromotion.length > 0) {
      const promote = olderForPromotion.shift();
      if (promote) {
        promotedSet.add(promote);
      }
    }

    const promotedToFullRes = promotedSet.size;

    const finalFullRes = [...newFullRes, ...promotedSet].sort((a, b) => {
      return DateTime.fromISO(a.timestamp).toMillis() - DateTime.fromISO(b.timestamp).toMillis();
    });

    const promotedFilter = (point: ThermalDataPoint) => !promotedSet.has(point);
    const filteredMidCandidates = midCandidates.filter(promotedFilter);
    const filteredLowCandidates = lowCandidates.filter(promotedFilter);

    const midAggregates = filteredMidCandidates.length > 0
      ? this.aggregateThermalPoints(filteredMidCandidates, 'hour', { hoursPerBucket: 1 })
      : [];

    if (midAggregates.length > 0) {
      const midRangeEnd = Math.min(LOW_RES_BOUNDARY_DAYS, config.retentionDays);
      this.homey.log(`ThermalRetention: applied hourly aggregation for ${config.fullResDays + 1}–${midRangeEnd} d (${midAggregates.length} buckets)`);
    }

    const lowAggregates = filteredLowCandidates.length > 0
      ? this.aggregateThermalPoints(filteredLowCandidates, 'day')
      : [];

    if (lowAggregates.length > 0) {
      this.homey.log(`ThermalRetention: applied daily aggregation for ${Math.max(config.fullResDays + 1, LOW_RES_BOUNDARY_DAYS + 1)}–${config.retentionDays} d (${lowAggregates.length} buckets)`);
    }

    this.dataPoints = finalFullRes;

    this.aggregatedData = this.aggregatedData.filter(aggregate => {
      const start = this.parseAggregatedStart(aggregate);
      if (!start || !start.isValid) {
        return false;
      }

      if (start < retentionCutoff) {
        return false;
      }

      if (start >= fullResCutoff) {
        return false;
      }

      return true;
    });

    this.mergeAggregatedPoints([...midAggregates, ...lowAggregates]);

    return {
      promotedToFullRes,
      aggregatedMid: midAggregates.length,
      aggregatedLow: lowAggregates.length,
      droppedRaw
    };
  }

  private mergeAggregatedPoints(points: AggregatedDataPoint[]): void {
    if (!points || points.length === 0) {
      return;
    }

    const map = new Map<string, AggregatedDataPoint>();
    for (const existing of this.aggregatedData) {
      map.set(this.getAggregatedKey(existing), existing);
    }

    for (const point of points) {
      map.set(this.getAggregatedKey(point), point);
    }

    this.aggregatedData = Array.from(map.values()).sort((a, b) => {
      return this.parseAggregatedStart(a).toMillis() - this.parseAggregatedStart(b).toMillis();
    });
  }

  private getAggregatedKey(point: AggregatedDataPoint): string {
    const span = point.bucketSpanHours ?? this.getDefaultBucketSpan(point.bucket);
    return `${point.bucket}|${span}|${point.date}`;
  }

  private getDefaultBucketSpan(bucket: AggregationBucket): number {
    if (bucket === 'hour') {
      return 1;
    }
    if (bucket === '2day') {
      return 48;
    }
    return 24;
  }

  private parseAggregatedStart(point: AggregatedDataPoint): DateTime {
    if (!point?.date) {
      return DateTime.invalid('missing-date');
    }

    let parsed = DateTime.fromISO(point.date);

    if (!parsed.isValid && point.date.length === 10) {
      parsed = DateTime.fromFormat(point.date, 'yyyy-MM-dd');
    }

    return parsed;
  }

  private floorToBucket(value: DateTime, bucket: AggregationBucket, spanHours: number = 1): DateTime {
    const span = Math.max(1, spanHours);

    if (bucket === 'hour') {
      const spanMillis = span * 60 * 60 * 1000;
      const floored = Math.floor(value.toUTC().toMillis() / spanMillis) * spanMillis;
      return DateTime.fromMillis(floored, { zone: value.zone });
    }

    if (bucket === '2day') {
      const spanMillis = 48 * 60 * 60 * 1000;
      const floored = Math.floor(value.toUTC().toMillis() / spanMillis) * spanMillis;
      return DateTime.fromMillis(floored, { zone: value.zone });
    }

    return value.startOf('day');
  }

  private makeAggregationKey(bucket: AggregationBucket, span: number, start: DateTime): string {
    return `${bucket}|${span}|${start.toISO()}`;
  }

  private formatBucketDate(start: DateTime, bucket: AggregationBucket): string {
    if (bucket === 'day') {
      return (
        start.toISODate() ||
        start.toUTC().toISODate() ||
        start.toUTC().toISO() ||
        new Date().toISOString()
      );
    }

    return (
      start.toISO() ||
      start.toUTC().toISO() ||
      new Date().toISOString()
    );
  }

  private aggregateThermalPoints(
    points: ThermalDataPoint[],
    bucket: AggregationBucket,
    options: { hoursPerBucket?: number } = {}
  ): AggregatedDataPoint[] {
    if (!points || points.length === 0) {
      return [];
    }

    const hoursPerBucket = bucket === 'hour'
      ? Math.max(1, Math.floor(options.hoursPerBucket ?? 1))
      : bucket === '2day'
        ? 48
        : 24;

    const grouped = new Map<string, {
      start: DateTime;
      sumIndoor: number;
      sumOutdoor: number;
      sumTarget: number;
      sumWind: number;
      sumHumidity: number;
      heatingCount: number;
      count: number;
      energySum: number;
      hasEnergy: boolean;
    }>();

    for (const point of points) {
      const timestamp = DateTime.fromISO(point.timestamp);
      if (!timestamp.isValid) {
        continue;
      }

      const bucketStart = this.floorToBucket(timestamp, bucket, hoursPerBucket);
      const key = this.makeAggregationKey(bucket, hoursPerBucket, bucketStart);
      let state = grouped.get(key);

      if (!state) {
        state = {
          start: bucketStart,
          sumIndoor: 0,
          sumOutdoor: 0,
          sumTarget: 0,
          sumWind: 0,
          sumHumidity: 0,
          heatingCount: 0,
          count: 0,
          energySum: 0,
          hasEnergy: false
        };
        grouped.set(key, state);
      }

      state.sumIndoor += point.indoorTemperature;
      state.sumOutdoor += point.outdoorTemperature;
      state.sumTarget += point.targetTemperature;
      state.sumWind += point.weatherConditions?.windSpeed ?? 0;
      state.sumHumidity += point.weatherConditions?.humidity ?? 0;
      state.count += 1;

      if (point.heatingActive) {
        state.heatingCount += 1;
      }

      if (typeof point.energyUsage === 'number') {
        state.energySum += point.energyUsage;
        state.hasEnergy = true;
      }
    }

    const bucketSpanHours = bucket === 'hour' ? hoursPerBucket : bucket === 'day' ? 24 : 48;

    return Array.from(grouped.values()).map(state => {
      const count = Math.max(1, state.count);
      const heatingHours = (state.heatingCount / count) * bucketSpanHours;
      const dateValue = this.formatBucketDate(state.start, bucket);

      return {
        date: dateValue,
        bucket,
        bucketSpanHours,
        avgIndoorTemp: state.sumIndoor / count,
        avgOutdoorTemp: state.sumOutdoor / count,
        avgTargetTemp: state.sumTarget / count,
        heatingHours,
        avgWindSpeed: state.sumWind / count,
        avgHumidity: state.sumHumidity / count,
        totalEnergyUsage: state.hasEnergy ? state.energySum : undefined,
        dataPointCount: count
      };
    }).sort((a, b) => this.parseAggregatedStart(a).toMillis() - this.parseAggregatedStart(b).toMillis());
  }

  private aggregateAggregatedPoints(
    points: AggregatedDataPoint[],
    bucket: AggregationBucket,
    options: { hoursPerBucket?: number } = {}
  ): AggregatedDataPoint[] {
    if (!points || points.length === 0) {
      return [];
    }

    const hoursPerBucket = bucket === 'hour'
      ? Math.max(1, Math.floor(options.hoursPerBucket ?? 1))
      : bucket === '2day'
        ? 48
        : 24;

    const grouped = new Map<string, {
      start: DateTime;
      weight: number;
      sumIndoor: number;
      sumOutdoor: number;
      sumTarget: number;
      sumWind: number;
      sumHumidity: number;
      heatingHours: number;
      energySum: number;
      hasEnergy: boolean;
    }>();

    for (const point of points) {
      const start = this.parseAggregatedStart(point);
      if (!start.isValid) {
        continue;
      }

      const bucketStart = this.floorToBucket(start, bucket, hoursPerBucket);
      const key = this.makeAggregationKey(bucket, hoursPerBucket, bucketStart);
      let state = grouped.get(key);

      if (!state) {
        state = {
          start: bucketStart,
          weight: 0,
          sumIndoor: 0,
          sumOutdoor: 0,
          sumTarget: 0,
          sumWind: 0,
          sumHumidity: 0,
          heatingHours: 0,
          energySum: 0,
          hasEnergy: false
        };
        grouped.set(key, state);
      }

      const weight = Math.max(1, point.dataPointCount || 1);

      state.weight += weight;
      state.sumIndoor += point.avgIndoorTemp * weight;
      state.sumOutdoor += point.avgOutdoorTemp * weight;
      state.sumTarget += point.avgTargetTemp * weight;
      state.sumWind += point.avgWindSpeed * weight;
      state.sumHumidity += point.avgHumidity * weight;
      state.heatingHours += point.heatingHours;

      if (typeof point.totalEnergyUsage === 'number') {
        state.energySum += point.totalEnergyUsage;
        state.hasEnergy = true;
      }
    }

    const bucketSpanHours = bucket === 'hour' ? hoursPerBucket : bucket === 'day' ? 24 : 48;

    return Array.from(grouped.values()).map(state => {
      const weight = Math.max(1, state.weight);
      const dateValue = this.formatBucketDate(state.start, bucket);

      return {
        date: dateValue,
        bucket,
        bucketSpanHours,
        avgIndoorTemp: state.sumIndoor / weight,
        avgOutdoorTemp: state.sumOutdoor / weight,
        avgTargetTemp: state.sumTarget / weight,
        heatingHours: state.heatingHours,
        avgWindSpeed: state.sumWind / weight,
        avgHumidity: state.sumHumidity / weight,
        totalEnergyUsage: state.hasEnergy ? state.energySum : undefined,
        dataPointCount: weight
      };
    }).sort((a, b) => this.parseAggregatedStart(a).toMillis() - this.parseAggregatedStart(b).toMillis());
  }

  private estimateSerializedKB(data: unknown): number {
    try {
      const json = JSON.stringify(data ?? []);
      return Buffer.byteLength(json, 'utf8') / 1024;
    } catch (error) {
      this.homey.error(`ThermalRetention: failed to estimate size`, error);
      return 0;
    }
  }

  private computeRetentionMetrics(): {
    rawCount: number;
    aggregatedBucketCount: number;
    aggregatedRepresentedPoints: number;
    rawKB: number;
    aggKB: number;
    totalKB: number;
    totalStoredEntries: number;
  } {
    const rawCount = this.dataPoints.length;
    const aggregatedBucketCount = this.aggregatedData.length;
    const aggregatedRepresentedPoints = this.aggregatedData.reduce((sum, point) => {
      return sum + Math.max(1, point.dataPointCount || 0);
    }, 0);

    const rawKB = this.estimateSerializedKB(this.dataPoints);
    const aggKB = this.estimateSerializedKB(this.aggregatedData);

    return {
      rawCount,
      aggregatedBucketCount,
      aggregatedRepresentedPoints,
      rawKB,
      aggKB,
      totalKB: rawKB + aggKB,
      totalStoredEntries: rawCount + aggregatedBucketCount
    };
  }

  private enforceCapsByAggregationAndTrim(
    config: RetentionConfig,
    trigger: string,
    summary: {
      promotedToFullRes: number;
      aggregatedMid: number;
      aggregatedLow: number;
      droppedRaw: number;
    }
  ): void {
    let metrics = this.computeRetentionMetrics();

    this.homey.log(
      `ThermalRetention: sizes {rawKB=${metrics.rawKB.toFixed(1)}, aggKB=${metrics.aggKB.toFixed(1)}} points={${metrics.rawCount}, ${metrics.aggregatedBucketCount}}`
    );

    if (summary.droppedRaw > 0) {
      this.homey.log(`ThermalRetention: dropped ${summary.droppedRaw} raw points beyond retention window`);
    }
    if (summary.promotedToFullRes > 0) {
      this.homey.log(`ThermalRetention: promoted ${summary.promotedToFullRes} points to maintain full-resolution buffer`);
    }

    const targetKB = config.targetKB;
    const maxPoints = config.maxPoints;

    let midSpan = this.getCurrentMidSpan();

    const needsGuard = () => metrics.totalKB > targetKB || metrics.totalStoredEntries > maxPoints;

    let guardIteration = 0;

    while (needsGuard()) {
      guardIteration += 1;
      if (guardIteration > 50) {
        this.homey.error('ThermalRetention: guard loop exceeded 50 iterations, aborting to prevent infinite loop');
        break;
      }

      const sizeReason = metrics.totalKB > targetKB ? 'size' : 'points';

      const nextSpan = this.nextMidBucketSpan(midSpan);
      if (nextSpan && this.reaggregateMidResolution(nextSpan)) {
        midSpan = nextSpan;
        metrics = this.computeRetentionMetrics();
        continue;
      }

      if (this.compressLowResolution()) {
        metrics = this.computeRetentionMetrics();
        continue;
      }

      if (this.trimOldestAggregated(sizeReason)) {
        metrics = this.computeRetentionMetrics();
        continue;
      }

      // Nothing else to do; break to avoid endless loop
      this.homey.error(
        `ThermalRetention: unable to satisfy ${sizeReason} guard after aggregation adjustments (current size=${metrics.totalKB.toFixed(1)}KB, entries=${metrics.totalStoredEntries})`
      );
      break;
    }

    if (guardIteration > 0) {
      metrics = this.computeRetentionMetrics();
      this.homey.log(
        `ThermalRetention: post-guard sizes {rawKB=${metrics.rawKB.toFixed(1)}, aggKB=${metrics.aggKB.toFixed(1)}} points={${metrics.rawCount}, ${metrics.aggregatedBucketCount}}`
      );
    }
  }

  private getCurrentMidSpan(): number {
    const spans = this.aggregatedData
      .filter(point => point.bucket === 'hour')
      .map(point => point.bucketSpanHours ?? this.getDefaultBucketSpan('hour'));

    if (spans.length === 0) {
      return 1;
    }

    return Math.max(...spans);
  }

  private nextMidBucketSpan(current: number): number | null {
    const allowedSpans = [1, 2, 3, 4, 6, 8, 12];
    const index = allowedSpans.indexOf(current);

    if (index === -1 || index === allowedSpans.length - 1) {
      return null;
    }

    return allowedSpans[index + 1];
  }

  private reaggregateMidResolution(newSpan: number): boolean {
    const midPoints = this.aggregatedData.filter(point => point.bucket === 'hour');
    if (midPoints.length === 0) {
      return false;
    }

    const reaggregated = this.aggregateAggregatedPoints(midPoints, 'hour', { hoursPerBucket: newSpan });
    if (reaggregated.length === 0) {
      return false;
    }

    this.removeAggregatedPoints(midPoints);
    this.mergeAggregatedPoints(reaggregated);
    this.homey.log(`ThermalRetention: increased mid-res bucket span to ${newSpan}h (reason: size guard)`);
    return true;
  }

  private compressLowResolution(): boolean {
    const lowPoints = this.aggregatedData.filter(point => point.bucket === 'day');
    if (lowPoints.length === 0) {
      return false;
    }

    const compressed = this.aggregateAggregatedPoints(lowPoints, '2day');
    if (compressed.length === 0) {
      return false;
    }

    this.removeAggregatedPoints(lowPoints);
    this.mergeAggregatedPoints(compressed);
    this.homey.log('ThermalRetention: applied 2-day aggregation for low-resolution window (reason: size guard)');
    return true;
  }

  private trimOldestAggregated(reason: string): boolean {
    if (this.aggregatedData.length === 0) {
      return false;
    }

    const candidates = this.aggregatedData
      .filter(point => point.bucket === '2day' || point.bucket === 'day')
      .sort((a, b) => this.parseAggregatedStart(a).toMillis() - this.parseAggregatedStart(b).toMillis());

    if (candidates.length === 0) {
      return false;
    }

    const remove = candidates.shift();
    if (!remove) {
      return false;
    }

    this.removeAggregatedPoints([remove]);

    const spanHours = remove.bucketSpanHours ?? this.getDefaultBucketSpan(remove.bucket);
    const spanDays = Math.max(1, Math.round(spanHours / 24));

    this.homey.log(`ThermalRetention: trimmed oldest ${spanDays} days (reason: ${reason})`);
    return true;
  }

  private removeAggregatedPoints(points: AggregatedDataPoint[]): void {
    if (!points || points.length === 0) {
      return;
    }

    const keys = new Set(points.map(point => this.getAggregatedKey(point)));
    this.aggregatedData = this.aggregatedData.filter(point => !keys.has(this.getAggregatedKey(point)));
  }

  /**
   * Load previously stored thermal data from Homey settings
   * Falls back to file storage if settings storage fails
   * Also loads aggregated historical data
   */
  private loadStoredData(): void {
    try {
      // First try to load from Homey settings (persists across reinstalls)
      const settingsData = this.homey.settings.get(THERMAL_DATA_SETTINGS_KEY);
      const aggregatedData = this.homey.settings.get(AGGREGATED_DATA_SETTINGS_KEY);

      let dataLoaded = false;

      if (settingsData) {
        try {
          this.dataPoints = typeof settingsData === 'string'
            ? JSON.parse(settingsData)
            : Array.isArray(settingsData)
              ? settingsData
              : [];
          this.homey.log(`Loaded ${this.dataPoints.length} thermal data points from settings storage`);
          dataLoaded = true;
        } catch (parseError) {
          this.homey.error(`Error parsing thermal data from settings: ${parseError}`);
          this.dataPoints = [];
        }
      }

      if (aggregatedData) {
        try {
          const parsedAggregated = typeof aggregatedData === 'string'
            ? JSON.parse(aggregatedData)
            : Array.isArray(aggregatedData)
              ? aggregatedData
              : [];

          this.aggregatedData = Array.isArray(parsedAggregated)
            ? parsedAggregated.map((entry: any) => this.normalizeAggregatedEntry(entry))
            : [];

          this.homey.log(`Loaded ${this.aggregatedData.length} aggregated data points from settings storage`);
        } catch (parseError) {
          this.homey.error(`Error parsing aggregated data from settings: ${parseError}`);
          this.aggregatedData = [];
        }
      }

      if (!dataLoaded) {
        this.homey.log('No stored thermal data found, starting fresh collection');
        this.dataPoints = [];
      }

      // Clean up data on load to ensure we don't have too many points
      this.cleanupDataOnLoad();

      this.initialized = true;
    } catch (error) {
      this.homey.error(`Error loading thermal data: ${error}`);
      this.dataPoints = [];
      this.aggregatedData = [];
      this.initialized = true;
    }
  }

  /**
   * Clean up data after loading to ensure we don't exceed limits
   */
  private cleanupDataOnLoad(): void {
    try {
      this.applyRetentionPolicy('initial-load');
    } catch (error) {
      this.homey.error(`Error cleaning up data on load: ${error}`);
    }
  }

  private getRetentionConfig(): RetentionConfig {
    const retentionSetting = this.homey?.settings?.get('thermal_retention_days');
    let retentionDays = typeof retentionSetting === 'number'
      ? retentionSetting
      : Number(retentionSetting);

    if (retentionSetting === null || retentionSetting === undefined || Number.isNaN(retentionDays)) {
      retentionDays = DEFAULT_RETENTION_DAYS;
    }

    retentionDays = Math.max(MIN_RETENTION_DAYS, Math.min(MAX_RETENTION_DAYS, retentionDays));

    const fullResSetting = this.homey?.settings?.get('thermal_fullres_days');
    let fullResDays = typeof fullResSetting === 'number'
      ? fullResSetting
      : Number(fullResSetting);

    if (fullResSetting === null || fullResSetting === undefined || Number.isNaN(fullResDays)) {
      fullResDays = DEFAULT_FULL_RES_DAYS;
    }

    fullResDays = Math.max(MIN_FULL_RES_DAYS, Math.min(60, fullResDays));
    fullResDays = Math.min(fullResDays, retentionDays);

    const maxPointsSetting = this.homey?.settings?.get('thermal_max_points');
    let maxPoints = typeof maxPointsSetting === 'number'
      ? maxPointsSetting
      : Number(maxPointsSetting);

    if (maxPointsSetting === null || maxPointsSetting === undefined || Number.isNaN(maxPoints)) {
      maxPoints = DEFAULT_MAX_POINTS;
    }

    maxPoints = Math.max(MIN_MAX_POINTS, Math.min(MAX_MAX_POINTS, maxPoints));

    const targetSetting = this.homey?.settings?.get('thermal_target_kb');
    let targetKB = typeof targetSetting === 'number'
      ? targetSetting
      : Number(targetSetting);

    if (targetSetting === null || targetSetting === undefined || Number.isNaN(targetKB)) {
      targetKB = DEFAULT_TARGET_KB;
    }

    targetKB = Math.max(MIN_TARGET_KB, Math.min(MAX_TARGET_KB, targetKB));

    return {
      retentionDays,
      fullResDays,
      maxPoints,
      targetKB
    };
  }

  /**
   * Save thermal data to Homey settings (persists across reinstalls)
   */
  private saveToSettings(): void {
    try {
      // Check memory usage before saving
      this.checkMemoryUsage();

      // Create a new Set for tracking circular references
      const seen = new WeakSet();

      // Stringify with a replacer function to handle circular references
      const dataString = JSON.stringify(this.dataPoints, (key, value) => {
        // Handle circular references
        if (typeof value === 'object' && value !== null) {
          if (seen.has(value)) {
            return '[Circular]';
          }
          seen.add(value);
        }
        return value;
      });

      // Check if the data is too large for settings storage
      if (dataString.length > MAX_SETTINGS_DATA_SIZE) {
        this.homey.log(`Data size (${dataString.length} bytes) exceeds maximum settings size (${MAX_SETTINGS_DATA_SIZE} bytes)`);
        this.reduceDataSize();
        return; // reduceDataSize will call saveToSettings again with reduced data
      }

      this.homey.settings.set(THERMAL_DATA_SETTINGS_KEY, dataString);

      // Also save aggregated data
      if (this.aggregatedData.length > 0) {
        const aggregatedString = JSON.stringify(this.aggregatedData);
        this.homey.settings.set(AGGREGATED_DATA_SETTINGS_KEY, aggregatedString);
        this.homey.log(`Saved ${this.aggregatedData.length} aggregated data points to settings storage`);
      }

      this.homey.log(`Saved ${this.dataPoints.length} thermal data points to settings storage (${dataString.length} bytes)`);
    } catch (error) {
      this.homey.error(`Error saving thermal data to settings`, error);

      // Try to save a smaller subset if the full dataset is too large
      this.reduceDataSize();
    }
  }

  /**
   * Reduce the size of the data to be saved when it's too large
   */
  private reduceDataSize(): void {
    try {
      this.homey.error('ThermalRetention: reduceDataSize fallback engaged due to settings storage limit');

      // Re-apply retention policy aggressively
      this.applyRetentionPolicy('hard-limit');

      let dataString = JSON.stringify(this.dataPoints);
      if (dataString.length > MAX_SETTINGS_DATA_SIZE) {
        const keepCount = Math.max(
          MIN_FULL_RES_POINTS,
          Math.min(this.dataPoints.length, Math.floor(MAX_SETTINGS_DATA_SIZE / 200))
        );

        if (this.dataPoints.length > keepCount) {
          const removed = this.dataPoints.length - keepCount;
          this.dataPoints = this.dataPoints.slice(-keepCount);
          this.homey.error(`ThermalRetention: force-trimmed ${removed} detailed points to respect storage limit`);
        }

        dataString = JSON.stringify(this.dataPoints);
      }

      this.homey.settings.set(THERMAL_DATA_SETTINGS_KEY, dataString);

      let aggregatedString = JSON.stringify(this.aggregatedData);
      if (aggregatedString.length > MAX_SETTINGS_DATA_SIZE) {
        this.homey.error('ThermalRetention: aggregated data exceeded storage limit, clearing oldest buckets');
        this.aggregatedData = [];
        aggregatedString = '[]';
      }

      this.homey.settings.set(AGGREGATED_DATA_SETTINGS_KEY, aggregatedString);
    } catch (error) {
      this.homey.error(`ThermalRetention: reduceDataSize failed`, error);
    }
  }

  /**
   * Check memory usage and log warnings if memory usage is high
   */
  private checkMemoryUsage(): void {
    try {
      // Only check memory usage every 10 minutes to avoid excessive logging
      const now = Date.now();
      if (now - this.lastMemoryCheck < 10 * 60 * 1000) {
        return;
      }

      this.lastMemoryCheck = now;

      // Get memory usage if available
      if (process && process.memoryUsage) {
        const memoryUsage = process.memoryUsage();
        const heapUsedMB = Math.round(memoryUsage.heapUsed / 1024 / 1024 * 100) / 100;
        const heapTotalMB = Math.round(memoryUsage.heapTotal / 1024 / 1024 * 100) / 100;
        const usagePercentage = Math.round((heapUsedMB / heapTotalMB) * 100);

        this.homey.log(`Memory usage: ${heapUsedMB}MB / ${heapTotalMB}MB (${usagePercentage}%)`);

        // If memory usage is high, log a warning and trigger data cleanup
        if (usagePercentage > 80 && !this.memoryWarningIssued) {
          this.homey.error(`High memory usage detected: ${usagePercentage}%. Triggering data cleanup.`);
          this.memoryWarningIssued = true;
          this.applyRetentionPolicy('memory-high');
        } else if (usagePercentage < 70) {
          // Reset warning flag when memory usage drops
          this.memoryWarningIssued = false;
        }
      }
    } catch (error) {
      this.homey.error(`Error checking memory usage: ${error}`);
    }
  }

  /**
   * Save thermal data to all storage methods
   */
  private saveData(reason: string = 'save'): void {
    this.applyRetentionPolicy(reason);
    this.saveToSettings();
  }


  /**
   * Add a new thermal data point
   * @param dataPoint The thermal data point to add
   */
  public addDataPoint(dataPoint: ThermalDataPoint): void {
    if (!this.initialized) {
      this.homey.log('Thermal data collector not yet initialized, waiting...');
      return;
    }

    try {
      // Validate the data point
      if (!this.validateDataPoint(dataPoint)) {
        this.homey.error('Invalid thermal data point, skipping');
        return;
      }

      // Add the new data point
      this.dataPoints.push(dataPoint);

      // Save the updated data
      this.saveData('add-data-point');

      this.homey.log(`Added new thermal data point. Total points: ${this.dataPoints.length}`);
    } catch (error) {
      this.homey.error('Error adding thermal data point:', error);
    }
  }

  /**
   * Explicitly run retention maintenance (used by scheduled cleanup tasks)
   */
  public runRetentionMaintenance(reason: string = 'manual'): void {
    try {
      this.saveData(reason);
    } catch (error) {
      this.homey.error('Error running retention maintenance:', error);
    }
  }

  /**
   * Validate a thermal data point to ensure it contains valid data
   * @param dataPoint The data point to validate
   * @returns True if the data point is valid, false otherwise
   */
  private validateDataPoint(dataPoint: ThermalDataPoint): boolean {
    try {
      // Check for required fields
      if (!dataPoint.timestamp ||
        typeof dataPoint.indoorTemperature !== 'number' ||
        typeof dataPoint.outdoorTemperature !== 'number' ||
        typeof dataPoint.targetTemperature !== 'number' ||
        typeof dataPoint.heatingActive !== 'boolean') {
        return false;
      }

      // Check for valid temperature ranges
      if (dataPoint.indoorTemperature < -10 || dataPoint.indoorTemperature > 40 ||
        dataPoint.outdoorTemperature < -50 || dataPoint.outdoorTemperature > 50 ||
        dataPoint.targetTemperature < 5 || dataPoint.targetTemperature > 30) {
        return false;
      }

      // Check for valid timestamp
      try {
        const timestamp = DateTime.fromISO(dataPoint.timestamp);
        if (!timestamp.isValid) {
          return false;
        }

        // Check that timestamp is not in the future
        if (timestamp > DateTime.now()) {
          return false;
        }
      } catch (e) {
        return false;
      }

      // Check weather conditions
      if (!dataPoint.weatherConditions ||
        typeof dataPoint.weatherConditions.windSpeed !== 'number' ||
        typeof dataPoint.weatherConditions.humidity !== 'number' ||
        typeof dataPoint.weatherConditions.cloudCover !== 'number' ||
        typeof dataPoint.weatherConditions.precipitation !== 'number') {
        return false;
      }

      return true;
    } catch (error) {
      this.homey.error('Error validating data point:', error);
      return false;
    }
  }

  /**
   * Get all thermal data points
   * @returns Array of all thermal data points
   */
  public getAllDataPoints(): ThermalDataPoint[] {
    return this.dataPoints;
  }

  /**
   * Get aggregated historical data
   * @returns Array of aggregated data points
   */
  public getAggregatedData(): AggregatedDataPoint[] {
    return this.aggregatedData;
  }

  /**
   * Get combined data for analysis (recent detailed points + historical aggregates)
   * This provides a comprehensive dataset for analysis while keeping memory usage low
   * @returns Object containing both detailed and aggregated data
   */
  public getCombinedDataForAnalysis(): {
    detailed: ThermalDataPoint[];
    aggregated: AggregatedDataPoint[];
    totalDataPoints: number;
  } {
    return {
      detailed: this.dataPoints,
      aggregated: this.aggregatedData,
      totalDataPoints: this.dataPoints.length + this.aggregatedData.reduce((sum, agg) => sum + agg.dataPointCount, 0)
    };
  }

  /**
   * Get data points from the last N hours
   * @param hours Number of hours to look back
   * @returns Array of data points from the specified time period
   */
  public getRecentDataPoints(hours: number): ThermalDataPoint[] {
    try {
      const cutoffTime = DateTime.now().minus({ hours });
      return this.dataPoints.filter(point => {
        const pointTime = DateTime.fromISO(point.timestamp);
        return pointTime.isValid && pointTime >= cutoffTime;
      });
    } catch (error) {
      this.homey.error(`Error getting recent data points: ${error}`);
      return [];
    }
  }

  /**
   * Get data statistics for a specific time period
   * @param days Number of days to analyze
   * @returns Statistics about the data for the specified period
   */
  public getDataStatistics(days: number = 7): {
    dataPointCount: number;
    avgIndoorTemp: number;
    avgOutdoorTemp: number;
    heatingActivePercentage: number;
    oldestDataPoint: string;
    newestDataPoint: string;
    dataCollectionRate: number; // points per day
  } {
    try {
      const cutoffDate = DateTime.now().minus({ days });
      const recentPoints = this.dataPoints.filter(point => {
        const pointDate = DateTime.fromISO(point.timestamp);
        return pointDate.isValid && pointDate >= cutoffDate;
      });

      if (recentPoints.length === 0) {
        return {
          dataPointCount: 0,
          avgIndoorTemp: 0,
          avgOutdoorTemp: 0,
          heatingActivePercentage: 0,
          oldestDataPoint: '',
          newestDataPoint: '',
          dataCollectionRate: 0
        };
      }

      // Sort points by timestamp
      const sortedPoints = [...recentPoints].sort((a, b) => {
        return DateTime.fromISO(a.timestamp).toMillis() - DateTime.fromISO(b.timestamp).toMillis();
      });

      const oldestPoint = sortedPoints[0];
      const newestPoint = sortedPoints[sortedPoints.length - 1];

      // Calculate statistics
      const avgIndoorTemp = recentPoints.reduce((sum, p) => sum + p.indoorTemperature, 0) / recentPoints.length;
      const avgOutdoorTemp = recentPoints.reduce((sum, p) => sum + p.outdoorTemperature, 0) / recentPoints.length;
      const heatingActiveCount = recentPoints.filter(p => p.heatingActive).length;
      const heatingActivePercentage = (heatingActiveCount / recentPoints.length) * 100;

      // Calculate data collection rate (points per day)
      const oldestDate = DateTime.fromISO(oldestPoint.timestamp);
      const newestDate = DateTime.fromISO(newestPoint.timestamp);
      const daysDiff = newestDate.diff(oldestDate, 'days').days;
      const dataCollectionRate = daysDiff > 0 ? recentPoints.length / daysDiff : recentPoints.length;

      return {
        dataPointCount: recentPoints.length,
        avgIndoorTemp: Math.round(avgIndoorTemp * 10) / 10,
        avgOutdoorTemp: Math.round(avgOutdoorTemp * 10) / 10,
        heatingActivePercentage: Math.round(heatingActivePercentage * 10) / 10,
        oldestDataPoint: oldestPoint.timestamp,
        newestDataPoint: newestPoint.timestamp,
        dataCollectionRate: Math.round(dataCollectionRate * 10) / 10
      };
    } catch (error) {
      this.homey.error(`Error calculating data statistics: ${error}`);
      return {
        dataPointCount: 0,
        avgIndoorTemp: 0,
        avgOutdoorTemp: 0,
        heatingActivePercentage: 0,
        oldestDataPoint: '',
        newestDataPoint: '',
        dataCollectionRate: 0
      };
    }
  }

  /**
   * Set data points (replace all existing data)
   * Used for data cleanup and management
   * @param dataPoints Array of data points to set
   */
  public setDataPoints(dataPoints: ThermalDataPoint[]): void {
    if (!this.initialized) {
      this.homey.log('Thermal data collector not yet initialized, waiting...');
      return;
    }

    try {
      // Validate the data points
      const validDataPoints = dataPoints.filter(point => this.validateDataPoint(point));

      if (validDataPoints.length < dataPoints.length) {
        this.homey.log(`Filtered out ${dataPoints.length - validDataPoints.length} invalid data points`);
      }

      // Replace the data points
      this.dataPoints = validDataPoints;

      // Save the updated data
      this.saveData();

      this.homey.log(`Updated thermal data points. Total points: ${this.dataPoints.length}`);
    } catch (error) {
      this.homey.error('Error setting thermal data points:', error);
    }
  }

  /**
   * Set the maximum number of data points to keep in memory
   * @param maxPoints Maximum number of data points
   */
  public setMaxDataPoints(maxPoints: number): void {
    try {
      if (maxPoints < 100) {
        this.homey.error(`Invalid maxDataPoints value: ${maxPoints}. Must be at least 100.`);
        return;
      }

      const oldMax = this.maxDataPoints;
      this.maxDataPoints = maxPoints;
      this.homey.log(`Updated maxDataPoints from ${oldMax} to ${maxPoints}`);

      // If current data exceeds the new maximum, trim it
      if (this.dataPoints.length > this.maxDataPoints) {
        this.applyRetentionPolicy('set-max-points');
        this.saveToSettings();
      }
    } catch (error) {
      this.homey.error(`Error setting max data points: ${error}`);
    }
  }

  /**
   * Clear all stored data (for testing or reset)
   * @param clearAggregated Whether to also clear aggregated data (default: true)
   */
  public clearData(clearAggregated: boolean = true): void {
    try {
      this.dataPoints = [];

      if (clearAggregated) {
        this.aggregatedData = [];
        this.homey.log('Cleared all thermal data (including aggregated data)');
      } else {
        this.homey.log('Cleared detailed thermal data points (kept aggregated data)');
      }

      this.saveData('clear-data');
    } catch (error) {
      this.homey.error(`Error clearing data: ${error}`);
    }
  }

  /**
   * Get memory usage statistics for the data collector
   * @returns Object with memory usage information
   */
  public getMemoryUsage(): {
    dataPointCount: number;
    aggregatedDataCount: number;
    estimatedMemoryUsageKB: number;
    dataPointsPerDay: number;
  } {
    try {
      // Estimate memory usage (rough approximation)
      // Average data point is about 200 bytes, average aggregated point is about 100 bytes
      const dataPointsMemory = this.dataPoints.length * 200;
      const aggregatedMemory = this.aggregatedData.length * 100;
      const totalMemoryKB = Math.round((dataPointsMemory + aggregatedMemory) / 1024);

      // Calculate data points per day
      let dataPointsPerDay = 0;
      if (this.dataPoints.length > 0) {
        const now = DateTime.now();
        const oneDayAgo = now.minus({ days: 1 });
        const lastDayPoints = this.dataPoints.filter(point => {
          const pointDate = DateTime.fromISO(point.timestamp);
          return pointDate >= oneDayAgo && pointDate <= now;
        });
        dataPointsPerDay = lastDayPoints.length;
      }

      return {
        dataPointCount: this.dataPoints.length,
        aggregatedDataCount: this.aggregatedData.length,
        estimatedMemoryUsageKB: totalMemoryKB,
        dataPointsPerDay
      };
    } catch (error) {
      this.homey.error(`Error getting memory usage: ${error}`);
      return {
        dataPointCount: this.dataPoints.length,
        aggregatedDataCount: this.aggregatedData.length,
        estimatedMemoryUsageKB: 0,
        dataPointsPerDay: 0
      };
    }
  }
}
