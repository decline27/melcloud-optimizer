/**
 * Timeline Message Formatter
 * Provides verbosity-based formatting for timeline messages
 */

import { HomeyApp } from '../types';

// Type for Homey-like objects that may have limited interface
interface HomeyLike {
  settings?: {
    get?: (key: string) => any;
  };
  i18n?: {
    getCurrency?: () => string | undefined;
  };
}

export type TimelineVerbosity = 'minimal' | 'standard' | 'detailed' | 'debug';

export interface TimelinePayload {
  zoneName: string;           // e.g., "Zone1"
  fromTempC: number;          // e.g., 19.5
  toTempC: number;            // e.g., 20
  tankFromC?: number | null;  // e.g., 46
  tankToC?: number | null;    // e.g., 46
  projectedDailySavingsSEK?: number | null; // e.g., 17.48
  reasonCode: string;         // e.g., "within_deadband", "cheaper_hour_raise_within_comfort"
  planningShiftHours?: number; // signed int, may be 0
  // Additional fields for detailed/debug modes
  outdoorTempC?: number;
  copEstimate?: number;
  pricePercentile?: number;
  comfortBandLowC?: number;
  comfortBandHighC?: number;
  // Legacy raw engine text for debug mode
  rawEngineText?: string;
}

/**
 * Reason code to user-friendly text mapping
 */
const REASON_MAP: Record<string, string> = {
  within_deadband: 'Held steady (within comfort band).',
  cheaper_hour_raise_within_comfort: 'Raised temperature during a cheaper electricity hour (within comfort).',
  cheaper_hour_lower_within_comfort: 'Lowered temperature during a cheaper hour (within comfort).',
  planning_shift: 'Shifted heating to cheaper hours.',
  // Add more mappings as needed
};

/**
 * Get user-friendly reason text
 */
function getFriendlyReason(reasonCode: string): string {
  return REASON_MAP[reasonCode] || 'Adjustment applied based on price and comfort.';
}

/**
 * Round temperature to 0.5 step precision and format
 */
function roundTemp(temp: number): number {
  return Math.round(temp * 2) / 2;
}

/**
 * Format temperature, dropping trailing ".0"
 */
function formatTemp(temp?: number | null): string {
  if (temp == null) return '–';
  const rounded = roundTemp(temp);
  return String(rounded).replace('.0', '');
}

/**
 * Format money with proper currency formatting
 */
function formatMoney(amount?: number | null, currency = 'SEK'): string {
  if (amount == null) return '–';
  return `${amount.toFixed(2)} ${currency}/day`;
}

/**
 * Format timeline message based on verbosity level
 */
export function formatTimelineMessage(
  payload: TimelinePayload, 
  verbosity: TimelineVerbosity, 
  currency = 'SEK'
): string {
  const zone = payload.zoneName || 'Zone';
  const fromTemp = formatTemp(payload.fromTempC);
  const toTemp = formatTemp(payload.toTempC);
  
  // Temperature change line
  const tempChanged = payload.fromTempC !== payload.toTempC;
  const zLine = tempChanged 
    ? `${zone}: ${fromTemp}°C → ${toTemp}°C`
    : `${zone} held at ${toTemp}°C`;
  
  // Tank information
  const tankChanged = (payload.tankFromC != null && payload.tankToC != null && payload.tankFromC !== payload.tankToC);
  const tankLine = (payload.tankFromC != null && payload.tankToC != null)
    ? ` | Tank ${formatTemp(payload.tankFromC)}°C → ${formatTemp(payload.tankToC)}°C`
    : '';
  
  // Savings information
  const savings = formatMoney(payload.projectedDailySavingsSEK, currency);
  
  // Reason and planning
  const reason = getFriendlyReason(payload.reasonCode);
  const planning = (payload.planningShiftHours && payload.planningShiftHours !== 0) 
    ? ` | Planning: shifted ${payload.planningShiftHours > 0 ? '+' : ''}${payload.planningShiftHours}h`
    : '';

  switch (verbosity) {
    case 'minimal': {
      const head = tempChanged 
        ? `${zone} ${toTemp}°C` 
        : `${zone} held at ${toTemp}°C`;
      return `Hourly optimization: ${head}. Projected daily savings: ${savings}.`;
    }

    case 'standard': {
      return `${zLine}${tankChanged ? tankLine : ''}\nProjected daily savings: ${savings}\nReason: ${reason}${planning}`;
    }

    case 'detailed': {
      let result = `${zLine}${tankLine}\nProjected daily savings: ${savings}\nReason: ${reason}${planning}`;
      
      // Add technical parameters if available
      const params: string[] = [];
      if (payload.outdoorTempC != null) params.push(`outdoor ${formatTemp(payload.outdoorTempC)}°C`);
      if (payload.pricePercentile != null) params.push(`percentile ${Math.round(payload.pricePercentile * 100)}%`);
      if (payload.copEstimate != null) params.push(`COP-est ${payload.copEstimate.toFixed(1)}`);
      if (payload.comfortBandLowC != null && payload.comfortBandHighC != null) {
        params.push(`band ${formatTemp(payload.comfortBandLowC)}-${formatTemp(payload.comfortBandHighC)}°C`);
      }
      
      if (params.length > 0) {
        result += `\nParams: ${params.join(', ')}`;
      }
      
      return result;
    }

    case 'debug': {
      // Return raw engine text if available, otherwise fall back to detailed format
      if (payload.rawEngineText) {
        return payload.rawEngineText;
      }
      // Fallback to a debug-style format if no raw text
      return `DEBUG: ${zLine}${tankLine} | Savings: ${savings} | Reason: ${payload.reasonCode}${planning}`;
    }

    default:
      // Fallback to standard
      return formatTimelineMessage(payload, 'standard', currency);
  }
}

/**
 * Get timeline verbosity setting from Homey
 */
export function getTimelineVerbosity(homey: HomeyLike | HomeyApp | undefined): TimelineVerbosity {
  try {
    if (!homey) return 'standard';
    const verbosity = homey.settings?.get?.('timeline_verbosity') as string;
    if (verbosity && ['minimal', 'standard', 'detailed', 'debug'].includes(verbosity)) {
      return verbosity as TimelineVerbosity;
    }
  } catch (error) {
    // Ignore errors, fall back to default
  }
  return 'standard'; // Default
}

/**
 * Get currency code from Homey settings with fallback
 */
export function getCurrencyCode(homey: HomeyLike | HomeyApp | undefined): string {
  try {
    if (!homey) return 'SEK';
    const currency = homey.settings?.get?.('currency') || 
                    homey.settings?.get?.('currency_code') ||
                    homey.i18n?.getCurrency?.();
    if (currency && typeof currency === 'string') {
      return currency.toUpperCase();
    }
  } catch (error) {
    // Ignore errors, fall back to default
  }
  return 'SEK'; // Default fallback
}