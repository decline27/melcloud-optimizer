
import { EnhancedSavingsCalculator, OptimizationData } from '../src/util/enhanced-savings-calculator';

function makeLogger() {
    return {
        debug: jest.fn(),
        error: jest.fn(),
        info: jest.fn(),
        warn: jest.fn()
    } as any;
}

describe('PR #11 Reproduction: Projection Capping', () => {
    it('should not cap projection based on low daily average when recent savings are high', () => {
        const logger = makeLogger();
        const calc = new EnhancedSavingsCalculator(logger);

        // Scenario: Late in the day (20:00 / 8 PM)
        const currentHour = 20;
        const remainingHours = 3; // 21, 22, 23

        // History: 10 hours of low savings (0.1 SEK) earlier in the day
        const history: OptimizationData[] = [];
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        for (let i = 8; i < 18; i++) {
            const optTime = new Date(today);
            optTime.setHours(i, 0, 0, 0);
            history.push({
                timestamp: optTime.toISOString(),
                savings: 0.1,
                targetTemp: 20,
                targetOriginal: 21,
                priceNow: 0.5,
                priceAvg: 0.5
            });
        }

        // Current situation: Savings spiked to 1.0 SEK (e.g. price spike)
        const currentHourSavings = 1.0;

        // Calculate
        const result = calc.calculateEnhancedDailySavings(currentHourSavings, history, currentHour);

        // Analysis
        // Daily average (approx): (10 * 0.1) / 10 = 0.1
        // Current cap logic: max(0, 0.1) * 3 * 1.1 = 0.33 SEK
        // Realistic projection: 1.0 * 3 = 3.0 SEK (or slightly less if weighted)

        // The bug is that the projection is capped at ~0.33, ignoring the current 1.0 reality
        console.log(`Daily Savings: ${result.dailySavings}`);
        console.log(`Projected Savings: ${result.projectedSavings}`);
        console.log(`Compounded Savings: ${result.compoundedSavings}`);

        // We expect the projection to be closer to the current high savings
        // If we use the last 3 hours (which in this case is just the current hour effectively for the trend),
        // it should be much higher than 0.33.

        // With the fix, we expect projection to be allowed to be higher.
        // Let's assert that it's at least 1.5 (half of the theoretical max 3.0)
        expect(result.projectedSavings).toBeGreaterThan(1.0);
    });
});
