/**
 * Home/away from Homey presence.
 *
 * Two sources for the `occupied` setting:
 * - 'presence': follows whether anyone in the Homey household is home. Only changes in
 *   presence (someone arrives, everyone leaves) are applied, so a Flow ("set occupied"), the
 *   device switch or the settings page can still override in between; the latest event wins.
 * - 'manual': Flows, the device switch and the settings page only (the behaviour before
 *   presence existed; home/away-day schedules built with Flows keep working unchanged).
 */
export type OccupancySource = 'presence' | 'manual';

type SettingsLike = { get(key: string): any; set(key: string, value: any): void };
type LoggerLike = { log(message: string, ...args: any[]): void; error?(message: string, ...args: any[]): void };

export const OCCUPANCY_SOURCE_KEY = 'occupancy_source';
const LAST_PRESENCE_KEY = 'presence_last_home';

export function getOccupancySource(settings: { get(key: string): any }): OccupancySource {
  return settings.get(OCCUPANCY_SOURCE_KEY) === 'presence' ? 'presence' : 'manual';
}

/**
 * One-time choice for installs that predate presence: anyone who already has a stored
 * home/away state (page save, Flow, device switch) keeps Flows and the switch; a fresh
 * install starts on presence. Stored once so later presence writes do not flip it.
 */
export function migrateOccupancySource(settings: SettingsLike): OccupancySource {
  const stored = settings.get(OCCUPANCY_SOURCE_KEY);
  if (stored === 'presence' || stored === 'manual') return stored;
  const occupied = settings.get('occupied');
  const source: OccupancySource = occupied === undefined || occupied === null ? 'presence' : 'manual';
  settings.set(OCCUPANCY_SOURCE_KEY, source);
  return source;
}

export class PresenceService {
  private api: any = null;

  constructor(private readonly homey: any) {}

  private async getApi(): Promise<any> {
    if (!this.api) {
      // Needs the homey:manager:api permission.
      const { HomeyAPI } = require('homey-api');
      this.api = await HomeyAPI.createAppAPI({ homey: this.homey });
    }
    return this.api;
  }

  /**
   * True when at least one enabled Homey user is home, false when all are away, null when no
   * user has presence information.
   */
  async anyoneHome(): Promise<boolean | null> {
    const api = await this.getApi();
    const users = Object.values(await api.users.getUsers()) as Array<{ enabled?: boolean; present?: boolean | null }>;
    const tracked = users.filter(user => user && user.enabled !== false && typeof user.present === 'boolean');
    if (tracked.length === 0) return null;
    return tracked.some(user => user.present === true);
  }
}

/**
 * Applies a presence change to the `occupied` setting (which the device switch, Flows and the
 * optimizer all follow). Returns the new state when it changed, else null.
 */
export async function syncOccupancyFromPresence(
  settings: SettingsLike,
  presence: Pick<PresenceService, 'anyoneHome'>,
  logger: LoggerLike
): Promise<boolean | null> {
  if (getOccupancySource(settings) !== 'presence') return null;
  const home = await presence.anyoneHome();
  if (home === null) return null;
  if (settings.get(LAST_PRESENCE_KEY) === home) return null;
  settings.set(LAST_PRESENCE_KEY, home);
  if (settings.get('occupied') === home) return null;
  settings.set('occupied', home);
  logger.log(`Presence: ${home ? 'someone came home' : 'everyone left'}; home/away set to ${home ? 'home' : 'away'}`);
  return home;
}
