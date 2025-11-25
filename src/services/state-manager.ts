import { HomeyLogger } from '../util/logger';
import { HomeyApp } from '../types';

/**
 * Last setpoint change record for a zone
 */
export interface SetpointChangeRecord {
    setpoint: number | null;
    timestamp: number | null;
}

/**
 * StateManager Service
 * 
 * Manages setpoint change tracking and lockout timing across all zones.
 * Handles state persistence to Homey settings.
 */
export class StateManager {
    // Zone 1 state
    private zone1LastSetpoint: number | null = null;
    private zone1LastChangeMs: number | null = null;

    // Zone 2 state
    private zone2LastSetpoint: number | null = null;
    private zone2LastChangeMs: number | null = null;

    // Tank state
    private tankLastSetpoint: number | null = null;
    private tankLastChangeMs: number | null = null;

    constructor(private readonly logger: HomeyLogger) { }

    // ========== Zone 1 Methods ==========

    /**
     * Record a Zone 1 setpoint change
     * @param setpoint New setpoint value
     * @param timestamp Timestamp in milliseconds
     */
    recordZone1Change(setpoint: number, timestamp: number = Date.now()): void {
        this.zone1LastSetpoint = setpoint;
        this.zone1LastChangeMs = timestamp;
        this.logger.log(`Zone 1 setpoint change recorded: ${setpoint}°C at ${new Date(timestamp).toISOString()}`);
    }

    /**
     * Get Zone 1 last change record
     */
    getZone1LastChange(): SetpointChangeRecord {
        return {
            setpoint: this.zone1LastSetpoint,
            timestamp: this.zone1LastChangeMs
        };
    }

    /**
     * Check if Zone 1 is in lockout period
     * @param minChangeMinutes Minimum minutes between changes
     * @returns True if locked out
     */
    isZone1LockedOut(minChangeMinutes: number): boolean {
        if (this.zone1LastChangeMs === null) {
            return false; // No previous change, not locked out
        }

        const now = Date.now();
        const timeSinceLastChange = (now - this.zone1LastChangeMs) / 60000; // Convert to minutes
        return timeSinceLastChange < minChangeMinutes;
    }

    /**
     * Get time remaining in Zone 1 lockout (minutes)
     * @param minChangeMinutes Minimum minutes between changes
     * @returns Minutes remaining, or 0 if not locked out
     */
    getZone1LockoutRemaining(minChangeMinutes: number): number {
        if (!this.isZone1LockedOut(minChangeMinutes)) {
            return 0;
        }

        const now = Date.now();
        const timeSinceLastChange = (now - this.zone1LastChangeMs!) / 60000;
        return Math.max(0, minChangeMinutes - timeSinceLastChange);
    }

    // ========== Zone 2 Methods ==========

    /**
     * Record a Zone 2 setpoint change
     * @param setpoint New setpoint value
     * @param timestamp Timestamp in milliseconds
     */
    recordZone2Change(setpoint: number, timestamp: number = Date.now()): void {
        this.zone2LastSetpoint = setpoint;
        this.zone2LastChangeMs = timestamp;
        this.logger.log(`Zone 2 setpoint change recorded: ${setpoint}°C at ${new Date(timestamp).toISOString()}`);
    }

    /**
     * Get Zone 2 last change record
     */
    getZone2LastChange(): SetpointChangeRecord {
        return {
            setpoint: this.zone2LastSetpoint,
            timestamp: this.zone2LastChangeMs
        };
    }

    /**
     * Check if Zone 2 is in lockout period
     * @param minChangeMinutes Minimum minutes between changes
     * @returns True if locked out
     */
    isZone2LockedOut(minChangeMinutes: number): boolean {
        if (this.zone2LastChangeMs === null) {
            return false;
        }

        const now = Date.now();
        const timeSinceLastChange = (now - this.zone2LastChangeMs) / 60000;
        return timeSinceLastChange < minChangeMinutes;
    }

    /**
     * Get time remaining in Zone 2 lockout (minutes)
     * @param minChangeMinutes Minimum minutes between changes
     * @returns Minutes remaining, or 0 if not locked out
     */
    getZone2LockoutRemaining(minChangeMinutes: number): number {
        if (!this.isZone2LockedOut(minChangeMinutes)) {
            return 0;
        }

        const now = Date.now();
        const timeSinceLastChange = (now - this.zone2LastChangeMs!) / 60000;
        return Math.max(0, minChangeMinutes - timeSinceLastChange);
    }

    // ========== Tank Methods ==========

    /**
     * Record a tank setpoint change
     * @param setpoint New setpoint value
     * @param timestamp Timestamp in milliseconds
     */
    recordTankChange(setpoint: number, timestamp: number = Date.now()): void {
        this.tankLastSetpoint = setpoint;
        this.tankLastChangeMs = timestamp;
        this.logger.log(`Tank setpoint change recorded: ${setpoint}°C at ${new Date(timestamp).toISOString()}`);
    }

    /**
     * Get tank last change record
     */
    getTankLastChange(): SetpointChangeRecord {
        return {
            setpoint: this.tankLastSetpoint,
            timestamp: this.tankLastChangeMs
        };
    }

    /**
     * Check if tank is in lockout period
     * @param minChangeMinutes Minimum minutes between changes
     * @returns True if locked out
     */
    isTankLockedOut(minChangeMinutes: number): boolean {
        if (this.tankLastChangeMs === null) {
            return false;
        }

        const now = Date.now();
        const timeSinceLastChange = (now - this.tankLastChangeMs) / 60000;
        return timeSinceLastChange < minChangeMinutes;
    }

    /**
     * Get time remaining in tank lockout (minutes)
     * @param minChangeMinutes Minimum minutes between changes
     * @returns Minutes remaining, or 0 if not locked out
     */
    getTankLockoutRemaining(minChangeMinutes: number): number {
        if (!this.isTankLockedOut(minChangeMinutes)) {
            return 0;
        }

        const now = Date.now();
        const timeSinceLastChange = (now - this.tankLastChangeMs!) / 60000;
        return Math.max(0, minChangeMinutes - timeSinceLastChange);
    }

    // ========== Persistence Methods ==========

    /**
     * Save state to Homey settings
     * @param homey Homey app instance
     */
    saveToSettings(homey: HomeyApp): void {
        try {
            // Save Zone 1 state
            if (this.zone1LastChangeMs !== null) {
                homey.settings.set('last_setpoint_change_ms', this.zone1LastChangeMs);
            }
            if (this.zone1LastSetpoint !== null) {
                homey.settings.set('last_issued_setpoint_c', this.zone1LastSetpoint);
            }

            // Save Zone 2 state
            if (this.zone2LastChangeMs !== null) {
                homey.settings.set('last_zone2_setpoint_change_ms', this.zone2LastChangeMs);
            }
            if (this.zone2LastSetpoint !== null) {
                homey.settings.set('last_zone2_issued_setpoint_c', this.zone2LastSetpoint);
            }

            // Save tank state
            if (this.tankLastChangeMs !== null) {
                homey.settings.set('last_tank_setpoint_change_ms', this.tankLastChangeMs);
            }
            if (this.tankLastSetpoint !== null) {
                homey.settings.set('last_tank_issued_setpoint_c', this.tankLastSetpoint);
            }

            this.logger.log('State saved to Homey settings');
        } catch (error) {
            this.logger.error('Failed to save state to settings:', error);
        }
    }

    /**
     * Load state from Homey settings
     * @param homey Homey app instance
     */
    loadFromSettings(homey: HomeyApp): void {
        try {
            // Load Zone 1 state
            const zone1ChangeMs = homey.settings.get('last_setpoint_change_ms');
            if (typeof zone1ChangeMs === 'number' && Number.isFinite(zone1ChangeMs) && zone1ChangeMs > 0) {
                this.zone1LastChangeMs = zone1ChangeMs;
            }

            const zone1Setpoint = homey.settings.get('last_issued_setpoint_c');
            if (typeof zone1Setpoint === 'number' && Number.isFinite(zone1Setpoint)) {
                this.zone1LastSetpoint = zone1Setpoint;
            }

            // Load Zone 2 state
            const zone2ChangeMs = homey.settings.get('last_zone2_setpoint_change_ms');
            if (typeof zone2ChangeMs === 'number' && Number.isFinite(zone2ChangeMs) && zone2ChangeMs > 0) {
                this.zone2LastChangeMs = zone2ChangeMs;
            }

            const zone2Setpoint = homey.settings.get('last_zone2_issued_setpoint_c');
            if (typeof zone2Setpoint === 'number' && Number.isFinite(zone2Setpoint)) {
                this.zone2LastSetpoint = zone2Setpoint;
            }

            // Load tank state
            const tankChangeMs = homey.settings.get('last_tank_setpoint_change_ms');
            if (typeof tankChangeMs === 'number' && Number.isFinite(tankChangeMs) && tankChangeMs > 0) {
                this.tankLastChangeMs = tankChangeMs;
            }

            const tankSetpoint = homey.settings.get('last_tank_issued_setpoint_c');
            if (typeof tankSetpoint === 'number' && Number.isFinite(tankSetpoint)) {
                this.tankLastSetpoint = tankSetpoint;
            }

            this.logger.log('State loaded from Homey settings', {
                zone1Change: this.zone1LastChangeMs ? new Date(this.zone1LastChangeMs).toISOString() : 'none',
                zone2Change: this.zone2LastChangeMs ? new Date(this.zone2LastChangeMs).toISOString() : 'none',
                tankChange: this.tankLastChangeMs ? new Date(this.tankLastChangeMs).toISOString() : 'none'
            });
        } catch (error) {
            this.logger.error('Failed to load state from settings:', error);
        }
    }

    /**
     * Clear all state (useful for testing)
     */
    clearAllState(): void {
        this.zone1LastSetpoint = null;
        this.zone1LastChangeMs = null;
        this.zone2LastSetpoint = null;
        this.zone2LastChangeMs = null;
        this.tankLastSetpoint = null;
        this.tankLastChangeMs = null;
        this.logger.log('All state cleared');
    }
}
