const BYTES_PER_MB = 1024 * 1024;

type LoggerLike = {
  log?: (message: string, ...args: any[]) => void;
  warn?: (message: string, ...args: any[]) => void;
  error?: (message: string, ...args: any[]) => void;
  debug?: (message: string, ...args: any[]) => void;
};

export type MemoryValue = number | 'N/A';

export interface ProcessMemoryStats {
  rss: MemoryValue;
  heapTotal: MemoryValue;
  heapUsed: MemoryValue;
  external: MemoryValue;
}

export type ProcessMemorySource = 'process' | 'v8' | 'unavailable';

export interface ProcessMemorySnapshot {
  stats: ProcessMemoryStats;
  source: ProcessMemorySource;
  fallbackReason?: string;
}

const roundBytesToMB = (bytes: number): number => {
  return Math.round((bytes / BYTES_PER_MB) * 100) / 100;
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return typeof error === 'object' ? JSON.stringify(error) : String(error);
};

const formatLogMessage = (message: string, error?: unknown): string => {
  if (error === undefined) {
    return message;
  }
  return `${message} (${getErrorMessage(error)})`;
};

const logWarning = (logger: LoggerLike | undefined, message: string, error?: unknown): void => {
  if (!logger) {
    return;
  }
  const formattedMessage = formatLogMessage(message, error);
  if (typeof logger.warn === 'function') {
    logger.warn(formattedMessage);
    return;
  }
  if (typeof logger.error === 'function') {
    logger.error(formattedMessage);
    return;
  }
  if (typeof logger.log === 'function') {
    logger.log(formattedMessage);
  }
};

const getResourceUsageRss = (): MemoryValue => {
  if (typeof process === 'undefined' || typeof process.resourceUsage !== 'function') {
    return 'N/A';
  }

  try {
    const usage = process.resourceUsage();
    if (usage && typeof usage.maxRSS === 'number' && usage.maxRSS > 0) {
      // Node reports maxRSS in kilobytes
      return roundBytesToMB(usage.maxRSS * 1024);
    }
  } catch {
    // Ignore resource usage errors; we'll fall back to other metrics
  }

  return 'N/A';
};

export const captureProcessMemory = (logger?: LoggerLike): ProcessMemorySnapshot => {
  const defaultStats: ProcessMemoryStats = {
    rss: 'N/A',
    heapTotal: 'N/A',
    heapUsed: 'N/A',
    external: 'N/A'
  };

  let fallbackReason: string | undefined;

  if (typeof process === 'undefined') {
    return {
      stats: defaultStats,
      source: 'unavailable',
      fallbackReason: 'process global is not available in this runtime'
    };
  }

  if (typeof process.memoryUsage === 'function') {
    try {
      const usage = process.memoryUsage();
      return {
        stats: {
          rss: roundBytesToMB(usage.rss),
          heapTotal: roundBytesToMB(usage.heapTotal),
          heapUsed: roundBytesToMB(usage.heapUsed),
          external: roundBytesToMB(usage.external ?? 0)
        },
        source: 'process'
      };
    } catch (error) {
      const message = `process.memoryUsage() failed: ${getErrorMessage(error)}`;
      logWarning(logger, 'Could not read detailed process memory usage; falling back to estimates', error);
      fallbackReason = message;
    }
  } else {
    fallbackReason = 'process.memoryUsage is not available in this runtime';
  }

  // Try to obtain heap statistics via V8 as a fallback
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const v8: any = require('v8');
    if (v8 && typeof v8.getHeapStatistics === 'function') {
      const heapStats = v8.getHeapStatistics();
      const rss = getResourceUsageRss();

      return {
        stats: {
          rss: rss !== 'N/A' && typeof heapStats.total_physical_size === 'number'
            ? rss
            : typeof heapStats.total_physical_size === 'number'
              ? roundBytesToMB(heapStats.total_physical_size)
              : rss,
          heapTotal: typeof heapStats.total_heap_size === 'number'
            ? roundBytesToMB(heapStats.total_heap_size)
            : 'N/A',
          heapUsed: typeof heapStats.used_heap_size === 'number'
            ? roundBytesToMB(heapStats.used_heap_size)
            : 'N/A',
          external: typeof heapStats.external_memory === 'number'
            ? roundBytesToMB(heapStats.external_memory)
            : 'N/A'
        },
        source: 'v8',
        fallbackReason
      };
    }

    fallbackReason = fallbackReason
      ? `${fallbackReason}; v8.getHeapStatistics is not available`
      : 'v8.getHeapStatistics is not available in this runtime';
  } catch (error) {
    const message = `v8 heap statistics unavailable: ${getErrorMessage(error)}`;
    logWarning(logger, 'Could not read V8 heap statistics for memory usage fallback', error);
    fallbackReason = fallbackReason ? `${fallbackReason}; ${message}` : message;
  }

  return {
    stats: defaultStats,
    source: 'unavailable',
    fallbackReason
  };
};
