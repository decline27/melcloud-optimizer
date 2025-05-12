/**
 * Timeline Helper Wrapper
 * JavaScript wrapper for the TypeScript TimelineHelper class
 * Provides standardized timeline entry creation for JavaScript files
 */

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
            // Add heating temperature information if available
            if (additionalData.targetTemp !== undefined && additionalData.targetOriginal !== undefined) {
              message += ` from ${additionalData.targetOriginal}°C to ${additionalData.targetTemp}°C`;
            }

            // Add hot water tank temperature information if available
            if (additionalData.tankTemp !== undefined && additionalData.tankOriginal !== undefined) {
              message += `. Hot water tank: ${additionalData.tankOriginal}°C to ${additionalData.tankTemp}°C`;
            }

            // Add savings information if available - prioritize daily savings over hourly
            if (additionalData.dailySavings !== undefined || additionalData.savings !== undefined) {
              try {
                // Get the user's locale or default to the system locale
                const userLocale = this.homey.i18n?.getLanguage() || 'en-US';
                // Get the user's currency or default to EUR
                const userCurrency = this.homey.settings?.get('currency') ||
                                    (this.homey.i18n?.getCurrency ? this.homey.i18n.getCurrency() : 'EUR');

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
