/* eslint-disable @typescript-eslint/no-var-requires */
let api: any;

describe('getSavingsSummary', () => {
  let homey: any;
  let anchorDay: number;
  let base: Date;

  beforeEach(() => {
    // Load real api.js fresh in each test file context to avoid name collisions
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

  test('returns today, last 7 days, and last 30 days sums (legacy format)', async () => {
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
    expect(res.summary.allTime).toBeUndefined();

    // Series should include 30 days
    expect(res.series).toBeDefined();
    expect(Array.isArray(res.series.last30)).toBe(true);
    expect(res.series.last30.length).toBe(30);
    // Sum of series equals last30Days
    const seriesSum = res.series.last30.reduce((s: number, d: any) => s + Number(d.total || 0), 0);
    expect(seriesSum).toBe(55);

    // Verify migration occurred (entries should now have totalMinor)
    const migratedHistory = homey.settings.set.mock.calls.find((call: any) => call[0] === 'savings_history');
    expect(migratedHistory).toBeDefined();
    if (migratedHistory) {
      const migratedEntries = migratedHistory[1];
      expect(migratedEntries[0]).toHaveProperty('totalMinor');
      expect(migratedEntries[0]).toHaveProperty('currency', 'EUR');
      expect(migratedEntries[0]).toHaveProperty('decimals', 2);
      expect(migratedEntries[0]).not.toHaveProperty('total');
      // Verify conversion: 1 EUR = 100 minor units (cents)
      expect(migratedEntries[migratedEntries.length - 1].totalMinor).toBe(100);
    }
  });

  test('handles new totalMinor format correctly', async () => {
    // Replace with new format data
    const settingsStore: any = {};
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

    // Build 10-day history ending at anchorDay using new format
    const toDateStr = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
    const hist: Array<{date:string; totalMinor:number; currency:string; decimals:number}> = [];
    for (let i = 9; i >= 0; i--) {
      const d = new Date(base.getTime());
      d.setUTCDate(d.getUTCDate() - i);
      // totalMinor = (i + 1) * 100 cents for i+1 EUR
      hist.push({ 
        date: toDateStr(d), 
        totalMinor: (i + 1) * 100, 
        currency: 'EUR', 
        decimals: 2 
      });
    }
    settingsStore['savings_history'] = hist;

    const res = await api.getSavingsSummary({ homey: homey2 });
    expect(res.success).toBe(true);
    expect(res.currencyCode).toBe('EUR');

    // Should produce same results as legacy format
    expect(res.summary.today).toBe(1);
    expect(res.summary.yesterday).toBe(2);
    expect(res.summary.last7Days).toBe(28);
    expect(res.summary.last30Days).toBe(55);

    // No migration should have occurred
    expect(homey2.settings.set).not.toHaveBeenCalledWith('savings_history', expect.anything());
  });

  test('handles mixed currency entries correctly', async () => {
    const settingsStore: any = {};
    const homey3: any = {
      app: { log: jest.fn(), error: jest.fn() },
      settings: {
        get: jest.fn((k: string) => settingsStore[k]),
        set: jest.fn((k: string, v: any) => { settingsStore[k] = v; })
      }
    };

    settingsStore['time_zone_offset'] = 0;
    settingsStore['use_dst'] = false;
    settingsStore['currency'] = 'USD';

    // Mixed currency history: some EUR, some USD, some legacy
    const toDateStr = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
    const hist: Array<any> = [
      { date: toDateStr(new Date(base.getTime() - 9 * 24 * 60 * 60 * 1000)), totalMinor: 100, currency: 'EUR', decimals: 2 },
      { date: toDateStr(new Date(base.getTime() - 8 * 24 * 60 * 60 * 1000)), totalMinor: 200, currency: 'USD', decimals: 2 },
      { date: toDateStr(new Date(base.getTime() - 7 * 24 * 60 * 60 * 1000)), total: 3 }, // legacy
      { date: toDateStr(new Date(base.getTime() - 6 * 24 * 60 * 60 * 1000)), totalMinor: 400, currency: 'EUR', decimals: 2 },
      { date: toDateStr(new Date(base.getTime())), totalMinor: 500, currency: 'USD', decimals: 2 }, // today
    ];
    settingsStore['savings_history'] = hist;

    const res = await api.getSavingsSummary({ homey: homey3 });
    expect(res.success).toBe(true);

    // Mixed currencies should result in empty currency code
    expect(res.currencyCode).toBe('');

    // Should still compute totals correctly (converting all to USD as configured)
    expect(res.summary.today).toBe(5); // 500 cents = 5 USD
    expect(typeof res.summary.last7Days).toBe('number');
    expect(res.summary.last7Days).toBeGreaterThan(0);

    // Verify migration occurred for legacy entry
    const migratedHistory = homey3.settings.set.mock.calls.find((call: any) => call[0] === 'savings_history');
    expect(migratedHistory).toBeDefined();
  });

  test('handles JPY currency (0 decimals) correctly', async () => {
    const settingsStore: any = {};
    const homey4: any = {
      app: { log: jest.fn(), error: jest.fn() },
      settings: {
        get: jest.fn((k: string) => settingsStore[k]),
        set: jest.fn((k: string, v: any) => { settingsStore[k] = v; })
      }
    };

    settingsStore['time_zone_offset'] = 0;
    settingsStore['use_dst'] = false;
    settingsStore['currency'] = 'JPY';

    // Legacy JPY data
    const toDateStr = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
    const hist: Array<{date:string; total:number}> = [
      { date: toDateStr(new Date(base.getTime() - 2 * 24 * 60 * 60 * 1000)), total: 100 },
      { date: toDateStr(new Date(base.getTime() - 1 * 24 * 60 * 60 * 1000)), total: 150 },
      { date: toDateStr(new Date(base.getTime())), total: 200 }, // today
    ];
    settingsStore['savings_history'] = hist;

    const res = await api.getSavingsSummary({ homey: homey4 });
    expect(res.success).toBe(true);
    expect(res.currencyCode).toBe('JPY');

    // JPY amounts should be the same (no decimal conversion)
    expect(res.summary.today).toBe(200);
    expect(res.summary.yesterday).toBe(150);

    // Verify migration occurred with correct decimals (0 for JPY)
    const migratedHistory = homey4.settings.set.mock.calls.find((call: any) => call[0] === 'savings_history');
    expect(migratedHistory).toBeDefined();
    if (migratedHistory) {
      const migratedEntries = migratedHistory[1];
      expect(migratedEntries[0]).toHaveProperty('totalMinor', 100); // No conversion for JPY
      expect(migratedEntries[0]).toHaveProperty('currency', 'JPY');
      expect(migratedEntries[0]).toHaveProperty('decimals', 0);
    }
  });

  test('handles KWD currency (3 decimals) correctly', async () => {
    const settingsStore: any = {};
    const homey5: any = {
      app: { log: jest.fn(), error: jest.fn() },
      settings: {
        get: jest.fn((k: string) => settingsStore[k]),
        set: jest.fn((k: string, v: any) => { settingsStore[k] = v; })
      }
    };

    settingsStore['time_zone_offset'] = 0;
    settingsStore['use_dst'] = false;
    settingsStore['currency'] = 'KWD';

    // Legacy KWD data
    const toDateStr = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
    const hist: Array<{date:string; total:number}> = [
      { date: toDateStr(new Date(base.getTime())), total: 1.234 }, // today - 1.234 KWD
    ];
    settingsStore['savings_history'] = hist;

    const res = await api.getSavingsSummary({ homey: homey5 });
    expect(res.success).toBe(true);
    expect(res.currencyCode).toBe('KWD');

    // KWD amounts should be preserved
    expect(res.summary.today).toBe(1.234);

    // Verify migration occurred with correct decimals (3 for KWD)
    const migratedHistory = homey5.settings.set.mock.calls.find((call: any) => call[0] === 'savings_history');
    expect(migratedHistory).toBeDefined();
    if (migratedHistory) {
      const migratedEntries = migratedHistory[1];
      expect(migratedEntries[0]).toHaveProperty('totalMinor', 1234); // 1.234 * 1000
      expect(migratedEntries[0]).toHaveProperty('currency', 'KWD');
      expect(migratedEntries[0]).toHaveProperty('decimals', 3);
    }
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

  test('handles per-entry decimals correctly', async () => {
    const settingsStore: any = {};
    const homey6: any = {
      app: { log: jest.fn(), error: jest.fn() },
      settings: {
        get: jest.fn((k: string) => settingsStore[k]),
        set: jest.fn((k: string, v: any) => { settingsStore[k] = v; })
      }
    };

    settingsStore['time_zone_offset'] = 0;
    settingsStore['use_dst'] = false;
    settingsStore['currency'] = 'USD';

    // History with entries having different decimals
    const toDateStr = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
    const hist: Array<any> = [
      { date: toDateStr(new Date(base.getTime() - 2 * 24 * 60 * 60 * 1000)), totalMinor: 12345, currency: 'KWD', decimals: 3 }, // 12.345 KWD
      { date: toDateStr(new Date(base.getTime() - 1 * 24 * 60 * 60 * 1000)), totalMinor: 250, currency: 'USD', decimals: 2 }, // 2.50 USD
      { date: toDateStr(new Date(base.getTime())), totalMinor: 100, currency: 'JPY', decimals: 0 }, // 100 JPY
    ];
    settingsStore['savings_history'] = hist;

    const res = await api.getSavingsSummary({ homey: homey6 });
    expect(res.success).toBe(true);

    // Should correctly convert each entry based on its own decimals
    expect(res.summary.today).toBe(100); // 100 JPY (no conversion)
    expect(res.summary.yesterday).toBe(2.5); // 250 cents = 2.50 USD

    // Mixed currencies should result in empty currency code
    expect(res.currencyCode).toBe('');

    // Series should include converted values
    expect(res.series.last30.length).toBe(30);
  });
});
