#!/usr/bin/env node

/**
 * Single Migration Runner - Run only migration 005: Actor Media
 */

import { DatabaseClient } from './client';
import fs from 'fs';
import path from 'path';

async function runMigration005() {
  console.log('[MIGRATION] Running migration 005_actor_media.sql...\n');

  const db = DatabaseClient.getInstance();
  const migrationFile = path.join(__dirname, '../migrations/005_actor_media.sql');

  try {
    // Check if migration file exists
    if (!fs.existsSync(migrationFile)) {
      console.error(`[MIGRATION] Migration file not found: ${migrationFile}`);
      process.exit(1);
    }

    // Read and execute migration
    const sql = fs.readFileSync(migrationFile, 'utf-8');

    console.log('[MIGRATION] Executing SQL...');
    await db.query(sql);
    console.log('[MIGRATION] ✓ Migration completed successfully!\n');

    await db.close();
    process.exit(0);
  } catch (error: any) {
    console.error('[MIGRATION] ✗ Migration failed:');
    console.error(error.message);
    console.error('\nFull error:', error);
    await db.close();
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  runMigration005();
}

export { runMigration005 };
