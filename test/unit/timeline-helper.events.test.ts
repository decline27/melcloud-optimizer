import { TimelineHelper, TimelineEventType, TimelineEntryType } from '../../src/util/timeline-helper';

const createLogger = () => ({ log: jest.fn(), error: jest.fn() });

const makeHomey = (overrides: any = {}) => ({
  settings: { get: (k: string) => overrides.settings?.[k] },
  i18n: { getLanguage: () => overrides.lang || 'en-US', getCurrency: () => overrides.i18nCurrency },
  timeline: {
    createEntry: jest.fn().mockImplementation(({ title, body, type }) => {
      if (typeof overrides.onEntry === 'function') overrides.onEntry({ title, body, type });
      return Promise.resolve();
    })
  },
  notifications: overrides.notifications
} as any);

describe('TimelineHelper - other events & notifications', () => {
  test('WEEKLY_CALIBRATION_RESULT formats K change and method', async () => {
    let lastBody = '';
    const homey = makeHomey({ onEntry: ({ body }: any) => (lastBody = body) });
    const helper = new TimelineHelper(homey, createLogger() as any);

    const ok = await helper.addTimelineEntry(
      TimelineEventType.WEEKLY_CALIBRATION_RESULT,
      {},
      false,
      { oldK: 0.12, newK: 0.18, method: 'least_squares' }
    );

    expect(ok).toBe(true);
    expect(lastBody).toContain('K-factor adjusted from 0.12 to 0.18');
    expect(lastBody).toContain('using least_squares method');
  });

  test('CUSTOM event uses provided message', async () => {
    let lastBody = '';
    const homey = makeHomey({ onEntry: ({ body }: any) => (lastBody = body) });
    const helper = new TimelineHelper(homey, createLogger() as any);

    const ok = await helper.addTimelineEntry(
      TimelineEventType.CUSTOM,
      { message: 'Hello world' },
      false
    );

    expect(ok).toBe(true);
    expect(lastBody).toContain('Hello world');
  });

  test('createNotification true creates a notification', async () => {
    const notifications = { createNotification: jest.fn().mockResolvedValue(true) };
    let lastTitle = '';
    const homey = makeHomey({ onEntry: ({ title }: any) => (lastTitle = title), notifications });
    const helper = new TimelineHelper(homey, createLogger() as any);

    const ok = await helper.addTimelineEntry(
      TimelineEventType.HOURLY_OPTIMIZATION,
      {},
      true
    );

    expect(ok).toBe(true);
    expect(lastTitle).toBe('MELCloud Optimizer');
    expect(notifications.createNotification).toHaveBeenCalled();
  });
});

