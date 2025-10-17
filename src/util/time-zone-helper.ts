import { Logger } from './logger';

/**
 * UTC offset to IANA timezone mapping for common offsets
 */
const OFFSET_TO_IANA_MAP: Record<number, string> = {
  [-12]: 'Pacific/Kwajalein',
  [-11]: 'Pacific/Midway', 
  [-10]: 'Pacific/Honolulu',
  [-9]: 'America/Anchorage',
  [-8]: 'America/Los_Angeles',
  [-7]: 'America/Denver',
  [-6]: 'America/Chicago',
  [-5]: 'America/New_York',
  [-4]: 'America/Halifax',
  [-3]: 'America/Sao_Paulo',
  [-2]: 'Atlantic/South_Georgia',
  [-1]: 'Atlantic/Azores',
  [0]: 'Europe/London',
  [1]: 'Europe/Stockholm',    // Most common for this app
  [2]: 'Europe/Helsinki',
  [3]: 'Europe/Moscow',
  [4]: 'Asia/Dubai',
  [5]: 'Asia/Karachi',
  [5.5]: 'Asia/Kolkata',
  [6]: 'Asia/Dhaka',
  [7]: 'Asia/Bangkok',
  [8]: 'Asia/Shanghai',
  [9]: 'Asia/Tokyo',
  [9.5]: 'Australia/Adelaide',
  [10]: 'Australia/Sydney',
  [11]: 'Pacific/Noumea',
  [12]: 'Pacific/Auckland',
  [13]: 'Pacific/Tongatapu'
};

/**
 * Time Zone Helper
 * Provides utilities for handling time zones and DST with enhanced migration support
 */
export class TimeZoneHelper {
  private timeZoneOffset: number;
  private useDST: boolean;
  private logger: Logger;
  private timeZoneName?: string;

  /**
   * Constructor
   * @param logger Logger instance
   * @param timeZoneOffset Time zone offset in hours (default: 2)
   * @param useDST Whether to use DST (default: false)
   * @param timeZoneName IANA timezone name (preferred)
   */
  constructor(
    logger: Logger,
    timeZoneOffset: number = 2,
    useDST: boolean = false,
    timeZoneName?: string
  ) {
    this.logger = logger;
    this.timeZoneOffset = timeZoneOffset;
    this.useDST = useDST;
    this.timeZoneName = timeZoneName;

    // Validate IANA timezone if provided
    if (timeZoneName && !this.validateTimezone(timeZoneName)) {
      this.logger.warn(`Invalid IANA timezone '${timeZoneName}', falling back to offset-based calculation`);
      this.timeZoneName = undefined;
    }
  }

  /**
   * Validate IANA timezone name
   * @param timezone IANA timezone name to validate
   * @returns True if valid
   */
  public static validateTimezone(timezone: string): boolean {
    if (!timezone || typeof timezone !== 'string') return false;
    try {
      Intl.DateTimeFormat(undefined, { timeZone: timezone });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Validate IANA timezone name (instance method)
   * @param timezone IANA timezone name to validate
   * @returns True if valid
   */
  private validateTimezone(timezone: string): boolean {
    return TimeZoneHelper.validateTimezone(timezone);
  }

  /**
   * Convert UTC offset to equivalent IANA timezone
   * @param offset UTC offset in hours
   * @returns IANA timezone name or null if no mapping exists
   */
  public static offsetToIANA(offset: number): string | null {
    return OFFSET_TO_IANA_MAP[offset] || null;
  }

  /**
   * Auto-detect system timezone
   * @returns IANA timezone name or null if detection fails
   */
  public static detectSystemTimezone(): string | null {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return null;
    }
  }

  /**
   * Update settings with enhanced validation and migration
   * @param timeZoneOffset Time zone offset in hours
   * @param useDST Whether to use DST
   * @param timeZoneName Optional IANA time zone name
   */
  public updateSettings(timeZoneOffset: number, useDST: boolean, timeZoneName?: string): void {
    this.timeZoneOffset = timeZoneOffset;
    this.useDST = useDST;
    
    // Validate and set timezone name
    if (timeZoneName && this.validateTimezone(timeZoneName)) {
      this.timeZoneName = timeZoneName;
    } else if (timeZoneName) {
      this.logger.warn(`Invalid IANA timezone '${timeZoneName}', ignoring`);
      this.timeZoneName = undefined;
    } else {
      this.timeZoneName = undefined;
    }

    if (this.logger && typeof this.logger.log === 'function') {
      this.logger.log(
        `Time zone settings updated: offset=${timeZoneOffset}, DST=${useDST}, name=${this.timeZoneName || 'n/a'}`
      );
    }
  }

  /**
   * Get current configuration status for migration purposes
   * @returns Configuration status object
   */
  public getConfigurationStatus(): {
    hasIANA: boolean;
    hasManual: boolean;
    preferredApproach: 'IANA' | 'MANUAL' | 'NONE';
    suggestedIANA?: string;
  } {
    const hasIANA = !!this.timeZoneName;
    const hasManual = this.timeZoneOffset !== 2 || this.useDST; // 2 is the default offset
    
    let preferredApproach: 'IANA' | 'MANUAL' | 'NONE' = 'NONE';
    let suggestedIANA: string | undefined;

    if (hasIANA) {
      preferredApproach = 'IANA';
    } else if (hasManual) {
      preferredApproach = 'MANUAL';
      suggestedIANA = OFFSET_TO_IANA_MAP[this.timeZoneOffset];
    }

    return {
      hasIANA,
      hasManual,
      preferredApproach,
      suggestedIANA
    };
  }

  /**
   * Attempt to migrate from manual offset to IANA timezone
   * @returns Migration result with new timezone or null if migration not possible
   */
  public attemptMigration(): { success: boolean; newTimezone?: string; reason: string } {
    const status = this.getConfigurationStatus();
    
    if (status.hasIANA) {
      return { success: false, reason: 'Already using IANA timezone' };
    }

    if (!status.hasManual) {
      // Try to auto-detect system timezone
      const detected = TimeZoneHelper.detectSystemTimezone();
      if (detected && this.validateTimezone(detected)) {
        return { success: true, newTimezone: detected, reason: 'Auto-detected system timezone' };
      }
      return { success: false, reason: 'No configuration to migrate and auto-detection failed' };
    }

    // Try to convert offset to IANA
    if (status.suggestedIANA) {
      return { 
        success: true, 
        newTimezone: status.suggestedIANA, 
        reason: `Converted UTC${this.timeZoneOffset >= 0 ? '+' : ''}${this.timeZoneOffset} to ${status.suggestedIANA}` 
      };
    }

    return { success: false, reason: `No IANA mapping found for UTC${this.timeZoneOffset >= 0 ? '+' : ''}${this.timeZoneOffset}` };
  }

  /**
   * Calculate offset in minutes for the provided date based on configured settings
   */
  private getOffsetMinutes(date: Date): number {
    if (this.timeZoneName) {
      try {
        const formatter = new Intl.DateTimeFormat('en-US', {
          timeZone: this.timeZoneName,
          timeZoneName: 'shortOffset',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        });
        const parts = formatter.formatToParts(date);
        const tzPart = parts.find(part => part.type === 'timeZoneName')?.value;
        if (tzPart) {
          const match = tzPart.match(/GMT([+-]\d{2})(?::?(\d{2}))?/);
          if (match) {
            const sign = match[1].startsWith('-') ? -1 : 1;
            const hours = Math.abs(parseInt(match[1], 10));
            const minutes = match[2] ? parseInt(match[2], 10) : 0;
            return sign * ((hours * 60) + minutes);
          }
        }
        // Fallback: derive offset by converting to localised time string
        const localized = date.toLocaleString('en-US', { timeZone: this.timeZoneName });
        const tzDate = new Date(localized);
        if (!Number.isNaN(tzDate.getTime())) {
          const diffMinutes = Math.round((tzDate.getTime() - date.getTime()) / 60000);
          return diffMinutes;
        }
      } catch (error) {
        if (this.logger && typeof this.logger.warn === 'function') {
          this.logger.warn(`Failed to derive offset from timezone name ${this.timeZoneName}: ${error}`);
        }
      }
    }

    let offsetMinutes = this.timeZoneOffset * 60;

    if (this.useDST) {
      const month = date.getUTCMonth(); // 0-11
      if (month > 2 && month < 10) {
        offsetMinutes += 60;
      }
    }

    return offsetMinutes;
  }

  /**
   * Get the current local time
   * @returns Object with date, hour, and formatted time string
   */
  public getLocalTime(): {
    date: Date;
    hour: number;
    timeString: string;
    timeZoneOffset: number;
    effectiveOffset: number;
    timeZoneName?: string;
  } {
    // Create a date object with the current time
    const now = new Date();
    const offsetMinutes = this.getOffsetMinutes(now);
    const localTime = new Date(now.getTime() + offsetMinutes * 60 * 1000);
    const effectiveOffset = offsetMinutes / 60;

    // Determine hour using formatter to respect timezone name when present
    let localHour = localTime.getUTCHours();
    let localTimeString = localTime.toUTCString();
    if (this.timeZoneName) {
      try {
        const formatter = new Intl.DateTimeFormat('en-GB', {
          timeZone: this.timeZoneName,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        });
        const parts = formatter.formatToParts(now);
        const partMap: Record<string, string> = {};
        parts.forEach(part => {
          partMap[part.type] = part.value;
        });
        const year = partMap.year || '1970';
        const month = partMap.month || '01';
        const day = partMap.day || '01';
        const hour = partMap.hour || '00';
        const minute = partMap.minute || '00';
        const second = partMap.second || '00';
        localHour = parseInt(hour, 10);
        localTimeString = `${year}-${month}-${day} ${hour}:${minute}:${second} ${this.timeZoneName}`;
      } catch (error) {
        if (this.logger && typeof this.logger.warn === 'function') {
          this.logger.warn(`Failed to format using timezone ${this.timeZoneName}: ${error}`);
        }
      }
    }

    if (this.logger && typeof this.logger.debug === 'function') {
      this.logger.debug(
        `System time: ${now.toISOString()}, Local time: ${localTimeString} (offset=${effectiveOffset}h, name=${this.timeZoneName || 'n/a'})`
      );
    }

    return {
      date: localTime,
      hour: localHour,
      timeString: localTimeString,
      timeZoneOffset: this.timeZoneOffset,
      effectiveOffset,
      timeZoneName: this.timeZoneName
    };
  }

  /**
   * Get the time zone string (e.g., "UTC+2")
   * @returns Time zone string
   */
  public getTimeZoneString(): string {
    const { effectiveOffset } = this.getLocalTime();
    const offsetString = `UTC${effectiveOffset >= 0 ? '+' : ''}${Math.abs(effectiveOffset)}`;
    return this.timeZoneName ? `${this.timeZoneName} (${offsetString})` : offsetString;
  }

  /**
   * Check if the current time is in DST period
   * @returns True if in DST period
   */
  public isInDSTperiod(): boolean {
    const now = new Date();

    if (this.timeZoneName) {
      try {
        const currentOffset = this.getOffsetMinutes(now);
        const janOffset = this.getOffsetMinutes(new Date(Date.UTC(now.getUTCFullYear(), 0, 1)));
        const julOffset = this.getOffsetMinutes(new Date(Date.UTC(now.getUTCFullYear(), 6, 1)));
        const standardOffset = Math.min(janOffset, julOffset);
        const dstOffset = Math.max(janOffset, julOffset);

        if (standardOffset === dstOffset) {
          return false;
        }

        return currentOffset === dstOffset;
      } catch (error) {
        if (this.logger && typeof this.logger.warn === 'function') {
          this.logger.warn(`Failed to evaluate DST using timezone ${this.timeZoneName}: ${error}`);
        }
      }
    }

    if (!this.useDST) {
      return false;
    }

    const month = now.getUTCMonth();
    return month > 2 && month < 10;
  }

  /**
   * Format a date to local time string
   * @param date Date to format
   * @param options Format options
   * @returns Formatted date string
   */
  public formatDate(date: Date, options?: Intl.DateTimeFormatOptions): string {
    // Default options
    const defaultOptions: Intl.DateTimeFormatOptions = {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    };
    
    // Merge options
    const mergedOptions = { ...defaultOptions, ...options };

    try {
      if (this.timeZoneName) {
        return new Intl.DateTimeFormat(undefined, {
          ...mergedOptions,
          timeZone: this.timeZoneName
        }).format(date);
      }
    } catch (error) {
      if (this.logger && typeof this.logger.warn === 'function') {
        this.logger.warn(`Failed to format date using timezone ${this.timeZoneName}: ${error}`);
      }
    }

    // Fallback to manual offset handling
    const offsetMinutes = this.getOffsetMinutes(date);
    const adjusted = new Date(date.getTime() + offsetMinutes * 60 * 1000);
    return adjusted.toLocaleString(undefined, mergedOptions);
  }
}
