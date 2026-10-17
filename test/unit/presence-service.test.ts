import {
  getOccupancySource,
  migrateOccupancySource,
  syncOccupancyFromPresence
} from '../../src/services/presence-service';

function settings(initial: Record<string, unknown> = {}) {
  const store: Record<string, unknown> = { ...initial };
  return { store, get: (k: string) => store[k], set: (k: string, v: unknown) => { store[k] = v; } };
}
const logger = { log: jest.fn() };
const presence = (home: boolean | null) => ({ anyoneHome: jest.fn().mockResolvedValue(home) });

describe('home/away source', () => {
  test('existing installs with a stored home/away state keep Flows and the switch', () => {
    const s = settings({ occupied: false });
    expect(migrateOccupancySource(s)).toBe('manual');
    expect(s.store.occupancy_source).toBe('manual');
  });

  test('fresh installs start on presence; the choice is stored once', () => {
    const s = settings();
    expect(migrateOccupancySource(s)).toBe('presence');
    s.set('occupied', true); // presence writes occupied later
    expect(migrateOccupancySource(s)).toBe('presence');
  });

  test('a stored choice is kept', () => {
    expect(migrateOccupancySource(settings({ occupancy_source: 'presence', occupied: true }))).toBe('presence');
    expect(getOccupancySource(settings({}))).toBe('manual');
  });
});

describe('presence sync', () => {
  test('manual source never touches occupied', async () => {
    const s = settings({ occupancy_source: 'manual', occupied: true });
    const p = presence(false);
    expect(await syncOccupancyFromPresence(s, p, logger)).toBeNull();
    expect(p.anyoneHome).not.toHaveBeenCalled();
    expect(s.store.occupied).toBe(true);
  });

  test('everyone leaving sets away, someone arriving sets home', async () => {
    const s = settings({ occupancy_source: 'presence', occupied: true });
    expect(await syncOccupancyFromPresence(s, presence(false), logger)).toBe(false);
    expect(s.store.occupied).toBe(false);
    expect(await syncOccupancyFromPresence(s, presence(true), logger)).toBe(true);
    expect(s.store.occupied).toBe(true);
  });

  test('a Flow override holds until presence changes again', async () => {
    const s = settings({ occupancy_source: 'presence', occupied: true });
    await syncOccupancyFromPresence(s, presence(true), logger); // someone home
    s.set('occupied', false); // Flow: away day
    expect(await syncOccupancyFromPresence(s, presence(true), logger)).toBeNull();
    expect(s.store.occupied).toBe(false);
    await syncOccupancyFromPresence(s, presence(false), logger); // everyone leaves: still away
    expect(await syncOccupancyFromPresence(s, presence(true), logger)).toBe(true); // arrival wins
  });

  test('no presence information leaves home/away alone', async () => {
    const s = settings({ occupancy_source: 'presence', occupied: false });
    expect(await syncOccupancyFromPresence(s, presence(null), logger)).toBeNull();
    expect(s.store.occupied).toBe(false);
  });
});

describe('PresenceService.anyoneHome', () => {
  const { PresenceService } = require('../../src/services/presence-service');
  const withUsers = (users: Record<string, unknown>) => {
    const svc = new PresenceService({});
    (svc as any).api = { users: { getUsers: jest.fn().mockResolvedValue(users) } };
    return svc;
  };

  test('any enabled user home means home; disabled and untracked users are ignored', async () => {
    expect(await withUsers({ a: { enabled: true, present: false }, b: { enabled: true, present: true } }).anyoneHome()).toBe(true);
    expect(await withUsers({ a: { enabled: true, present: false }, b: { enabled: false, present: true } }).anyoneHome()).toBe(false);
    expect(await withUsers({ a: { enabled: true, present: null } }).anyoneHome()).toBeNull();
  });
});
