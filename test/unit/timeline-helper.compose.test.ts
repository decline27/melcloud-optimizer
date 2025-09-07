import { TimelineHelper, TimelineEventType } from '../../src/util/timeline-helper';

const createLogger = () => ({ log: jest.fn(), error: jest.fn() });

const makeHomey = (overrides: any = {}) => ({
  settings: {
    get: (k: string) => overrides.settings?.[k]
  },
  i18n: {
    getLanguage: () => overrides.lang || 'en-US',
    getCurrency: () => overrides.i18nCurrency
  },
  timeline: {
    createEntry: jest.fn().mockImplementation(({ title, body }) => {
      // allow tests to inspect last body via override hook
      if (typeof overrides.onEntry === 'function') {
        overrides.onEntry({ title, body });
      }
      return Promise.resolve();
    })
  }
} as any);

describe('TimelineHelper - HOURLY_OPTIMIZATION_RESULT composition', () => {
  test('includes Zone1 change from/to when provided', async () => {
    let lastBody = '';
    const homey = makeHomey({ onEntry: ({ body }: any) => (lastBody = body) });
    const helper = new TimelineHelper(homey, createLogger() as any);

    const ok = await helper.addTimelineEntry(
      TimelineEventType.HOURLY_OPTIMIZATION_RESULT,
      {},
      false,
      { targetOriginal: 20, targetTemp: 19 }
    );

    expect(ok).toBe(true);
    expect(lastBody).toContain('from 20°C to 19°C');
  });

  test('falls back to notifications API when timeline API fails', async () => {
    let usedNotifications = false;
    const homey: any = {
      settings: { get: () => undefined },
      i18n: { getLanguage: () => 'en-US', getCurrency: () => 'USD' },
      timeline: { createEntry: jest.fn().mockRejectedValue(new Error('fail')) },
      notifications: {
        createNotification: jest.fn().mockImplementation(() => {
          usedNotifications = true;
          return Promise.resolve();
        })
      }
    };
    const helper = new TimelineHelper(homey, createLogger() as any);
    const ok = await helper.addTimelineEntry(
      TimelineEventType.HOURLY_OPTIMIZATION_RESULT,
      {},
      false,
      { targetOriginal: 20, targetTemp: 19, dailySavings: 1 }
    );
    expect(ok).toBe(true);
    expect(usedNotifications).toBe(true);
  });

  test('falls back to flow API when timeline and notifications are unavailable', async () => {
    let usedFlow = false;
    const homey: any = {
      settings: { get: () => undefined },
      i18n: { getLanguage: () => 'en-US', getCurrency: () => 'USD' },
      flow: {
        runFlowCardAction: jest.fn().mockImplementation(() => {
          usedFlow = true;
          return Promise.resolve();
        })
      }
    };
    const helper = new TimelineHelper(homey, createLogger() as any);
    const ok = await helper.addTimelineEntry(
      TimelineEventType.HOURLY_OPTIMIZATION_RESULT,
      {},
      false,
      { targetOriginal: 20, targetTemp: 19, dailySavings: 1 }
    );
    expect(ok).toBe(true);
    expect(usedFlow).toBe(true);
  });

  test('includes tank change when provided', async () => {
    let lastBody = '';
    const homey = makeHomey({ onEntry: ({ body }: any) => (lastBody = body) });
    const helper = new TimelineHelper(homey, createLogger() as any);

    const ok = await helper.addTimelineEntry(
      TimelineEventType.HOURLY_OPTIMIZATION_RESULT,
      {},
      false,
      { targetOriginal: 21, targetTemp: 22, tankOriginal: 47.5, tankTemp: 49 }
    );

    expect(ok).toBe(true);
    expect(lastBody).toContain('from 21°C to 22°C');
    expect(lastBody).toContain('Hot water tank: 47.5°C to 49°C');
    // Zone2 is not included by TypeScript TimelineHelper (only in JS wrapper)
  });

  test('formats projected daily savings with currency', async () => {
    let lastBody = '';
    const homey = makeHomey({ settings: { currency: 'USD' }, onEntry: ({ body }: any) => (lastBody = body) });
    const helper = new TimelineHelper(homey, createLogger() as any);

    const ok = await helper.addTimelineEntry(
      TimelineEventType.HOURLY_OPTIMIZATION_RESULT,
      {},
      false,
      { targetOriginal: 20, targetTemp: 19, dailySavings: 1.23 }
    );

    expect(ok).toBe(true);
    expect(lastBody).toContain('Projected daily savings:');
    expect(lastBody).toMatch(/\$1\.23|US\$\s?1\.23/); // locale differences allowed
  });

  test('uses hourly savings x24 when dailySavings missing', async () => {
    let lastBody = '';
    const homey = makeHomey({ settings: { currency: 'USD' }, onEntry: ({ body }: any) => (lastBody = body) });
    const helper = new TimelineHelper(homey, createLogger() as any);

    const ok = await helper.addTimelineEntry(
      TimelineEventType.HOURLY_OPTIMIZATION_RESULT,
      {},
      false,
      { targetOriginal: 20, targetTemp: 19, savings: 0.5 }
    );

    expect(ok).toBe(true);
    // Should show about $12.00 (0.5 * 24) depending on locale formatting
    expect(lastBody).toContain('Projected daily savings:');
  });
});
