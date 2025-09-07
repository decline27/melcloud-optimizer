/**
 * Timeline Helper
 * Provides utility functions for creating timeline entries and notifications
 * with standardized formatting and fallback mechanisms
 */

import { HomeyApp } from '../types';

/**
 * Currency detection utility using GPS coordinates
 */
class CurrencyDetector {
  private static readonly COUNTRY_CURRENCY_MAP: Record<string, string> = {
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

  private static readonly COORDINATE_RANGES: Array<{
    name: string;
    code: string;
    lat: [number, number];
    lng: [number, number];
  }> = [
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
   * @param latitude Latitude coordinate
   * @param longitude Longitude coordinate
   * @returns Currency code (ISO 4217) or null if not detected
   */
  static detectCurrency(latitude: number, longitude: number): string | null {
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
   * @param homey Homey app instance
   * @returns Currency code
   */
  static getCurrencyWithFallback(homey: HomeyApp): string {
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

/**
 * Timeline entry types
 */
export enum TimelineEntryType {
  INFO = 'info',
  SUCCESS = 'success',
  WARNING = 'warning',
  ERROR = 'error'
}

/**
 * Timeline event types for standardized message templates
 */
export enum TimelineEventType {
  // Optimization events
  HOURLY_OPTIMIZATION = 'hourly_optimization',
  HOURLY_OPTIMIZATION_MANUAL = 'hourly_optimization_manual',
  HOURLY_OPTIMIZATION_RESULT = 'hourly_optimization_result',
  HOURLY_OPTIMIZATION_ERROR = 'hourly_optimization_error',

  // Calibration events
  WEEKLY_CALIBRATION = 'weekly_calibration',
  WEEKLY_CALIBRATION_MANUAL = 'weekly_calibration_manual',
  WEEKLY_CALIBRATION_RESULT = 'weekly_calibration_result',
  WEEKLY_CALIBRATION_ERROR = 'weekly_calibration_error',

  // System events
  SYSTEM_STARTUP = 'system_startup',
  SYSTEM_HEALTH_CHECK = 'system_health_check',
  SYSTEM_HEALTH_ERROR = 'system_health_error',
  SYSTEM_RECOVERY = 'system_recovery',
  CRON_JOB_STATUS = 'cron_job_status',
  CRON_JOB_INITIALIZED = 'cron_job_initialized',

  // Custom message (for backward compatibility)
  CUSTOM = 'custom'
}

/**
 * Timeline template interface
 */
export interface TimelineTemplate {
  title: string;
  message: string;
  type: TimelineEntryType;
  icon: string;
  createNotification: boolean;
}

/**
 * Timeline entry options
 */
export interface TimelineEntryOptions {
  title: string;
  message: string;
  type?: TimelineEntryType;
  icon?: string;
  createNotification?: boolean;
}

/**
 * Timeline Helper class
 */
export class TimelineHelper {
  /**
   * Standardized message templates for different event types
   */
  private static readonly TIMELINE_TEMPLATES: Record<TimelineEventType, TimelineTemplate> = {
    // Optimization events
    [TimelineEventType.HOURLY_OPTIMIZATION]: {
      title: 'MELCloud Optimizer',
      message: '🕒 Automatic hourly optimization | Adjusting temperatures based on price and COP',
      type: TimelineEntryType.INFO,
      icon: 'mdi:clock-outline',
      createNotification: false
    },
    [TimelineEventType.HOURLY_OPTIMIZATION_MANUAL]: {
      title: 'MELCloud Optimizer',
      message: '🔄 Manual hourly optimization | Optimizing based on current prices and COP',
      type: TimelineEntryType.INFO,
      icon: 'mdi:refresh',
      createNotification: true
    },
    [TimelineEventType.HOURLY_OPTIMIZATION_RESULT]: {
      title: 'Hourly Optimization Completed',
      message: 'Temperature optimized based on electricity prices',
      type: TimelineEntryType.SUCCESS,
      icon: 'mdi:check-circle',
      createNotification: false
    },
    [TimelineEventType.HOURLY_OPTIMIZATION_ERROR]: {
      title: 'Hourly Optimization Failed',
      message: '{error}',
      type: TimelineEntryType.ERROR,
      icon: 'mdi:alert-circle',
      createNotification: true
    },

    // Calibration events
    [TimelineEventType.WEEKLY_CALIBRATION]: {
      title: 'MELCloud Optimizer',
      message: '📈 Automatic weekly calibration | Updating thermal model with latest data',
      type: TimelineEntryType.INFO,
      icon: 'mdi:chart-line',
      createNotification: false
    },
    [TimelineEventType.WEEKLY_CALIBRATION_MANUAL]: {
      title: 'MELCloud Optimizer',
      message: '📊 Manual weekly calibration | Analyzing thermal model based on collected data',
      type: TimelineEntryType.INFO,
      icon: 'mdi:chart-bell-curve',
      createNotification: true
    },
    [TimelineEventType.WEEKLY_CALIBRATION_RESULT]: {
      title: 'Weekly Calibration Completed',
      message: 'Thermal model updated with latest data',
      type: TimelineEntryType.SUCCESS,
      icon: 'mdi:check-circle',
      createNotification: false
    },
    [TimelineEventType.WEEKLY_CALIBRATION_ERROR]: {
      title: 'Weekly Calibration Failed',
      message: '{error}',
      type: TimelineEntryType.ERROR,
      icon: 'mdi:alert-circle',
      createNotification: true
    },

    // System events
    [TimelineEventType.SYSTEM_STARTUP]: {
      title: 'MELCloud Optimizer',
      message: '🚀 System started | Optimizer initialized and ready',
      type: TimelineEntryType.INFO,
      icon: 'mdi:power',
      createNotification: false
    },
    [TimelineEventType.SYSTEM_HEALTH_CHECK]: {
      title: 'System Health Check',
      message: 'System health check passed successfully',
      type: TimelineEntryType.INFO,
      icon: 'mdi:heart-pulse',
      createNotification: false
    },
    [TimelineEventType.SYSTEM_HEALTH_ERROR]: {
      title: 'System Health Check Issues',
      message: 'Found {count} issues: {issues}',
      type: TimelineEntryType.WARNING,
      icon: 'mdi:alert',
      createNotification: true
    },
    [TimelineEventType.SYSTEM_RECOVERY]: {
      title: 'System Recovery',
      message: 'Successfully recovered from system health issues',
      type: TimelineEntryType.SUCCESS,
      icon: 'mdi:backup-restore',
      createNotification: false
    },
    [TimelineEventType.CRON_JOB_STATUS]: {
      title: 'MELCloud Optimizer',
      message: '⏱️ Cron job status checked',
      type: TimelineEntryType.INFO,
      icon: 'mdi:timer-outline',
      createNotification: false
    },
    [TimelineEventType.CRON_JOB_INITIALIZED]: {
      title: 'MELCloud Optimizer',
      message: '🕓 Scheduled jobs initialized',
      type: TimelineEntryType.INFO,
      icon: 'mdi:calendar-clock',
      createNotification: false
    },

    // Custom message (for backward compatibility)
    [TimelineEventType.CUSTOM]: {
      title: 'MELCloud Optimizer',
      message: '{message}',
      type: TimelineEntryType.INFO,
      icon: 'mdi:information',
      createNotification: false
    }
  };

  /**
   * Constructor
   * @param homey Homey app instance
   * @param logger Logger instance
   */
  constructor(
    private readonly homey: HomeyApp,
    private readonly logger: { log: Function; error: Function }
  ) {}

  /**
   * Add a timeline entry using standardized templates
   * @param eventType Type of event from TimelineEventType enum
   * @param details Optional details to replace placeholders in the template
   * @param createNotification Override default notification setting
   * @param additionalData Additional data for specialized formatting
   * @returns Promise resolving to true if successful
   */
  public async addTimelineEntry(
    eventType: TimelineEventType,
    details?: Record<string, any>,
    createNotification?: boolean,
    additionalData?: Record<string, any>
  ): Promise<boolean> {
    try {
      // Get the template for this event type
      const template = TimelineHelper.TIMELINE_TEMPLATES[eventType];
      if (!template) {
        this.logger.error(`No template found for event type: ${eventType}`);
        return false;
      }

      // Format the message by replacing placeholders with details
      let message = template.message;
      if (details) {
        Object.entries(details).forEach(([key, value]) => {
          message = message.replace(`{${key}}`, String(value));
        });
      }

      // Add additional data to the message if provided
      if (additionalData) {
        // Handle specific event types with custom formatting
        if (eventType === TimelineEventType.HOURLY_OPTIMIZATION_RESULT) {
          // Add heating temperature information if available
          if (additionalData.targetTemp !== undefined && additionalData.targetOriginal !== undefined) {
            message += ` from ${additionalData.targetOriginal}°C to ${additionalData.targetTemp}°C`;
          }

          // Add hot water tank temperature information if available
          if (additionalData.tankTemp !== undefined && additionalData.tankOriginal !== undefined) {
            message += `. Hot water tank: ${additionalData.tankOriginal}°C to ${additionalData.tankTemp}°C`;
          }

          // Add savings information
          // Prefer an accumulated "today so far" value if provided
          if (additionalData.todaySoFar !== undefined) {
            try {
              const userLocale = this.homey.i18n?.getLanguage() || 'en-US';
              const userCurrency = CurrencyDetector.getCurrencyWithFallback(this.homey);

              const formattedToday = new Intl.NumberFormat(userLocale, {
                style: 'currency',
                currency: userCurrency,
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
              }).format(additionalData.todaySoFar);

              message += `. Today so far: ${formattedToday}`;
            } catch (error) {
              message += `. Today so far: €${Number(additionalData.todaySoFar).toFixed(2)}`;
              this.logger.error('Error formatting currency:', error);
            }
          }
          // Otherwise, fall back to projected daily savings (legacy behaviour)
          else if (additionalData.dailySavings !== undefined || additionalData.savings !== undefined) {
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
        } else if (eventType === TimelineEventType.WEEKLY_CALIBRATION_RESULT) {
          if (additionalData.oldK !== undefined && additionalData.newK !== undefined) {
            message += `. K-factor adjusted from ${additionalData.oldK.toFixed(2)} to ${additionalData.newK.toFixed(2)}`;
          }

          if (additionalData.method) {
            message += ` using ${additionalData.method} method`;
          }

          // Optionally append weekly savings total if provided
          if (additionalData.weeklySavings !== undefined) {
            try {
              const userLocale = this.homey.i18n?.getLanguage() || 'en-US';
              const userCurrency = CurrencyDetector.getCurrencyWithFallback(this.homey);

              const formattedWeekly = new Intl.NumberFormat(userLocale, {
                style: 'currency',
                currency: userCurrency,
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
              }).format(additionalData.weeklySavings);

              message += `. Weekly total savings: ${formattedWeekly}`;
            } catch (error) {
              message += `. Weekly total savings: €${Number(additionalData.weeklySavings).toFixed(2)}`;
              this.logger.error('Error formatting currency for weekly savings:', error);
            }
          }
        } else if (
          eventType === TimelineEventType.WEEKLY_CALIBRATION ||
          eventType === TimelineEventType.WEEKLY_CALIBRATION_MANUAL
        ) {
          // For weekly start events, append current weekly total if provided
          if (additionalData.weeklySavings !== undefined) {
            try {
              const userLocale = this.homey.i18n?.getLanguage() || 'en-US';
              const userCurrency = CurrencyDetector.getCurrencyWithFallback(this.homey);

              const formattedWeekly = new Intl.NumberFormat(userLocale, {
                style: 'currency',
                currency: userCurrency,
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
              }).format(additionalData.weeklySavings);

              message += `. Weekly total so far: ${formattedWeekly}`;
            } catch (error) {
              message += `. Weekly total so far: €${Number(additionalData.weeklySavings).toFixed(2)}`;
              this.logger.error('Error formatting currency for weekly savings (start):', error);
            }
          }
        }
      }

      // Determine whether to create a notification
      const shouldCreateNotification = createNotification !== undefined ? createNotification : template.createNotification;

      // Create the timeline entry with all APIs
      return await this.createTimelineEntryWithFallbacks({
        title: template.title,
        message: message,
        type: template.type,
        icon: template.icon,
        createNotification: shouldCreateNotification
      });
    } catch (error) {
      this.logger.error(`Error creating timeline entry for event type ${eventType}:`, error);
      return false;
    }
  }

  /**
   * Create a timeline entry with fallbacks to different APIs
   * @param options Timeline entry options
   * @returns Promise resolving to true if successful
   */
  private async createTimelineEntryWithFallbacks(options: TimelineEntryOptions): Promise<boolean> {
    try {
      // Validate options
      if (!options.title || !options.message) {
        this.logger.error('Invalid timeline entry options: title and message are required');
        return false;
      }

      // Set default type if not provided
      const type = options.type || TimelineEntryType.INFO;

      // Set default icon if not provided
      const icon = options.icon || 'mdi:calendar-clock';

      let success = false;

      // Try each API method in sequence until one succeeds
      success = await this.tryTimelineAPI(options.title, options.message, icon, type) ||
                await this.tryNotificationsAPI(options.title, options.message) ||
                await this.tryFlowAPI(options.title, options.message);

      // If all APIs failed, log the failure
      if (!success) {
        this.logger.log('No timeline API available, using log only');
      }

      // Create notification if requested and we have the API
      if (options.createNotification) {
        try {
          await this.createNotification(options.title, options.message);
        } catch (notifyError) {
          this.logger.error('Failed to create notification:', notifyError);
        }
      }

      return success;
    } catch (error) {
      this.logger.error('Error creating timeline entry with fallbacks:', error);
      return false;
    }
  }

  /**
   * Try to create a timeline entry using the timeline API
   * @param title Entry title
   * @param message Entry message
   * @param icon Entry icon
   * @param type Entry type
   * @returns Promise resolving to true if successful
   */
  private async tryTimelineAPI(
    title: string,
    message: string,
    icon: string,
    type: TimelineEntryType
  ): Promise<boolean> {
    try {
      if (this.homey.timeline) {
        await this.homey.timeline.createEntry({
          title: title,
          body: message,
          icon,
          type
        });
        this.logger.log(`Timeline entry created using timeline API: ${title}`);
        return true;
      }
    } catch (timelineError) {
      this.logger.error('Failed to create timeline entry using timeline API:', timelineError);
    }
    return false;
  }

  /**
   * Try to create a timeline entry using the notifications API
   * @param title Entry title
   * @param message Entry message
   * @returns Promise resolving to true if successful
   */
  private async tryNotificationsAPI(title: string, message: string): Promise<boolean> {
    try {
      if (this.homey.notifications) {
        await this.homey.notifications.createNotification({
          excerpt: `${title}: ${message}`
        });
        this.logger.log(`Timeline entry created using notifications API: ${title}`);
        return true;
      }
    } catch (notifyError) {
      this.logger.error('Failed to create timeline entry using notifications API:', notifyError);
    }
    return false;
  }

  /**
   * Try to create a timeline entry using the flow API
   * @param title Entry title
   * @param message Entry message
   * @returns Promise resolving to true if successful
   */
  private async tryFlowAPI(title: string, message: string): Promise<boolean> {
    try {
      if (this.homey.flow && typeof this.homey.flow.runFlowCardAction === 'function') {
        await this.homey.flow.runFlowCardAction({
          uri: 'homey:flowcardaction:homey:manager:timeline:log',
          args: { text: `${title}: ${message}` }
        });
        this.logger.log(`Timeline entry created using flow API: ${title}`);
        return true;
      }
    } catch (flowError) {
      this.logger.error('Failed to create timeline entry using flow API:', flowError);
    }
    return false;
  }

  /**
   * Create a notification
   * @param title Notification title
   * @param message Notification message
   * @returns Promise resolving to true if successful
   */
  public async createNotification(title: string, message: string): Promise<boolean> {
    try {
      // Create notification
      if (this.homey.notifications) {
        await this.homey.notifications.createNotification({
          excerpt: `${title}: ${message}`
        });

        this.logger.log(`Notification created: ${title}`);
        return true;
      } else {
        this.logger.log(`Notifications API not available, skipping notification: ${title}`);
        return false;
      }
    } catch (error) {
      this.logger.error('Error creating notification:', error);
      return false;
    }
  }

  /**
   * Create a timeline entry (legacy method for backward compatibility)
   * @param options Timeline entry options
   * @returns Promise resolving to true if successful
   */
  public async createTimelineEntry(options: TimelineEntryOptions): Promise<boolean> {
    return this.createTimelineEntryWithFallbacks(options);
  }

  /**
   * Create an info timeline entry (legacy method for backward compatibility)
   * @param title Entry title
   * @param message Entry message
   * @param createNotification Whether to create a notification
   * @returns Promise resolving to true if successful
   */
  public async createInfoEntry(
    title: string,
    message: string,
    createNotification: boolean = false
  ): Promise<boolean> {
    return this.createTimelineEntryWithFallbacks({
      title,
      message,
      type: TimelineEntryType.INFO,
      icon: 'mdi:information',
      createNotification
    });
  }

  /**
   * Create a success timeline entry (legacy method for backward compatibility)
   * @param title Entry title
   * @param message Entry message
   * @param createNotification Whether to create a notification
   * @returns Promise resolving to true if successful
   */
  public async createSuccessEntry(
    title: string,
    message: string,
    createNotification: boolean = false
  ): Promise<boolean> {
    return this.createTimelineEntryWithFallbacks({
      title,
      message,
      type: TimelineEntryType.SUCCESS,
      icon: 'mdi:check-circle',
      createNotification
    });
  }

  /**
   * Create a warning timeline entry (legacy method for backward compatibility)
   * @param title Entry title
   * @param message Entry message
   * @param createNotification Whether to create a notification
   * @returns Promise resolving to true if successful
   */
  public async createWarningEntry(
    title: string,
    message: string,
    createNotification: boolean = true
  ): Promise<boolean> {
    return this.createTimelineEntryWithFallbacks({
      title,
      message,
      type: TimelineEntryType.WARNING,
      icon: 'mdi:alert',
      createNotification
    });
  }

  /**
   * Create an error timeline entry (legacy method for backward compatibility)
   * @param title Entry title
   * @param message Entry message
   * @param createNotification Whether to create a notification
   * @returns Promise resolving to true if successful
   */
  public async createErrorEntry(
    title: string,
    message: string,
    createNotification: boolean = true
  ): Promise<boolean> {
    return this.createTimelineEntryWithFallbacks({
      title,
      message,
      type: TimelineEntryType.ERROR,
      icon: 'mdi:alert-circle',
      createNotification
    });
  }
}
