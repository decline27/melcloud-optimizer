/**
 * MELCloud API constants
 * 
 * This file contains all the magic numbers and flags used in the MELCloud API integration.
 * Each constant is documented with its purpose and usage context.
 */

// MELCloud Device EffectiveFlags bit masks
// These flags tell the MELCloud API which device parameters have been changed
export const MELCLOUD_FLAGS = {
  /**
   * Zone 1 temperature control flags
   * Used when setting Zone 1 temperature or related parameters
   */
  ZONE1_TEMPERATURE: 0x200000080,

  /**
   * Zone 2 temperature control flags  
   * Used when setting Zone 2 temperature or related parameters
   */
  ZONE2_TEMPERATURE: 0x800000200,

  /**
   * Tank temperature control flags
   * Combined flags for hot water tank temperature control
   * 0x1000000000000 = tank setpoint bit
   * 0x20 = additional tank control bit
   */
  TANK_TEMPERATURE: 0x1000000000000 | 0x20,

  /**
   * Individual tank control flags (for reference)
   */
  TANK_SETPOINT_BIT: 0x1000000000000,
  TANK_CONTROL_BIT: 0x20,
} as const;

// API Rate Limiting and Timing Constants
export const API_TIMING = {
  /**
   * Minimum interval between API calls (milliseconds)
   * Increased from 2s to 5s to reduce rate limiting issues
   */
  MIN_API_CALL_INTERVAL: 5000,

  /**
   * Default cache TTL for general API responses (milliseconds)
   */
  DEFAULT_CACHE_TTL: 3 * 60 * 1000, // 3 minutes

  /**
   * Cache TTL specifically for device state (milliseconds)
   */
  DEVICE_STATE_CACHE_TTL: 3 * 60 * 1000, // 3 minutes

  /**
   * Maximum wait time for API throttling (milliseconds)
   */
  MAX_THROTTLE_WAIT: 60000, // 1 minute
} as const;

// Circuit Breaker Configuration
export const CIRCUIT_BREAKER = {
  /**
   * Base timeout before circuit breaker resets (milliseconds)
   */
  RESET_TIMEOUT: 120000, // 2 minutes

  /**
   * Individual request timeout (milliseconds)
   */
  REQUEST_TIMEOUT: 30000, // 30 seconds

  /**
   * Maximum reset timeout for exponential backoff (milliseconds)
   */
  MAX_RESET_TIMEOUT: 1800000, // 30 minutes

  /**
   * Success rate calculation window (milliseconds)
   */
  SUCCESS_RATE_WINDOW: 3600000, // 1 hour
} as const;

// Tibber API specific constants
export const TIBBER_API = {
  /**
   * Circuit breaker reset timeout for Tibber API (milliseconds)
   */
  RESET_TIMEOUT: 60000, // 1 minute

  /**
   * Request timeout for Tibber API (milliseconds)
   */
  REQUEST_TIMEOUT: 15000, // 15 seconds

  /**
   * Default retry delay for rate limited requests (milliseconds)
   */
  DEFAULT_RETRY_DELAY: 60000, // 1 minute

  /**
   * Maximum age for price data before considering it stale (milliseconds)
   */
  MAX_PRICE_DATA_AGE: 65 * 60 * 1000, // 65 minutes

  /**
   * Conversion factor for time difference logging (to minutes)
   */
  MS_TO_MINUTES: 60000,
} as const;

// Hot Water Service Constants
export const HOT_WATER_SERVICE = {
  /**
   * Data collection interval (milliseconds)
   */
  DATA_COLLECTION_INTERVAL: 20 * 60 * 1000, // 20 minutes

  /**
   * Analysis interval (milliseconds)
   */
  ANALYSIS_INTERVAL: 6 * 60 * 60 * 1000, // 6 hours

  /**
   * Memory check interval (milliseconds)
   */
  MEMORY_CHECK_INTERVAL: 20 * 60 * 1000, // 20 minutes

  /**
   * Maximum data points to store (~2 weeks at 20-minute intervals)
   */
  MAX_DATA_POINTS: 1008,

  /**
   * Maximum settings data size in bytes (~500KB)
   */
  MAX_SETTINGS_DATA_SIZE: 500000,

  /**
   * Bytes to KB conversion factor
   */
  BYTES_TO_KB: 1024,
} as const;

// Retry and Delay Constants
export const RETRY_CONFIG = {
  /**
   * Default initial delay for retries (milliseconds)
   */
  DEFAULT_INITIAL_DELAY: 1000, // 1 second

  /**
   * Maximum wait time for API throttling (milliseconds)
   */
  MAX_WAIT_TIME: 60000, // 1 minute
} as const;