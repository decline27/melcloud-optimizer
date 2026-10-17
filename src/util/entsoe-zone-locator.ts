/**
 * Picks the ENTSO-E bidding zone for a home in a country with several zones, from its
 * coordinates: the zone of the nearest reference town wins. Zone borders follow grid
 * constraints, not lines on a map, so a few homes right at a border can land in the
 * neighbouring zone; the settings page lets the user pick another one.
 *
 * Countries with one zone are not listed; their area is the country code itself.
 */
type ReferencePoint = [area: string, latitude: number, longitude: number];

const ZONE_REFERENCE_POINTS: Readonly<Record<string, ReferencePoint[]>> = {
  SE: [
    ['SE1', 67.86, 20.23], ['SE1', 65.58, 22.15], ['SE1', 65.82, 21.69], ['SE1', 66.6, 19.82],
    ['SE2', 64.75, 20.95], ['SE2', 63.83, 20.26], ['SE2', 63.18, 14.64], ['SE2', 62.39, 17.31],
    ['SE2', 61.73, 17.1], ['SE2', 63.29, 18.72],
    ['SE3', 60.67, 17.14], ['SE3', 59.33, 18.07], ['SE3', 59.86, 17.64], ['SE3', 59.38, 13.5],
    ['SE3', 59.27, 15.21], ['SE3', 58.41, 15.62], ['SE3', 57.71, 11.97], ['SE3', 57.78, 14.16],
    ['SE3', 57.64, 18.29], ['SE3', 60.48, 15.44], ['SE3', 58.59, 16.18],
    ['SE4', 55.6, 13.0], ['SE4', 56.05, 12.69], ['SE4', 56.16, 15.59], ['SE4', 56.66, 16.36],
    ['SE4', 56.88, 14.81], ['SE4', 56.67, 12.86], ['SE4', 55.43, 13.82], ['SE4', 56.03, 14.16]
  ],
  NO: [
    ['NO1', 59.91, 10.75], ['NO1', 60.79, 11.07], ['NO1', 59.27, 10.41], ['NO1', 59.74, 10.2],
    ['NO1', 61.12, 10.47], ['NO1', 59.21, 9.61],
    ['NO2', 58.15, 8.0], ['NO2', 58.97, 5.73], ['NO2', 59.41, 5.27], ['NO2', 58.46, 8.77],
    ['NO2', 58.85, 5.74],
    ['NO5', 60.39, 5.32], ['NO5', 61.45, 5.85], ['NO5', 60.63, 6.42],
    ['NO3', 63.43, 10.4], ['NO3', 62.47, 6.15], ['NO3', 62.74, 7.16], ['NO3', 64.47, 11.5],
    ['NO3', 62.57, 11.38],
    ['NO4', 69.65, 18.96], ['NO4', 67.28, 14.4], ['NO4', 68.44, 17.43], ['NO4', 70.66, 23.68],
    ['NO4', 66.31, 14.14], ['NO4', 69.97, 23.27]
  ],
  // Split at the Great Belt: Jutland and Funen are DK1, Zealand, Lolland-Falster and Bornholm DK2.
  DK: [
    ['DK1', 56.16, 10.2], ['DK1', 55.4, 10.39], ['DK1', 55.47, 8.45], ['DK1', 57.05, 9.92],
    ['DK1', 55.71, 9.54], ['DK1', 56.46, 9.4], ['DK1', 55.06, 10.6],
    ['DK2', 55.68, 12.57], ['DK2', 55.64, 12.08], ['DK2', 55.33, 11.15], ['DK2', 54.77, 11.87],
    ['DK2', 55.1, 14.7], ['DK2', 55.46, 11.79], ['DK2', 56.03, 12.6]
  ],
  IT: [
    ['IT_NORD', 45.46, 9.19], ['IT_NORD', 45.07, 7.69], ['IT_NORD', 45.44, 12.33], ['IT_NORD', 44.49, 11.34],
    ['IT_NORD', 44.41, 8.93], ['IT_NORD', 46.07, 11.12], ['IT_NORD', 45.65, 13.78],
    ['IT_CNOR', 43.77, 11.25], ['IT_CNOR', 43.72, 10.4], ['IT_CNOR', 43.11, 12.39], ['IT_CNOR', 43.62, 13.52],
    ['IT_CSUD', 41.9, 12.5], ['IT_CSUD', 40.85, 14.27], ['IT_CSUD', 42.35, 13.4], ['IT_CSUD', 41.56, 14.66],
    ['IT_SUD', 41.12, 16.87], ['IT_SUD', 40.64, 15.81], ['IT_SUD', 40.35, 18.17], ['IT_SUD', 41.46, 15.55],
    ['IT_CALA', 38.11, 15.65], ['IT_CALA', 39.3, 16.25], ['IT_CALA', 38.91, 16.59],
    ['IT_SICI', 38.12, 13.36], ['IT_SICI', 37.5, 15.09], ['IT_SICI', 37.07, 15.29],
    ['IT_SARD', 39.22, 9.12], ['IT_SARD', 40.73, 8.56], ['IT_SARD', 40.92, 9.5]
  ]
};

/**
 * The bidding-zone area (e.g. 'SE4', 'NO5', 'IT_SUD') for a home, or the country code itself
 * for countries with a single zone.
 */
export function zoneAreaForLocation(country: string, latitude: number, longitude: number): string {
  const points = ZONE_REFERENCE_POINTS[country];
  if (!points || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return country;
  const cosLat = Math.cos((latitude * Math.PI) / 180);
  let best = points[0];
  let bestDistance = Infinity;
  for (const point of points) {
    const dLat = point[1] - latitude;
    const dLon = (point[2] - longitude) * cosLat;
    const distance = dLat * dLat + dLon * dLon;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = point;
    }
  }
  return best[0];
}
