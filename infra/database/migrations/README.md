# HDICR migrations — ownership & conventions

This directory is the **authoritative source for `TABLE OWNER: HDICR` migrations**. Each file's header tags its owner (`-- TABLE OWNER: HDICR` or `-- TABLE OWNER: TI`). HDICR-owned tables (actors, user_profiles, identity_links, verifiable_credentials, consent_ledger, licenses, agents, representation, the `sync_events` outbox, etc.) are defined and evolved here.

## Runner
`../src/migrate.ts` applies migrations, tracking applied files **by filename** (with a SHA-256 checksum) in a `schema_migrations` table — re-runs are idempotent. Run the HDICR domain set in its locked order:

```
pnpm --filter @trulyimagined/database migrate -- --domain=hdicr
```

`--domain=hdicr` requires `HDICR_DATABASE_URL` and uses the `HDICR_MIGRATION_ORDER` array in `migrate.ts`. Keep that array in sync when adding an HDICR migration.

## Conventions
- Filename: `NNN_description.sql` with a **unique numeric ordinal** across this directory. CI enforces uniqueness via `scripts/check-migrations.mjs` — this prevents the ordering ambiguity that a duplicate ordinal would cause.
- Migrations must be idempotent where practical (`IF NOT EXISTS`, `CREATE OR REPLACE`) since they may run against an already-provisioned database.
- No cross-DB foreign keys to TI-owned tables (see `031` in the TI repo). HDICR ⇄ TI is bridged only by the `sync_events` outbox → TI's `hdicr_ref` read-model.

## Cross-repo note: ordinal 035
The TI repo independently uses `035_ti_stripe_accounts.sql` for a TI-owned table, while this repo uses `035_fix_sync_event_null_version.sql` (an HDICR-owned outbox trigger fix). These are **different files with the same ordinal in different repos** — not an in-repo collision. It is **deliberately not renumbered**: the file is already applied in production and the runner tracks by filename, so renumbering would orphan its `schema_migrations` record and re-execute it. Each repo runs only its own domain-locked order, so there is no runtime conflict. When the databases are physically separated (plan P1c), each repo owns its own migration history outright and this note becomes moot.

## Relationship to the TI repo
Until P1c (physical DB separation), the TI repo carries a superset of migrations (it holds the full TI product schema plus copies of the HDICR-owned files it historically depended on). This directory is the canonical home for HDICR-owned migrations; TI's copies of HDICR-owned files should be treated as read-only mirrors and eventually reduced to just the `hdicr_ref` read-model.
