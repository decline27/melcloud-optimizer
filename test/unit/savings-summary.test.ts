/* eslint-disable @typescript-eslint/no-var-requires */
let api: any;

describe('getSavingsSummary', () => {
  let homey: any;
  let anchorDay: number;
  let base: Date;

  beforeEach(() => {
    // Load real api.js fresh in each test file context to avoid name collisions
    jest.resetModules();
    api = require('../../api.js');
    // Reset helpers if available
    if (api.__test && typeof api.__test.resetAll === 'function') {
      api.__test.resetAll();
    }

    const settingsStore: Record<string, any> = {};

    homey = {
      app: {
        log: jest.fn(),
        error: jest.fn(),
      },
      settings: {
        get: jest.fn((key: string) => settingsStore[key]),
        set: jest.fn((key: string, val: any) => { settingsStore[key] = val; })
      }
    };

    // Fixed time zone for deterministic tests
    settingsStore['time_zone_offset'] = 0; // UTC
    settingsStore['use_dst'] = false;
    settingsStore['currency'] = 'EUR';

    // Build a simple rolling history for 10 days ending on a stable anchor date within the current month
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    anchorDay = 20; // keep within month boundaries
    base = new Date(Date.UTC(y, m, anchorDay, 0, 0, 0));
    const toDateStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const history: Array<{date: string; total: number}> = [];
    for (let i = 9; i >= 0; i--) {
      const d = new Date(base.getTime());
      d.setDate(d.getDate() - i);
      history.push({ date: toDateStr(d), total: i + 1 }); // totals: 1..10
    }
    settingsStore['savings_history'] = history;
  });

  test('returns today, last 7 days, and last 30 days sums', async () => {
    const res = await api.getSavingsSummary({ homey });
    expect(res.success).toBe(true);
    expect(res.currencyCode).toBe('EUR');

    // today equals 1 (constructed as i+1 with i=0 for today)
    expect(res.summary.today).toBe(1);

    // last 7 days sum of totals 1..7 = 28
    expect(res.summary.last7Days).toBe(28);

    // yesterday equals 2
    expect(res.summary.yesterday).toBe(2);

    // month to date equals all entries (1..10) = 55
    expect(res.summary.monthToDate).toBe(55);

    // week to date: compute Monday->today within our constructed window
    const jsDay = base.getUTCDay(); // 0..6; Monday offset
    const offsetToMonday = (jsDay + 6) % 7;
    const mondayDay = anchorDay - offsetToMonday;
    const start = Math.max(mondayDay, anchorDay - 9); // ensure within our 10-day history (days 11..20)
    let expectedWTD = 0;
    for (let d = start; d <= anchorDay; d++) {
      // total at day d is anchorDay - d + 1
      expectedWTD += (anchorDay - d + 1);
    }
    expect(res.summary.weekToDate).toBe(expectedWTD);

    // last 30 days equals all entries (1..10) = 55
    expect(res.summary.last30Days).toBe(55);

    // allTime should be omitted when history <= 30 days
    expect((res.summary as any).allTime).toBeUndefined();

    // Series should include 30 days
    expect(res.series).toBeDefined();
    expect(Array.isArray(res.series.last30)).toBe(true);
    expect(res.series.last30.length).toBe(30);
    // Sum of series equals last30Days
    const seriesSum = res.series.last30.reduce((s: number, d: any) => s + Number(d.total || 0), 0);
    expect(seriesSum).toBe(55);
  });

  test('includes allTime when history > 30 days and returns 30-day series', async () => {
    const settingsStore: any = {};
    // rebuild a new homey stub for this test
    const homey2: any = {
      app: { log: jest.fn(), error: jest.fn() },
      settings: {
        get: jest.fn((k: string) => settingsStore[k]),
        set: jest.fn((k: string, v: any) => { settingsStore[k] = v; })
      }
    };

    settingsStore['time_zone_offset'] = 0;
    settingsStore['use_dst'] = false;
    settingsStore['currency'] = 'EUR';

    // Build 35-day history ending at anchorDay
    const toDateStr = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
    const hist: Array<{date:string; total:number}> = [];
    for (let i = 34; i >= 0; i--) {
      const d = new Date(base.getTime());
      d.setUTCDate(d.getUTCDate() - i);
      hist.push({ date: toDateStr(d), total: i + 1 }); // 1..35, with today=1, yesterday=2
    }
    settingsStore['savings_history'] = hist;

    const res = await api.getSavingsSummary({ homey: homey2 });
    expect(res.success).toBe(true);
    // allTime exists and equals sum 1..35 = 630
    expect(res.summary.allTime).toBe(630);
    // last30Days equals sum 1..30 = 465 (since our construction sets today=1 => last30: 1..30)
    expect(res.summary.last30Days).toBe(465);
    // Series integrity
    expect(res.series.last30.length).toBe(30);
    const sSum = res.series.last30.reduce((s: number, d: any) => s + Number(d.total || 0), 0);
    expect(sSum).toBe(465);
  });

  test('handles empty history gracefully', async () => {
    // Override with empty history
    (homey.settings.get as jest.Mock).mockImplementation((key: string) => {
      if (key === 'savings_history') return [];
      if (key === 'time_zone_offset') return 0;
      if (key === 'use_dst') return false;
      if (key === 'currency') return 'EUR';
      return undefined;
    });

    const res = await api.getSavingsSummary({ homey });
    expect(res.success).toBe(true);
    expect(res.summary.today).toBe(0);
    expect(res.summary.last7Days).toBe(0);
    expect(res.summary.last30Days).toBe(0);
  });
});

