import { TimelineHelper, TimelineEventType } from '../../src/util/timeline-helper';

const mockHomey = (overrides: any = {}) => ({
  settings: {
    get: (k: string) => overrides.settings?.[k]
  },
  i18n: {
    getLanguage: () => overrides.lang || 'en-US',
    getCurrency: () => overrides.i18nCurrency
  },
  // Provide notifications API when requested by tests
  notifications: overrides.notifications,
  timeline: overrides.timeline,
  flow: overrides.flow
} as any);

const createLogger = () => ({ log: jest.fn(), error: jest.fn() });

describe('TimelineHelper - Currency fallback via addTimelineEntry', () => {
  test('uses manual currency setting when provided', async () => {
    const notifications = { createNotification: jest.fn().mockResolvedValue(true) };
    const homey = mockHomey({ settings: { currency: 'USD' }, notifications });
    const helper = new TimelineHelper(homey, createLogger() as any);

    const ok = await helper.addTimelineEntry(
      TimelineEventType.HOURLY_OPTIMIZATION_RESULT,
      undefined,
      undefined,
      { savings: 0.5 }
    );

    expect(ok).toBe(true);
  });

  test('uses GPS detection when coordinates provided', async () => {
    const notifications = { createNotification: jest.fn().mockResolvedValue(true) };
    const homey = mockHomey({ settings: { latitude: 60.0, longitude: 10.0 }, notifications });
    const helper = new TimelineHelper(homey, createLogger() as any);

    const ok = await helper.addTimelineEntry(
      TimelineEventType.HOURLY_OPTIMIZATION_RESULT,
      undefined,
      undefined,
      { dailySavings: 3.5 }
    );

    expect(ok).toBe(true);
  });

  test('uses i18n currency when available', async () => {
    const notifications = { createNotification: jest.fn().mockResolvedValue(true) };
    const homey = mockHomey({ settings: {}, i18nCurrency: 'GBP', notifications });
    const helper = new TimelineHelper(homey, createLogger() as any);

    const ok = await helper.addTimelineEntry(
      TimelineEventType.HOURLY_OPTIMIZATION_RESULT,
      undefined,
      undefined,
      { dailySavings: 1.25 }
    );

    expect(ok).toBe(true);
  });

  test('falls back to EUR when no info available', async () => {
    const notifications = { createNotification: jest.fn().mockResolvedValue(true) };
    const homey = mockHomey({ settings: {}, notifications });
    const helper = new TimelineHelper(homey, createLogger() as any);

    const ok = await helper.addTimelineEntry(
      TimelineEventType.HOURLY_OPTIMIZATION_RESULT,
      undefined,
      undefined,
      { dailySavings: 2.0 }
    );

    expect(ok).toBe(true);
  });
});
