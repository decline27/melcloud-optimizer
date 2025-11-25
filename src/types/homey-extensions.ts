/**
 * Type definitions for Homey app extensions
 * 
 * This file provides type-safe interfaces for services and features
 * that are dynamically added to the Homey app instance at runtime.
 */

import { HomeyApp } from './index';
import type { HotWaterService as HotWaterServiceClass } from '../services/hot-water';

/**
 * Extended Homey app with optimizer-specific services
 */
export interface HomeyWithOptimizer extends HomeyApp {
    /**
     * Optional hot water tracking service
     */
    hotWaterService?: HotWaterServiceClass;
}

/**
 * Type guard to check if Homey has hot water service
 * @param homey Homey app instance to check
 * @returns True if the instance has a properly initialized hot water service
 */
export function hasHotWaterService(
    homey: HomeyApp | undefined
): homey is HomeyWithOptimizer {
    if (!homey || !('hotWaterService' in homey)) {
        return false;
    }

    const service = homey.hotWaterService;
    const hasStatsMethod = (svc: unknown): svc is { getUsageStatistics: (...args: unknown[]) => unknown } =>
        typeof (svc as { getUsageStatistics?: unknown }).getUsageStatistics === 'function';

    return Boolean(service && hasStatsMethod(service));
}

// Re-export HotWaterService type for convenience
export type { HotWaterServiceClass as HotWaterService };
