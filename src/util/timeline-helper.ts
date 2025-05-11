/**
 * Timeline Helper
 * Provides utility functions for creating timeline entries and notifications
 */

import { HomeyApp } from '../types';

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
   * Constructor
   * @param homey Homey app instance
   * @param logger Logger instance
   */
  constructor(
    private readonly homey: HomeyApp,
    private readonly logger: { log: Function; error: Function }
  ) {}

  /**
   * Create a timeline entry
   * @param options Timeline entry options
   * @returns Promise resolving to true if successful
   */
  public async createTimelineEntry(options: TimelineEntryOptions): Promise<boolean> {
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

      // Create timeline entry
      try {
        if (this.homey.timeline) {
          await this.homey.timeline.createEntry({
            title: options.title,
            body: options.message,
            icon,
            type
          });

          this.logger.log(`Timeline entry created: ${options.title}`);
        } else {
          this.logger.log(`Timeline API not available, skipping timeline entry: ${options.title}`);
        }
      } catch (timelineError) {
        this.logger.error('Failed to create timeline entry:', timelineError);
      }

      // Create notification if requested
      if (options.createNotification) {
        try {
          await this.createNotification(options.title, options.message);
        } catch (notifyError) {
          this.logger.error('Failed to create notification:', notifyError);
        }
      }

      return true;
    } catch (error) {
      this.logger.error('Error creating timeline entry:', error);
      return false;
    }
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
      } else {
        this.logger.log(`Notifications API not available, skipping notification: ${title}`);
      }
      return true;
    } catch (error) {
      this.logger.error('Error creating notification:', error);
      return false;
    }
  }

  /**
   * Create an info timeline entry
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
    return this.createTimelineEntry({
      title,
      message,
      type: TimelineEntryType.INFO,
      icon: 'mdi:information',
      createNotification
    });
  }

  /**
   * Create a success timeline entry
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
    return this.createTimelineEntry({
      title,
      message,
      type: TimelineEntryType.SUCCESS,
      icon: 'mdi:check-circle',
      createNotification
    });
  }

  /**
   * Create a warning timeline entry
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
    return this.createTimelineEntry({
      title,
      message,
      type: TimelineEntryType.WARNING,
      icon: 'mdi:alert',
      createNotification
    });
  }

  /**
   * Create an error timeline entry
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
    return this.createTimelineEntry({
      title,
      message,
      type: TimelineEntryType.ERROR,
      icon: 'mdi:alert-circle',
      createNotification
    });
  }
}
