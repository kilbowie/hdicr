#!/usr/bin/env node
/**
 * Migration hygiene check (runs in CI, no database needed).
 *
 * Guards against the class of bug where two migrations share the same numeric
 * ordinal (e.g. the cross-repo `035_fix_sync_event_null_version` vs
 * `035_ti_stripe_accounts` collision). Within a single repo, each numeric prefix
 * must be unique, so the apply order is unambiguous regardless of owner.
 *
 * Also sanity-checks the filename convention `NNN_description.sql`.
 *
 * Exits non-zero on any violation.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, '../infra/database/migrations');

const files = fs
  .readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

const errors = [];

// 1. Filename convention: <digits>_<something>.sql
const badNames = files.filter((f) => !/^\d+_.+\.sql$/.test(f));
for (const f of badNames) {
  errors.push(`Filename does not match "NNN_description.sql": ${f}`);
}

// 2. Unique numeric ordinal per file (the collision guard).
const byNumber = new Map();
for (const f of files) {
  const num = String(parseInt(f.split('_')[0], 10)); // normalise "007" and "7"
  if (!byNumber.has(num)) byNumber.set(num, []);
  byNumber.get(num).push(f);
}
for (const [num, group] of byNumber) {
  if (group.length > 1) {
    errors.push(`Duplicate migration ordinal ${num}: ${group.join(', ')}`);
  }
}

if (errors.length > 0) {
  console.error(`[check-migrations] ${errors.length} problem(s) in ${migrationsDir}:`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}

console.log(`[check-migrations] OK — ${files.length} migrations, unique ordinals, valid names.`);
