import { DateTime } from 'luxon';
import { MelCloudApi } from '../services/melcloud-api';
import {
  DeviceSnapshot,
  EnergyReport,
  EnergyReportWindow,
  HeatpumpDeviceInfo,
  IHeatpumpProvider,
  ProviderInitOptions,
  SetpointCommand,
  TankCommand,
  Vendor,
  ZoneState,
  TankState,
} from './types';
import { createFallbackLogger, Logger } from '../util/logger';
import { DeviceInfo, MelCloudDevice } from '../types';

type MelcloudProviderConfig = {
  username?: string;
  password?: string;
  deviceId?: string;
  buildingId?: string | number;
  api?: MelCloudApi;
  logger?: Logger;
};

const MELCLOUD_BASE_URL = 'https://app.melcloud.com/Mitsubishi.Wifi.Client';

export class MELCloudProvider implements IHeatpumpProvider {
  public readonly vendor: Vendor = 'melcloud';

  private readonly api: MelCloudApi;
  private readonly logger: Logger;
  private readonly config: MelcloudProviderConfig;

  constructor(config: MelcloudProviderConfig = {}) {
    this.config = config;
    this.logger =
      config.logger ??
      ((config.api as any)?.logger as Logger | undefined) ??
      createFallbackLogger('[Provider:melcloud]');
    this.api = config.api ?? new MelCloudApi(this.logger);
  }

  baseUrl(): string {
    return MELCLOUD_BASE_URL;
  }

  async init(opts: ProviderInitOptions): Promise<void> {
    const timezone = opts.timezone;
    let offsetHours = 0;

    if (timezone) {
      try {
        const dt = DateTime.now().setZone(timezone);
        if (dt.isValid) {
          offsetHours = dt.offset / 60;
        }
      } catch {
        this.logger.warn('Failed to resolve timezone for MELCloud provider', { timezone });
      }
    }

    this.api.updateTimeZoneSettings(offsetHours, opts.dst, timezone);
    this.logger.info(`Provider initialized with timezone=${timezone ?? 'n/a'} offset=${offsetHours}`);
  }

  async login(): Promise<void> {
    const username =
      this.config.username ??
      (global as any)?.homeySettings?.get?.('melcloud_user');
    const password =
      this.config.password ??
      (global as any)?.homeySettings?.get?.('melcloud_pass');

    if (!username || !password) {
      throw new Error('Missing MELCloud credentials');
    }

    const success = await this.api.login(username, password);
    if (!success) {
      throw new Error('MELCloud login failed');
    }
  }

  async listDevices(): Promise<HeatpumpDeviceInfo[]> {
    const devices = await this.api.getDevices();
    return devices.map(device => this.mapDevice(device));
  }

  async getSnapshot(deviceId: string, buildingId?: string): Promise<DeviceSnapshot> {
    const numericBuildingId = this.ensureBuildingId(buildingId);
    const deviceState = await this.api.getDeviceState(deviceId, numericBuildingId);
    const deviceInfo = await this.getDeviceInfo(deviceId, numericBuildingId);
    const lastCommunicationRaw =
      (deviceState as any).LastCommunication ??
      (deviceState as any).LastCommunicationTime ??
      null;

    const snapshot: DeviceSnapshot = {
      device: deviceInfo,
      outdoorTempC: toNumber(deviceState.OutdoorTemperature),
      zones: this.mapZones(deviceState),
      tank: this.mapTank(deviceState),
      lastCommunication: formatTimestamp(lastCommunicationRaw),
    };

    return snapshot;
  }

  async getEnergyReport(deviceId: string, window: EnergyReportWindow): Promise<EnergyReport> {
    const buildingId = this.requireBuildingId(deviceId);
    const totals = await this.api.getEnergyData(deviceId, buildingId, window.fromISO, window.toISO);

    // Some API responses return array per day.
    const normalized = Array.isArray(totals) ? aggregateEnergyArray(totals) : totals || {};

    const heatingConsumed = numberOrZero(normalized.TotalHeatingConsumed);
    const heatingProduced = numberOrZero(normalized.TotalHeatingProduced);
    const hotWaterConsumed = numberOrZero(normalized.TotalHotWaterConsumed);
    const hotWaterProduced = numberOrZero(normalized.TotalHotWaterProduced);
    const coolingConsumed = numberOrZero(normalized.TotalCoolingConsumed);
    const coolingProduced = numberOrZero(normalized.TotalCoolingProduced);

    return {
      heatingKWh: numberOrZero(normalized.TotalHeatingConsumed),
      hotWaterKWh: numberOrZero(normalized.TotalHotWaterConsumed),
      coolingKWh: numberOrZero(normalized.TotalCoolingConsumed),
      producedHeatingKWh: toNumber(normalized.TotalHeatingProduced),
      producedHotWaterKWh: toNumber(normalized.TotalHotWaterProduced),
      producedCoolingKWh: toNumber(normalized.TotalCoolingProduced),
      averageHeatingCOP:
        computeRatio(heatingProduced, heatingConsumed) ??
        toNumber(normalized.heatingCOP) ??
        toNumber(normalized.AverageHeatingCOP) ??
        toNumber(normalized.AverageCOP),
      averageHotWaterCOP:
        computeRatio(hotWaterProduced, hotWaterConsumed) ??
        toNumber(normalized.hotWaterCOP) ??
        toNumber(normalized.AverageHotWaterCOP) ??
        toNumber(normalized.AverageCOP),
      sampleDays: normalized.SampledDays ?? undefined,
    };
  }

  async setZoneTarget(deviceId: string, cmd: SetpointCommand, buildingId?: string): Promise<void> {
    const numericBuildingId = this.ensureBuildingId(buildingId);
    await this.api.setZoneTemperature(deviceId, numericBuildingId, cmd.targetTempC, cmd.zone);
  }

  async setTankTarget(deviceId: string, cmd: TankCommand, buildingId?: string): Promise<void> {
    const numericBuildingId = this.ensureBuildingId(buildingId);
    await this.api.setTankTemperature(deviceId, numericBuildingId, cmd.targetTempC);

    if (cmd.forceHotWater) {
      try {
        await this.api.startLegionellaCycle(deviceId, numericBuildingId);
      } catch (error) {
        this.logger.warn('Failed to trigger legionella cycle after tank command', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  async supportsZone2(deviceId: string, buildingId?: string): Promise<boolean> {
    const numericBuildingId = this.ensureBuildingId(buildingId);
    const state = await this.api.getDeviceState(deviceId, numericBuildingId);
    return hasZone2(state);
  }

  private async getDeviceInfo(deviceId: string, buildingId: number): Promise<HeatpumpDeviceInfo> {
    const devices = await this.api.getDevices();
    const match = devices.find(d => String(d.id) === String(deviceId) || String((d as any)?.DeviceID) === String(deviceId));

    if (match) {
      return this.mapDevice(match);
    }

    const state = await this.api.getDeviceState(deviceId, buildingId);
    return {
      deviceId: String(deviceId),
      name: (state as any).DeviceName ?? 'Heat Pump',
      buildingId: String(buildingId),
      supportsZone2: hasZone2(state),
    };
  }

  private mapDevice(device: DeviceInfo): HeatpumpDeviceInfo {
    const deviceId = device?.id ?? (device as any)?.DeviceID;
    const buildingId = device?.buildingId ?? (device as any)?.BuildingID;
    const data = device?.data ?? {};

    return {
      deviceId: String(deviceId),
      name: device?.name ?? data?.DeviceName ?? 'Heat Pump',
      buildingId: buildingId !== undefined ? String(buildingId) : undefined,
      supportsZone2: inferZone2Support(device, data),
    };
  }

  private mapZones(state: MelCloudDevice): ZoneState[] {
    const zones: ZoneState[] = [];

    zones.push({
      zone: 1,
      roomTempC: toNumber(state.RoomTemperatureZone1 ?? state.RoomTemperature),
      targetTempC: toNumber(state.SetTemperatureZone1 ?? state.SetTemperature),
      opMode: mapOperationMode((state as any).OperationModeZone1 ?? (state as any).OperationMode),
      idle: toBoolean((state as any).IdleZone1),
    });

    if (hasZone2(state)) {
      zones.push({
        zone: 2,
        roomTempC: toNumber((state as any).RoomTemperatureZone2),
        targetTempC: toNumber((state as any).SetTemperatureZone2),
        opMode: mapOperationMode((state as any).OperationModeZone2),
        idle: toBoolean((state as any).IdleZone2),
      });
    }

    return zones;
  }

  private mapTank(state: MelCloudDevice): TankState | undefined {
    const currentTemp =
      (state as any).TankWaterTemperature ??
      (state as any).HotWaterTemperature ??
      (state as any).FlowTemperature;

    const targetTemp = (state as any).SetTankWaterTemperature ?? (state as any).HotWaterTargetTemperature;

    if (currentTemp === undefined && targetTemp === undefined) {
      return undefined;
    }

    return {
      currentTempC: toNumber(currentTemp),
      targetTempC: toNumber(targetTemp),
      ecoMode: toBoolean((state as any).EcoHotWater),
    };
  }

  private ensureBuildingId(buildingId?: string): number {
    if (buildingId) {
      const numeric = parseInt(buildingId, 10);
      if (!Number.isNaN(numeric)) {
        return numeric;
      }
    }

    if (this.config.buildingId !== undefined) {
      const numeric = parseInt(String(this.config.buildingId), 10);
      if (!Number.isNaN(numeric)) {
        return numeric;
      }
    }

    return this.requireBuildingId();
  }

  private requireBuildingId(deviceId?: string): number {
    const configured =
      this.config.buildingId ??
      (global as any)?.homeySettings?.get?.('building_id') ??
      (global as any)?.homeySettings?.get?.('melcloud_building_id');

    const numeric = configured !== undefined ? parseInt(String(configured), 10) : NaN;
    if (!Number.isNaN(numeric)) {
      return numeric;
    }

    if (deviceId) {
      throw new Error(`MELCloud buildingId required for device ${deviceId}`);
    }
    throw new Error('MELCloud buildingId required');
  }
}

function inferZone2Support(device: DeviceInfo, data: any): boolean {
  if (data && typeof data === 'object') {
    if (data.HasZone2 !== undefined) return Boolean(data.HasZone2);
    if (data.SetTemperatureZone2 !== undefined) return true;
  }

  if (device && typeof device === 'object') {
    if ((device as any).hasZone2 !== undefined) return Boolean((device as any).hasZone2);
  }

  return false;
}

function hasZone2(state: MelCloudDevice | any): boolean {
  if (!state || typeof state !== 'object') return false;
  if ('HasZone2' in state) return Boolean(state.HasZone2);
  if ('SetTemperatureZone2' in state) return state.SetTemperatureZone2 !== undefined;
  if ('RoomTemperatureZone2' in state) return state.RoomTemperatureZone2 !== undefined;
  return false;
}

function mapOperationMode(mode: any): 'heat' | 'cool' | 'auto' | 'off' {
  if (mode === null || mode === undefined) return 'heat';
  switch (Number(mode)) {
    case 0:
      return 'heat';
    case 1:
      return 'cool';
    case 2:
      return 'auto';
    case 3:
      return 'off';
    default:
      return 'heat';
  }
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const num = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(num) ? num : null;
}

function toBoolean(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 0) return false;
    if (value === 1) return true;
  }
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(lower)) return true;
    if (['false', '0', 'no', 'off'].includes(lower)) return false;
  }
  return null;
}

function numberOrZero(value: unknown): number {
  const num = toNumber(value);
  return num ?? 0;
}

function aggregateEnergyArray(entries: any[]): Record<string, any> {
  return entries.reduce(
    (acc, entry) => ({
      TotalHeatingConsumed: numberOrZero(entry.TotalHeatingConsumed) + acc.TotalHeatingConsumed,
      TotalHeatingProduced: numberOrZero(entry.TotalHeatingProduced) + acc.TotalHeatingProduced,
      TotalHotWaterConsumed: numberOrZero(entry.TotalHotWaterConsumed) + acc.TotalHotWaterConsumed,
      TotalHotWaterProduced: numberOrZero(entry.TotalHotWaterProduced) + acc.TotalHotWaterProduced,
      TotalCoolingConsumed: numberOrZero(entry.TotalCoolingConsumed) + acc.TotalCoolingConsumed,
      TotalCoolingProduced: numberOrZero(entry.TotalCoolingProduced) + acc.TotalCoolingProduced,
      SampledDays: (acc.SampledDays ?? 0) + 1,
    }),
    {
      TotalHeatingConsumed: 0,
      TotalHeatingProduced: 0,
      TotalHotWaterConsumed: 0,
      TotalHotWaterProduced: 0,
      TotalCoolingConsumed: 0,
      TotalCoolingProduced: 0,
      SampledDays: 0,
    }
  );
}

function computeRatio(produced: number, consumed: number): number | null {
  if (!Number.isFinite(produced) || !Number.isFinite(consumed) || consumed <= 0) {
    return null;
  }
  return produced / consumed;
}

function formatTimestamp(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && value.trim().length > 0) return value;
  return null;
}
