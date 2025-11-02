import { Vendor } from '../../providers/types';

export interface MelcloudSettings {
  username: string;
  password: string;
  deviceId?: string;
  buildingId?: string;
}

export interface MyUplinkSettings {
  accessToken: string;
  deviceId?: string;
}

export interface AppSettings {
  vendor: Vendor;
  melcloud: MelcloudSettings;
  myUplink: MyUplinkSettings;
}

let cachedSettings: AppSettings | null = null;

export function getSettings(): AppSettings {
  if (cachedSettings) {
    return cachedSettings;
  }

  const normalized = normalizeSettings(readFromHomey());
  cachedSettings = normalized;
  return normalized;
}

export function setSettings(settings: AppSettings): void {
  cachedSettings = settings;
}

function readFromHomey(): Partial<AppSettings> {
  const homeySettings = (global as any)?.homeySettings;
  if (!homeySettings || typeof homeySettings.get !== 'function') {
    return {};
  }

  return {
    vendor: homeySettings.get('vendor'),
    melcloud: {
      username: homeySettings.get('melcloud_user'),
      password: homeySettings.get('melcloud_pass'),
      deviceId: homeySettings.get('device_id'),
      buildingId: homeySettings.get('building_id'),
    },
    myUplink: {
      accessToken: homeySettings.get('myuplink_access_token'),
      deviceId: homeySettings.get('myuplink_device_id'),
    },
  };
}

function normalizeSettings(raw: Partial<AppSettings>): AppSettings {
  const vendor = (raw.vendor as Vendor) ?? 'melcloud';

  const melcloud: MelcloudSettings = {
    username: raw.melcloud?.username ?? '',
    password: raw.melcloud?.password ?? '',
    deviceId: raw.melcloud?.deviceId ?? undefined,
    buildingId: raw.melcloud?.buildingId ?? undefined,
  };

  const myUplink: MyUplinkSettings = {
    accessToken: raw.myUplink?.accessToken ?? '',
    deviceId: raw.myUplink?.deviceId ?? undefined,
  };

  return {
    vendor,
    melcloud,
    myUplink,
  };
}
