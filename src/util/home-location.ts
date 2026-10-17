/**
 * Where the home is, for weather and currency detection.
 *
 * Coordinates typed in the settings win; otherwise the location set in Homey itself is used
 * (homey:manager:geolocation), so a new user does not have to enter anything.
 */
export interface HomeLocation {
  latitude: number;
  longitude: number;
  source: 'settings' | 'homey';
}

type HomeyWithLocation = {
  settings?: { get(key: string): any };
  geolocation?: { getLatitude?(): number; getLongitude?(): number };
} | null | undefined;

function validPair(lat: unknown, lon: unknown): { latitude: number; longitude: number } | null {
  if (lat === null || lat === undefined || lat === '' || lon === null || lon === undefined || lon === '') return null;
  const latitude = Number(lat);
  const longitude = Number(lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  // 0,0 is what an unset location reads as, not a home.
  if (latitude === 0 && longitude === 0) return null;
  return { latitude, longitude };
}

export function getHomeLocation(homey: HomeyWithLocation): HomeLocation | null {
  try {
    const fromSettings = validPair(homey?.settings?.get('latitude'), homey?.settings?.get('longitude'));
    if (fromSettings) return { ...fromSettings, source: 'settings' };
  } catch (_) {
    // fall through to Homey's location
  }
  try {
    const fromHomey = validPair(homey?.geolocation?.getLatitude?.(), homey?.geolocation?.getLongitude?.());
    if (fromHomey) return { ...fromHomey, source: 'homey' };
  } catch (_) {
    // geolocation unavailable (no permission, or not set in Homey)
  }
  return null;
}
