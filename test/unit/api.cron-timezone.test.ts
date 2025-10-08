import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

describe('getStartCronJobs timezone handling', () => {
  let cronCalls: Array<{ pattern: string; tz?: string }>;
  let api: any;
  let mockHomey: any;

  beforeEach(() => {
    jest.resetModules();
    cronCalls = [];

    jest.doMock('cron', () => ({
      CronJob: class {
        public running = false;
        public cronTime: any;
        constructor(pattern: string, fn: Function, onComplete: any, start: boolean, tz?: string) {
          this.running = !!start;
          this.cronTime = { source: pattern };
          cronCalls.push({ pattern, tz });
        }
        public start() {
          this.running = true;
        }
      }
    }));

    api = require('../../api.ts');

    mockHomey = {
      app: {
        log: jest.fn(),
        error: jest.fn(),
        warn: jest.fn()
      },
      settings: {
        get: jest.fn(() => undefined),
        set: jest.fn()
      }
    };
  });

  afterEach(() => {
    jest.resetModules();
    delete (global as any).hourlyJob;
    delete (global as any).weeklyJob;
  });

  test('defaults to Europe/Stockholm when no timezone configured', async () => {
    await api.getStartCronJobs({ homey: mockHomey });
    expect(cronCalls).toHaveLength(2);
    expect(cronCalls[0].tz).toBe('Europe/Stockholm');
    expect(cronCalls[1].tz).toBe('Europe/Stockholm');
  });

  test('uses configured time zone name when available', async () => {
    mockHomey.settings.get.mockImplementation((key: string) => {
      if (key === 'time_zone_name') return 'Europe/Oslo';
      return undefined;
    });

    await api.getStartCronJobs({ homey: mockHomey });
    expect(cronCalls[0].tz).toBe('Europe/Oslo');
    expect(cronCalls[1].tz).toBe('Europe/Oslo');
  });
});
