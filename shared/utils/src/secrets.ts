/**
 * AWS Secrets Manager Client
 *
 * Provides secure secret retrieval with:
 * - Client-side caching (5-minute TTL)
 * - Automatic fallback to environment variables in development
 * - Type-safe secret names
 * - Error handling and retry logic
 *
 * @module secrets
 */

import {
  SecretsManagerClient,
  GetSecretValueCommand,
  GetSecretValueCommandInput,
} from '@aws-sdk/client-secrets-manager';

// Type-safe secret names
export type SecretName =
  | 'prod/encryption-key'
  | 'prod/vc-issuer-key'
  | 'prod/consent-key'
  | 'prod/auth0-client-secret'
  | 'prod/stripe-secret-key'
  | 'prod/stripe-webhook-secret'
  | 'staging/encryption-key'
  | 'staging/vc-issuer-key'
  | 'staging/consent-key'
  | 'staging/auth0-client-secret'
  | 'staging/stripe-secret-key'
  | 'staging/stripe-webhook-secret';

// Environment variable fallback mapping
// Maps Secrets Manager path → local .env.local variable name
// IMPORTANT: verifiable-credentials.ts reads ISSUER_ED25519_PRIVATE_KEY directly;
// consent-proof.ts reads CONSENT_SIGNING_PRIVATE_KEY directly.
// These must match the actual env var names used in the consuming code.
const ENV_FALLBACK_MAP: Record<SecretName, string> = {
  'prod/encryption-key': 'ENCRYPTION_KEY',
  'prod/vc-issuer-key': 'ISSUER_ED25519_PRIVATE_KEY',
  'prod/consent-key': 'CONSENT_SIGNING_PRIVATE_KEY',
  'prod/auth0-client-secret': 'AUTH0_CLIENT_SECRET',
  'prod/stripe-secret-key': 'STRIPE_SECRET_KEY',
  'prod/stripe-webhook-secret': 'STRIPE_WEBHOOK_SECRET',
  'staging/encryption-key': 'ENCRYPTION_KEY',
  'staging/vc-issuer-key': 'ISSUER_ED25519_PRIVATE_KEY',
  'staging/consent-key': 'CONSENT_SIGNING_PRIVATE_KEY',
  'staging/auth0-client-secret': 'AUTH0_CLIENT_SECRET',
  'staging/stripe-secret-key': 'STRIPE_SECRET_KEY',
  'staging/stripe-webhook-secret': 'STRIPE_WEBHOOK_SECRET',
};

// Cache configuration
interface CachedSecret {
  value: string;
  expiresAt: number;
}

const secretCache = new Map<SecretName, CachedSecret>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Secrets Manager client (singleton)
let client: SecretsManagerClient | null = null;

function getClient(): SecretsManagerClient {
  if (!client) {
    client = new SecretsManagerClient({
      region: process.env.AWS_REGION || 'eu-west-2',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      },
    });
  }
  return client;
}

/**
 * Get a secret from AWS Secrets Manager (with caching)
 *
 * In development (NODE_ENV !== 'production'):
 * - Falls back to environment variables (.env.local)
 * - Does not call AWS Secrets Manager API
 *
 * In production:
 * - Retrieves from AWS Secrets Manager
 * - Caches for 5 minutes (reduces API calls = cost savings)
 * - Retries on transient errors (3 attempts)
 *
 * @param secretName - The name of the secret (e.g., 'prod/encryption-key')
 * @returns The secret value (string)
 * @throws Error if secret not found or AWS API error
 *
 * @example
 * ```typescript
 * // Production: Retrieves from AWS Secrets Manager
 * const key = await getSecret('prod/encryption-key');
 *
 * // Development: Falls back to process.env.ENCRYPTION_KEY
 * const key = await getSecret('prod/encryption-key'); // Uses .env.local
 * ```
 */
export async function getSecret(secretName: SecretName): Promise<string> {
  // Development mode: Use environment variables
  if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
    const envVar = ENV_FALLBACK_MAP[secretName];
    const value = process.env[envVar];

    if (!value) {
      throw new Error(
        `Development secret not found: ${envVar} (for ${secretName})\n` +
          `Add ${envVar}=... to your .env.local file`
      );
    }

    return value;
  }

  // Check cache first
  const cached = secretCache.get(secretName);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  // Retrieve from Secrets Manager
  try {
    const value = await getSecretFromAWS(secretName);

    // Cache for 5 minutes
    secretCache.set(secretName, {
      value,
      expiresAt: Date.now() + CACHE_TTL,
    });

    return value;
  } catch (error) {
    // If AWS fails, try environment variable as emergency fallback
    const envVar = ENV_FALLBACK_MAP[secretName];
    const fallbackValue = process.env[envVar];

    if (fallbackValue) {
      console.warn(
        `[SECRETS] AWS Secrets Manager failed, using emergency env var fallback: ${envVar}`
      );
      return fallbackValue;
    }

    throw error;
  }
}

/**
 * Retrieve secret from AWS Secrets Manager (with retry logic)
 *
 * @internal
 * @param secretName - The name of the secret
 * @param maxRetries - Maximum retry attempts (default: 3)
 * @returns The secret value
 * @throws Error if all retries fail
 */
async function getSecretFromAWS(secretName: SecretName, maxRetries = 3): Promise<string> {
  const smClient = getClient();

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const input: GetSecretValueCommandInput = {
        SecretId: secretName,
        VersionStage: 'AWSCURRENT', // Always use latest version
      };

      const command = new GetSecretValueCommand(input);
      const response = await smClient.send(command);

      if (!response.SecretString) {
        throw new Error(`Secret ${secretName} has no SecretString (is it a binary secret?)`);
      }

      return response.SecretString;
    } catch (error) {
      lastError = error as Error;

      // Don't retry on ResourceNotFoundException (secret doesn't exist)
      if (error instanceof Error && error.name === 'ResourceNotFoundException') {
        throw new Error(
          `Secret not found: ${secretName}\n` +
            `Run migration script: node scripts/migrate-secrets-to-aws.js`
        );
      }

      // Don't retry on AccessDeniedException (permission issue)
      if (error instanceof Error && error.name === 'AccessDeniedException') {
        throw new Error(
          `Access denied to secret: ${secretName}\n` +
            `Check IAM permissions for GetSecretValue on ${secretName}`
        );
      }

      // Transient errors: Retry with exponential backoff
      if (attempt < maxRetries) {
        const backoffMs = Math.pow(2, attempt) * 100; // 200ms, 400ms, 800ms
        console.warn(
          `[SECRETS] Attempt ${attempt}/${maxRetries} failed for ${secretName}, ` +
            `retrying in ${backoffMs}ms...`,
          error
        );
        await sleep(backoffMs);
      }
    }
  }

  throw new Error(
    `Failed to retrieve secret ${secretName} after ${maxRetries} attempts:\n${lastError?.message}`
  );
}

/**
 * Clear the secret cache (useful for testing or forced refresh)
 *
 * @param secretName - Optional: Clear specific secret. Omit to clear all.
 *
 * @example
 * ```typescript
 * // Clear all cached secrets
 * clearSecretCache();
 *
 * // Clear specific secret
 * clearSecretCache('prod/encryption-key');
 * ```
 */
export function clearSecretCache(secretName?: SecretName): void {
  if (secretName) {
    secretCache.delete(secretName);
  } else {
    secretCache.clear();
  }
}

/**
 * Get cache statistics (for monitoring and debugging)
 *
 * @returns Cache stats: size, hit rate, expired entries
 *
 * @example
 * ```typescript
 * const stats = getSecretCacheStats();
 * console.log(`Cache size: ${stats.size}, Expired: ${stats.expired}`);
 * ```
 */
export function getSecretCacheStats() {
  const now = Date.now();
  let expired = 0;

  for (const [, cached] of secretCache) {
    if (cached.expiresAt <= now) {
      expired++;
    }
  }

  return {
    size: secretCache.size,
    expired,
    active: secretCache.size - expired,
  };
}

/**
 * Validate that all required secrets are accessible
 *
 * Call this during application startup to fail fast if secrets are missing.
 *
 * @param secretNames - Array of required secret names
 * @throws Error if any secret is inaccessible
 *
 * @example
 * ```typescript
 * // Validate at startup
 * await validateSecrets([
 *   'prod/encryption-key',
 *   'prod/vc-issuer-key',
 *   'prod/consent-key',
 * ]);
 * ```
 */
export async function validateSecrets(secretNames: SecretName[]): Promise<void> {
  const errors: string[] = [];

  for (const secretName of secretNames) {
    try {
      const value = await getSecret(secretName);
      if (!value || value.length === 0) {
        errors.push(`${secretName}: Empty value`);
      }
    } catch (error) {
      errors.push(`${secretName}: ${(error as Error).message}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Secret validation failed:\n${errors.map((e) => `  - ${e}`).join('\n')}`);
  }
}

// Utility: Sleep
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
