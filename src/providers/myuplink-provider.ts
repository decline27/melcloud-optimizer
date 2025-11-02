import { createHttpClient, HttpClient } from '../util/http';
import { createFallbackLogger, Logger } from '../util/logger';
import {
  DeviceSnapshot,
  EnergyReport,
  EnergyReportWindow,
  HeatpumpDeviceInfo,
  IHeatpumpProvider,
  ProviderInitOptions,
  SetpointCommand,
  TankCommand,
  TankState,
  Vendor,
  ZoneState,
} from './types';

interface MyUplinkConfig {
  accessToken: string;
  deviceId?: string;
}

export class MyUplinkProvider implements IHeatpumpProvider {
  public readonly vendor: Vendor = 'myuplink';
  private http: HttpClient | null = null;
  private readonly logger: Logger;

  constructor(private readonly cfg: MyUplinkConfig) {
    this.logger = createFallbackLogger('[Provider:myuplink]');
  }

  baseUrl(): string {
    return 'https://api.myuplink.com';
  }

  async init(opts: ProviderInitOptions): Promise<void> {
    this.http = createHttpClient({
      baseURL: this.baseUrl(),
      breakerKey: this.baseUrl(),
      headers: {
        Authorization: `Bearer ${this.cfg.accessToken}`,
      },
      logger: this.logger,
      cache: {
        ttlMs: 30_000,
        maxEntries: 50,
      },
    });

    this.logger.info(`myUplink provider initialized (timezone=${opts.timezone}, currency=${opts.priceCurrency ?? 'n/a'})`);
  }

  async login(): Promise<void> {
    // myUplink uses static bearer tokens; assume validation happens during API calls.
    // TODO(myuplink): Implement token refresh if the integration switches to OAuth flows.
    return;
  }

  async listDevices(): Promise<HeatpumpDeviceInfo[]> {
    const http = this.ensureHttp();
    // TODO(myuplink): Replace placeholder endpoint with official devices listing.
    const res = await http.get<any>('/v2/devices');
    const items = Array.isArray(res?.items) ? res.items : [];

    return items.map((device: any) => ({
      deviceId: String(device.id ?? device.deviceId ?? ''),
      name: device.name ?? 'Heat Pump',
      supportsZone2: Boolean(device.supportsZone2 ?? device.zone2 ?? false),
    }));
  }

  async getSnapshot(deviceId: string, _buildingId?: string): Promise<DeviceSnapshot> {
    const http = this.ensureHttp();
    // TODO(myuplink): Stitch together device status once official endpoints are mapped.
    const res = await http.get<any>(`/v2/devices/${deviceId}/status`);

    return {
      device: {
        deviceId,
        name: res?.name ?? 'Heat Pump',
        supportsZone2: Boolean(res?.supportsZone2 ?? res?.zone2),
      },
      outdoorTempC: numberOrNull(res?.outdoorTemp ?? res?.outdoorTemperature),
      zones: mapZones(res),
      tank: mapTank(res),
      lastCommunication: res?.lastUpdate ?? res?.updatedAt ?? null,
    };
  }

  async getEnergyReport(deviceId: string, window: EnergyReportWindow): Promise<EnergyReport> {
    const http = this.ensureHttp();
    // TODO(myuplink): Align with official energy reporting endpoint/fields.
    const res = await http.get<any>(`/v2/devices/${deviceId}/energy`, {
      params: {
        from: window.fromISO,
        to: window.toISO,
      },
    });

    return {
      heatingKWh: numberOrZero(res?.heatingKWh),
      hotWaterKWh: numberOrZero(res?.hotWaterKWh),
      coolingKWh: numberOrZero(res?.coolingKWh),
      producedHeatingKWh: numberOrNull(res?.producedHeatingKWh),
      producedHotWaterKWh: numberOrNull(res?.producedHotWaterKWh),
      producedCoolingKWh: numberOrNull(res?.producedCoolingKWh),
      averageHeatingCOP: numberOrNull(res?.avgHeatingCOP ?? res?.averageHeatingCOP),
      averageHotWaterCOP: numberOrNull(res?.avgHotWaterCOP ?? res?.averageHotWaterCOP),
      sampleDays: typeof res?.sampleDays === 'number' ? res.sampleDays : undefined,
    };
  }

  async setZoneTarget(deviceId: string, cmd: SetpointCommand, _buildingId?: string): Promise<void> {
    const http = this.ensureHttp();
    // TODO(myuplink): Confirm method/body for zone setpoint adjustments.
    await http.post(`/v2/devices/${deviceId}/zones/${cmd.zone}/setpoint`, {
      body: {
        target: cmd.targetTempC,
      },
    });
  }

  async setTankTarget(deviceId: string, cmd: TankCommand, _buildingId?: string): Promise<void> {
    const http = this.ensureHttp();
    // TODO(myuplink): Confirm tank target/boost endpoint and payload.
    await http.post(`/v2/devices/${deviceId}/tank/setpoint`, {
      body: {
        target: cmd.targetTempC,
        force: Boolean(cmd.forceHotWater),
      },
    });
  }

  async supportsZone2(deviceId: string, _buildingId?: string): Promise<boolean> {
    const snapshot = await this.getSnapshot(deviceId);
    return snapshot.device.supportsZone2;
  }

  private ensureHttp(): HttpClient {
    if (!this.http) {
      throw new Error('myUplink provider not initialized. Call init() before making requests.');
    }
    return this.http;
  }
}

function mapZones(data: any): ZoneState[] {
  const zones: ZoneState[] = [];

  if (data?.zone1) {
    zones.push({
      zone: 1,
      roomTempC: numberOrNull(data.zone1.roomTemp ?? data.zone1.roomTemperature),
      targetTempC: numberOrNull(data.zone1.target ?? data.zone1.targetTemperature),
      opMode: normalizeMode(data.zone1.mode),
      idle: booleanOrNull(data.zone1.idle),
    });
  } else {
    zones.push({
      zone: 1,
      roomTempC: numberOrNull(data?.roomTemp ?? data?.indoorTemperature),
      targetTempC: numberOrNull(data?.target ?? data?.targetTemperature),
      opMode: normalizeMode(data?.mode),
      idle: booleanOrNull(data?.idle),
    });
  }

  if (data?.zone2) {
    zones.push({
      zone: 2,
      roomTempC: numberOrNull(data.zone2.roomTemp ?? data.zone2.roomTemperature),
      targetTempC: numberOrNull(data.zone2.target ?? data.zone2.targetTemperature),
      opMode: normalizeMode(data.zone2.mode),
      idle: booleanOrNull(data.zone2.idle),
    });
  }

  return zones;
}

function mapTank(data: any): TankState | undefined {
  if (!data?.tank) {
    return undefined;
  }

  return {
    currentTempC: numberOrNull(data.tank.temp ?? data.tank.temperature),
    targetTempC: numberOrNull(data.tank.target ?? data.tank.targetTemperature),
    ecoMode: booleanOrNull(data.tank.eco ?? data.tank.ecoMode),
  };
}

function normalizeMode(mode: any): 'heat' | 'cool' | 'auto' | 'off' {
  if (typeof mode === 'string') {
    const normalized = mode.toLowerCase();
    if (['heat', 'heating'].includes(normalized)) return 'heat';
    if (['cool', 'cooling'].includes(normalized)) return 'cool';
    if (['auto', 'automatic'].includes(normalized)) return 'auto';
    if (['off', 'standby'].includes(normalized)) return 'off';
  }

  if (typeof mode === 'number') {
    switch (mode) {
      case 0:
        return 'off';
      case 1:
        return 'heat';
      case 2:
        return 'cool';
      case 3:
        return 'auto';
      default:
        return 'heat';
    }
  }

  return 'heat';
}

function numberOrNull(value: any): number | null {
  if (value === null || value === undefined) return null;
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function numberOrZero(value: any): number {
  const numeric = numberOrNull(value);
  return numeric ?? 0;
}

function booleanOrNull(value: any): boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 0) return false;
    if (value === 1) return true;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', 'on', 'yes', '1'].includes(normalized)) return true;
    if (['false', 'off', 'no', '0'].includes(normalized)) return false;
  }
  return null;
}
