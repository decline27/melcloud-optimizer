import { HomeyApp } from '../types';
import { HomeyLogger } from '../util/logger';

/**
 * Historical price data structure
 */
interface PriceHistoryEntry {
    timestamp: string; // ISO 8601 timestamp
    price: number; // Price in currency/kWh
}

/**
 * Historical price thresholds calculated from historical data
 */
export interface HistoricalPriceThresholds {
    p10: number; // 10th percentile (very cheap)
    p25: number; // 25th percentile (cheap)
    p50: number; // 50th percentile (median/normal)
    p75: number; // 75th percentile (expensive)
    p90: number; // 90th percentile (very expensive)
    sampleSize: number; // Number of data points used
    oldestDate: string; // Oldest data point timestamp
    newestDate: string; // Newest data point timestamp
}

/**
 * Service for tracking historical electricity prices to enable
 * context-aware price classification (e.g., "is today cheap compared to last month?")
 */
export class PriceHistoryTracker {
    private readonly HISTORY_DAYS = 30;
    private readonly MAX_ENTRIES = this.HISTORY_DAYS * 24; // 30 days * 24 hours
    private readonly STORAGE_KEY = 'price_history_v1';

    private history: PriceHistoryEntry[] = [];
    private thresholds: HistoricalPriceThresholds | null = null;
    private lastUpdate: Date | null = null;

    constructor(
        private readonly homey: HomeyApp,
        private readonly logger: HomeyLogger
    ) {
        this.loadHistory();
    }

    /**
     * Load price history from Homey settings
     */
    private loadHistory(): void {
        try {
            const stored = this.homey.settings.get(this.STORAGE_KEY);
            if (stored && Array.isArray(stored)) {
                this.history = stored;
                this.logger.log(`Loaded ${this.history.length} historical price entries`);

                // Clean up old entries on load
                this.cleanupOldEntries();

                // Calculate thresholds if we have data
                if (this.history.length > 0) {
                    this.calculateThresholds();
                }
            } else {
                this.logger.log('No historical price data found, starting fresh');
            }
        } catch (error) {
            this.logger.error('Failed to load price history, starting fresh:', error);
            this.history = [];
        }
    }

    /**
     * Save price history to Homey settings
     */
    private saveHistory(): void {
        try {
            this.homey.settings.set(this.STORAGE_KEY, this.history);
            this.logger.log(`Saved ${this.history.length} historical price entries`);
        } catch (error) {
            this.logger.error('Failed to save price history:', error);
        }
    }

    /**
     * Add a new price entry to the history
     * @param price Price in currency/kWh
     * @param timestamp Optional timestamp (defaults to now)
     */
    public addPrice(price: number, timestamp?: Date): void {
        const entry: PriceHistoryEntry = {
            timestamp: (timestamp || new Date()).toISOString(),
            price
        };

        this.history.push(entry);
        this.logger.log(`Added price entry: ${price.toFixed(4)} kr/kWh at ${entry.timestamp}`);

        // Clean up old entries
        this.cleanupOldEntries();

        // Save to storage
        this.saveHistory();

        // Recalculate thresholds
        this.calculateThresholds();
    }

    /**
     * Add multiple price entries (batch operation)
     * @param prices Array of price entries with timestamp and price
     */
    public addPrices(prices: Array<{ price: number; timestamp: Date }>): void {
        const newEntries: PriceHistoryEntry[] = prices.map(p => ({
            timestamp: p.timestamp.toISOString(),
            price: p.price
        }));

        this.history.push(...newEntries);
        this.logger.log(`Added ${newEntries.length} price entries in batch`);

        // Clean up old entries
        this.cleanupOldEntries();

        // Save to storage
        this.saveHistory();

        // Recalculate thresholds
        this.calculateThresholds();
    }

    /**
     * Remove entries older than HISTORY_DAYS
     */
    private cleanupOldEntries(): void {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - this.HISTORY_DAYS);
        const cutoffTimestamp = cutoffDate.toISOString();

        const originalLength = this.history.length;
        this.history = this.history.filter(entry => entry.timestamp >= cutoffTimestamp);

        const removed = originalLength - this.history.length;
        if (removed > 0) {
            this.logger.log(`Cleaned up ${removed} old price entries (older than ${this.HISTORY_DAYS} days)`);
        }
    }

    /**
     * Calculate historical price percentiles
     */
    private calculateThresholds(): void {
        if (this.history.length === 0) {
            this.thresholds = null;
            this.logger.log('No historical data available for threshold calculation');
            return;
        }

        // Extract prices and sort
        const prices = this.history.map(e => e.price).sort((a, b) => a - b);

        // Calculate percentiles
        const p10 = this.calculatePercentile(prices, 0.10);
        const p25 = this.calculatePercentile(prices, 0.25);
        const p50 = this.calculatePercentile(prices, 0.50);
        const p75 = this.calculatePercentile(prices, 0.75);
        const p90 = this.calculatePercentile(prices, 0.90);

        // Get date range
        const timestamps = this.history.map(e => e.timestamp).sort();
        const oldestDate = timestamps[0];
        const newestDate = timestamps[timestamps.length - 1];

        this.thresholds = {
            p10,
            p25,
            p50,
            p75,
            p90,
            sampleSize: prices.length,
            oldestDate,
            newestDate
        };

        this.lastUpdate = new Date();

        this.logger.log('Historical price thresholds calculated:', {
            p10: p10.toFixed(4),
            p25: p25.toFixed(4),
            p50: p50.toFixed(4),
            p75: p75.toFixed(4),
            p90: p90.toFixed(4),
            samples: prices.length,
            coverage: `${Math.min(100, (prices.length / this.MAX_ENTRIES) * 100).toFixed(0)}%`
        });
    }

    /**
     * Calculate a specific percentile from sorted price array
     * @param sortedPrices Array of prices sorted in ascending order
     * @param percentile Percentile to calculate (0.0 - 1.0)
     */
    private calculatePercentile(sortedPrices: number[], percentile: number): number {
        const index = Math.ceil(sortedPrices.length * percentile) - 1;
        return sortedPrices[Math.max(0, index)];
    }

    /**
     * Get current historical price thresholds
     * @returns Historical thresholds or null if insufficient data
     */
    public getThresholds(): HistoricalPriceThresholds | null {
        return this.thresholds;
    }

    /**
     * Check if we have sufficient historical data for reliable classification
     * @param minDays Minimum days of data required (default: 7)
     * @returns True if we have enough data
     */
    public hasSufficientData(minDays: number = 7): boolean {
        if (!this.thresholds || this.history.length === 0) {
            return false;
        }

        // Check if we have at least minDays worth of data
        const minEntries = minDays * 24; // Assuming hourly data
        return this.thresholds.sampleSize >= minEntries;
    }

    /**
     * Get a summary of the price history status
     */
    public getStatus(): {
        hasData: boolean;
        sampleSize: number;
        coveragePercent: number;
        daysOfData: number;
        hasSufficientData: boolean;
    } {
        return {
            hasData: this.history.length > 0,
            sampleSize: this.history.length,
            coveragePercent: Math.min(100, (this.history.length / this.MAX_ENTRIES) * 100),
            daysOfData: Math.ceil(this.history.length / 24),
            hasSufficientData: this.hasSufficientData()
        };
    }

    /**
     * Clear all historical data (for testing or reset)
     */
    public clear(): void {
        this.history = [];
        this.thresholds = null;
        this.lastUpdate = null;
        this.saveHistory();
        this.logger.log('Cleared all historical price data');
    }
}
