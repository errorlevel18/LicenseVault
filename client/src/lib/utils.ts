import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Converts a snake_case string to camelCase
 * @param str The snake_case string to convert
 * @returns The camelCase version of the input string
 */
export function snakeToCamel(str: string): string {
  return str.replace(/(_\w)/g, match => match[1].toUpperCase());
}

/**
 * Converts a camelCase string to snake_case
 * @param str The camelCase string to convert
 * @returns The snake_case version of the input string
 */
export function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

/**
 * Recursively transforms all keys in an object from snake_case to camelCase
 * @param obj The object whose keys should be transformed
 * @returns A new object with all keys in camelCase
 */
export function transformObjectKeysToCamel<T extends Record<string, any>>(obj: T): Record<string, any> {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => transformObjectKeysToCamel(item));
  }

  return Object.keys(obj).reduce((acc, key) => {
    const camelKey = snakeToCamel(key);
    acc[camelKey] = transformObjectKeysToCamel(obj[key]);
    return acc;
  }, {} as Record<string, any>);
}

/**
 * Recursively transforms all keys in an object from camelCase to snake_case
 * @param obj The object whose keys should be transformed
 * @returns A new object with all keys in snake_case
 */
export function transformObjectKeysToSnake<T extends Record<string, any>>(obj: T): Record<string, any> {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => transformObjectKeysToSnake(item));
  }

  return Object.keys(obj).reduce((acc, key) => {
    const snakeKey = camelToSnake(key);
    acc[snakeKey] = transformObjectKeysToSnake(obj[key]);
    return acc;
  }, {} as Record<string, any>);
}
