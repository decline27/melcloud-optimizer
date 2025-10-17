import fetch from 'node-fetch';
import { XMLParser } from 'fast-xml-parser';
import moment from 'moment-timezone';
import type { App } from 'homey';
import Homey from 'homey';
import defaultAreaMap from '../entsoe_area_map.json';

type HomeyLike = App['homey'];

function logHomey(homey: HomeyLike, message: string): void {
  try {
    const logger = (homey as unknown as { app?: { log?: (...args: unknown[]) => void } })?.app;
    if (logger && typeof logger.log === 'function') {
      logger.log(message);
    }
  } catch (_error) {
    // ignore logging errors
  }
}

function readEnvToken(): string | undefined {
  if (typeof process === 'undefined' || typeof process.env !== 'object') {
    return readHomeyEnvToken();
  }
  const raw = process.env.ENTSOE_TOKEN || process.env.entsoe_token;
  if (typeof raw === 'string' && raw.trim().length > 0) {
    return raw.trim();
  }
  return readHomeyEnvToken();
}

function readHomeyEnvToken(): string | undefined {
  try {
    // Try to access Homey.env directly as per Homey documentation
    const raw = (Homey as any)?.env?.ENTSOE_TOKEN || (Homey as any)?.env?.entsoe_token;
    if (typeof raw === 'string' && raw.trim().length > 0) {
      return raw.trim();
    }
    
    // Fallback to global access if direct access doesn't work
    const homeyGlobal = (globalThis as any)?.Homey;
    if (homeyGlobal && homeyGlobal.env) {
      const fallbackRaw = homeyGlobal.env.ENTSOE_TOKEN || homeyGlobal.env.entsoe_token;
      if (typeof fallbackRaw === 'string' && fallbackRaw.trim().length > 0) {
        return fallbackRaw.trim();
      }
    }
  } catch (error) {
    // Ignore errors and continue to fallback methods
  }
  return undefined;
}

/**
 * Determine the ENTSO-E security token.
 * Priority order:
 *   1. Explicit override provided to fetchPrices (for testing)
 *   2. Environment variable ENTSOE_TOKEN (set via Homey App Store or env.json during dev)
 *   3. Homey app setting entsoe_security_token (user-provided)
 */
export function getEntsoeToken(homey: HomeyLike, override?: string): string | undefined {
  if (typeof override === 'string' && override.trim().length > 0) {
    return override.trim();
  }

  const envToken = readEnvToken();
  if (envToken) {
    return envToken;
  }

  try {
    if (homey && typeof homey.settings === 'object' && typeof homey.settings.get === 'function') {
      const stored = homey.settings.get('entsoe_security_token');
      if (typeof stored === 'string' && stored.trim().length > 0) {
        return stored.trim();
      }
    }
  } catch (_error) {
    // Ignore settings lookup errors; absence is handled by caller
  }

  return undefined;
}

export interface EntsoePricePoint {
  ts_iso_utc: string;
  price_eur_per_mwh: number;
  price_eur_per_kwh: number;
  price_sek_per_kwh?: number;
}

export interface FetchPricesOptions {
  ttlMs?: number;
  forceRefresh?: boolean;
  fxRateEurToSek?: number;
  useCurrencyConversion?: boolean;
  areaMapOverride?: AreaMap;
  securityTokenOverride?: string;
}

export type AreaMap = Record<string, string[]>;

interface CacheEntry {
  expiresAt: number;
  data: EntsoePricePoint[];
}

interface RawPoint {
  timestamp: string;
  price: number;
}

const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  textNodeName: 'value',
  parseAttributeValue: true,
  parseTagValue: true,
  trimValues: true,
  allowBooleanAttributes: true
});

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<EntsoePricePoint[]>>();

function isLikelyEic(zoneInput: string): boolean {
  const trimmed = zoneInput.trim();
  return /^10Y[A-Z0-9\-]{6,}$/.test(trimmed) || trimmed.includes(':');
}

function cloneDefaultAreaMap(): AreaMap {
  return JSON.parse(JSON.stringify(defaultAreaMap));
}

function normaliseAreaMap(map: unknown): AreaMap {
  if (!map || typeof map !== 'object') {
    return cloneDefaultAreaMap();
  }

  const result: AreaMap = {};
  const entries = Object.entries(map as Record<string, unknown>);
  for (const [iso, value] of entries) {
    if (!Array.isArray(value)) {
      continue;
    }

    const cleaned = value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter((item) => item.length > 0);

    if (cleaned.length > 0) {
      result[iso.trim().toUpperCase()] = cleaned;
    }
  }

  if (Object.keys(result).length === 0) {
    return cloneDefaultAreaMap();
  }

  return result;
}

function loadAreaMap(homey: HomeyLike, override?: AreaMap): AreaMap {
  if (override && Object.keys(override).length > 0) {
    return normaliseAreaMap(override);
  }

  const stored = homey.settings.get('entsoe_area_map');
  if (stored) {
    try {
      if (typeof stored === 'string') {
        return normaliseAreaMap(JSON.parse(stored));
      }
      return normaliseAreaMap(stored);
    } catch (error) {
      console.warn('Failed to parse entsoe_area_map from settings, falling back to default map', error);
    }
  }

  return cloneDefaultAreaMap();
}

/**
 * Resolve a user supplied zone to an ENTSO-E EIC code. Accepts both ISO2 country codes and direct EIC codes.
 * entsoe_area_map may provide multiple EIC codes per ISO; we pick the first entry as default.
 */
export function resolveZoneToEic(homey: HomeyLike, zoneInput?: string, options?: { areaMapOverride?: AreaMap }): string {
  const candidate = (zoneInput || homey.settings.get('entsoe_area_eic') || 'SE3').toString().trim();
  if (!candidate) {
    throw new Error('No ENTSO-E price area specified. Provide an ISO country code or an EIC code.');
  }

  if (isLikelyEic(candidate)) {
    return candidate.toUpperCase();
  }

  const iso = candidate.toUpperCase();
  const map = loadAreaMap(homey, options?.areaMapOverride);
  const eics = map[iso];
  if (!eics || eics.length === 0) {
    throw new Error(`No ENTSO-E EIC mapping found for ISO code ${iso}. Update your entsoe_area_map setting.`);
  }

  return eics[0];
}

function toEntsoeTimestamp(input: string | Date): string {
  const m = moment.utc(input);
  if (!m.isValid()) {
    throw new Error(`Invalid timestamp provided: ${input}`);
  }
  return m.format('YYYYMMDDHHmm');
}

function createCacheKey(eic: string, startIso: string, endIso: string): string {
  return `${eic}|${startIso}|${endIso}`;
}

function parseResolutionToMinutes(resolution: string | undefined): number {
  if (!resolution || typeof resolution !== 'string' || !resolution.startsWith('PT')) {
    return 60;
  }

  const match = resolution.match(/^PT(?:(\d+)H)?(?:(\d+)M)?$/);
  if (!match) {
    return 60;
  }

  const [, hours, minutes] = match;
  const totalMinutes = (hours ? Number(hours) * 60 : 0) + (minutes ? Number(minutes) : 0);
  return totalMinutes > 0 ? totalMinutes : 60;
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function buildEntsoeReasonMessage(reasonSource: any): string {
  const reasons = toArray(reasonSource);
  const messages = reasons
    .map((reason: any) => [reason?.code, reason?.text, reason?.value]
      .filter((part) => typeof part === 'string' && part.trim().length > 0)
      .join(' - '))
    .filter((msg: string) => msg.length > 0);
  return messages.join('; ');
}

function parseEntsoeXml(xml: string): RawPoint[] {
  const doc = parser.parse(xml);
  const acknowledgementDocument = doc?.Acknowledgement_MarketDocument;
  if (acknowledgementDocument) {
    const message = buildEntsoeReasonMessage(acknowledgementDocument.Reason || acknowledgementDocument.reason);
    const suffix = message || 'Unknown acknowledgement reason';
    throw new Error(`ENTSO-E returned an error: ${suffix}`);
  }

  const marketDocument = doc?.Publication_MarketDocument || doc?.GL_MarketDocument;

  if (!marketDocument) {
    const errorText = typeof doc === 'string' ? doc : JSON.stringify(doc);
    throw new Error(`Unexpected ENTSO-E response. Body: ${errorText}`);
  }

  if (marketDocument?.Reason || marketDocument?.reason) {
    const message = buildEntsoeReasonMessage(marketDocument.Reason || marketDocument.reason);
    throw new Error(`ENTSO-E returned an error: ${message || 'Unknown reason'}`);
  }

  const seriesList = toArray(marketDocument.TimeSeries);
  if (seriesList.length === 0) {
    throw new Error('ENTSO-E response did not include any TimeSeries data.');
  }

  const points: RawPoint[] = [];

  for (const series of seriesList) {
    const periods = toArray(series?.Period || series?.period);
    for (const period of periods) {
      const timeInterval = period?.timeInterval || series?.timeInterval;
      const start = timeInterval?.start || timeInterval?.Start;
      if (!start) {
        continue;
      }
      const resolution = period?.resolution || series?.resolution;
      const resolutionMinutes = parseResolutionToMinutes(resolution);
      const periodPoints = toArray(period?.Point || period?.point);
      for (const point of periodPoints) {
        const position = Number(point?.position ?? point?.Position);
        const priceRaw = point?.['price.amount'] ?? point?.priceAmount ?? point?.price?.amount ?? point?.price?.value ?? point?.price;
        const price = typeof priceRaw === 'number' ? priceRaw : Number(priceRaw);
        if (!Number.isFinite(position) || position < 1) {
          continue;
        }
        const timestamp = moment.utc(start).add((position - 1) * resolutionMinutes, 'minutes');
        if (!timestamp.isValid()) {
          continue;
        }
        points.push({
          timestamp: timestamp.toISOString(),
          price: Number.isFinite(price) ? price : NaN,
        });
      }
    }
  }

  if (points.length === 0) {
    throw new Error('ENTSO-E response parsing produced zero data points.');
  }

  points.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return points;
}

function enrichPrices(rawPoints: RawPoint[], fxRate: number | null, useCurrencyConversion: boolean): EntsoePricePoint[] {
  return rawPoints.map((point) => {
    const priceEurPerMwh = point.price;
    const priceEurPerKwh = Number.isFinite(priceEurPerMwh) ? priceEurPerMwh / 1000 : NaN;
    const includeSek = useCurrencyConversion && fxRate != null && Number.isFinite(fxRate) && fxRate > 0;
    return {
      ts_iso_utc: point.timestamp,
      price_eur_per_mwh: priceEurPerMwh,
      price_eur_per_kwh: priceEurPerKwh,
      price_sek_per_kwh: includeSek && Number.isFinite(priceEurPerKwh)
        ? +(priceEurPerKwh * fxRate).toFixed(6)
        : undefined,
    };
  });
}

async function executeRequest(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'com.melcloud.optimize (Homey)',
      Accept: 'application/xml;q=1, text/xml;q=0.8, */*;q=0.5'
    },
  });

  const bodyText = await response.text();

  if (!response.ok) {
    throw new Error(`ENTSO-E request failed (${response.status} ${response.statusText}). Body: ${bodyText}`);
  }

  if (!bodyText || bodyText.trim().length === 0) {
    throw new Error('ENTSO-E returned an empty body.');
  }

  return bodyText;
}

function getFxRate(homey: HomeyLike, override?: number): number | null {
  if (typeof override === 'number' && Number.isFinite(override)) {
    return override;
  }
  const generic = homey.settings.get('fx_rate_eur_to_currency');
  const values = [generic, homey.settings.get('fx_rate_eur_to_sek')];
  for (const raw of values) {
    if (raw == null) continue;
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

function shouldUseCurrencyConversion(homey: HomeyLike, override?: boolean): boolean {
  if (typeof override === 'boolean') {
    return override;
  }
  return getFxRate(homey, undefined) != null;
}

function extractEntsoeErrorMessage(error: unknown): string {
  if (!error) {
    return '';
  }
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (typeof error === 'object') {
    try {
      return JSON.stringify(error);
    } catch (_jsonError) {
      return String(error);
    }
  }
  return String(error);
}

function isInvalidIntervalError(error: unknown): boolean {
  const message = extractEntsoeErrorMessage(error);
  if (!message) {
    return false;
  }
  return /Delivered interval is not valid/i.test(message)
    || /ENTSO-E request failed .*Delivered interval is not valid/i.test(message);
}

function isNoDataError(error: unknown): boolean {
  const message = extractEntsoeErrorMessage(error);
  if (!error) {
    return false;
  }
  return /No matching data found/i.test(message);
}

async function retrieveEntsoeData(
  homey: HomeyLike,
  eic: string,
  securityToken: string,
  startIso: string,
  endIso: string,
  options?: FetchPricesOptions
): Promise<EntsoePricePoint[]> {
  const url = new URL('https://web-api.tp.entsoe.eu/api');
  url.searchParams.set('securityToken', securityToken);
  url.searchParams.set('documentType', 'A44');
  url.searchParams.set('contract_MarketAgreement.Type', 'A01');
  url.searchParams.set('processType', 'A01');
  url.searchParams.set('in_Domain', eic);
  url.searchParams.set('out_Domain', eic);
  url.searchParams.set('periodStart', toEntsoeTimestamp(startIso));
  url.searchParams.set('periodEnd', toEntsoeTimestamp(endIso));

  const safeParams = new URLSearchParams(url.searchParams.toString());
  if (safeParams.has('securityToken')) {
    safeParams.set('securityToken', '***');
  }
  logHomey(homey, `[ENTSO-E] Requesting prices for ${eic} from ${startIso} to ${endIso} (${safeParams.toString()})`);

  const xml = await executeRequest(url.toString());
  const rawPoints = parseEntsoeXml(xml);
  const fxRate = getFxRate(homey, options?.fxRateEurToSek);
  const useConversion = shouldUseCurrencyConversion(homey, options?.useCurrencyConversion);
  return enrichPrices(rawPoints, fxRate, useConversion);
}

async function fallbackWithDailyChunks(
  homey: HomeyLike,
  eic: string,
  securityToken: string,
  startIso: string,
  endIso: string,
  options?: FetchPricesOptions
): Promise<EntsoePricePoint[] | null> {
  const start = moment.utc(startIso);
  const end = moment.utc(endIso);
  if (!start.isValid() || !end.isValid() || !start.isBefore(end)) {
    return null;
  }

  const nowUtc = moment.utc();
  const chunkHours = 24;
  const collected: EntsoePricePoint[] = [];

  let cursor = start.clone();
  while (cursor.isBefore(end)) {
    const next = moment.min(cursor.clone().add(chunkHours, 'hours'), end);
    if (!next.isAfter(cursor)) {
      break;
    }

    try {
      const chunk = await retrieveEntsoeData(homey, eic, securityToken, cursor.toISOString(), next.toISOString(), options);
      collected.push(...chunk);
    } catch (error) {
      if ((isInvalidIntervalError(error) || isNoDataError(error)) && cursor.isSameOrAfter(nowUtc, 'day')) {
        logHomey(homey, `[ENTSO-E] No data yet for ${eic} chunk ${cursor.toISOString()} -> ${next.toISOString()} (${extractEntsoeErrorMessage(error)})`);
        // Future data not yet available – stop chunking and keep what we have so far.
        break;
      }
      throw error;
    }

    cursor = next;
  }

  if (collected.length === 0) {
    return null;
  }

  const deduped = new Map<string, EntsoePricePoint>();
  for (const point of collected) {
    deduped.set(point.ts_iso_utc, point);
  }

  return Array.from(deduped.values()).sort((a, b) => a.ts_iso_utc.localeCompare(b.ts_iso_utc));
}

function normaliseIso(input: string | Date): string {
  const m = moment.utc(input);
  if (!m.isValid()) {
    throw new Error(`Invalid date value: ${input}`);
  }
  return m.toISOString();
}

function getTtl(options: FetchPricesOptions | undefined): number {
  const candidate = options?.ttlMs;
  if (typeof candidate === 'number' && candidate > 0) {
    return candidate;
  }
  return DEFAULT_TTL_MS;
}

export async function fetchPrices(
  homey: HomeyLike,
  zoneInput: string | undefined,
  startUtc: string | Date,
  endUtc: string | Date,
  options?: FetchPricesOptions
): Promise<EntsoePricePoint[]> {
  const securityToken = getEntsoeToken(homey, options?.securityTokenOverride);
  if (!securityToken) {
    throw new Error(
      'ENTSO-E token not found. Set ENTSOE_TOKEN as an environment variable (preferred) or configure entsoe_security_token in the app settings.'
    );
  }
  const eic = resolveZoneToEic(homey, zoneInput, { areaMapOverride: options?.areaMapOverride });
  const startIso = normaliseIso(startUtc);
  const endIso = normaliseIso(endUtc);
  const cacheKey = createCacheKey(eic, startIso, endIso);
  const ttl = getTtl(options);
  const now = Date.now();

  if (!options?.forceRefresh) {
    const cachedEntry = cache.get(cacheKey);
    if (cachedEntry && cachedEntry.expiresAt > now) {
      return cachedEntry.data;
    }
  }

  if (inFlight.has(cacheKey)) {
    return inFlight.get(cacheKey)!;
  }

  const requestPromise = (async () => {
    try {
      const enriched = await retrieveEntsoeData(homey, eic, securityToken, startIso, endIso, options);
      cache.set(cacheKey, {
        data: enriched,
        expiresAt: now + ttl,
      });
      return enriched;
    } catch (error) {
      if (isInvalidIntervalError(error) || isNoDataError(error)) {
        const fallback = await fallbackWithDailyChunks(homey, eic, securityToken, startIso, endIso, options);
        if (fallback && fallback.length > 0) {
          cache.set(cacheKey, {
            data: fallback,
            expiresAt: now + ttl,
          });
          return fallback;
        }
        if (isNoDataError(error)) {
          logHomey(homey, `[ENTSO-E] No price data available for ${eic} between ${startIso} and ${endIso}. Returning empty array.`);
          return fallback ?? [];
        }
      }
      throw error;
    } finally {
      inFlight.delete(cacheKey);
    }
  })();

  inFlight.set(cacheKey, requestPromise);

  try {
    return await requestPromise;
  } catch (error) {
    cache.delete(cacheKey);
    throw error;
  }
}

export function clearEntsoeCache(): void {
  cache.clear();
  inFlight.clear();
}

export const __testables = {
  parseEntsoeXml,
  buildEntsoeReasonMessage,
};
