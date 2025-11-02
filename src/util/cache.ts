export interface CacheEntry<V> {
  value: V;
  expiresAt: number;
}

export interface CacheOptions {
  ttlMs?: number;
  maxEntries?: number;
}

/**
 * Lightweight in-memory TTL cache with naive eviction.
 * Designed for short-lived provider call caching.
 */
export class TTLCache<K, V> {
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly map = new Map<K, CacheEntry<V>>();

  constructor(options: CacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? 30_000;
    this.maxEntries = options.maxEntries ?? 50;
  }

  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) {
      return undefined;
    }

    if (entry.expiresAt < Date.now()) {
      this.map.delete(key);
      return undefined;
    }

    return entry.value;
  }

  set(key: K, value: V, ttlOverride?: number): void {
    const ttl = ttlOverride ?? this.ttlMs;
    if (ttl > 0) {
      const expiresAt = Date.now() + ttl;
      this.map.set(key, { value, expiresAt });
      this.enforceSizeLimit();
    }
  }

  delete(key: K): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  private enforceSizeLimit(): void {
    if (this.map.size <= this.maxEntries) {
      return;
    }

    const now = Date.now();
    for (const [key, entry] of this.map.entries()) {
      if (entry.expiresAt < now) {
        this.map.delete(key);
      }
    }

    if (this.map.size <= this.maxEntries) {
      return;
    }

    const keys = this.map.keys();
    while (this.map.size > this.maxEntries) {
      const oldestKey = keys.next();
      if (oldestKey.done) {
        break;
      }
      this.map.delete(oldestKey.value);
    }
  }
}
