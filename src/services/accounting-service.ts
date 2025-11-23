import { HomeyLogger } from '../util/logger';
import { HomeyApp } from '../types';
import { OrchestratorMetrics } from '../metrics';
import { TimeZoneHelper } from '../util/time-zone-helper';

export class AccountingService {
    private static readonly currencyDecimals: Record<string, number> = {
        JPY: 0,
        KWD: 3,
        // Default is 2 for most currencies
    };

    constructor(
        private readonly homey: HomeyApp,
        private readonly logger: HomeyLogger,
        private readonly timeZoneHelper?: TimeZoneHelper
    ) { }

    /**
     * Get decimal places for a currency (default 2)
     */
    private getCurrencyDecimals(currency: string): number {
        return AccountingService.currencyDecimals[currency?.toUpperCase()] ?? 2;
    }

    /**
     * Convert major currency units to minor units (e.g. 1.23 EUR -> 123 cents)
     */
    public majorToMinor(amount: number, decimals: number): number {
        if (typeof amount !== 'number' || isNaN(amount)) return 0;
        return Math.round(amount * Math.pow(10, decimals));
    }

    /**
     * Convert minor currency units to major units (e.g. 123 cents -> 1.23 EUR)
     */
    public minorToMajor(amount: number, decimals: number): number {
        if (typeof amount !== 'number' || isNaN(amount)) return 0;
        return amount / Math.pow(10, decimals);
    }

    /**
     * Format a Date to YYYY-MM-DD using local time (with timezone helper if available)
     */
    private formatLocalDate(date = new Date()): string {
        const d = this.timeZoneHelper ? this.timeZoneHelper.getLocalTime().date : date;
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    /**
     * Migrate legacy savings field to new metrics structure
     */
    public migrateLegacySavings(): void {
        try {
            const legacy = this.homey.settings.get('total_savings') ?? this.homey.settings.get('savings');
            if (typeof legacy === 'number' && !Number.isNaN(legacy) && legacy > 0) {
                const metrics: OrchestratorMetrics = this.homey.settings.get('orchestrator_metrics') || {
                    totalSavings: 0,
                    totalCostImpact: 0,
                };
                metrics.totalSavings = +(metrics.totalSavings + legacy).toFixed(2);
                if (metrics.totalCostImpact == null) metrics.totalCostImpact = 0;
                metrics.lastUpdateIso = new Date().toISOString();
                this.homey.settings.set('orchestrator_metrics', metrics);
                this.homey.settings.unset('total_savings');
                this.homey.settings.unset('savings');
                this.logger.info(`Migrated legacy savings=${legacy}`);
            }
        } catch (e) {
            this.logger.error('Failed to migrate legacy savings', e as Error);
        }
    }

    /**
     * Migrate legacy savings entry to new format with minor units
     */
    private migrateLegacyEntry(entry: any, currency: string, decimals: number): any {
        if (entry.totalMinor !== undefined) {
            // Already migrated
            return entry;
        }

        if (entry.total !== undefined) {
            // Legacy entry, convert to new format
            const totalMinor = this.majorToMinor(entry.total, decimals);
            return {
                date: entry.date,
                totalMinor,
                currency,
                decimals
            };
        }

        // Unknown format, return as-is
        return entry;
    }

    /**
     * Update cost metrics using actual/baseline energy and price
     */
    public accountCost(
        priceSekPerKWh: number,
        kWhActual: number,
        kWhBaseline: number,
        priceTimestamp?: string
    ): { todaySavings: number; costImpactToday: number } {
        const now = new Date();

        if (
            priceSekPerKWh == null || Number.isNaN(priceSekPerKWh) || priceSekPerKWh <= 0 ||
            kWhActual == null || Number.isNaN(kWhActual) || !Number.isFinite(kWhActual) ||
            kWhBaseline == null || Number.isNaN(kWhBaseline) || !Number.isFinite(kWhBaseline)
        ) {
            this.logger.log('[Accounting] Skipped - invalid inputs');
            return { todaySavings: 0, costImpactToday: 0 };
        }

        if (priceTimestamp) {
            const ts = new Date(priceTimestamp);
            if (isFinite(ts.getTime()) && now.getTime() - ts.getTime() > 65 * 60 * 1000) {
                this.logger.log('[Accounting] Skipped - stale price/energy data');
                return { todaySavings: 0, costImpactToday: 0 };
            }
        }

        const actualCost = kWhActual * priceSekPerKWh;
        const baselineCost = kWhBaseline * priceSekPerKWh;
        let costDelta = +(actualCost - baselineCost).toFixed(2);
        if (Math.abs(costDelta) < 0.005) costDelta = 0;
        const savingsThisInterval = Math.max(0, +(-costDelta).toFixed(2));

        const metrics: OrchestratorMetrics = this.homey.settings.get('orchestrator_metrics') || {
            totalSavings: 0,
            totalCostImpact: 0,
        };

        metrics.totalCostImpact = +(metrics.totalCostImpact + costDelta).toFixed(2);
        metrics.totalSavings = +(metrics.totalSavings + savingsThisInterval).toFixed(2);
        const today = this.formatLocalDate();
        if (metrics.dailyCostImpactDate !== today) {
            metrics.dailyCostImpactDate = today;
            metrics.dailyCostImpact = 0;
        }
        metrics.dailyCostImpact = +(Number(metrics.dailyCostImpact || 0) + costDelta).toFixed(2);
        metrics.lastUpdateIso = now.toISOString();
        this.homey.settings.set('orchestrator_metrics', metrics);

        // Do NOT persist savings history here to avoid double-counting.
        // The API layer (api.js:getRunHourlyOptimizer) is the single writer for savings_history.
        // Here we only read today's total from the already-persisted history to report "today so far".
        let todaySoFar = 0;
        try {
            const currency = this.homey.settings.get('currency_code') || this.homey.settings.get('currency') || '';
            const decimals = this.getCurrencyDecimals(currency);
            const rawHistory = this.homey.settings.get('savings_history') || [];
            const history = (rawHistory as any[]).map((h: any) => this.migrateLegacyEntry(h, currency, decimals));
            const todayEntry: any = history.find((h: any) => h.date === today);
            if (todayEntry) {
                if (todayEntry.totalMinor !== undefined) {
                    todaySoFar = Number(this.minorToMajor(todayEntry.totalMinor, todayEntry.decimals ?? decimals).toFixed(4));
                } else if (todayEntry.total !== undefined) {
                    todaySoFar = Number(Number(todayEntry.total).toFixed(4));
                }
            }
        } catch (_) {
            todaySoFar = 0;
        }

        this.logger.info(
            `[Accounting] baseline=${baselineCost.toFixed(2)} actual=${actualCost.toFixed(2)} ` +
            `delta=${costDelta >= 0 ? '+' : ''}${costDelta.toFixed(2)} SEK ` +
            `saved=${savingsThisInterval.toFixed(2)} SEK totalSaved=${metrics.totalSavings.toFixed(2)} SEK ` +
            `totalImpact=${metrics.totalCostImpact.toFixed(2)} SEK`
        );

        return { todaySavings: todaySoFar, costImpactToday: metrics.dailyCostImpact || 0 };
    }

    /**
     * Add an hourly savings amount to today's total and maintain a short history
     * Amount should be in major units and will be converted to integer minor units
     * Returns todaySoFar and weekSoFar (last 7 days including today) in major units
     */
    public addSavings(amount: number): { todaySoFar: number; weekSoFar: number } {
        try {
            if (typeof amount !== 'number' || isNaN(amount)) {
                return { todaySoFar: 0, weekSoFar: 0 };
            }

            const today = this.formatLocalDate();

            // Get currency settings - prefer currency_code, fall back to currency
            const currency = this.homey.settings.get('currency_code') || this.homey.settings.get('currency') || '';
            const decimals = this.getCurrencyDecimals(currency);

            // Convert amount to minor units
            const amountMinor = this.majorToMinor(amount, decimals);

            const rawHistory = this.homey.settings.get('savings_history') || [];

            // Migrate legacy entries and normalize the history
            const history = rawHistory.map((h: any) => this.migrateLegacyEntry(h, currency, decimals));

            // Find or create today's entry
            let todayEntry: any = history.find((h: any) => h.date === today);
            if (!todayEntry) {
                todayEntry = {
                    date: today,
                    totalMinor: 0,
                    currency,
                    decimals
                };
                history.push(todayEntry);
            } else {
                // Ensure currency and decimals are set on existing entry
                if (!todayEntry.currency) todayEntry.currency = currency;
                if (todayEntry.decimals === undefined) todayEntry.decimals = decimals;
            }

            // Increment today's total (in minor units)
            todayEntry.totalMinor = (todayEntry.totalMinor || 0) + amountMinor;

            // Trim history to last 30 days
            history.sort((a: any, b: any) => a.date.localeCompare(b.date));
            const cutoffIndex = Math.max(0, history.length - 30);
            const trimmed = history.slice(cutoffIndex);

            this.homey.settings.set('savings_history', trimmed);

            // Compute last 7 days total including today (convert back to major units)
            const todayDate = new Date(`${today}T00:00:00`);
            const last7Cutoff = new Date(todayDate);
            last7Cutoff.setDate(todayDate.getDate() - 6); // include 7 days window

            const weekSoFarMinor = (trimmed as any[])
                .filter((h: any) => {
                    const d = new Date(`${h.date}T00:00:00`);
                    return d >= last7Cutoff && d <= todayDate;
                })
                .reduce((sum: number, h: any) => {
                    return sum + (h.totalMinor || 0);
                }, 0);

            const todaySoFar = this.minorToMajor(todayEntry.totalMinor, decimals);
            const weekSoFar = this.minorToMajor(weekSoFarMinor, decimals);

            return {
                todaySoFar: Number(todaySoFar.toFixed(4)),
                weekSoFar: Number(weekSoFar.toFixed(4))
            };
        } catch (e) {
            this.logger.error('Failed to add savings to history', e as Error);
            return { todaySoFar: 0, weekSoFar: 0 };
        }
    }

    /**
     * Get the total savings for the last 7 days including today
     */
    public getWeeklySavingsTotal(): number {
        try {
            const today = this.formatLocalDate();
            const todayDate = new Date(`${today}T00:00:00`);
            const last7Cutoff = new Date(todayDate);
            last7Cutoff.setDate(todayDate.getDate() - 6);

            // Get currency settings
            const currency = this.homey.settings.get('currency_code') || this.homey.settings.get('currency') || '';
            const decimals = this.getCurrencyDecimals(currency);

            const rawHistory = this.homey.settings.get('savings_history') || [];

            // Migrate legacy entries and calculate total
            const totalMinor = (rawHistory as any[])
                .map((h: any) => this.migrateLegacyEntry(h, currency, decimals))
                .filter((h: any) => {
                    const d = new Date(`${h.date}T00:00:00`);
                    return d >= last7Cutoff && d <= todayDate;
                })
                .reduce((sum: number, h: any) => {
                    return sum + (h.totalMinor || 0);
                }, 0);

            const total = this.minorToMajor(totalMinor, decimals);
            return Number(total.toFixed(4));
        } catch (e) {
            this.logger.error('Failed to compute weekly savings total', e as Error);
            return 0;
        }
    }
}
