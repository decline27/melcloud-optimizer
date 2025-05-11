/**
 * Validation utility functions
 * Provides helper functions for validating input parameters
 */

/**
 * Validate a number value
 * @param value Value to validate
 * @param name Name of the parameter (for error messages)
 * @param options Validation options
 * @returns The validated number
 * @throws Error if validation fails
 */
export function validateNumber(
  value: any, 
  name: string, 
  options: { 
    min?: number; 
    max?: number; 
    integer?: boolean 
  } = {}
): number {
  if (typeof value !== 'number' || isNaN(value)) {
    throw new Error(`Invalid ${name}: must be a number`);
  }
  
  if (options.min !== undefined && value < options.min) {
    throw new Error(`Invalid ${name}: must be at least ${options.min}`);
  }
  
  if (options.max !== undefined && value > options.max) {
    throw new Error(`Invalid ${name}: must be at most ${options.max}`);
  }
  
  if (options.integer && !Number.isInteger(value)) {
    throw new Error(`Invalid ${name}: must be an integer`);
  }
  
  return value;
}

/**
 * Validate a boolean value
 * @param value Value to validate
 * @param name Name of the parameter (for error messages)
 * @returns The validated boolean
 * @throws Error if validation fails
 */
export function validateBoolean(value: any, name: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`Invalid ${name}: must be a boolean`);
  }
  
  return value;
}

/**
 * Validate a string value
 * @param value Value to validate
 * @param name Name of the parameter (for error messages)
 * @param options Validation options
 * @returns The validated string
 * @throws Error if validation fails
 */
export function validateString(
  value: any, 
  name: string, 
  options: { 
    minLength?: number; 
    maxLength?: number; 
    pattern?: RegExp 
  } = {}
): string {
  if (typeof value !== 'string') {
    throw new Error(`Invalid ${name}: must be a string`);
  }
  
  if (options.minLength !== undefined && value.length < options.minLength) {
    throw new Error(`Invalid ${name}: must be at least ${options.minLength} characters`);
  }
  
  if (options.maxLength !== undefined && value.length > options.maxLength) {
    throw new Error(`Invalid ${name}: must be at most ${options.maxLength} characters`);
  }
  
  if (options.pattern !== undefined && !options.pattern.test(value)) {
    throw new Error(`Invalid ${name}: does not match required pattern`);
  }
  
  return value;
}

/**
 * Validate an array value
 * @param value Value to validate
 * @param name Name of the parameter (for error messages)
 * @param options Validation options
 * @returns The validated array
 * @throws Error if validation fails
 */
export function validateArray(
  value: any, 
  name: string, 
  options: { 
    minLength?: number; 
    maxLength?: number; 
    elementValidator?: (element: any, index: number) => boolean 
  } = {}
): any[] {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid ${name}: must be an array`);
  }
  
  if (options.minLength !== undefined && value.length < options.minLength) {
    throw new Error(`Invalid ${name}: must have at least ${options.minLength} elements`);
  }
  
  if (options.maxLength !== undefined && value.length > options.maxLength) {
    throw new Error(`Invalid ${name}: must have at most ${options.maxLength} elements`);
  }
  
  if (options.elementValidator) {
    for (let i = 0; i < value.length; i++) {
      if (!options.elementValidator(value[i], i)) {
        throw new Error(`Invalid ${name}: element at index ${i} failed validation`);
      }
    }
  }
  
  return value;
}
