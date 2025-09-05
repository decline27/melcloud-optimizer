import { isMelCloudDevice, isTibberPriceInfo } from '../../src/types';

describe('types guards', () => {
  describe('isMelCloudDevice', () => {
    it('returns true for a valid MelCloudDevice', () => {
      const dev = {
        DeviceID: 'abc',
        BuildingID: 1,
        OutdoorTemperature: 0,
        IdleZone1: false,
      } as any;
      expect(isMelCloudDevice(dev)).toBe(true);
    });

    it('returns false for null/primitive', () => {
      expect(isMelCloudDevice(null as any)).toBe(false);
      expect(isMelCloudDevice(123 as any)).toBe(false);
      expect(isMelCloudDevice('x' as any)).toBe(false);
    });

    it('returns false when DeviceID is missing or not string', () => {
      expect(isMelCloudDevice({ BuildingID: 1 } as any)).toBe(false);
      expect(isMelCloudDevice({ DeviceID: 123, BuildingID: 1 } as any)).toBe(false);
    });

    it('returns false when BuildingID is missing or not number', () => {
      expect(isMelCloudDevice({ DeviceID: 'abc' } as any)).toBe(false);
      expect(isMelCloudDevice({ DeviceID: 'abc', BuildingID: '1' } as any)).toBe(false);
    });
  });

  describe('isTibberPriceInfo', () => {
    it('returns true for a valid TibberPriceInfo', () => {
      const info = {
        current: { price: 0.5, time: '2024-01-01T00:00:00Z' },
        prices: [{ price: 0.5, time: '00:00' }],
      } as any;
      expect(isTibberPriceInfo(info)).toBe(true);
    });

    it('returns false when current is missing or malformed', () => {
      expect(isTibberPriceInfo({ prices: [] } as any)).toBe(false);
      expect(isTibberPriceInfo({ current: {}, prices: [] } as any)).toBe(false);
      expect(
        isTibberPriceInfo({ current: { price: '0.1' }, prices: [] } as any)
      ).toBe(false);
    });

    it('returns false when prices is not an array', () => {
      expect(
        isTibberPriceInfo({ current: { price: 0.5, time: 't' }, prices: {} } as any)
      ).toBe(false);
    });
  });
});

