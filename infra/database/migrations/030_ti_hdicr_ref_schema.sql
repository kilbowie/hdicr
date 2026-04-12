-- TABLE OWNER: TI
-- Migration 030: TI local hdicr_ref read-model schema
-- Date: 2026-04-11
-- Purpose: Create hdicr_ref schema in the TI database containing lightweight
--          read-model copies of HDICR entities. These replace hard cross-database
--          foreign keys and are populated by the outbox sync worker reading
--          HDICR sync_events (migration 027).
--
-- Design notes:
--   - source_id = the primary key in the HDICR database.
--   - source_version = EPOCH of the HDICR updated_at, used to reject stale writes.
--   - synced_at = when this replica was last refreshed by the sync worker.
--   - deleted_at = soft-delete mirror from HDICR; TI validators treat this as non-existent.
--   - sync workers UPSERT on source_id with source_version optimistic locking.

-- ===========================================
-- SCHEMA
-- ===========================================
CREATE SCHEMA IF NOT EXISTS hdicr_ref;

COMMENT ON SCHEMA hdicr_ref IS 'TI-local read-model replicas sourced from HDICR via outbox sync. Do not write directly.';

-- ===========================================
-- hdicr_ref.user_profiles
-- ===========================================
CREATE TABLE IF NOT EXISTS hdicr_ref.user_profiles (
  source_id        UUID          PRIMARY KEY,
  tenant_id        VARCHAR(100)  NOT NULL,
  auth0_user_id    VARCHAR(255)  NOT NULL,
  email            VARCHAR(255),
  display_name     VARCHAR(255),
  source_version   BIGINT        NOT NULL DEFAULT 0,
  synced_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  deleted_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_hdicr_ref_user_profiles_tenant
  ON hdicr_ref.user_profiles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_hdicr_ref_user_profiles_auth0
  ON hdicr_ref.user_profiles(auth0_user_id);
CREATE INDEX IF NOT EXISTS idx_hdicr_ref_user_profiles_active
  ON hdicr_ref.user_profiles(tenant_id, source_id) WHERE deleted_at IS NULL;

COMMENT ON TABLE hdicr_ref.user_profiles IS 'Read-model replica of HDICR user_profiles. Synced via outbox; do not write.';

-- ===========================================
-- hdicr_ref.actors
-- ===========================================
CREATE TABLE IF NOT EXISTS hdicr_ref.actors (
  source_id         UUID          PRIMARY KEY,
  tenant_id         VARCHAR(100)  NOT NULL,
  user_profile_id   UUID,            -- mirrors HDICR actors.user_profile_id
  auth0_user_id     VARCHAR(255)  NOT NULL,
  registry_id       VARCHAR(100),
  display_name      VARCHAR(255),
  verification_status VARCHAR(50),
  source_version    BIGINT        NOT NULL DEFAULT 0,
  synced_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_hdicr_ref_actors_tenant
  ON hdicr_ref.actors(tenant_id);
CREATE INDEX IF NOT EXISTS idx_hdicr_ref_actors_auth0
  ON hdicr_ref.actors(auth0_user_id);
CREATE INDEX IF NOT EXISTS idx_hdicr_ref_actors_user_profile
  ON hdicr_ref.actors(user_profile_id) WHERE user_profile_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hdicr_ref_actors_active
  ON hdicr_ref.actors(tenant_id, source_id) WHERE deleted_at IS NULL;

COMMENT ON TABLE hdicr_ref.actors IS 'Read-model replica of HDICR actors. Synced via outbox; do not write.';

-- ===========================================
-- hdicr_ref.licenses
-- ===========================================
CREATE TABLE IF NOT EXISTS hdicr_ref.licenses (
  source_id       UUID          PRIMARY KEY,
  tenant_id       VARCHAR(100)  NOT NULL,
  actor_id        UUID          NOT NULL,   -- refers to hdicr_ref.actors.source_id
  status          VARCHAR(50),
  license_type    VARCHAR(100),
  expires_at      TIMESTAMPTZ,
  source_version  BIGINT        NOT NULL DEFAULT 0,
  synced_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_hdicr_ref_licenses_tenant
  ON hdicr_ref.licenses(tenant_id);
CREATE INDEX IF NOT EXISTS idx_hdicr_ref_licenses_actor
  ON hdicr_ref.licenses(actor_id);
CREATE INDEX IF NOT EXISTS idx_hdicr_ref_licenses_active
  ON hdicr_ref.licenses(tenant_id, actor_id, status) WHERE deleted_at IS NULL;

COMMENT ON TABLE hdicr_ref.licenses IS 'Read-model replica of HDICR licenses. Synced via outbox; do not write.';

-- ===========================================
-- hdicr_ref.consent_ledger_active
-- Active (non-withdrawn) consent entries only.
-- ===========================================
CREATE TABLE IF NOT EXISTS hdicr_ref.consent_ledger_active (
  source_id       UUID          PRIMARY KEY,
  tenant_id       VARCHAR(100)  NOT NULL,
  actor_id        UUID          NOT NULL,   -- refers to hdicr_ref.actors.source_id
  consent_type    TEXT          NOT NULL,
  version         BIGINT        NOT NULL DEFAULT 1,
  granted_at      TIMESTAMPTZ,
  source_version  BIGINT        NOT NULL DEFAULT 0,
  synced_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ    -- set when consent withdrawn
);

CREATE INDEX IF NOT EXISTS idx_hdicr_ref_consent_ledger_active_tenant
  ON hdicr_ref.consent_ledger_active(tenant_id);
CREATE INDEX IF NOT EXISTS idx_hdicr_ref_consent_ledger_active_actor_type
  ON hdicr_ref.consent_ledger_active(actor_id, consent_type) WHERE deleted_at IS NULL;

COMMENT ON TABLE hdicr_ref.consent_ledger_active IS 'Read-model replica of active HDICR consent entries. Synced via outbox; do not write.';

-- ===========================================
-- GRANT ACCESS
-- The sync worker role (hdicr_sync_worker) must be able to write to hdicr_ref.
-- Application roles read only.
-- ===========================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hdicr_sync_worker') THEN
    GRANT USAGE ON SCHEMA hdicr_ref TO hdicr_sync_worker;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA hdicr_ref TO hdicr_sync_worker;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ti_app') THEN
    GRANT USAGE ON SCHEMA hdicr_ref TO ti_app;
    GRANT SELECT ON ALL TABLES IN SCHEMA hdicr_ref TO ti_app;
  END IF;
END $$;
