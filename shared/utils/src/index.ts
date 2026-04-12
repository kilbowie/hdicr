/**
 * Shared Utility Functions for Truly Imagined v3
 */

import { v4 as uuidv4 } from 'uuid';
import type { ApiResponse } from '@trulyimagined/types';

// ==================== ENCRYPTION ====================

export {
  encryptField,
  decryptField,
  encryptJSON,
  decryptJSON,
  isEncrypted,
  generateEncryptionKey,
  rotateKey,
} from './crypto';

// ==================== SECRETS MANAGEMENT ====================

export { getSecret, clearSecretCache, getSecretCacheStats, validateSecrets } from './secrets';
export type { SecretName } from './secrets';

// ==================== ID GENERATION ====================

export function generateId(): string {
  return uuidv4();
}

// ==================== API RESPONSE BUILDERS ====================

export function successResponse<T>(data: T): ApiResponse<T> {
  return {
    success: true,
    data,
    timestamp: new Date().toISOString(),
  };
}

export function errorResponse(error: string): ApiResponse {
  return {
    success: false,
    error,
    timestamp: new Date().toISOString(),
  };
}

// ==================== DATE UTILITIES ====================

export function now(): Date {
  return new Date();
}

export function formatDate(date: Date): string {
  return date.toISOString();
}

// ==================== VALIDATION UTILITIES ====================

export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export function isValidUUID(id: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
}

// ==================== STRING UTILITIES ====================

export function sanitizeString(input: string): string {
  return input.trim().replace(/[<>]/g, '');
}

export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}
