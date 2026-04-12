/**
 * Application-Level Encryption Utilities
 *
 * Implements AES-256-GCM encryption for sensitive database fields.
 * This provides defense-in-depth beyond database-level encryption.
 *
 * GDPR Article 32 Compliance: Technical measures for data security
 *
 * Standards:
 * - AES-256-GCM (NIST approved)
 * - 128-bit authentication tag
 * - Per-encryption random IV (96 bits)
 *
 * Usage:
 *   const encrypted = encryptField(JSON.stringify(sensitiveData));
 *   await db.query('UPDATE table SET field = $1', [encrypted]);
 *
 *   const decrypted = decryptField(encrypted);
 *   const data = JSON.parse(decrypted);
 */

import crypto from 'crypto';

/** Algorithm: AES-256-GCM provides both confidentiality and authenticity */
const ALGORITHM = 'aes-256-gcm';

/** IV length: 96 bits (12 bytes) is optimal for GCM */
const IV_LENGTH = 12;

/** Tag length: 128 bits (16 bytes) for authentication */
const AUTH_TAG_LENGTH = 16;

/** Key length: 256 bits (32 bytes) */
const KEY_LENGTH = 32;

/**
 * Get encryption key from environment or parameter
 *
 * In development: Use .env.local
 * In production: Retrieve from AWS Secrets Manager
 *
 * @param keyHex - Optional key hex string (for testing/key rotation)
 * @throws Error if ENCRYPTION_KEY not configured
 */
function getEncryptionKey(keyHex?: string): Buffer {
  const key = keyHex || process.env.ENCRYPTION_KEY;

  if (!key) {
    throw new Error('ENCRYPTION_KEY not configured. Generate with: openssl rand -hex 32');
  }

  // Validate key length (should be 64 hex chars = 32 bytes)
  if (key.length !== KEY_LENGTH * 2) {
    throw new Error(
      `Invalid ENCRYPTION_KEY length. Expected ${KEY_LENGTH * 2} hex characters (${KEY_LENGTH} bytes), got ${key.length}`
    );
  }

  return Buffer.from(key, 'hex');
}

/**
 * Encrypt a plaintext string
 *
 * Returns format: iv:authTag:ciphertext (all base64 encoded)
 *
 * Example:
 *   const encrypted = encryptField('{"name":"John"}');
 *   // Returns: "kR3mT5n...==:p9xL2w...==:a8cZ4b...=="
 *
 * @param plaintext - String to encrypt (typically JSON)
 * @param keyHex - Optional encryption key (for testing/key rotation)
 * @returns Encrypted string in format: iv:authTag:ciphertext
 */
export function encryptField(plaintext: string, keyHex?: string): string {
  const key = getEncryptionKey(keyHex);

  // Generate random IV for this encryption (never reuse IVs with same key!)
  const iv = crypto.randomBytes(IV_LENGTH);

  // Create cipher
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  // Encrypt
  let ciphertext = cipher.update(plaintext, 'utf8', 'base64');
  ciphertext += cipher.final('base64');

  // Get authentication tag
  const authTag = cipher.getAuthTag();

  // Return format: iv:authTag:ciphertext (all base64)
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${ciphertext}`;
}

/**
 * Decrypt an encrypted string
 *
 * @param ciphertext - Encrypted string in format: iv:authTag:ciphertext
 * @param keyHex - Optional encryption key (for testing/key rotation)
 * @returns Decrypted plaintext string
 * @throws Error if authentication fails or format invalid
 */
export function decryptField(ciphertext: string, keyHex?: string): string {
  const key = getEncryptionKey(keyHex);

  // Parse format: iv:authTag:ciphertext
  const parts = ciphertext.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid ciphertext format. Expected: iv:authTag:ciphertext');
  }

  const [ivB64, authTagB64, encryptedB64] = parts;

  // Decode from base64
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const encrypted = encryptedB64; // Keep as base64 for decipher.update

  // Validate lengths
  if (iv.length !== IV_LENGTH) {
    throw new Error(`Invalid IV length. Expected ${IV_LENGTH} bytes, got ${iv.length}`);
  }
  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error(
      `Invalid auth tag length. Expected ${AUTH_TAG_LENGTH} bytes, got ${authTag.length}`
    );
  }

  // Create decipher
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  // Decrypt
  let plaintext = decipher.update(encrypted, 'base64', 'utf8');
  plaintext += decipher.final('utf8');

  return plaintext;
}

/**
 * Encrypt a JSON object
 *
 * Convenience wrapper for encrypting objects
 *
 * @param data - Object to encrypt
 * @param keyHex - Optional encryption key (for testing/key rotation)
 * @returns Encrypted string
 */
export function encryptJSON(data: unknown, keyHex?: string): string {
  return encryptField(JSON.stringify(data), keyHex);
}

/**
 * Decrypt to JSON object
 *
 * Convenience wrapper for decrypting to object
 *
 * @param ciphertext - Encrypted string
 * @param keyHex - Optional encryption key (for testing/key rotation)
 * @returns Decrypted object
 */
export function decryptJSON<T = unknown>(ciphertext: string, keyHex?: string): T {
  return JSON.parse(decryptField(ciphertext, keyHex)) as T;
}

/**
 * Check if a string appears to be encrypted
 *
 * Useful for migration scenarios where some records may already be encrypted
 *
 * @param value - String to check
 * @returns true if format matches encrypted data
 */
export function isEncrypted(value: string): boolean {
  if (!value || typeof value !== 'string') {
    return false;
  }

  const parts = value.split(':');
  if (parts.length !== 3) {
    return false;
  }

  // Check if parts look like base64
  const base64Pattern = /^[A-Za-z0-9+/]+=*$/;
  return parts.every((part) => base64Pattern.test(part));
}

/**
 * Generate a new encryption key
 *
 * Use this to generate keys for new environments
 * Run: node -e "console.log(require('./crypto').generateEncryptionKey())"
 *
 * @returns Hex-encoded encryption key (64 characters)
 */
export function generateEncryptionKey(): string {
  return crypto.randomBytes(KEY_LENGTH).toString('hex');
}

/**
 * Rotate encryption key by re-encrypting data
 *
 * Use when changing encryption keys
 *
 * @param encryptedData - Data encrypted with old key
 * @param oldKey - Old encryption key (hex)
 * @param newKey - New encryption key (hex)
 * @returns Data re-encrypted with new key
 */
export function rotateKey(encryptedData: string, oldKey: string, newKey: string): string {
  // Temporarily set old key
  const originalKey = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = oldKey;

  // Decrypt with old key
  const plaintext = decryptField(encryptedData);

  // Set new key
  process.env.ENCRYPTION_KEY = newKey;

  // Encrypt with new key
  const reEncrypted = encryptField(plaintext);

  // Restore original key
  process.env.ENCRYPTION_KEY = originalKey;

  return reEncrypted;
}
