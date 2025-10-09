import { formatTimelineMessage, TimelinePayload } from '../../src/util/timeline-formatter';

describe('Timeline Message Formatter', () => {
  const basePayload: TimelinePayload = {
    zoneName: 'Zone1',
    fromTempC: 20,
    toTempC: 21,
    projectedDailySavingsSEK: 15.75,
    reasonCode: 'cheaper_hour_raise_within_comfort'
  };

  describe('Minimal verbosity', () => {
    test('formats temperature change correctly', () => {
      const result = formatTimelineMessage(basePayload, 'minimal', 'SEK');
      expect(result).toBe('Hourly optimization: Zone1 21°C. Projected daily savings: 15.75 SEK/day.');
    });

    test('formats no temperature change correctly', () => {
      const payload = { ...basePayload, fromTempC: 20, toTempC: 20 };
      const result = formatTimelineMessage(payload, 'minimal', 'SEK');
      expect(result).toBe('Hourly optimization: Zone1 held at 20°C. Projected daily savings: 15.75 SEK/day.');
    });

    test('handles missing savings gracefully', () => {
      const payload = { ...basePayload, projectedDailySavingsSEK: undefined };
      const result = formatTimelineMessage(payload, 'minimal', 'SEK');
      expect(result).toBe('Hourly optimization: Zone1 21°C. Projected daily savings: –.');
    });
  });

  describe('Standard verbosity', () => {
    test('formats complete message', () => {
      const result = formatTimelineMessage(basePayload, 'standard', 'SEK');
      const expected = `Zone1: 20°C → 21°C
Projected daily savings: 15.75 SEK/day
Reason: Raised temperature during a cheaper electricity hour (within comfort).`;
      expect(result).toBe(expected);
    });

    test('includes tank information when provided', () => {
      const payload = { ...basePayload, tankFromC: 46, tankToC: 48 };
      const result = formatTimelineMessage(payload, 'standard', 'SEK');
      expect(result).toContain('Tank 46°C → 48°C');
    });

    test('excludes tank information when unchanged', () => {
      const payload = { ...basePayload, tankFromC: 46, tankToC: 46 };
      const result = formatTimelineMessage(payload, 'standard', 'SEK');
      expect(result).not.toContain('Tank');
    });

    test('includes planning shift when provided', () => {
      const payload = { ...basePayload, planningShiftHours: -2 };
      const result = formatTimelineMessage(payload, 'standard', 'SEK');
      expect(result).toContain('Planning: shifted -2h');
    });
  });

  describe('Detailed verbosity', () => {
    test('includes technical parameters', () => {
      const payload: TimelinePayload = {
        ...basePayload,
        outdoorTempC: -5.5,
        copEstimate: 3.2,
        pricePercentile: 0.25,
        comfortBandLowC: 19,
        comfortBandHighC: 22
      };
      const result = formatTimelineMessage(payload, 'detailed', 'SEK');
      expect(result).toContain('Zone1: 20°C → 21°C');
      expect(result).toContain('Params: outdoor -5.5°C, percentile 25%, COP-est 3.2, band 19-22°C');
    });

    test('handles partial parameters', () => {
      const payload = { ...basePayload, outdoorTempC: 2 };
      const result = formatTimelineMessage(payload, 'detailed', 'SEK');
      expect(result).toContain('Params: outdoor 2°C');
    });

    test('omits params line when no parameters available', () => {
      const result = formatTimelineMessage(basePayload, 'detailed', 'SEK');
      expect(result).not.toContain('Params:');
    });
  });

  describe('Debug verbosity', () => {
    test('uses raw engine text when provided', () => {
      const payload = { ...basePayload, rawEngineText: 'Engine: Cheaper hour → raise within comfort + Planning -0' };
      const result = formatTimelineMessage(payload, 'debug', 'SEK');
      expect(result).toBe('Engine: Cheaper hour → raise within comfort + Planning -0');
    });

    test('falls back to debug format when no raw text', () => {
      const result = formatTimelineMessage(basePayload, 'debug', 'SEK');
      expect(result).toBe('DEBUG: Zone1: 20°C → 21°C | Savings: 15.75 SEK/day | Reason: cheaper_hour_raise_within_comfort');
    });
  });

  describe('Reason code mapping', () => {
    test('maps known reason codes to friendly text', () => {
      const testCases = [
        { code: 'within_deadband', expected: 'Held steady (within comfort band).' },
        { code: 'cheaper_hour_raise_within_comfort', expected: 'Raised temperature during a cheaper electricity hour (within comfort).' },
        { code: 'cheaper_hour_lower_within_comfort', expected: 'Lowered temperature during a cheaper hour (within comfort).' },
        { code: 'planning_shift', expected: 'Shifted heating to cheaper hours.' }
      ];

      testCases.forEach(({ code, expected }) => {
        const payload = { ...basePayload, reasonCode: code };
        const result = formatTimelineMessage(payload, 'standard', 'SEK');
        expect(result).toContain(expected);
      });
    });

    test('uses fallback for unknown reason codes', () => {
      const payload = { ...basePayload, reasonCode: 'unknown_reason' };
      const result = formatTimelineMessage(payload, 'standard', 'SEK');
      expect(result).toContain('Adjustment applied based on price and comfort.');
    });
  });

  describe('Temperature formatting', () => {
    test('rounds to 0.5 degree precision', () => {
      const payload = { ...basePayload, fromTempC: 20.3, toTempC: 20.8 };
      const result = formatTimelineMessage(payload, 'standard', 'SEK');
      expect(result).toContain('20.5°C → 21°C');
    });

    test('drops trailing .0', () => {
      const payload = { ...basePayload, fromTempC: 20.0, toTempC: 21.0 };
      const result = formatTimelineMessage(payload, 'standard', 'SEK');
      expect(result).toContain('20°C → 21°C');
    });
  });

  describe('Currency formatting', () => {
    test('formats different currencies', () => {
      const currencies = ['SEK', 'NOK', 'EUR', 'USD'];
      currencies.forEach(currency => {
        const result = formatTimelineMessage(basePayload, 'standard', currency);
        expect(result).toContain(`15.75 ${currency}/day`);
      });
    });
  });

  describe('Fallback behavior', () => {
    test('falls back to standard for unknown verbosity', () => {
      const result = formatTimelineMessage(basePayload, 'unknown' as any, 'SEK');
      // Should be same as standard format
      const standardResult = formatTimelineMessage(basePayload, 'standard', 'SEK');
      expect(result).toBe(standardResult);
    });
  });
});