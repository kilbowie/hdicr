-- TABLE OWNER: HDICR
-- Migration 025: Complete tenant_id coverage for HDICR tables
-- Date: 2026-04-11
-- Purpose: Add tenant_id to HDICR-owned tables not covered by migration 016.
--          All columns default to 'trulyimagined' so existing rows are backfilled
--          without manual data patching.

-- ===========================================
-- ADD TENANT_ID COLUMNS (idempotent)
-- ===========================================
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(100) NOT NULL DEFAULT 'trulyimagined';

ALTER TABLE consent_ledger
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(100) NOT NULL DEFAULT 'trulyimagined';

ALTER TABLE api_clients
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(100) NOT NULL DEFAULT 'trulyimagined';

ALTER TABLE licenses
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(100) NOT NULL DEFAULT 'trulyimagined';

ALTER TABLE license_usage_log
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(100) NOT NULL DEFAULT 'trulyimagined';

ALTER TABLE bitstring_status_lists
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(100) NOT NULL DEFAULT 'trulyimagined';

ALTER TABLE credential_status_entries
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(100) NOT NULL DEFAULT 'trulyimagined';

-- manual_verification_sessions already has tenant_id from migration 019.
-- Guard this block in case 019 has not been applied in an existing environment.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'manual_verification_sessions'
  ) THEN
    ALTER TABLE manual_verification_sessions
      ALTER COLUMN tenant_id SET NOT NULL,
      ALTER COLUMN tenant_id SET DEFAULT 'trulyimagined';
  END IF;
END $$;

-- ===========================================
-- TENANT-SCOPED INDEXES
-- ===========================================

-- user_profiles
CREATE INDEX IF NOT EXISTS idx_user_profiles_tenant_id
  ON user_profiles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_tenant_auth0_user_id
  ON user_profiles(tenant_id, auth0_user_id);

-- consent_ledger
CREATE INDEX IF NOT EXISTS idx_consent_ledger_tenant_id
  ON consent_ledger(tenant_id);
CREATE INDEX IF NOT EXISTS idx_consent_ledger_tenant_actor_version
  ON consent_ledger(tenant_id, actor_id, version DESC);

-- api_clients
CREATE INDEX IF NOT EXISTS idx_api_clients_tenant_id
  ON api_clients(tenant_id);
CREATE INDEX IF NOT EXISTS idx_api_clients_tenant_status
  ON api_clients(tenant_id, credential_status) WHERE deleted_at IS NULL;

-- licenses
CREATE INDEX IF NOT EXISTS idx_licenses_tenant_id
  ON licenses(tenant_id);
CREATE INDEX IF NOT EXISTS idx_licenses_tenant_actor_status
  ON licenses(tenant_id, actor_id, status);

-- license_usage_log
CREATE INDEX IF NOT EXISTS idx_license_usage_log_tenant_id
  ON license_usage_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_license_usage_log_tenant_actor_created_at
  ON license_usage_log(tenant_id, actor_id, created_at DESC);

-- bitstring_status_lists
CREATE INDEX IF NOT EXISTS idx_bitstring_status_lists_tenant_id
  ON bitstring_status_lists(tenant_id);
CREATE INDEX IF NOT EXISTS idx_bitstring_status_lists_tenant_purpose
  ON bitstring_status_lists(tenant_id, status_purpose);

-- credential_status_entries
CREATE INDEX IF NOT EXISTS idx_credential_status_entries_tenant_id
  ON credential_status_entries(tenant_id);
CREATE INDEX IF NOT EXISTS idx_credential_status_entries_tenant_credential
  ON credential_status_entries(tenant_id, credential_id);

-- manual_verification_sessions composite (already has single-column index)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'manual_verification_sessions'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_manual_verification_sessions_tenant_status
      ON manual_verification_sessions(tenant_id, status) WHERE deleted_at IS NULL;
  END IF;
END $$;

-- ===========================================
-- COLUMN DOCUMENTATION
-- ===========================================
COMMENT ON COLUMN user_profiles.tenant_id IS 'Tenant identifier owning this user profile';
COMMENT ON COLUMN consent_ledger.tenant_id IS 'Tenant identifier owning this immutable consent ledger entry';
COMMENT ON COLUMN api_clients.tenant_id IS 'Tenant identifier owning this API client registration';
COMMENT ON COLUMN licenses.tenant_id IS 'Tenant identifier owning this license grant';
COMMENT ON COLUMN license_usage_log.tenant_id IS 'Tenant identifier for this license usage event';
COMMENT ON COLUMN bitstring_status_lists.tenant_id IS 'Tenant identifier owning this bitstring status list';
COMMENT ON COLUMN credential_status_entries.tenant_id IS 'Tenant identifier for this credential status entry';
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'manual_verification_sessions'
  ) THEN
    COMMENT ON COLUMN manual_verification_sessions.tenant_id IS 'Tenant identifier owning this verification session';
  END IF;
END $$;
