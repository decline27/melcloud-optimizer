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
  log_level: 1
};

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
      const res = apiPath === '/getSettingDefaults' ? { success: true, defaults: DEFAULTS } : { success: false };
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
