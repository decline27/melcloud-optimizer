import { HomeyApp } from './src/types';
import { 
  formatTimelineMessage, 
  getTimelineVerbosity, 
  getCurrencyCode,
  TimelinePayload 
} from './src/util/timeline-formatter';

export enum TimelineEventType {
  HOURLY_OPTIMIZATION = 'hourly_optimization',
  HOURLY_OPTIMIZATION_MANUAL = 'hourly_optimization_manual',
  HOURLY_OPTIMIZATION_RESULT = 'hourly_optimization_result',
  HOURLY_OPTIMIZATION_ERROR = 'hourly_optimization_error',
  WEEKLY_CALIBRATION = 'weekly_calibration',
  WEEKLY_CALIBRATION_MANUAL = 'weekly_calibration_manual',
  WEEKLY_CALIBRATION_RESULT = 'weekly_calibration_result',
  WEEKLY_CALIBRATION_ERROR = 'weekly_calibration_error',
  CRON_JOB_INITIALIZED = 'cron_job_initialized',
  CUSTOM = 'custom'
}

type TimelineDetails = {
  reason?: string;
  message?: string;
  [key: string]: unknown;
};

type TimelineExtra = {
  fromTemp?: number;
  toTemp?: number;
  targetOriginal?: number;
  targetTemp?: number;
  zone2Original?: number;
  zone2Temp?: number;
  tankOriginal?: number;
  tankTemp?: number;
  dailySavings?: number;
  [key: string]: unknown;
};

type HomeyLike = Pick<HomeyApp, 'timeline' | 'notifications' | 'i18n' | 'settings'>;

/**
 * Lightweight wrapper used by the legacy API layer so we can keep Homey timeline
 * interactions isolated from the large api.ts module.
 */
export class TimelineHelperWrapper {
  private readonly homey?: HomeyLike;

  constructor(homey?: HomeyLike) {
    this.homey = homey;
  }

  async addTimelineEntry(
    eventType: TimelineEventType,
    details: TimelineDetails = {},
    createNotification = false,
    additionalData: TimelineExtra = {}
  ): Promise<void> {
    const title = this.titleFor(eventType) ?? 'MELCloud Optimizer';
    const message = this.messageFor(eventType, details, additionalData);

    let postedToTimeline = false;

    if (this.homey?.timeline && typeof this.homey.timeline.createEntry === 'function') {
      try {
        await this.homey.timeline.createEntry({ title, body: message, icon: 'flow:device_changed' });
        postedToTimeline = true;
      } catch (error) {
        // Swallow errors so we can use the notification fallback
        postedToTimeline = false;
      }
    }

    const notifier = this.homey?.notifications?.createNotification?.bind(this.homey.notifications);

    if (!notifier) {
      return;
    }

    if (!postedToTimeline) {
      try {
        await notifier({ excerpt: `${title}: ${message}` });
      } catch (error) {
        // Ignore notification errors – logging here would spam the console
      }
      return;
    }

    if (createNotification) {
      try {
        await notifier({ excerpt: `${title}: ${message}` });
      } catch (error) {
        // Ignore notification errors
      }
    }
  }

  private titleFor(eventType: TimelineEventType): string {
    switch (eventType) {
      case TimelineEventType.HOURLY_OPTIMIZATION_RESULT:
        return 'Hourly Optimization Completed';
      case TimelineEventType.WEEKLY_CALIBRATION_RESULT:
        return 'Weekly Calibration Completed';
      case TimelineEventType.CRON_JOB_INITIALIZED:
        return 'Cron Jobs Initialized';
      default:
        return 'MELCloud Optimizer';
    }
  }

  private messageFor(eventType: TimelineEventType, details: TimelineDetails, extra: TimelineExtra): string {
    if (eventType === TimelineEventType.HOURLY_OPTIMIZATION_RESULT) {
      // Use the new formatter for hourly optimization results
      const verbosity = getTimelineVerbosity(this.homey);
      const currency = getCurrencyCode(this.homey);
      
      const payload: TimelinePayload = {
        zoneName: 'Zone1', // Default zone name
        fromTempC: extra.fromTemp ?? extra.targetOriginal ?? 20,
        toTempC: extra.toTemp ?? extra.targetTemp ?? 20,
        tankFromC: extra.tankOriginal,
        tankToC: extra.tankTemp,
        projectedDailySavingsSEK: extra.dailySavings,
        reasonCode: this.extractReasonCode(details.reason),
        planningShiftHours: typeof extra.planningShiftHours === 'number' ? extra.planningShiftHours : undefined,
        // Add technical parameters if available
        outdoorTempC: typeof extra.outdoorTemp === 'number' ? extra.outdoorTemp : undefined,
        copEstimate: typeof extra.copEstimate === 'number' ? extra.copEstimate : undefined,
        pricePercentile: typeof extra.pricePercentile === 'number' ? extra.pricePercentile : undefined,
        comfortBandLowC: typeof extra.comfortLowC === 'number' ? extra.comfortLowC : undefined,
        comfortBandHighC: typeof extra.comfortHighC === 'number' ? extra.comfortHighC : undefined,
        // For debug mode, include the legacy format
        rawEngineText: verbosity === 'debug' ? this.getLegacyMessage(details, extra) : undefined
      };

      return formatTimelineMessage(payload, verbosity, currency);
    }

    if (eventType === TimelineEventType.WEEKLY_CALIBRATION_RESULT) {
      return `Thermal model calibrated${details.reason ? ` | ${details.reason}` : ''}`;
    }

    if (eventType === TimelineEventType.CRON_JOB_INITIALIZED) {
      return 'Scheduled tasks started';
    }

    if (eventType === TimelineEventType.CUSTOM) {
      return typeof details.message === 'string' ? details.message : 'Event';
    }

    return 'Event logged';
  }

  /**
   * Extract reason code from reason string for mapping to friendly text
   */
  private extractReasonCode(reason?: string): string {
    if (!reason) return 'unknown';
    
    const reasonStr = String(reason).toLowerCase();
    
    // Map common reason patterns to codes
    if (reasonStr.includes('within') && reasonStr.includes('deadband')) {
      return 'within_deadband';
    }
    if (reasonStr.includes('cheaper') && reasonStr.includes('raise') && reasonStr.includes('comfort')) {
      return 'cheaper_hour_raise_within_comfort';
    }
    if (reasonStr.includes('cheaper') && reasonStr.includes('lower') && reasonStr.includes('comfort')) {
      return 'cheaper_hour_lower_within_comfort';
    }
    if (reasonStr.includes('planning') && reasonStr.includes('shift')) {
      return 'planning_shift';
    }
    
    // Return the original reason as code for unmapped cases
    return reasonStr.replace(/[^a-z0-9_]/g, '_');
  }

  /**
   * Generate legacy message format for debug mode
   */
  private getLegacyMessage(details: TimelineDetails, extra: TimelineExtra): string {
    const from = extra.fromTemp ?? extra.targetOriginal;
    const to = extra.toTemp ?? extra.targetTemp;

    const head = from !== undefined && to !== undefined
      ? (from === to ? `No change (target ${to}°C)` : `Zone1 ${from}°C → ${to}°C`)
      : 'Temperature optimized';

    const segments: string[] = [head];

    if (extra.zone2Original !== undefined && extra.zone2Temp !== undefined) {
      segments.push(`Zone2 ${extra.zone2Original}°C → ${extra.zone2Temp}°C`);
    }
    if (extra.tankOriginal !== undefined && extra.tankTemp !== undefined) {
      segments.push(`Tank ${extra.tankOriginal}°C → ${extra.tankTemp}°C`);
    }

    if (typeof extra.dailySavings === 'number') {
      const currency = this.detectCurrency();
      const amount = Number(extra.dailySavings).toFixed(2);
      segments.push(`Projected daily savings: ${amount} ${currency}/day`);
    }

    if (details.reason) {
      segments.push(String(details.reason));
    }

    return segments.join(' | ');
  }

  private detectCurrency(): string {
    try {
      const currency = this.homey?.i18n?.getCurrency?.();
      if (currency) {
        return currency;
      }

      const manual = this.homey?.settings?.get?.('currency');
      if (manual) {
        return String(manual);
      }
    } catch (error) {
      // Ignore, fall back to default
    }

    return 'EUR';
  }
}

export default TimelineHelperWrapper;
