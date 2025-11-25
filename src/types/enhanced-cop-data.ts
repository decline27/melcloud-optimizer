/**
 * Enhanced COP data structures returned by MELCloud API helpers.
 */
export interface DailyCOPData {
  TotalHeatingConsumed: number;
  TotalHeatingProduced: number;
  TotalHotWaterConsumed: number;
  TotalHotWaterProduced: number;
  TotalCoolingConsumed?: number;
  TotalCoolingProduced?: number;
  CoP?: Array<number | { hour: number; value: number }>;
  heatingCOP?: number | null;
  hotWaterCOP?: number | null;
  coolingCOP?: number | null;
  averageCOP?: number | null;
  AverageHeatingCOP?: number | null;
  AverageHotWaterCOP?: number | null;
  HasZone2?: boolean;
  SampledDays?: number;
  Date?: string;
}

export interface EnhancedCOPData {
  current: {
    heating: number;
    hotWater: number;
    outdoor: number;
    timestamp: Date;
  };
  daily: DailyCOPData;
  historical: {
    heating: number;
    hotWater: number;
    cooling?: number;
  };
  trends: {
    heatingTrend: 'improving' | 'stable' | 'declining';
    hotWaterTrend: 'improving' | 'stable' | 'declining';
    averageHeating: number;
    averageHotWater: number;
  };
  predictions: {
    nextHourHeating: number;
    nextHourHotWater: number;
    confidenceLevel: number;
  };
}

export function isEnhancedCOPData(data: unknown): data is EnhancedCOPData {
  if (!data || typeof data !== 'object') {
    return false;
  }

  const root = data as Record<string, unknown>;
  const current = root.current as Record<string, unknown> | undefined;
  const daily = root.daily as Record<string, unknown> | undefined;
  const historical = root.historical as Record<string, unknown> | undefined;
  const trends = root.trends as Record<string, unknown> | undefined;
  const predictions = root.predictions as Record<string, unknown> | undefined;

  return Boolean(
    current &&
    typeof current.heating === 'number' &&
    typeof current.hotWater === 'number' &&
    typeof current.outdoor === 'number' &&
    daily &&
    typeof daily === 'object' &&
    historical &&
    typeof historical === 'object' &&
    trends &&
    typeof trends === 'object' &&
    predictions &&
    typeof predictions.nextHourHeating === 'number' &&
    typeof predictions.nextHourHotWater === 'number' &&
    typeof predictions.confidenceLevel === 'number'
  );
}

/**
 * Safe accessor for COP values with legacy fallbacks.
 */
export function getCOPValue(
  daily: DailyCOPData,
  type: 'heating' | 'hotWater',
  fallback: number = 0
): number {
  const primary = type === 'heating' ? daily.heatingCOP : daily.hotWaterCOP;
  const legacyAverage = type === 'heating' ? daily.AverageHeatingCOP : daily.AverageHotWaterCOP;
  const candidate = primary ?? daily.averageCOP ?? legacyAverage;

  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : fallback;
}
