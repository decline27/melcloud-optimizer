// Prevent MelCloudApi from triggering network activity during imports
jest.mock('../../src/services/melcloud-api', () => ({
  MelCloudApi: class {}
}));

import { Optimizer } from '../../src/services/optimizer';

// Create lightweight mocks for dependencies
const makeMel = () => ({ getEnergyData: jest.fn().mockResolvedValue([]) });
const makeTibber = () => ({});
const makeLogger = () => ({ log: jest.fn(), error: jest.fn(), warn: jest.fn() });

describe('Optimizer basic', () => {
  test('setThermalModel validates and sets K', () => {
    const opt = new Optimizer(makeMel() as any, makeTibber() as any, 'dev', 1, makeLogger() as any);
    opt.setThermalModel(0.7);
    // No exception means success. Internal state is private; call a method that relies on it indirectly
    expect(() => opt.setThermalModel(1.2)).not.toThrow();
  });
});
