#!/usr/bin/env node

/**
 * Database Migration Runner
 * Applies SQL migrations to PostgreSQL database, tracking applied migrations
 * in a schema_migrations table so that re-runs are safe and idempotent.
 *
 * Usage:
 *   pnpm --filter @trulyimagined/database migrate
 *
 * First-time run against an already-initialised database (baseline):
 *   pnpm --filter @trulyimagined/database migrate -- --baseline=019
 *   This marks all migrations with a numeric prefix <= 019 as already applied
 *   without executing them, then runs any migrations > 019 normally.
 */

import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import dotenv from 'dotenv';

const TRACKING_TABLE = 'schema_migrations';
const repoRoot = path.resolve(__dirname, '../../..');
// Load env files in both common locations used by this monorepo.
dotenv.config({ path: path.join(repoRoot, '.env.local') });
dotenv.config({ path: path.join(repoRoot, 'apps', 'web', '.env.local') });

const HDICR_DOMAIN = 'hdicr';
const TI_DOMAIN = 'ti';

const HDICR_MIGRATION_ORDER = [
  '001_initial_schema.sql',
  '002_user_profiles.sql',
  '003_link_actors_to_user_profiles.sql',
  '004_identity_links.sql',
  '006_verifiable_credentials.sql',
  '007_bitstring_status_lists.sql',
  '008_consent_ledger_licenses.sql',
  '016_tenant_isolation.sql',
  '017_rls_policies.sql',
  '018_neutral_schema_aliases.sql',
  '019_manual_verification_sessions.sql',
  '020_guardrails_foundation.sql',
  '021_guardrails_immutability_and_audit.sql',
  '022_guardrails_data_flow_contracts.sql',
  '025_hdicr_tenant_completion.sql',
  '026_hdicr_soft_delete_admin_views.sql',
  '027_hdicr_outbox_sync_events.sql',
  '028_hdicr_drop_ti_domain_tables.sql',
];

const TI_MIGRATION_ORDER = [
  '0_ti_initial_extensions.sql',
  '002_user_profiles.sql',
  '005_actor_media.sql',
  '009_support_tickets.sql',
  '010_user_feedback.sql',
  '011_feedback_support_linkage.sql',
  '012_user_profile_status_flags.sql',
  '013_agents.sql',
  '014_representation.sql',
  '015_agency_team_members.sql',
  '023_representation_terminations.sql',
  '024_agent_invitation_codes.sql',
  '029_ti_tenant_completion.sql',
  '030_ti_hdicr_ref_schema.sql',
  '031_ti_remove_cross_db_fks_add_validators.sql',
  '032_ti_soft_delete_admin_views.sql',
  '033_ti_rls_policies.sql',
  '034_ti_actor_media_tenant_backfill.sql',
];

type MigrationDb = {
  query: <T = any>(text: string, params?: any[]) => Promise<{ rows: T[] }>;
  close: () => Promise<void>;
};

/**
 * Parse --baseline=NNN from argv.
 * Returns the numeric string (zero-padded) or null if not supplied.
 */
function parseBaseline(): string | null {
  const arg = process.argv.find((a) => a.startsWith('--baseline='));
  if (!arg) return null;
  return arg.split('=')[1].padStart(3, '0');
}

/** Parse --domain=hdicr|ti from argv. Defaults to null (all SQL files sorted). */
function parseDomain(): string | null {
  const arg = process.argv.find((a) => a.startsWith('--domain='));
  if (!arg) return null;
  const domain = arg.split('=')[1].toLowerCase();

  if (domain !== HDICR_DOMAIN && domain !== TI_DOMAIN) {
    throw new Error(
      `Invalid --domain value: ${domain}. Use --domain=${HDICR_DOMAIN} or --domain=${TI_DOMAIN}`
    );
  }

  return domain;
}

/** Pick target DB URL by migration domain and map into DATABASE_URL for DatabaseClient. */
function configureConnectionForDomain(domain: string | null): void {
  if (domain === HDICR_DOMAIN) {
    if (!process.env.HDICR_DATABASE_URL) {
      throw new Error('HDICR_DATABASE_URL environment variable is not set');
    }
    process.env.DATABASE_URL = process.env.HDICR_DATABASE_URL;
    return;
  }

  if (domain === TI_DOMAIN) {
    if (!process.env.TI_DATABASE_URL) {
      throw new Error('TI_DATABASE_URL environment variable is not set');
    }
    process.env.DATABASE_URL = process.env.TI_DATABASE_URL;
    return;
  }
}

function getMigrationOrderByDomain(domain: string | null, files: string[]): string[] {
  if (domain === HDICR_DOMAIN) {
    return validateMigrationOrder(HDICR_MIGRATION_ORDER, files, HDICR_DOMAIN);
  }

  if (domain === TI_DOMAIN) {
    return validateMigrationOrder(TI_MIGRATION_ORDER, files, TI_DOMAIN);
  }

  return files;
}

function validateMigrationOrder(
  order: string[],
  existingFiles: string[],
  domain: string
): string[] {
  const missing = order.filter((file) => !existingFiles.includes(file));
  if (missing.length > 0) {
    throw new Error(
      `[MIGRATION] ${domain.toUpperCase()} migration order references missing file(s): ${missing.join(', ')}`
    );
  }

  return order;
}

/** SHA-256 checksum of a file's contents, for drift detection. */
function checksum(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/** Extract the leading numeric prefix from a migration filename, e.g. "019" from "019_foo.sql". */
function migrationNumber(filename: string): string {
  return filename.split('_')[0].padStart(3, '0');
}

async function ensureTrackingTable(db: MigrationDb): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS ${TRACKING_TABLE} (
      id          SERIAL PRIMARY KEY,
      filename    VARCHAR(255) UNIQUE NOT NULL,
      checksum    VARCHAR(64),
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getApplied(db: MigrationDb): Promise<Set<string>> {
  const { rows } = await db.query<{ filename: string }>(
    `SELECT filename FROM ${TRACKING_TABLE} ORDER BY filename`
  );
  return new Set(rows.map((r) => r.filename));
}

async function recordApplied(db: MigrationDb, filename: string, sql: string): Promise<void> {
  await db.query(
    `INSERT INTO ${TRACKING_TABLE} (filename, checksum) VALUES ($1, $2) ON CONFLICT (filename) DO NOTHING`,
    [filename, checksum(sql)]
  );
}

async function runMigrations() {
  console.log('[MIGRATION] Starting database migrations...\n');
  const domain = parseDomain();
  configureConnectionForDomain(domain);
  // Important: import the DB client only after DATABASE_URL has been finalized.
  // client.ts exports an eagerly initialized singleton that would otherwise lock
  // onto a stale URL before --domain remapping is applied.
  const { DatabaseClient } = await import('./client');
  const db = DatabaseClient.getInstance() as MigrationDb;
  const migrationsDir = path.join(__dirname, '../migrations');

  try {
    if (!fs.existsSync(migrationsDir)) {
      console.error(`[MIGRATION] Migrations directory not found: ${migrationsDir}`);
      process.exit(1);
    }

    const allSqlFiles = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    if (allSqlFiles.length === 0) {
      console.log('[MIGRATION] No migration files found.');
      await db.close();
      process.exit(0);
    }

    const files = getMigrationOrderByDomain(domain, allSqlFiles);

    if (domain) {
      console.log(
        `[MIGRATION] Domain mode: ${domain.toUpperCase()} (${files.length} migration(s) in locked order)\n`
      );
    }

    // Bootstrap tracking table
    await ensureTrackingTable(db);

    const applied = await getApplied(db);

    // --baseline: seed tracking table without running those migrations
    const baseline = parseBaseline();
    if (baseline !== null) {
      console.log(`[MIGRATION] Baseline mode: marking migrations <= ${baseline} as applied\n`);
      for (const file of files) {
        if (migrationNumber(file) <= baseline && !applied.has(file)) {
          const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
          await recordApplied(db, file, sql);
          console.log(`[MIGRATION] Baselined (skipped): ${file}`);
          applied.add(file);
        }
      }
      console.log('');
    }

    const pending = files.filter((f) => !applied.has(f));

    if (pending.length === 0) {
      console.log('[MIGRATION] Database is up to date. No pending migrations.');
      await db.close();
      process.exit(0);
    }

    console.log(`[MIGRATION] ${pending.length} pending migration(s):\n`);

    for (const file of pending) {
      console.log(`[MIGRATION] Running: ${file}`);
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf-8');

      try {
        await db.query(sql);
        await recordApplied(db, file, sql);
        console.log(`[MIGRATION] ✓ ${file} applied successfully\n`);
      } catch (error: any) {
        console.error(`[MIGRATION] ✗ ${file} failed:`);
        console.error(error.message);
        console.error(
          '\nStopping migrations due to error. Already-completed migrations were recorded.'
        );
        await db.close();
        process.exit(1);
      }
    }

    console.log('[MIGRATION] All migrations completed successfully!');
    await db.close();
    process.exit(0);
  } catch (error: any) {
    console.error('[MIGRATION] Fatal error:', error.message);
    await db.close();
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  runMigrations();
}

export { runMigrations };
