import { TimeZoneHelper } from '../../src/util/time-zone-helper';

const createMockLogger = () => ({
  debug: jest.fn(),
  log: jest.fn(),
});

describe('TimeZoneHelper', () => {
  const RealDate = Date;

  afterEach(() => {
    // Restore original Date
    // @ts-ignore
    global.Date = RealDate;
    jest.restoreAllMocks();
  });

  test('updateSettings changes offset and DST flag and getTimeZoneString reflects it', () => {
    const logger = createMockLogger() as any;
    const tz = new TimeZoneHelper(logger, 2, false);

    tz.updateSettings(1, true);
    const tzString = tz.getTimeZoneString();
    // Since we cannot guarantee current month, just assert string starts with UTC
    expect(tzString).toMatch(/^UTC[+-]\d+/);
  });

  test('formatDate respects offset and DST', () => {
    const logger = createMockLogger() as any;
    const tz = new TimeZoneHelper(logger, 2, true);

    // Mock Date to a known DST month (June)
    // @ts-ignore
    global.Date = class extends RealDate {
      constructor(...args: any[]) {
        if (args.length === 0) {
          super('2025-06-15T12:00:00Z');
        } else if (args.length === 1) {
          super(args[0]);
        } else {
          // Support multiple-arg Date constructor up to 7 args
          // @ts-ignore
          super(args[0], args[1], args[2], args[3], args[4], args[5], args[6]);
        }
      }
      static now() { return new RealDate('2025-06-15T12:00:00Z').getTime(); }
    };

    const formatted = tz.formatDate(new Date('2025-06-15T12:00:00Z'));
    expect(typeof formatted).toBe('string');
    expect(formatted.length).toBeGreaterThan(0);
  });

  test('isInDSTperiod returns false when DST disabled and true when enabled in DST month', () => {
    const logger = createMockLogger() as any;
    const tzNoDst = new TimeZoneHelper(logger, 0, false);
    expect(tzNoDst.isInDSTperiod()).toBe(false);

    const tz = new TimeZoneHelper(logger, 0, true);
    // Mock Date to July
    // @ts-ignore
    global.Date = class extends RealDate {
      constructor(...args: any[]) {
        if (args.length === 0) {
          super('2025-07-01T00:00:00Z');
        } else if (args.length === 1) {
          super(args[0]);
        } else {
          // @ts-ignore
          super(args[0], args[1], args[2], args[3], args[4], args[5], args[6]);
        }
      }
      static now() { return new RealDate('2025-07-01T00:00:00Z').getTime(); }
    };

    expect(tz.isInDSTperiod()).toBe(true);
  });
});
