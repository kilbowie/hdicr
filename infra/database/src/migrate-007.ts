/**
 * Run Database Migration 007: Bitstring Status Lists
 *
 * This script creates the bitstringstatuslist infrastructure for W3C credential revocation.
 *
 * Usage:
 *   pnpm tsx infra/database/src/migrate-007.ts
 */

import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../../../.env.local') });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

async function runMigration() {
  console.log('🚀 Starting Migration 007: Bitstring Status Lists...\n');

  try {
    // Read migration file
    const migrationPath = path.join(__dirname, '../migrations/007_bitstring_status_lists.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf-8');

    console.log('📄 Executing SQL migration...');

    // Execute migration
    await pool.query(migrationSQL);

    console.log('✅ Migration 007 completed successfully!\n');

    // Verify tables were created
    console.log('🔍 Verifying tables...');

    const tables = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name IN ('bitstring_status_lists', 'credential_status_entries')
      ORDER BY table_name
    `);

    console.log(`\n✅ Created tables:`);
    tables.rows.forEach((row) => {
      console.log(`   - ${row.table_name}`);
    });

    // Check for credential_id column
    const credentialIdColumn = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'verifiable_credentials' 
        AND column_name = 'credential_id'
    `);

    if (credentialIdColumn.rows.length > 0) {
      console.log('\n✅ Added credential_id column to verifiable_credentials table');
    }

    console.log('\n🎉 Migration 006 complete! Bitstring Status Lists are ready.');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

runMigration();
