import { describe, it, expect } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';

const runIntegration = process.env.RUN_RLS_INTEGRATION === '1';
const dbUrl = process.env.DATABASE_URL;

const testFn = runIntegration && dbUrl ? it : it.skip;

describe('[SEP-043] Tenant RLS integration', () => {
  testFn('cross-tenant query returns empty result set without error', async () => {
    const pool = new Pool({
      connectionString: dbUrl,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
    });

    const client = await pool.connect();

    const tenantA = `tenant-a-${randomUUID().slice(0, 8)}`;
    const tenantB = `tenant-b-${randomUUID().slice(0, 8)}`;

    const actorAAuth0 = `auth0|${randomUUID()}`;
    const actorBAuth0 = `auth0|${randomUUID()}`;
    const actorAEmail = `rls-a-${randomUUID()}@example.test`;
    const actorBEmail = `rls-b-${randomUUID()}@example.test`;

    try {
      await client.query('BEGIN');

      await client.query('SET LOCAL app.current_tenant_id = $1', [tenantA]);
      const insertA = await client.query(
        `INSERT INTO actors (tenant_id, auth0_user_id, email, first_name, last_name)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [tenantA, actorAAuth0, actorAEmail, 'Rls', 'TenantA']
      );

      await client.query('SET LOCAL app.current_tenant_id = $1', [tenantB]);
      const insertB = await client.query(
        `INSERT INTO actors (tenant_id, auth0_user_id, email, first_name, last_name)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [tenantB, actorBAuth0, actorBEmail, 'Rls', 'TenantB']
      );

      const actorAId = insertA.rows[0]?.id;
      const actorBId = insertB.rows[0]?.id;

      await client.query('SET LOCAL app.current_tenant_id = $1', [tenantA]);
      const crossTenantRead = await client.query('SELECT id FROM actors WHERE id = $1', [actorBId]);
      expect(crossTenantRead.rows.length).toBe(0);

      await client.query('SET LOCAL app.current_tenant_id = $1', [tenantB]);
      const sameTenantRead = await client.query('SELECT id FROM actors WHERE id = $1', [actorBId]);
      expect(sameTenantRead.rows.length).toBe(1);
      expect(sameTenantRead.rows[0].id).toBe(actorBId);

      await client.query('SET LOCAL app.current_tenant_id = $1', [tenantA]);
      const sameTenantReadA = await client.query('SELECT id FROM actors WHERE id = $1', [actorAId]);
      expect(sameTenantReadA.rows.length).toBe(1);
      expect(sameTenantReadA.rows[0].id).toBe(actorAId);
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await pool.end();
    }
  });
});
