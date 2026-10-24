import {
  MelCloudApi,
  EFFECTIVE_FLAG_ATW_FORCED_HOT_WATER,
  EFFECTIVE_FLAG_ATW_OPERATION_MODE_ZONE1,
  EFFECTIVE_FLAG_ATW_OPERATION_MODE_ZONE2,
  EFFECTIVE_FLAG_ATW_POWER
} from '../../src/services/melcloud-api';
import { createMockLogger } from '../mocks';

/**
 * MELCloud applies only fields named in EffectiveFlags. Without the forced-hot-water bit the
 * request succeeded and nothing changed (live 2026-10-18), also for the device's own switch.
 */
describe('setHotWaterMode', () => {
  function makeApi(reply: any) {
    const api: any = new MelCloudApi(createMockLogger() as any);
    api.contextKey = 'ctx';
    api.getDeviceState = jest.fn().mockResolvedValue({
      DeviceID: 59132691, SetTankWaterTemperature: 53, SetTemperatureZone1: 23,
      ForcedHotWaterMode: false, EffectiveFlags: 0x200000080
    });
    api.retryableRequest = jest.fn((fn: () => Promise<any>) => fn());
    api.throttledApiCall = jest.fn().mockResolvedValue(reply);
    return api;
  }

  test('sends only the forced-hot-water flag with the new mode', async () => {
    const api = makeApi({ ForcedHotWaterMode: true });
    expect(await api.setHotWaterMode('59132691', 513523, true)).toBe(true);
    const [method, path, options] = api.throttledApiCall.mock.calls[0];
    expect([method, path]).toEqual(['POST', 'Device/SetAtw']);
    const body = JSON.parse(options.body);
    expect(body.ForcedHotWaterMode).toBe(true);
    expect(body.EffectiveFlags).toBe(EFFECTIVE_FLAG_ATW_FORCED_HOT_WATER);
    expect(body.HasPendingCommand).toBe(true);
  });

  test('a reply that does not show the new mode counts as failure', async () => {
    const api = makeApi({ ForcedHotWaterMode: false });
    expect(await api.setHotWaterMode('59132691', 513523, true)).toBe(false);
  });

  test('logs what MELCloud replied, so a forced run that never starts can be traced', async () => {
    const api = makeApi({ ForcedHotWaterMode: true, OperationMode: 2, IdleZone1: false, TankWaterTemperature: 27, HasPendingCommand: true });
    await api.setHotWaterMode('59132691', 513523, true);
    const logged = JSON.stringify(api.logger.log.mock.calls);
    expect(logged).toContain('"ForcedHotWaterMode":true');
    expect(logged).toContain('"OperationMode":2');
    expect(logged).toContain('"HasPendingCommand":true');
  });
});

describe('other SetAtw writes name their field in EffectiveFlags', () => {
  function makeApi(reply: any) {
    const api: any = new MelCloudApi(createMockLogger() as any);
    api.contextKey = 'ctx';
    api.getDeviceState = jest.fn().mockResolvedValue({ DeviceID: 1, Power: true, OperationModeZone1: 2, OperationModeZone2: 2, EffectiveFlags: 0 });
    api.retryableRequest = jest.fn((fn: () => Promise<any>) => fn());
    api.throttledApiCall = jest.fn().mockResolvedValue(reply);
    api.invalidateDeviceStateCache = jest.fn();
    return api;
  }
  const body = (api: any) => JSON.parse(api.throttledApiCall.mock.calls[0][2].body);

  test('power', async () => {
    const api = makeApi({ Power: false });
    expect(await api.setDevicePower('1', 1, false)).toBe(true);
    expect(body(api)).toMatchObject({ Power: false, EffectiveFlags: EFFECTIVE_FLAG_ATW_POWER });
  });

  test('operation mode per zone; a reply with the old mode is a failure', async () => {
    const api1 = makeApi({ OperationModeZone1: 0 });
    expect(await api1.setOperationMode('1', 1, 0, 1)).toBe(true);
    expect(body(api1)).toMatchObject({ OperationModeZone1: 0, EffectiveFlags: EFFECTIVE_FLAG_ATW_OPERATION_MODE_ZONE1 });
    const api2 = makeApi({ OperationModeZone2: 2 });
    expect(await api2.setOperationMode('1', 1, 0, 2)).toBe(false);
    expect(body(api2).EffectiveFlags).toBe(EFFECTIVE_FLAG_ATW_OPERATION_MODE_ZONE2);
  });
});

