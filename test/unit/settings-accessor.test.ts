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

  describe('Type Coercion', () => {
    it('coerces numeric strings to numbers', () => {
      mockHomey.settings.get.mockReturnValue('21.5');
      expect(accessor.getNumber('temp', 20)).toBe(21.5);

      mockHomey.settings.get.mockReturnValue('42');
      expect(accessor.getNumber('count', 0)).toBe(42);
    });

    it('handles invalid numeric strings', () => {
      mockHomey.settings.get.mockReturnValue('not-a-number');
      expect(accessor.getNumber('temp', 20)).toBe(20); // default
    });

    it('coerces boolean strings', () => {
      mockHomey.settings.get.mockReturnValue('true');
      expect(accessor.getBoolean('flag', false)).toBe(true);

      mockHomey.settings.get.mockReturnValue('false');
      expect(accessor.getBoolean('flag', true)).toBe(false);

      mockHomey.settings.get.mockReturnValue('1');
      expect(accessor.getBoolean('flag', false)).toBe(true);

      mockHomey.settings.get.mockReturnValue('0');
      expect(accessor.getBoolean('flag', true)).toBe(false);
    });

    it('coerces numbers to booleans', () => {
      mockHomey.settings.get.mockReturnValue(1);
      expect(accessor.getBoolean('flag', false)).toBe(true);

      mockHomey.settings.get.mockReturnValue(0);
      expect(accessor.getBoolean('flag', true)).toBe(false);

      mockHomey.settings.get.mockReturnValue(42);
      expect(accessor.getBoolean('flag', false)).toBe(true);
    });

    it('validates ranges after string coercion', () => {
      mockHomey.settings.get.mockReturnValue('200');
      expect(accessor.getNumber('temp', 20, { max: 100 })).toBe(20); // default due to range

      mockHomey.settings.get.mockReturnValue('5');
      expect(accessor.getNumber('temp', 20, { min: 10 })).toBe(20); // default due to range
    });

    it('accepts valid coerced values within range', () => {
      mockHomey.settings.get.mockReturnValue('50');
      expect(accessor.getNumber('temp', 20, { min: 10, max: 100 })).toBe(50);
    });
  });
});
