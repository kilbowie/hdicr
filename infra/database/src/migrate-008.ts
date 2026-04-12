/**
 * Migration 008: Consent Ledger + Licensing System
 *
 * Run: pnpm exec ts-node infra/database/src/migrate-008.ts
 *
 * This migration creates:
 * - consent_ledger table (versioned, immutable consent policies)
 * - licenses table (license grants with permission snapshots)
 * - api_clients table (external API consumers)
 * - license_usage_log table (audit trail)
 */

import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: join(__dirname, '../../../.env.local') });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

async function migrate() {
  console.log('\n🔄 Running Migration 008: Consent Ledger + Licensing System\n');

  try {
    // Read SQL file
    const sqlPath = join(__dirname, '../migrations/008_consent_ledger_licenses.sql');
    const sql = readFileSync(sqlPath, 'utf-8');

    // Execute migration in a transaction
    console.log('📝 Executing SQL migration...');
    await pool.query('BEGIN');

    await pool.query(sql);

    await pool.query('COMMIT');

    console.log('✅ Migration 008 completed successfully!');
    console.log();
    console.log('Created tables:');
    console.log('  • api_clients');
    console.log('  • consent_ledger');
    console.log('  • licenses');
    console.log('  • license_usage_log');
    console.log();
    console.log('Created functions:');
    console.log('  • get_latest_consent(actor_id)');
    console.log('  • get_next_consent_version(actor_id)');
    console.log();

    process.exit(0);
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('❌ Migration failed:', error);
    console.error(error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
