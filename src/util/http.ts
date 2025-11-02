import fetch, { RequestInit, Response, FetchError } from 'node-fetch';
import { CircuitBreaker } from './circuit-breaker';
import { Logger, createFallbackLogger } from './logger';
import { TTLCache } from './cache';

type Primitive = string | number | boolean | null | undefined;

export interface HttpClientOptions {
  baseURL: string;
  headers?: Record<string, string>;
  breakerKey: string;
  logger?: Logger;
  timeoutMs?: number;
  maxRetries?: number;
  cache?: {
    ttlMs?: number;
    maxEntries?: number;
  };
}

export interface RequestOptions {
  params?: Record<string, Primitive>;
  headers?: Record<string, string>;
  body?: unknown;
  cacheTtlMs?: number;
  cacheKey?: string;
  timeoutMs?: number;
}

export interface HttpClient {
  get<T = any>(path: string, options?: RequestOptions): Promise<T>;
  post<T = any>(path: string, options?: RequestOptions): Promise<T>;
  put<T = any>(path: string, options?: RequestOptions): Promise<T>;
  patch<T = any>(path: string, options?: RequestOptions): Promise<T>;
  delete<T = any>(path: string, options?: RequestOptions): Promise<T>;
}

class RetryableError extends Error {
  constructor(
    message: string,
    public readonly retryAfterMs: number | null,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'RetryableError';
  }
}

class HttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: any
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function createHttpClient(options: HttpClientOptions): HttpClient {
  const {
    baseURL,
    headers = {},
    breakerKey,
    logger: providedLogger,
    timeoutMs = 30_000,
    maxRetries = 3,
    cache: cacheOptions
  } = options;

  const logger = providedLogger ?? createFallbackLogger(`[HTTP:${breakerKey}]`);
  const cache = cacheOptions ? new TTLCache<string, any>(cacheOptions) : null;
  const breaker = new CircuitBreaker(breakerKey, logger, {
    timeout: timeoutMs
  });

  const request = async <T>(
    method: string,
    path: string,
    requestOptions: RequestOptions = {}
  ): Promise<T> => {
    const url = buildUrl(baseURL, path, requestOptions.params);
    const cacheKey = requestOptions.cacheKey || `${method}:${url}`;
    const resolvedCacheTtl =
      requestOptions.cacheTtlMs ?? cacheOptions?.ttlMs ?? 0;

    if (method === 'GET' && cache && resolvedCacheTtl > 0) {
      const cached = cache.get(cacheKey);
      if (cached !== undefined) {
        logger.debug(`Cache hit for ${cacheKey}`);
        return cached as T;
      }
    }

    const exec = () =>
      requestWithRetries<T>(
        () => performFetch<T>(url, method, headers, requestOptions, timeoutMs, logger),
        maxRetries,
        logger
      );

    const response = await breaker.execute(exec);

    if (method === 'GET' && cache && resolvedCacheTtl > 0) {
      cache.set(cacheKey, response, resolvedCacheTtl);
    }

    return response;
  };

  return {
    get: (path, opts) => request('GET', path, opts),
    post: (path, opts) => request('POST', path, opts),
    put: (path, opts) => request('PUT', path, opts),
    patch: (path, opts) => request('PATCH', path, opts),
    delete: (path, opts) => request('DELETE', path, opts)
  };
}

async function requestWithRetries<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  logger: Logger
): Promise<T> {
  let attempt = 0;
  let lastError: unknown;

  while (attempt <= maxRetries) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      attempt += 1;

      if (attempt > maxRetries) {
        break;
      }

      const retryError = error instanceof RetryableError ? error : null;
      const backoffBase = retryError?.retryAfterMs ?? 1000 * Math.pow(2, attempt - 1);
      const jitter = backoffBase * (0.5 + Math.random() * 0.5);
      const waitMs = Math.min(30_000, Math.round(jitter));

      logger.warn(`HTTP request failed (attempt ${attempt}/${maxRetries}), retrying in ${waitMs}ms`, {
        error: error instanceof Error ? error.message : String(error),
        status: retryError?.status
      });

      await new Promise(resolve => setTimeout(resolve, waitMs));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`HTTP request failed after ${maxRetries + 1} attempts`);
}

async function performFetch<T>(
  url: string,
  method: string,
  defaultHeaders: Record<string, string>,
  options: RequestOptions,
  timeoutMs: number,
  logger: Logger
): Promise<T> {
  const headers = {
    ...defaultHeaders,
    ...(options.headers ?? {})
  };

  const init: RequestInit = {
    method,
    headers
  };

  if (options.body !== undefined && options.body !== null) {
    if (typeof options.body === 'string' || options.body instanceof Buffer) {
      init.body = options.body as any;
    } else {
      headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
      init.body = JSON.stringify(options.body);
    }
  }

  const controller = new AbortController();
  const timeout = options.timeoutMs ?? timeoutMs;
  const timeoutHandle = setTimeout(() => controller.abort(), timeout);
  init.signal = controller.signal;

  try {
    const response = await fetch(url, init);
    clearTimeout(timeoutHandle);
    return await parseResponse<T>(response);
  } catch (error) {
    clearTimeout(timeoutHandle);
    if (error instanceof FetchError) {
      if (error.type === 'aborted') {
        throw new RetryableError(`Request timeout after ${timeout}ms`, timeout, undefined);
      }
      throw new RetryableError(`Network error: ${error.message}`, null, undefined);
    }
    logger.error('HTTP request failed', error as Error);
    throw error;
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const contentType = response.headers.get('content-type') || '';
  const payload = text.length > 0 && contentType.includes('application/json')
    ? safeParseJson(text)
    : text.length > 0
      ? text
      : null;

  if (response.ok) {
    return payload as T;
  }

  const retryAfter = parseRetryAfter(response);
  const message = `HTTP ${response.status} ${response.statusText}`;

  if (isRetryableStatus(response.status)) {
    throw new RetryableError(message, retryAfter, response.status);
  }

  throw new HttpError(message, response.status, payload);
}

function safeParseJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function buildUrl(baseURL: string, path: string, params?: Record<string, Primitive>): string {
  const url = new URL(path, ensureTrailingSlash(baseURL));
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === null || value === undefined) continue;
      url.searchParams.append(key, String(value));
    }
  }
  return url.toString();
}

function ensureTrailingSlash(baseURL: string): string {
  return baseURL.endsWith('/') ? baseURL : `${baseURL}/`;
}

function parseRetryAfter(response: Response): number | null {
  const header = response.headers.get('retry-after');
  if (!header) return null;

  const delaySeconds = Number.parseFloat(header);
  if (Number.isFinite(delaySeconds)) {
    return Math.max(0, delaySeconds * 1000);
  }

  const retryDate = new Date(header);
  if (!Number.isNaN(retryDate.getTime())) {
    const diff = retryDate.getTime() - Date.now();
    return diff > 0 ? diff : 0;
  }

  return null;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}
