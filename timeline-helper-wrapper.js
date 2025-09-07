// Minimal JS wrapper for timeline entries used by api.js and tests
// Provides a stable surface without importing TS sources.

const TimelineEventType = {
  HOURLY_OPTIMIZATION: 'hourly_optimization',
  HOURLY_OPTIMIZATION_MANUAL: 'hourly_optimization_manual',
  HOURLY_OPTIMIZATION_RESULT: 'hourly_optimization_result',
  HOURLY_OPTIMIZATION_ERROR: 'hourly_optimization_error',
  WEEKLY_CALIBRATION: 'weekly_calibration',
  WEEKLY_CALIBRATION_MANUAL: 'weekly_calibration_manual',
  WEEKLY_CALIBRATION_RESULT: 'weekly_calibration_result',
  WEEKLY_CALIBRATION_ERROR: 'weekly_calibration_error',
  CRON_JOB_INITIALIZED: 'cron_job_initialized',
  CUSTOM: 'custom'
};

class TimelineHelperWrapper {
  constructor(homey) {
    this.homey = homey;
  }

  async addTimelineEntry(eventType, details = {}, createNotification = false, additionalData = {}) {
    const title = this._titleFor(eventType) || 'MELCloud Optimizer';
    const message = this._messageFor(eventType, details, additionalData);

    let postedToTimeline = false;

    // Try timeline first
    if (this.homey && this.homey.timeline && typeof this.homey.timeline.createEntry === 'function') {
      try {
        await this.homey.timeline.createEntry({ title, body: message, icon: 'flow:device_changed' });
        postedToTimeline = true;
      } catch (_) {
        postedToTimeline = false;
      }
    }

    // If timeline API is unavailable or failed, always send a notification as fallback
    if (!postedToTimeline && this.homey && this.homey.notifications && typeof this.homey.notifications.createNotification === 'function') {
      try {
        await this.homey.notifications.createNotification({ excerpt: `${title}: ${message}` });
      } catch (_) {}
    } else if (postedToTimeline && createNotification && this.homey && this.homey.notifications && typeof this.homey.notifications.createNotification === 'function') {
      // If timeline succeeded and an explicit notification was requested, send it too
      try {
        await this.homey.notifications.createNotification({ excerpt: `${title}: ${message}` });
      } catch (_) {}
    }
  }

  _titleFor(eventType) {
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

  _messageFor(eventType, details, extra) {
    if (eventType === TimelineEventType.HOURLY_OPTIMIZATION_RESULT) {
      const from = extra?.fromTemp ?? extra?.targetOriginal;
      const to = extra?.toTemp ?? extra?.targetTemp;
      const head = (from !== undefined && to !== undefined)
        ? (from === to
            ? `No change (target ${to}°C)`
            : `Zone1 ${from}°C → ${to}°C`)
        : 'Temperature optimized';

      // Include Zone 2 and Tank if provided
      const parts = [head];
      if (extra?.zone2Original !== undefined && extra?.zone2Temp !== undefined) {
        parts.push(`Zone2 ${extra.zone2Original}°C → ${extra.zone2Temp}°C`);
      }
      if (extra?.tankOriginal !== undefined && extra?.tankTemp !== undefined) {
        parts.push(`Tank ${extra.tankOriginal}°C → ${extra.tankTemp}°C`);
      }

      // Include projected daily savings if available
      if (typeof extra?.dailySavings === 'number') {
        const currency = this._detectCurrency();
        const amount = Number(extra.dailySavings).toFixed(2);
        parts.push(`Projected daily savings: ${amount} ${currency}/day`);
      }

      if (details?.reason) parts.push(details.reason);
      return parts.join(' | ');
    }
    if (eventType === TimelineEventType.WEEKLY_CALIBRATION_RESULT) {
      return `Thermal model calibrated${details?.reason ? ` | ${details.reason}` : ''}`;
    }
    if (eventType === TimelineEventType.CRON_JOB_INITIALIZED) {
      return 'Scheduled tasks started';
    }
    if (eventType === TimelineEventType.CUSTOM) {
      return details?.message || 'Event';
    }
    return 'Event logged';
  }

  _detectCurrency() {
    try {
      // Prefer Homey i18n
      if (this.homey && this.homey.i18n && typeof this.homey.i18n.getCurrency === 'function') {
        const c = this.homey.i18n.getCurrency();
        if (c) return c;
      }
      // Then manual currency setting if any
      const manual = this.homey?.settings?.get && this.homey.settings.get('currency');
      if (manual) return manual;
    } catch (_) {}
    // Default fallback
    return 'EUR';
  }
}

module.exports = { TimelineHelperWrapper, TimelineEventType };
