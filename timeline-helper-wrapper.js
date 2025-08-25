/**
 * Timeline Helper Wrapper
 * JavaScript wrapper for the TypeScript TimelineHelper class
 * Provides standardized timeline entry creation for JavaScript files
 */

/**
 * Currency detection utility using GPS coordinates
 */
class CurrencyDetector {
  static COUNTRY_CURRENCY_MAP = {
    // Europe
    'AT': 'EUR', 'BE': 'EUR', 'CY': 'EUR', 'EE': 'EUR', 'FI': 'EUR', 'FR': 'EUR',
    'DE': 'EUR', 'GR': 'EUR', 'IE': 'EUR', 'IT': 'EUR', 'LV': 'EUR', 'LT': 'EUR',
    'LU': 'EUR', 'MT': 'EUR', 'NL': 'EUR', 'PT': 'EUR', 'SK': 'EUR', 'SI': 'EUR',
    'ES': 'EUR', 'AD': 'EUR', 'MC': 'EUR', 'SM': 'EUR', 'VA': 'EUR',

    // Nordic countries
    'NO': 'NOK', 'SE': 'SEK', 'DK': 'DKK', 'IS': 'ISK',

    // Other European
    'GB': 'GBP', 'CH': 'CHF', 'PL': 'PLN', 'CZ': 'CZK', 'HU': 'HUF',
    'RO': 'RON', 'BG': 'BGN', 'HR': 'HRK',

    // North America
    'US': 'USD', 'CA': 'CAD', 'MX': 'MXN',

    // Asia Pacific
    'JP': 'JPY', 'AU': 'AUD', 'NZ': 'NZD', 'CN': 'CNY', 'KR': 'KRW',
    'IN': 'INR', 'SG': 'SGD', 'HK': 'HKD',

    // Others
    'BR': 'BRL', 'ZA': 'ZAR', 'RU': 'RUB'
  };

  static COORDINATE_RANGES = [
    // Nordic countries (common for heat pumps)
    { name: 'Norway', code: 'NO', lat: [57.0, 71.5], lng: [4.0, 31.5] },
    { name: 'Sweden', code: 'SE', lat: [55.0, 69.5], lng: [10.0, 24.5] },
    { name: 'Denmark', code: 'DK', lat: [54.5, 57.8], lng: [8.0, 15.5] },
    { name: 'Finland', code: 'FI', lat: [59.5, 70.5], lng: [19.0, 31.5] },
    { name: 'Iceland', code: 'IS', lat: [63.0, 67.0], lng: [-25.0, -13.0] },

    // Major European countries
    { name: 'Germany', code: 'DE', lat: [47.0, 55.5], lng: [5.5, 15.5] },
    { name: 'France', code: 'FR', lat: [41.0, 51.5], lng: [-5.5, 10.0] },
    { name: 'United Kingdom', code: 'GB', lat: [49.5, 61.0], lng: [-8.5, 2.0] },
    { name: 'Netherlands', code: 'NL', lat: [50.5, 54.0], lng: [3.0, 7.5] },
    { name: 'Belgium', code: 'BE', lat: [49.5, 51.5], lng: [2.5, 6.5] },
    { name: 'Switzerland', code: 'CH', lat: [45.5, 48.0], lng: [5.5, 11.0] },
    { name: 'Austria', code: 'AT', lat: [46.0, 49.5], lng: [9.5, 17.5] },
    { name: 'Poland', code: 'PL', lat: [49.0, 55.0], lng: [14.0, 24.5] },

    // North America
    { name: 'United States', code: 'US', lat: [24.0, 72.0], lng: [-180.0, -66.0] },
    { name: 'Canada', code: 'CA', lat: [41.5, 84.0], lng: [-141.0, -52.0] },

    // Other regions
    { name: 'Japan', code: 'JP', lat: [24.0, 46.0], lng: [123.0, 146.0] },
    { name: 'Australia', code: 'AU', lat: [-44.0, -10.0], lng: [113.0, 154.0] }
  ];

  /**
   * Detect currency based on GPS coordinates
   * @param {number} latitude Latitude coordinate
   * @param {number} longitude Longitude coordinate
   * @returns {string|null} Currency code (ISO 4217) or null if not detected
   */
  static detectCurrency(latitude, longitude) {
    if (!latitude || !longitude ||
        latitude < -90 || latitude > 90 ||
        longitude < -180 || longitude > 180) {
      return null;
    }

    // Find matching country based on coordinates
    for (const region of this.COORDINATE_RANGES) {
      const [latMin, latMax] = region.lat;
      const [lngMin, lngMax] = region.lng;

      if (latitude >= latMin && latitude <= latMax &&
          longitude >= lngMin && longitude <= lngMax) {
        return this.COUNTRY_CURRENCY_MAP[region.code] || null;
      }
    }

    return null;
  }

  /**
   * Get currency with fallback chain
   * @param {object} homey Homey app instance
   * @returns {string} Currency code
   */
  static getCurrencyWithFallback(homey) {
    // 1. Try manual currency setting (if exists)
    const manualCurrency = homey.settings?.get('currency');
    if (manualCurrency) {
      return manualCurrency;
    }

    // 2. Try GPS-based detection
    const latitude = homey.settings?.get('latitude');
    const longitude = homey.settings?.get('longitude');

    if (latitude && longitude) {
      const detectedCurrency = this.detectCurrency(latitude, longitude);
      if (detectedCurrency) {
        return detectedCurrency;
      }
    }

    // 3. Try Homey's i18n currency
    if (homey.i18n?.getCurrency) {
      const i18nCurrency = homey.i18n.getCurrency();
      if (i18nCurrency) {
        return i18nCurrency;
      }
    }

    // 4. Default fallback
    return 'EUR';
  }
}

// Define timeline entry types (must match the TypeScript enum)
const TimelineEntryType = {
  INFO: 'info',
  SUCCESS: 'success',
  WARNING: 'warning',
  ERROR: 'error'
};

// Define timeline event types (must match the TypeScript enum)
const TimelineEventType = {
  // Optimization events
  HOURLY_OPTIMIZATION: 'hourly_optimization',
  HOURLY_OPTIMIZATION_MANUAL: 'hourly_optimization_manual',
  HOURLY_OPTIMIZATION_RESULT: 'hourly_optimization_result',
  HOURLY_OPTIMIZATION_ERROR: 'hourly_optimization_error',

  // Calibration events
  WEEKLY_CALIBRATION: 'weekly_calibration',
  WEEKLY_CALIBRATION_MANUAL: 'weekly_calibration_manual',
  WEEKLY_CALIBRATION_RESULT: 'weekly_calibration_result',
  WEEKLY_CALIBRATION_ERROR: 'weekly_calibration_error',

  // System events
  SYSTEM_STARTUP: 'system_startup',
  SYSTEM_HEALTH_CHECK: 'system_health_check',
  SYSTEM_HEALTH_ERROR: 'system_health_error',
  SYSTEM_RECOVERY: 'system_recovery',
  CRON_JOB_STATUS: 'cron_job_status',
  CRON_JOB_INITIALIZED: 'cron_job_initialized',

  // Additional events for API functions
  DEVICE_LIST_RETRIEVED: 'device_list_retrieved',
  OPTIMIZER_SETTINGS_UPDATED: 'optimizer_settings_updated',
  THERMAL_MODEL_DATA_RETRIEVED: 'thermal_model_data_retrieved',
  COP_DATA_RETRIEVED: 'cop_data_retrieved',
  WEEKLY_COP_CALCULATED: 'weekly_cop_calculated',
  MELCLOUD_STATUS_CHECK: 'melcloud_status_check',
  TIBBER_STATUS_CHECK: 'tibber_status_check',
  MEMORY_USAGE_CHECK: 'memory_usage_check',
  DATA_CLEANUP: 'data_cleanup',

  // Custom message (for backward compatibility)
  CUSTOM: 'custom'
};

/**
 * Timeline Helper Wrapper class
 * Provides a JavaScript interface to the TypeScript TimelineHelper
 */
class TimelineHelperWrapper {
  /**
   * Constructor
   * @param {Object} homey - Homey app instance
   */
  constructor(homey) {
    this.homey = homey;
    this.logger = homey.app;
    this.timelineHelper = homey.app.timelineHelper;
  }

  /**
   * Add a timeline entry using standardized templates
   * @param {string} eventType - Type of event from TimelineEventType
   * @param {Object} details - Optional details to replace placeholders in the template
   * @param {boolean} createNotification - Override default notification setting
   * @param {Object} additionalData - Additional data for specialized formatting
   * @returns {Promise<boolean>} - Promise resolving to true if successful
   */
  async addTimelineEntry(eventType, details, createNotification, additionalData) {
    try {
      // If we have access to the TypeScript TimelineHelper, use it
      if (this.timelineHelper) {
        return await this.timelineHelper.addTimelineEntry(
          eventType,
          details,
          createNotification,
          additionalData
        );
      }

      // Otherwise, implement fallback logic
      this.logger.log(`Creating timeline entry for event type: ${eventType}`);

      // Create a basic message based on the event type
      let title = 'MELCloud Optimizer';
      let message = '';
      let icon = 'flow:device_changed';

      // Set message based on event type
      switch (eventType) {
        case TimelineEventType.HOURLY_OPTIMIZATION:
          message = '🕒 Automatic hourly optimization | Adjusting temperatures based on price and COP';
          break;
        case TimelineEventType.HOURLY_OPTIMIZATION_MANUAL:
          message = '🔄 Manual hourly optimization | Optimizing based on current prices and COP';
          break;
        case TimelineEventType.HOURLY_OPTIMIZATION_RESULT:
          title = 'Hourly Optimization Completed';
          message = 'Temperature optimized based on electricity prices';

          // Add details if available
          if (additionalData) {
            console.log('Timeline Debug - additionalData:', JSON.stringify(additionalData, null, 2));
            
            // Add heating temperature information if available
            if (additionalData.targetTemp !== undefined && additionalData.targetOriginal !== undefined) {
              console.log('Timeline Debug - Adding temperature info:', additionalData.targetOriginal, '→', additionalData.targetTemp);
              message += ` from ${additionalData.targetOriginal}°C to ${additionalData.targetTemp}°C`;
            } else {
              console.log('Timeline Debug - Temperature data missing. targetTemp:', additionalData.targetTemp, 'targetOriginal:', additionalData.targetOriginal);
            }

            // Add hot water tank temperature information if available
            if (additionalData.tankTemp !== undefined && additionalData.tankOriginal !== undefined) {
              console.log('Timeline Debug - Adding hot water tank info:', additionalData.tankOriginal, '→', additionalData.tankTemp);
              message += `. Hot water tank: ${additionalData.tankOriginal}°C to ${additionalData.tankTemp}°C`;
            } else {
              console.log('Timeline Debug - Hot water tank data missing. tankTemp:', additionalData.tankTemp, 'tankOriginal:', additionalData.tankOriginal);
            }

            // Add Zone2 temperature information if available
            if (additionalData.zone2Temp !== undefined && additionalData.zone2Original !== undefined) {
              console.log('Timeline Debug - Adding Zone2 info:', additionalData.zone2Original, '→', additionalData.zone2Temp);
              message += `. Zone2: ${additionalData.zone2Original}°C to ${additionalData.zone2Temp}°C`;
            } else {
              console.log('Timeline Debug - Zone2 data missing. zone2Temp:', additionalData.zone2Temp, 'zone2Original:', additionalData.zone2Original);
            }

            // Add savings information if available - prioritize daily savings over hourly
            if (additionalData.dailySavings !== undefined || additionalData.savings !== undefined) {
              try {
                // Get the user's locale or default to the system locale
                const userLocale = this.homey.i18n?.getLanguage() || 'en-US';

                // Use GPS-based currency detection with fallback chain
                const userCurrency = CurrencyDetector.getCurrencyWithFallback(this.homey);

                // Format the savings amount with proper currency formatting based on locale
                const savingsAmount = additionalData.dailySavings !== undefined ?
                  additionalData.dailySavings :
                  (additionalData.savings * 24); // Convert hourly to daily if dailySavings not available

                // Use Intl.NumberFormat for proper currency formatting
                const formattedSavings = new Intl.NumberFormat(userLocale, {
                  style: 'currency',
                  currency: userCurrency,
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2
                }).format(savingsAmount);

                message += `. Projected daily savings: ${formattedSavings}`;
              } catch (error) {
                // Fallback to simple formatting if there's an error with locale/currency
                const savingsAmount = additionalData.dailySavings !== undefined ?
                  additionalData.dailySavings :
                  (additionalData.savings * 24);
                message += `. Projected daily savings: €${savingsAmount.toFixed(2)}`;
                this.logger.error('Error formatting currency:', error);
              }
            }
          }
          break;
        case TimelineEventType.WEEKLY_CALIBRATION:
          message = '📈 Automatic weekly calibration | Updating thermal model with latest data';
          break;
        case TimelineEventType.WEEKLY_CALIBRATION_MANUAL:
          message = '📊 Manual weekly calibration | Analyzing thermal model based on collected data';
          break;
        case TimelineEventType.WEEKLY_CALIBRATION_RESULT:
          title = 'Weekly Calibration Completed';
          message = 'Thermal model updated with latest data';

          // Add details if available
          if (additionalData) {
            if (additionalData.oldK !== undefined && additionalData.newK !== undefined) {
              message += `. K-factor adjusted from ${additionalData.oldK.toFixed(2)} to ${additionalData.newK.toFixed(2)}`;
            }

            if (additionalData.method) {
              message += ` using ${additionalData.method} method`;
            }
          }
          break;
        case TimelineEventType.CRON_JOB_STATUS:
          message = '⏱️ Cron job status checked';
          break;
        case TimelineEventType.CRON_JOB_INITIALIZED:
          message = '🕓 Scheduled jobs initialized';
          break;
        case TimelineEventType.CUSTOM:
          // For custom messages, use the details.message property
          message = details && details.message ? details.message : 'Custom message';
          break;
        default:
          message = 'Timeline event';
          break;
      }

      // Replace placeholders in the message with details
      if (details) {
        Object.entries(details).forEach(([key, value]) => {
          message = message.replace(`{${key}}`, String(value));
        });
      }

      // Try to create the timeline entry using available APIs
      return await this.createTimelineEntryWithFallbacks(title, message, icon, createNotification);
    } catch (error) {
      this.logger.error('Error creating timeline entry:', error);
      return false;
    }
  }

  /**
   * Create a timeline entry with fallbacks to different APIs
   * @param {string} title - Entry title
   * @param {string} message - Entry message
   * @param {string} icon - Entry icon
   * @param {boolean} createNotification - Whether to create a notification
   * @returns {Promise<boolean>} - Promise resolving to true if successful
   */
  async createTimelineEntryWithFallbacks(title, message, icon = 'flow:device_changed', createNotification = false) {
    try {
      let success = false;

      // Try the direct timeline API first
      try {
        if (typeof this.homey.timeline === 'object' && typeof this.homey.timeline.createEntry === 'function') {
          await this.homey.timeline.createEntry({
            title: title,
            body: message,
            icon: icon
          });
          this.logger.log('Timeline entry created using timeline API');
          success = true;
        }
      } catch (timelineError) {
        this.logger.error('Failed to create timeline entry using timeline API:', timelineError);
      }

      // If timeline API failed, try notifications API
      if (!success) {
        try {
          if (typeof this.homey.notifications === 'object' && typeof this.homey.notifications.createNotification === 'function') {
            await this.homey.notifications.createNotification({
              excerpt: `${title}: ${message}`
            });
            this.logger.log('Timeline entry created using notifications API');
            success = true;
          }
        } catch (notifyError) {
          this.logger.error('Failed to create timeline entry using notifications API:', notifyError);
        }
      }

      // If notifications API failed, try flow API
      if (!success) {
        try {
          if (this.homey.app && this.homey.app.flow && typeof this.homey.app.flow.runFlowCardAction === 'function') {
            await this.homey.app.flow.runFlowCardAction({
              uri: 'homey:flowcardaction:homey:manager:timeline:log',
              args: { text: `${title}: ${message}` }
            });
            this.logger.log('Timeline entry created using flow API');
            success = true;
          }
        } catch (flowError) {
          this.logger.error('Failed to create timeline entry using flow API:', flowError);
        }
      }

      // If all APIs failed, log the failure
      if (!success) {
        this.logger.log('No timeline API available, using log only');
      }

      // Create notification if requested
      if (createNotification && success) {
        try {
          if (typeof this.homey.notifications === 'object' && typeof this.homey.notifications.createNotification === 'function') {
            await this.homey.notifications.createNotification({
              excerpt: `${title}: ${message}`
            });
            this.logger.log('Notification created');
          }
        } catch (notifyError) {
          this.logger.error('Failed to create notification:', notifyError);
        }
      }

      return success;
    } catch (error) {
      this.logger.error('Error in createTimelineEntryWithFallbacks:', error);
      return false;
    }
  }
}

module.exports = {
  TimelineHelperWrapper,
  TimelineEntryType,
  TimelineEventType
};
