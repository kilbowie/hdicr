/**
 * Check if consent ledger tables exist
 */
import { Pool } from 'pg';
import { join } from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: join(__dirname, '../../../.env.local') });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

async function checkTables() {
  try {
    const result = await pool.query(`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname = 'public' 
        AND tablename IN ('consent_ledger', 'licenses', 'api_clients', 'license_usage_log')
      ORDER BY tablename
    `);

    console.log('\n📊 Existing Consent Ledger Tables:\n');
    if (result.rows.length === 0) {
      console.log('   (none found)');
    } else {
      result.rows.forEach((row) => {
        console.log(`   ✓ ${row.tablename}`);
      });
    }
    console.log('');

    // Check indexes
    const indexResult = await pool.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname LIKE '%consent%' OR indexname LIKE '%license%' OR indexname LIKE '%api_client%'
      ORDER BY indexname
    `);

    console.log('📑 Existing Related Indexes:\n');
    if (indexResult.rows.length === 0) {
      console.log('   (none found)');
    } else {
      indexResult.rows.forEach((row) => {
        console.log(`   • ${row.indexname}`);
      });
    }
    console.log('');

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

checkTables();
