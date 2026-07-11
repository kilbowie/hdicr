/**
 * PostgreSQL Database Client for Truly Imagined v3
 *
 * Provides connection pooling and query utilities
 * for all backend services
 */

import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';

/**
 * Resolve the Postgres connection string.
 *
 * Precedence:
 *   1. `DATABASE_URL` env var — used for local dev, tests, migrations and as an
 *      emergency override. Takes priority so nothing changes for those flows.
 *   2. AWS Secrets Manager (`DB_URL_SECRET_ARN`) — used by the deployed Lambdas.
 *      The connection string (which contains the DB password) is fetched at
 *      runtime via the function's execution role instead of being baked into a
 *      plaintext Lambda environment variable.
 *
 * The SecretsManagerClient uses the default credential provider chain, so in
 * Lambda it transparently picks up AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY /
 * AWS_SESSION_TOKEN from the execution role.
 */
async function resolveConnectionString(): Promise<string> {
  const explicit = process.env.DATABASE_URL;
  if (explicit) {
    return explicit;
  }

  const secretId = process.env.DB_URL_SECRET_ARN;
  if (!secretId) {
    throw new Error(
      'Neither DATABASE_URL nor DB_URL_SECRET_ARN is set — cannot resolve database connection string',
    );
  }

  const sm = new SecretsManagerClient({
    region: process.env.AWS_REGION || 'eu-west-1',
  });
  const resp = await sm.send(new GetSecretValueCommand({ SecretId: secretId }));
  if (!resp.SecretString) {
    throw new Error(`Secret ${secretId} has no SecretString value`);
  }
  return resp.SecretString;
}

export class DatabaseClient {
  private pool?: Pool;
  private poolPromise?: Promise<Pool>;
  private static instance: DatabaseClient;

  private constructor() {}

  public static getInstance(): DatabaseClient {
    if (!DatabaseClient.instance) {
      DatabaseClient.instance = new DatabaseClient();
    }
    return DatabaseClient.instance;
  }

  /**
   * Lazily create (and memoise) the connection pool. The connection string is
   * resolved asynchronously — from Secrets Manager in the deployed Lambdas — so
   * the pool is built on first query rather than at module load. pg opens
   * sockets lazily anyway, so this adds no extra cold-start cost beyond a single
   * Secrets Manager fetch per container.
   */
  private async getPool(): Promise<Pool> {
    if (this.pool) {
      return this.pool;
    }
    if (!this.poolPromise) {
      this.poolPromise = this.initPool().catch((err) => {
        // Reset so a transient Secrets Manager failure can be retried on the
        // next query instead of permanently poisoning the singleton.
        this.poolPromise = undefined;
        throw err;
      });
    }
    this.pool = await this.poolPromise;
    return this.pool;
  }

  private async initPool(): Promise<Pool> {
    const rawConnectionString = await resolveConnectionString();

    // Keep TLS behavior explicit in the pg client config and avoid relying on
    // sslmode URL parsing semantics that changed in newer pg connection parsing.
    const connectionString = rawConnectionString.replace(/\?sslmode=\w+/, '');

    // Configure SSL based on environment
    const isProduction = process.env.NODE_ENV === 'production';
    const isRDS = connectionString.includes('rds.amazonaws.com');

    let sslConfig: boolean | { rejectUnauthorized: boolean } = false;

    if (isRDS || isProduction) {
      sslConfig = {
        rejectUnauthorized: false, // AWS RDS uses self-signed certs
      };
    }

    const pool = new Pool({
      connectionString,
      ssl: sslConfig,
      max: parseInt(process.env.DB_POOL_SIZE || '20'),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 30000,
      statement_timeout: 30000,
    });

    pool.on('error', (err) => {
      console.error('[DATABASE] Unexpected pool error:', err);
    });

    console.log('[DATABASE] Connection pool initialized');
    return pool;
  }

  public async query<T extends QueryResultRow = any>(
    text: string,
    params?: any[]
  ): Promise<QueryResult<T>> {
    const start = Date.now();
    try {
      const pool = await this.getPool();
      const result = await pool.query<T>(text, params);
      const duration = Date.now() - start;
      console.log(`[DATABASE] Query executed in ${duration}ms`);
      return result;
    } catch (error) {
      console.error('[DATABASE] Query error:', error);
      throw error;
    }
  }

  public async queryWithTenant<T extends QueryResultRow = any>(
    tenantId: string,
    text: string,
    params?: any[]
  ): Promise<QueryResult<T>> {
    return this.transaction(async (client) => {
      await client.query("SELECT pg_catalog.set_config('app.current_tenant_id', $1, true)", [tenantId]);
      return client.query<T>(text, params);
    });
  }

  public async getClient(): Promise<PoolClient> {
    const pool = await this.getPool();
    return pool.connect();
  }

  public async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.getClient();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  public async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = undefined;
      this.poolPromise = undefined;
      console.log('[DATABASE] Connection pool closed');
    }
  }
}

// Export singleton instance
export const db = DatabaseClient.getInstance();
