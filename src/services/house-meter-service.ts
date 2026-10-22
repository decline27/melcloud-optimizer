/**
 * House power from the whole-home meter in Homey (Tibber Pulse, P1 reader and similar), used to
 * measure the compressor's real draw (see util/power-calibration).
 *
 * Setting `house_meter_device_id`:
 * - empty or unset: automatic. The one device Homey Energy treats as the home meter
 *   (`energyObj.cumulative`), or else the one device reporting both power and imported energy.
 *   When several qualify, nothing is picked: the user chooses on the settings page.
 * - a device id: that device.
 * - 'none': no house meter; the power estimate stays as before.
 */
import { POWER_CALIBRATION_CONSTANTS } from '../constants';

export const HOUSE_METER_SETTING_KEY = 'house_meter_device_id';
export const HOUSE_METER_NONE = 'none';

/** The parts of a Homey API device this service reads. */
export interface MeterDeviceLike {
  id: string;
  name?: string;
  capabilities?: string[];
  capabilitiesObj?: Record<string, { value?: unknown; lastUpdated?: unknown } | undefined>;
  energyObj?: { cumulative?: boolean } | null;
}

export interface HouseMeterCandidate {
  id: string;
  name: string;
}

const hasPower = (device: MeterDeviceLike) =>
  Array.isArray(device.capabilities) && device.capabilities.includes('measure_power');

const looksLikeHouseMeter = (device: MeterDeviceLike) =>
  hasPower(device) && (device.energyObj?.cumulative === true || !!device.capabilities?.includes('meter_power.imported'));

/** Devices that look like a whole-home meter, home-meter ones (`cumulative`) first. */
export function houseMeterCandidates(devices: MeterDeviceLike[]): HouseMeterCandidate[] {
  return devices
    .filter(looksLikeHouseMeter)
    .sort((a, b) => Number(b.energyObj?.cumulative === true) - Number(a.energyObj?.cumulative === true))
    .map(device => ({ id: device.id, name: device.name || device.id }));
}

/** The meter to use for a setting value, or null for none. */
export function pickHouseMeter(devices: MeterDeviceLike[], setting: unknown): MeterDeviceLike | null {
  if (setting === HOUSE_METER_NONE) return null;
  if (typeof setting === 'string' && setting !== '') {
    return devices.find(device => device.id === setting && hasPower(device)) ?? null;
  }
  const cumulative = devices.filter(device => hasPower(device) && device.energyObj?.cumulative === true);
  if (cumulative.length === 1) return cumulative[0];
  if (cumulative.length > 1) return null;
  const meters = devices.filter(looksLikeHouseMeter);
  return meters.length === 1 ? meters[0] : null;
}

/** Current house power (W) from a device, or null when missing, invalid or stale. */
export function readPowerW(device: MeterDeviceLike, nowMs: number): number | null {
  const power = device.capabilitiesObj?.measure_power;
  const value = power?.value;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const updated = power?.lastUpdated ? new Date(power.lastUpdated as string | number).getTime() : NaN;
  if (Number.isFinite(updated) && nowMs - updated > POWER_CALIBRATION_CONSTANTS.MAX_READING_AGE_MINUTES * 60_000) return null;
  return value;
}

export class HouseMeterService {
  private api: any = null;
  private resolvedId: string | null = null;
  private resolvedFor: unknown = undefined;
  /** When the device list was last searched without finding a meter (ms), to space out retries. */
  private lastMissMs: number | null = null;

  constructor(private readonly homey: any) {}

  private async getApi(): Promise<any> {
    if (!this.api) {
      // Needs the homey:manager:api permission.
      const { HomeyAPI } = require('homey-api');
      this.api = await HomeyAPI.createAppAPI({ homey: this.homey });
    }
    return this.api;
  }

  private async allDevices(): Promise<MeterDeviceLike[]> {
    const api = await this.getApi();
    return Object.values(await api.devices.getDevices()) as MeterDeviceLike[];
  }

  async candidates(): Promise<{ candidates: HouseMeterCandidate[]; automatic: HouseMeterCandidate | null }> {
    const devices = await this.allDevices();
    const auto = pickHouseMeter(devices, '');
    return {
      candidates: houseMeterCandidates(devices),
      automatic: auto ? { id: auto.id, name: auto.name || auto.id } : null
    };
  }

  /** House power now (W), or null without a usable meter or reading. */
  async powerW(nowMs: number = Date.now()): Promise<number | null> {
    const setting = this.homey.settings.get(HOUSE_METER_SETTING_KEY);
    if (setting === HOUSE_METER_NONE) return null;

    // The device list is only searched when the choice changes or the device went away, and
    // without a meter at most once per RESCAN_MINUTES rather than on every poll.
    if (this.resolvedId === null || this.resolvedFor !== setting) {
      const sameChoice = this.resolvedFor === setting;
      if (sameChoice && this.lastMissMs !== null
        && nowMs - this.lastMissMs < POWER_CALIBRATION_CONSTANTS.RESCAN_MINUTES * 60_000) {
        return null;
      }
      const meter = pickHouseMeter(await this.allDevices(), setting);
      this.resolvedFor = setting;
      this.resolvedId = meter ? meter.id : null;
      this.lastMissMs = meter ? null : nowMs;
      if (!meter) return null;
      return readPowerW(meter, nowMs);
    }
    try {
      const api = await this.getApi();
      const device = await api.devices.getDevice({ id: this.resolvedId });
      return readPowerW(device as MeterDeviceLike, nowMs);
    } catch (error) {
      this.resolvedId = null;
      throw error;
    }
  }
}
