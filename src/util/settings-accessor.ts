import { HomeyApp, HomeyLogger } from '../types';

/**
 * Type-safe settings accessor with validation and defaults.
 */
export class SettingsAccessor {
  constructor(
    private readonly homey: HomeyApp,
    private readonly logger?: Pick<HomeyLogger, 'warn' | 'log'>
  ) { }

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
   * Get number setting with optional range validation and type coercion.
   */
  getNumber(
    key: string,
    defaultValue: number,
    options?: { min?: number; max?: number }
  ): number {
    const rawValue = this.homey.settings.get(key);

    if (rawValue === null || rawValue === undefined) {
      return defaultValue;
    }

    // Accept numbers directly
    if (typeof rawValue === 'number') {
      return this.validateNumberRange(rawValue, defaultValue, options, key);
    }

    // Coerce strings to numbers (backward compatibility)
    if (typeof rawValue === 'string') {
      const parsed = Number(rawValue);
      if (Number.isFinite(parsed)) {
        this.logInfo(`Setting '${key}' coerced from string "${rawValue}" to number ${parsed}`);
        return this.validateNumberRange(parsed, defaultValue, options, key);
      }
    }

    // Invalid type - use default
    this.logWarning(
      `Setting '${key}' has invalid type: expected number, got ${typeof rawValue}. Using default.`
    );
    return defaultValue;
  }

  /**
   * Get boolean setting with type coercion.
   */
  getBoolean(key: string, defaultValue: boolean): boolean {
    const rawValue = this.homey.settings.get(key);

    if (rawValue === null || rawValue === undefined) {
      return defaultValue;
    }

    // Accept booleans directly
    if (typeof rawValue === 'boolean') {
      return rawValue;
    }

    // Coerce strings to booleans (backward compatibility)
    if (typeof rawValue === 'string') {
      const lower = rawValue.toLowerCase().trim();
      if (lower === 'true' || lower === '1') {
        this.logInfo(`Setting '${key}' coerced from string "${rawValue}" to boolean true`);
        return true;
      }
      if (lower === 'false' || lower === '0' || lower === '') {
        this.logInfo(`Setting '${key}' coerced from string "${rawValue}" to boolean false`);
        return false;
      }
    }

    // Coerce numbers to booleans (0 = false, non-zero = true)
    if (typeof rawValue === 'number') {
      this.logInfo(`Setting '${key}' coerced from number ${rawValue} to boolean ${rawValue !== 0}`);
      return rawValue !== 0;
    }

    // Invalid type - use default
    this.logWarning(
      `Setting '${key}' has invalid type: expected boolean, got ${typeof rawValue}. Using default.`
    );
    return defaultValue;
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

  /**
   * Validate number is within specified range.
   */
  private validateNumberRange(
    value: number,
    defaultValue: number,
    options: { min?: number; max?: number } | undefined,
    key: string
  ): number {
    if (!Number.isFinite(value)) {
      return defaultValue;
    }

    if (options) {
      if (options.min !== undefined && value < options.min) {
        this.logWarning(
          `Setting '${key}' value ${value} below minimum (${options.min}); using default ${defaultValue}.`
        );
        return defaultValue;
      }
      if (options.max !== undefined && value > options.max) {
        this.logWarning(
          `Setting '${key}' value ${value} above maximum (${options.max}); using default ${defaultValue}.`
        );
        return defaultValue;
      }
    }

    return value;
  }

  private logInfo(message: string): void {
    if (this.logger?.log) {
      this.logger.log(message);
    } else {
      this.homey.log(message);
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
