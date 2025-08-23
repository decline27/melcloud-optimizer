import { validateNumber, validateBoolean, validateString, validateArray } from '../../src/util/validation';

describe('validation utilities', () => {
  describe('validateNumber', () => {
    it('accepts valid numbers and enforces min/max/integer', () => {
      expect(validateNumber(5, 'test')).toBe(5);
      expect(validateNumber(10, 'test', { min: 5 })).toBe(10);
      expect(() => validateNumber(4, 'test', { min: 5 })).toThrow();
      expect(() => validateNumber(11, 'test', { max: 10 })).toThrow();
      expect(validateNumber(3, 'test', { integer: true })).toBe(3);
      expect(() => validateNumber(3.5, 'test', { integer: true })).toThrow();
    });

    it('throws for non-number', () => {
      expect(() => validateNumber('a' as any, 'test')).toThrow();
    });
  });

  describe('validateBoolean', () => {
    it('accepts booleans and rejects others', () => {
      expect(validateBoolean(true, 'flag')).toBe(true);
      expect(() => validateBoolean('true' as any, 'flag')).toThrow();
    });
  });

  describe('validateString', () => {
    it('validates length and pattern', () => {
      expect(validateString('hello', 's')).toBe('hello');
      expect(() => validateString(123 as any, 's')).toThrow();
      expect(() => validateString('a', 's', { minLength: 2 })).toThrow();
      expect(() => validateString('long', 's', { maxLength: 3 })).toThrow();
      expect(() => validateString('abc', 's', { pattern: /\d+/ })).toThrow();
    });
  });

  describe('validateArray', () => {
    it('validates array size and elements', () => {
      expect(validateArray([1,2,3], 'arr')).toEqual([1,2,3]);
      expect(() => validateArray('notarray' as any, 'arr')).toThrow();
      expect(() => validateArray([], 'arr', { minLength: 1 })).toThrow();
      expect(() => validateArray([1,2,3,4], 'arr', { maxLength: 3 })).toThrow();
      expect(() => validateArray([1, 'x'], 'arr', { elementValidator: (el) => typeof el === 'number' })).toThrow();
    });
  });
});
