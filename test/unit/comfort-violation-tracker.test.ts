/**
 * TDD tests for ComfortViolationTracker (P1-2).
 *
 * The problem: countComfortViolations() in Optimizer was a single snapshot —
 * it returned 0 or 1 based on the temperature at the exact moment the hourly
 * optimizer ran. A house that was cold for 55 minutes and recovered by run
 * time would show zero violations, so learnFromOutcome() never adjusted
 * price weights downward.
 *
 * The fix: accumulate temperature samples between optimizer runs (e.g. from
 * the 5-minute device poll), count the out-of-band samples at evaluation
 * time, then reset the buffer.
 *
 * This test suite covers ComfortViolationTracker in isolation so it can be
 * verified without the full Homey/Optimizer setup.
 */

import { ComfortViolationTracker } from '../../src/services/comfort-violation-tracker';

const BAND = { minTemp: 20, maxTemp: 23 };

describe('ComfortViolationTracker', () => {
  describe('countAndReset — accumulated samples', () => {
    it('counts all out-of-band samples recorded since last reset', () => {
      const tracker = new ComfortViolationTracker();

      // 12 five-minute readings; 3 are below band minimum (19.5, 19.8, 19.7)
      const samples = [21, 21.5, 22, 20.5, 19.5, 21, 20.2, 19.8, 21.8, 22, 19.7, 21];
      for (const t of samples) tracker.record(t);

      // Current temp at evaluation time is in-band
      expect(tracker.countAndReset(BAND, 22)).toBe(3);
    });

    it('counts current temp as a violation if it is outside the band', () => {
      const tracker = new ComfortViolationTracker();

      // No prior samples — just the current snapshot (single-sample backwards compat)
      expect(tracker.countAndReset(BAND, 19.5)).toBe(1);
    });

    it('returns 0 when all samples and current temp are within band', () => {
      const tracker = new ComfortViolationTracker();
      [21, 21.5, 22, 20].forEach(t => tracker.record(t));
      expect(tracker.countAndReset(BAND, 21)).toBe(0);
    });
  });

  describe('countAndReset — buffer reset', () => {
    it('resets the sample buffer so a second call starts fresh', () => {
      const tracker = new ComfortViolationTracker();

      tracker.record(19.5); // out of band
      tracker.countAndReset(BAND, 22); // consume

      // No new samples, in-band current temp → should be 0
      expect(tracker.countAndReset(BAND, 22)).toBe(0);
    });

    it('does not carry violations across two consecutive resets', () => {
      const tracker = new ComfortViolationTracker();

      // First window: 2 violations
      tracker.record(19.0);
      tracker.record(19.5);
      expect(tracker.countAndReset(BAND, 22)).toBe(2);

      // Second window: 1 violation
      tracker.record(23.5);
      expect(tracker.countAndReset(BAND, 21)).toBe(1);
    });
  });

  describe('record — buffer cap', () => {
    it('does not grow beyond maxSamples (memory safety)', () => {
      const tracker = new ComfortViolationTracker(10);
      for (let i = 0; i < 50; i++) tracker.record(21);

      // Buffer is capped — internal length should not exceed maxSamples
      expect((tracker as any).samples.length).toBeLessThanOrEqual(10);
    });

    it('ignores non-finite temperature values', () => {
      const tracker = new ComfortViolationTracker();
      tracker.record(NaN);
      tracker.record(Infinity);
      tracker.record(-Infinity);

      expect(tracker.countAndReset(BAND, 21)).toBe(0);
    });
  });
});
