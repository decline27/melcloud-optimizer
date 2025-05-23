import { Logger } from './logger';

/**
 * Time Zone Helper
 * Provides utilities for handling time zones and DST
 */
export class TimeZoneHelper {
  private timeZoneOffset: number;
  private useDST: boolean;
  private logger: Logger;

  /**
   * Constructor
   * @param logger Logger instance
   * @param timeZoneOffset Time zone offset in hours (default: 2)
   * @param useDST Whether to use DST (default: false)
   */
  constructor(
    logger: Logger,
    timeZoneOffset: number = 2,
    useDST: boolean = false
  ) {
    this.logger = logger;
    this.timeZoneOffset = timeZoneOffset;
    this.useDST = useDST;
  }

  /**
   * Update settings
   * @param timeZoneOffset Time zone offset in hours
   * @param useDST Whether to use DST
   */
  public updateSettings(timeZoneOffset: number, useDST: boolean): void {
    this.timeZoneOffset = timeZoneOffset;
    this.useDST = useDST;
    this.logger.log(`Time zone settings updated: offset=${timeZoneOffset}, DST=${useDST}`);
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
  } {
    // Create a date object with the current time
    const now = new Date();
    
    // Create a local time object using the configured time zone offset
    const localTime = new Date(now.getTime());
    localTime.setUTCHours(now.getUTCHours() + this.timeZoneOffset);
    
    // Calculate effective offset including DST if enabled
    let effectiveOffset = this.timeZoneOffset;
    
    // If DST is enabled, check if we're in DST period (simplified approach for Europe)
    if (this.useDST) {
      // Simple check for European DST (last Sunday in March to last Sunday in October)
      const month = now.getUTCMonth(); // 0-11
      if (month > 2 && month < 10) { // April (3) through October (9)
        localTime.setUTCHours(localTime.getUTCHours() + 1);
        effectiveOffset += 1;
      }
    }
    
    // Get the local hour from the adjusted time
    const localHour = localTime.getUTCHours();
    const localTimeString = localTime.toUTCString();
    
    // Log time information for debugging
    this.logger.debug(`System time: ${now.toISOString()}, Local time: ${localTimeString} (Time zone offset: ${this.timeZoneOffset} hours${this.useDST ? ', DST enabled' : ''})`);
    
    return {
      date: localTime,
      hour: localHour,
      timeString: localTimeString,
      timeZoneOffset: this.timeZoneOffset,
      effectiveOffset
    };
  }

  /**
   * Get the time zone string (e.g., "UTC+2")
   * @returns Time zone string
   */
  public getTimeZoneString(): string {
    const { effectiveOffset } = this.getLocalTime();
    return `UTC${effectiveOffset >= 0 ? '+' : ''}${Math.abs(effectiveOffset)}`;
  }

  /**
   * Check if the current time is in DST period
   * @returns True if in DST period
   */
  public isInDSTperiod(): boolean {
    if (!this.useDST) return false;
    
    const now = new Date();
    const month = now.getUTCMonth(); // 0-11
    return month > 2 && month < 10; // April (3) through October (9)
  }

  /**
   * Format a date to local time string
   * @param date Date to format
   * @param options Format options
   * @returns Formatted date string
   */
  public formatDate(date: Date, options?: Intl.DateTimeFormatOptions): string {
    // Create a local time object
    const localTime = new Date(date.getTime());
    localTime.setUTCHours(date.getUTCHours() + this.timeZoneOffset);
    
    // Apply DST if enabled and in DST period
    if (this.useDST) {
      const month = date.getUTCMonth(); // 0-11
      if (month > 2 && month < 10) { // April (3) through October (9)
        localTime.setUTCHours(localTime.getUTCHours() + 1);
      }
    }
    
    // Default options
    const defaultOptions: Intl.DateTimeFormatOptions = {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    };
    
    // Merge options
    const mergedOptions = { ...defaultOptions, ...options };
    
    return localTime.toLocaleString(undefined, mergedOptions);
  }
}
