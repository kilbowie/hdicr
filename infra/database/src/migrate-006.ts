#!/usr/bin/env node

/**
 * Run Migration 006: Verifiable Credentials
 *
 * This script applies only migration 006, skipping earlier migrations
 * that have already been applied.
 */

import { DatabaseClient } from './client';
import fs from 'fs';
import path from 'path';

async function runMigration006() {
  console.log('[MIGRATION] Running migration 006: Verifiable Credentials...\n');

  const db = DatabaseClient.getInstance();
  const migrationPath = path.join(__dirname, '../migrations/006_verifiable_credentials.sql');

  try {
    // Check if migration file exists
    if (!fs.existsSync(migrationPath)) {
      console.error(`[MIGRATION] Migration file not found: ${migrationPath}`);
      process.exit(1);
    }

    // Read and execute migration
    const sql = fs.readFileSync(migrationPath, 'utf-8');
    await db.query(sql);

    console.log('[MIGRATION] ✓ Migration 006 completed successfully\n');
    process.exit(0);
  } catch (error: any) {
    console.error('[MIGRATION] ✗ Migration 006 failed:');
    console.error(error.message);
    process.exit(1);
  }
}

runMigration006();
