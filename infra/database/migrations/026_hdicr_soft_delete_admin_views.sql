-- TABLE OWNER: HDICR
-- Migration 026: HDICR admin audit views (soft-delete visibility)
-- Date: 2026-04-11
-- Purpose: Create hdicr_admin schema with views that include soft-deleted rows
--          so admin queries can audit full record lifecycle without bypassing RLS.

-- ===========================================
-- ADMIN SCHEMA
-- ===========================================
CREATE SCHEMA IF NOT EXISTS hdicr_admin;

COMMENT ON SCHEMA hdicr_admin IS 'Admin-only views of HDICR tables including soft-deleted records';

-- ===========================================
-- ADMIN VIEWS (resilient to schema drift)
-- ===========================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user_profiles') THEN
    EXECUTE 'CREATE OR REPLACE VIEW hdicr_admin.v_user_profiles_all AS SELECT * FROM public.user_profiles';
    EXECUTE 'COMMENT ON VIEW hdicr_admin.v_user_profiles_all IS ''All user profiles (including historical records where applicable); admin use only''';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'actors') THEN
    EXECUTE 'CREATE OR REPLACE VIEW hdicr_admin.v_actors_all AS SELECT * FROM public.actors';
    EXECUTE 'COMMENT ON VIEW hdicr_admin.v_actors_all IS ''All actors including soft-deleted where present; admin use only''';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'identity_links') THEN
    EXECUTE 'CREATE OR REPLACE VIEW hdicr_admin.v_identity_links_all AS SELECT * FROM public.identity_links';
    EXECUTE 'COMMENT ON VIEW hdicr_admin.v_identity_links_all IS ''All identity links (active/inactive); admin use only''';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'verifiable_credentials') THEN
    EXECUTE 'CREATE OR REPLACE VIEW hdicr_admin.v_verifiable_credentials_all AS SELECT * FROM public.verifiable_credentials';
    EXECUTE 'COMMENT ON VIEW hdicr_admin.v_verifiable_credentials_all IS ''All verifiable credentials including revoked; admin use only''';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'consent_ledger') THEN
    EXECUTE 'CREATE OR REPLACE VIEW hdicr_admin.v_consent_ledger_all AS SELECT * FROM public.consent_ledger';
    EXECUTE 'COMMENT ON VIEW hdicr_admin.v_consent_ledger_all IS ''Full consent ledger (append-only); admin use only''';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'licenses') THEN
    EXECUTE 'CREATE OR REPLACE VIEW hdicr_admin.v_licenses_all AS SELECT * FROM public.licenses';
    EXECUTE 'COMMENT ON VIEW hdicr_admin.v_licenses_all IS ''All licenses including revoked/expired; admin use only''';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'manual_verification_sessions') THEN
    EXECUTE 'CREATE OR REPLACE VIEW hdicr_admin.v_manual_verification_sessions_all AS SELECT * FROM public.manual_verification_sessions';
    EXECUTE 'COMMENT ON VIEW hdicr_admin.v_manual_verification_sessions_all IS ''All verification sessions including soft-deleted where present; admin use only''';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'audit_log') THEN
    EXECUTE 'CREATE OR REPLACE VIEW hdicr_admin.v_audit_log_all AS SELECT * FROM public.audit_log';
    EXECUTE 'COMMENT ON VIEW hdicr_admin.v_audit_log_all IS ''Full audit log (immutable, no deletes); admin use only''';
  END IF;
END $$;

-- ===========================================
-- GRANT ACCESS TO ADMIN ROLE
-- The hdicr_admin role is created by migration 020 (guardrails).
-- Use DO block for idempotency in case role was not created yet.
-- ===========================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hdicr_admin') THEN
    GRANT USAGE ON SCHEMA hdicr_admin TO hdicr_admin;
    GRANT SELECT ON ALL TABLES IN SCHEMA hdicr_admin TO hdicr_admin;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hdicr_owner') THEN
    GRANT USAGE ON SCHEMA hdicr_admin TO hdicr_owner;
    GRANT SELECT ON ALL TABLES IN SCHEMA hdicr_admin TO hdicr_owner;
  END IF;
END $$;
