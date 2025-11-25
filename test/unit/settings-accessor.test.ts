import { SettingsAccessor } from '../../src/util/settings-accessor';

describe('SettingsAccessor', () => {
  let mockHomey: any;
  let accessor: SettingsAccessor;

  beforeEach(() => {
    mockHomey = {
      settings: {
        get: jest.fn(),
        set: jest.fn()
      },
      log: jest.fn()
    };
    accessor = new SettingsAccessor(mockHomey);
  });

  it('returns default for missing settings', () => {
    mockHomey.settings.get.mockReturnValue(undefined);
    expect(accessor.getNumber('missing', 42)).toBe(42);
  });

  it('validates number ranges', () => {
    mockHomey.settings.get.mockReturnValue(200);
    expect(accessor.getNumber('range', 10, { max: 100 })).toBe(10);
  });

  it('handles type mismatches gracefully', () => {
    mockHomey.settings.get.mockReturnValueOnce('oops').mockReturnValueOnce('');
    expect(accessor.getBoolean('flag', true)).toBe(true);
    expect(accessor.getString('name', 'default')).toBe('default');
  });

  it('validates objects with custom validator', () => {
    const defaultValue = { value: 0 };
    const validator = (obj: unknown): obj is { value: number } =>
      typeof (obj as { value?: unknown }).value === 'number';

    mockHomey.settings.get.mockReturnValue({ value: 5 });
    expect(accessor.getObject('obj', defaultValue, validator)).toEqual({ value: 5 });

    mockHomey.settings.get.mockReturnValue({ value: 'nope' });
    expect(accessor.getObject('obj', defaultValue, validator)).toEqual(defaultValue);
  });

  it('sets values using Homey settings', () => {
    accessor.set('example', 123);
    expect(mockHomey.settings.set).toHaveBeenCalledWith('example', 123);
  });
});
