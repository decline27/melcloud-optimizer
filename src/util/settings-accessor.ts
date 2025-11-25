import { HomeyApp, HomeyLogger } from '../types';

/**
 * Type-safe settings accessor with validation and defaults.
 */
export class SettingsAccessor {
  constructor(
    private readonly homey: HomeyApp,
    private readonly logger?: Pick<HomeyLogger, 'warn' | 'log'>
  ) {}

  /**
   * Get setting with type safety and default value.
   */
  get<T>(key: string, defaultValue: T): T {
    const value = this.homey.settings.get(key);

    if (value === null || value === undefined) {
      return defaultValue;
    }

    const defaultType = typeof defaultValue;
    const valueType = typeof value;

    if (defaultType !== valueType) {
      this.logWarning(`Setting '${key}' has unexpected type: expected ${defaultType}, got ${valueType}. Using default.`);
      return defaultValue;
    }

    return value as T;
  }

  /**
   * Get number setting with optional range validation.
   */
  getNumber(
    key: string,
    defaultValue: number,
    options?: { min?: number; max?: number }
  ): number {
    const value = this.get(key, defaultValue);

    if (!Number.isFinite(value)) {
      return defaultValue;
    }

    if (options) {
      if (options.min !== undefined && value < options.min) {
        this.logWarning(`Setting '${key}' below minimum (${options.min}); using default ${defaultValue}.`);
        return defaultValue;
      }
      if (options.max !== undefined && value > options.max) {
        this.logWarning(`Setting '${key}' above maximum (${options.max}); using default ${defaultValue}.`);
        return defaultValue;
      }
    }

    return value;
  }

  /**
   * Get boolean setting.
   */
  getBoolean(key: string, defaultValue: boolean): boolean {
    return this.get(key, defaultValue);
  }

  /**
   * Get string setting.
   */
  getString(key: string, defaultValue: string): string {
    const value = this.get(key, defaultValue);
    return typeof value === 'string' && value.length > 0 ? value : defaultValue;
  }

  /**
   * Get object setting with optional validator.
   */
  getObject<T>(key: string, defaultValue: T, validator?: (obj: unknown) => obj is T): T {
    const value = this.homey.settings.get(key);

    if (!value || typeof value !== 'object') {
      return defaultValue;
    }

    if (validator && !validator(value)) {
      this.logWarning(`Setting '${key}' failed validation. Using default.`);
      return defaultValue;
    }

    return value as T;
  }

  /**
   * Set setting with type safety.
   */
  set<T>(key: string, value: T): void {
    try {
      void this.homey.settings.set(key, value);
    } catch (error) {
      this.logWarning(`Failed to persist setting '${key}': ${String(error)}`);
    }
  }

  private logWarning(message: string): void {
    if (this.logger?.warn) {
      this.logger.warn(message);
    } else {
      this.homey.log(message);
    }
  }
}
