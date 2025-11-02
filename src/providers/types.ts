export type Vendor = 'melcloud' | 'myuplink';

export interface HeatpumpDeviceInfo {
  deviceId: string;
  name: string;
  buildingId?: string;
  supportsZone2: boolean;
}

export interface TankState {
  currentTempC: number | null;
  targetTempC: number | null;
  ecoMode?: boolean | null;
}

export interface ZoneState {
  zone: 1 | 2;
  roomTempC: number | null;
  targetTempC: number | null;
  opMode: 'heat' | 'cool' | 'auto' | 'off';
  idle: boolean | null;
}

export interface DeviceSnapshot {
  device: HeatpumpDeviceInfo;
  outdoorTempC: number | null;
  zones: ZoneState[];
  tank?: TankState;
  lastCommunication?: string | null;
}

export interface EnergyReportWindow {
  fromISO: string;
  toISO: string;
}

export interface EnergyReport {
  heatingKWh: number;
  hotWaterKWh: number;
  coolingKWh: number;
  producedHeatingKWh?: number | null;
  producedHotWaterKWh?: number | null;
  producedCoolingKWh?: number | null;
  averageHeatingCOP?: number | null;
  averageHotWaterCOP?: number | null;
  sampleDays?: number;
}

export interface SetpointCommand {
  zone: 1 | 2;
  targetTempC: number;
}

export interface TankCommand {
  targetTempC: number;
  forceHotWater?: boolean;
}

export interface ProviderInitOptions {
  timezone: string;
  dst: boolean;
  priceCurrency?: string;
}

export interface IHeatpumpProvider {
  readonly vendor: Vendor;
  login(): Promise<void>;
  listDevices(): Promise<HeatpumpDeviceInfo[]>;
  getSnapshot(deviceId: string, buildingId?: string): Promise<DeviceSnapshot>;
  getEnergyReport(deviceId: string, window: EnergyReportWindow): Promise<EnergyReport>;
  setZoneTarget(deviceId: string, cmd: SetpointCommand, buildingId?: string): Promise<void>;
  setTankTarget(deviceId: string, cmd: TankCommand, buildingId?: string): Promise<void>;
  init(opts: ProviderInitOptions): Promise<void>;
  supportsZone2(deviceId: string, buildingId?: string): Promise<boolean>;
  baseUrl(): string;
}
