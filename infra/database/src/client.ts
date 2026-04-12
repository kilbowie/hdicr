/**
 * PostgreSQL Database Client for Truly Imagined v3
 *
 * Provides connection pooling and query utilities
 * for all backend services
 */

import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

export class DatabaseClient {
  private pool: Pool;
  private static instance: DatabaseClient;

  private constructor() {
    const rawConnectionString = process.env.DATABASE_URL;

    if (!rawConnectionString) {
      throw new Error('DATABASE_URL environment variable is not set');
    }

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

    this.pool = new Pool({
      connectionString,
      ssl: sslConfig,
      max: parseInt(process.env.DB_POOL_SIZE || '20'),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 30000,
      statement_timeout: 30000,
    });

    this.pool.on('error', (err) => {
      console.error('[DATABASE] Unexpected pool error:', err);
    });

    console.log('[DATABASE] Connection pool initialized');
  }

  public static getInstance(): DatabaseClient {
    if (!DatabaseClient.instance) {
      DatabaseClient.instance = new DatabaseClient();
    }
    return DatabaseClient.instance;
  }

  public async query<T extends QueryResultRow = any>(
    text: string,
    params?: any[]
  ): Promise<QueryResult<T>> {
    const start = Date.now();
    try {
      const result = await this.pool.query<T>(text, params);
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
      await client.query('SET LOCAL app.current_tenant_id = $1', [tenantId]);
      return client.query<T>(text, params);
    });
  }

  public async getClient(): Promise<PoolClient> {
    return this.pool.connect();
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
    await this.pool.end();
    console.log('[DATABASE] Connection pool closed');
  }
}

// Export singleton instance
export const db = DatabaseClient.getInstance();
