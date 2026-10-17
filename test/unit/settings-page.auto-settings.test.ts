import * as fs from 'fs';
import * as path from 'path';
import { JSDOM } from 'jsdom';

/**
 * Settings page "Automatic" fine-tuning, exercised against the real page in jsdom with a fake
 * Homey SDK. Automatic means nothing stored: values equal to the app default migrate to it, and
 * Save writes only fields the user changed.
 */

const DEFAULTS = {
  deadband_c: 0.5,
  min_setpoint_change_minutes: 30,
  temp_step_max: 0.5,
  preheat_cheap_percentile: 0.25,
  tank_temp_step: 1,
  temp_step_zone2: 1,
  log_level: 1,
  comfort_away_offset_c: 2,
  comfort_night_offset_c: 1
};

const MARKUP_TABLE = {
  SE: { gridFee: 0.03, energyTax: 0.036, retailMarkup: 0.01, vatRate: 1.25, description: 'Sweden' },
  default: { gridFee: 0.04, energyTax: 0.02, retailMarkup: 0.01, vatRate: 1.2, description: 'EU' }
};

const DETECTED = {
  time_zone_name: 'Europe/Stockholm',
  country: 'SE',
  currency: 'SEK',
  location: { latitude: 55.58, longitude: 12.95, source: 'homey' }
};

let deviceList: any = { success: true, devices: [], buildings: [] };

function makeHomey(stored: Record<string, unknown>) {
  const store: Record<string, unknown> = { ...stored };
  const sets: Array<[string, unknown]> = [];
  const unsets: string[] = [];
  const homey: any = {
    ready: jest.fn(),
    alert: jest.fn(),
    confirm: jest.fn(),
    on: jest.fn(),
    __: (k: string) => k,
    get: (key: string, cb: (err: any, value: unknown) => void) => setTimeout(() => cb(null, store[key]), 0),
    set: (key: string, value: unknown, cb?: (err: any) => void) => { sets.push([key, value]); store[key] = value; cb?.(null); },
    unset: (key: string, cb?: (err: any) => void) => { unsets.push(key); delete store[key]; cb?.(null); },
    api: (_method: string, apiPath: string, _body: unknown, cb: (err: any, res: any) => void) => {
      const res = apiPath === '/getSettingDefaults'
        ? { success: true, defaults: DEFAULTS, detected: DETECTED, consumer_markup_table: MARKUP_TABLE }
        : apiPath === '/getDeviceList' ? deviceList : { success: false };
      setTimeout(() => cb(null, res), 0);
    }
  };
  return { homey, store, sets, unsets };
}

async function loadPage(stored: Record<string, unknown>) {
  const html = fs.readFileSync(path.join(__dirname, '../../settings/index.html'), 'utf8')
    // External scripts (Homey SDK, maps) are not available here; the fake SDK is injected below.
    .replace(/<script[^>]*src=[^>]*><\/script>/g, '');
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://localhost/' });
  const win: any = dom.window;
  win.console.log = () => {};
  win.console.warn = () => {};
  win.console.error = () => {};
  win.alert = () => {};
  const fake = makeHomey(stored);
  win.Homey = fake.homey;
  win.onHomeyReady(fake.homey);
  await new Promise(r => setTimeout(r, 50));
  return { win, doc: win.document as Document, ...fake };
}

const status = (doc: Document, key: string) =>
  (doc.querySelector(`[data-auto-for="${key}"]`)?.textContent || '').trim();

describe('settings page automatic fine-tuning', () => {
  test('unset and default-equal values show Automatic; a different value shows Custom', async () => {
    const { doc } = await loadPage({ deadband_c: 0.5, min_setpoint_change_minutes: 60 });

    expect(status(doc, 'deadband_c')).toMatch(/^Automatic/);
    expect(status(doc, 'temp_step_max')).toMatch(/^Automatic/);
    expect((doc.getElementById('temp_step_max') as HTMLInputElement).value).toBe('0.5');
    expect(status(doc, 'min_setpoint_change_minutes')).toMatch(/^Custom value/);
    expect((doc.getElementById('min_setpoint_change_minutes') as HTMLInputElement).value).toBe('60');
    // deadband 0.5 equalled the default: migrated and announced.
    expect(doc.getElementById('fine_tuning_migration_note')?.textContent).toMatch(/1 setting matched/);
  });

  test('save writes only custom fields and clears automatic ones', async () => {
    const { win, doc, sets, unsets } = await loadPage({ deadband_c: 0.5, min_setpoint_change_minutes: 60 });

    // The user changes the temperature step, and puts the interval back to automatic.
    const step = doc.getElementById('temp_step_max') as HTMLInputElement;
    step.value = '1';
    step.dispatchEvent(new win.Event('input'));
    const link = doc.querySelector('[data-auto-for="min_setpoint_change_minutes"] a') as HTMLAnchorElement;
    link.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    expect(status(doc, 'min_setpoint_change_minutes')).toMatch(/^Automatic/);

    sets.length = 0;
    (doc.getElementById('save') as HTMLButtonElement).dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 20));

    const setKeys = sets.map(([k]) => k);
    expect(setKeys).toContain('temp_step_max');
    expect(sets.find(([k]) => k === 'temp_step_max')?.[1]).toBe(1);
    for (const autoKey of ['deadband_c', 'min_setpoint_change_minutes', 'preheat_cheap_percentile', 'tank_temp_step', 'log_level']) {
      expect(setKeys).not.toContain(autoKey);
      expect(unsets).toContain(autoKey);
    }
    expect(unsets).not.toContain('temp_step_max');
  });
});

const val = (doc: Document, id: string) => (doc.getElementById(id) as HTMLInputElement).value;

function setInput(win: any, doc: Document, id: string, value: string) {
  const el = doc.getElementById(id) as HTMLInputElement;
  el.value = value;
  el.dispatchEvent(new win.Event('input'));
}

async function pressSave(win: any, doc: Document) {
  (doc.getElementById('save') as HTMLButtonElement).dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 20));
}

describe('settings page comfort temperature', () => {
  afterEach(() => { deviceList = { success: true, devices: [], buildings: [] }; });

  test('comfort temperature sets the occupied range; away and night follow at the standard offsets', async () => {
    const { win, doc, sets } = await loadPage({ comfort_lower_occupied: 20, comfort_upper_occupied: 21 });

    expect(val(doc, 'comfort_target_c')).toBe('20.5');
    expect(val(doc, 'comfort_variation_c')).toBe('0.5');
    expect([val(doc, 'comfort_lower_away'), val(doc, 'comfort_upper_away')]).toEqual(['18', '19']);
    expect([val(doc, 'comfort_lower_night'), val(doc, 'comfort_upper_night')]).toEqual(['19', '20']);
    expect(doc.querySelector('[data-band-for="away"]')?.textContent).toMatch(/^Automatic/);

    setInput(win, doc, 'comfort_target_c', '22');
    setInput(win, doc, 'comfort_variation_c', '1');
    expect([val(doc, 'comfort_lower_occupied'), val(doc, 'comfort_upper_occupied')]).toEqual(['21', '23']);
    expect([val(doc, 'comfort_lower_away'), val(doc, 'comfort_upper_away')]).toEqual(['19', '21']);
    expect(doc.getElementById('comfort_band_summary')?.textContent).toMatch(/Home 21–23 °C · Away 19–21 °C · Night 20–22 °C/);

    sets.length = 0;
    await pressSave(win, doc);
    const saved = Object.fromEntries(sets);
    expect(saved).toMatchObject({
      comfort_lower_occupied: 21, comfort_upper_occupied: 23,
      comfort_lower_away: 19, comfort_upper_away: 21,
      comfort_lower_night: 20, comfort_upper_night: 22
    });
  });

  test('own away values are kept when the comfort temperature changes', async () => {
    const { win, doc } = await loadPage({
      comfort_lower_occupied: 21, comfort_upper_occupied: 23,
      comfort_lower_away: 18, comfort_upper_away: 20
    });

    expect(val(doc, 'comfort_target_c')).toBe('22');
    expect(doc.querySelector('[data-band-for="away"]')?.textContent).toMatch(/your own values/);
    setInput(win, doc, 'comfort_target_c', '21');
    expect([val(doc, 'comfort_lower_away'), val(doc, 'comfort_upper_away')]).toEqual(['18', '20']);

    // "Use automatic" puts away back on the standard offset.
    const link = doc.querySelector('[data-band-for="away"] a') as HTMLAnchorElement;
    link.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    expect([val(doc, 'comfort_lower_away'), val(doc, 'comfort_upper_away')]).toEqual(['18', '20']);
    expect(doc.querySelector('[data-band-for="away"]')?.textContent).toMatch(/^Automatic/);
    setInput(win, doc, 'comfort_target_c', '22');
    expect([val(doc, 'comfort_lower_away'), val(doc, 'comfort_upper_away')]).toEqual(['19', '21']);
  });
});

describe('settings page automatic detection', () => {
  afterEach(() => { deviceList = { success: true, devices: [], buildings: [] }; });

  test('an empty time zone stays empty (Homey zone) and is not saved on open', async () => {
    const { doc, sets } = await loadPage({});
    expect(val(doc, 'time_zone_name')).toBe('');
    expect((doc.getElementById('time_zone_name') as HTMLInputElement).placeholder).toBe('Automatic (Europe/Stockholm)');
    expect(sets.map(([k]) => k)).not.toContain('time_zone_name');
    expect((doc.getElementById('currency_code') as HTMLInputElement).placeholder).toBe('Automatic (SEK)');
    expect(doc.getElementById('weather_location_warning')?.style.display).toBe('none');
  });

  test('a stored copy of the built-in markup table is cleared; nothing is saved on open', async () => {
    const { doc, sets, unsets } = await loadPage({ consumer_markup_config: JSON.stringify(MARKUP_TABLE, null, 2) });
    expect(unsets).toContain('consumer_markup_config');
    expect(val(doc, 'consumer_markup_config')).toBe('');
    expect(sets.map(([k]) => k)).not.toContain('consumer_markup_config');
  });

  test('a single heat pump on the account is selected', async () => {
    deviceList = {
      success: true,
      buildings: [{ id: 7, name: 'Home' }],
      devices: [{ id: 42, name: 'Ecodan', buildingId: 7, hasZone1: true, hasZone2: false, type: 'atw' }]
    };
    const { doc } = await loadPage({});
    await new Promise(r => setTimeout(r, 30));
    expect(val(doc, 'device_id')).toBe('42');
    expect(val(doc, 'building_id')).toBe('7');
    expect(doc.getElementById('device_refresh_status')?.textContent).toMatch(/selected it/);
  });
});
