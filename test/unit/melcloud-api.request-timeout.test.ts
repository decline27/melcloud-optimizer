import { EventEmitter } from 'events';
import { MelCloudApi } from '../../src/services/melcloud-api';
import { createMockLogger } from '../mocks';
const https = require('https');

/**
 * A MELCloud connection that is accepted but never answered must not hang forever. Seen live on
 * 2026-10-16: with no request timeout the promise stayed pending, the de-duplication map handed
 * the same dead promise to every later device poll, and polling stopped for 11 hours.
 */

jest.setTimeout(15000);

function hangingRequest() {
  const req: any = new EventEmitter();
  req.write = jest.fn();
  req.end = jest.fn();
  req.setTimeout = jest.fn((ms: number, cb: () => void) => {
    setTimeout(cb, ms);
    return req;
  });
  req.destroy = jest.fn((err: Error) => {
    process.nextTick(() => req.emit('error', err));
    return req;
  });
  return req;
}

describe('MelCloudApi request timeout', () => {
  let originalRequest: any;

  beforeEach(() => {
    originalRequest = https.request;
  });

  afterEach(() => {
    https.request = originalRequest;
  });

  test('a request that is never answered rejects, and the next call is not stuck on it', async () => {
    const api: any = new MelCloudApi(createMockLogger() as any);
    api.circuitBreaker = { getRequestTimeoutMs: () => 20, cleanup: jest.fn() };
    api.throttle = jest.fn().mockResolvedValue(undefined);

    const requests: any[] = [];
    https.request = jest.fn(() => {
      const req = hangingRequest();
      requests.push(req);
      return req;
    });

    await expect(api.throttledApiCall('GET', 'Device/Get?id=1')).rejects.toThrow(/timed out after 20ms/);
    // Every attempt (initial + retries) armed the timeout.
    expect(requests.length).toBeGreaterThan(0);
    requests.forEach(r => expect(r.setTimeout).toHaveBeenCalledWith(20, expect.any(Function)));
    // The dead request is no longer tracked, so an identical call makes a fresh request.
    expect(api.pendingRequests.size).toBe(0);
    const before = requests.length;
    await expect(api.throttledApiCall('GET', 'Device/Get?id=1')).rejects.toThrow(/timed out/);
    expect(requests.length).toBeGreaterThan(before);
  });

  test('without a configured timeout the request is left as before', async () => {
    const api: any = new MelCloudApi(createMockLogger() as any);
    api.circuitBreaker = { cleanup: jest.fn() };
    api.throttle = jest.fn().mockResolvedValue(undefined);

    const req = hangingRequest();
    https.request = jest.fn((_opts: any, onResponse: (res: any) => void) => {
      process.nextTick(() => {
        const res: any = new EventEmitter();
        res.statusCode = 200;
        onResponse(res);
        process.nextTick(() => { res.emit('data', Buffer.from('{"ok":true}')); res.emit('end'); });
      });
      return req;
    });

    await expect(api.throttledApiCall('GET', 'ok')).resolves.toEqual({ ok: true });
    expect(req.setTimeout).not.toHaveBeenCalled();
  });
});
