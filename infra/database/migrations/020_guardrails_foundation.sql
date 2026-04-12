-- TABLE OWNER: HDICR
-- Migration 020: Guardrails foundation (safe, non-breaking)
-- Date: 2026-04-10
-- Purpose:
--   1) Establish logical schemas for HDICR, HDICR_AUTH, and TI.
--   2) Create application roles used for least-privilege split credentials.
--   3) Define TI-readable HDICR contract views without moving existing tables.
--
-- Notes:
-- - This migration intentionally keeps existing tables in public schema to avoid
--   breaking current app queries.
-- - Role creation is idempotent and uses NOLOGIN by default. Login/password setup
--   should be completed via secure DBA workflow.

BEGIN;

-- ===========================================
-- 1) LOGICAL SCHEMA BOUNDARIES
-- ===========================================
CREATE SCHEMA IF NOT EXISTS hdicr;
CREATE SCHEMA IF NOT EXISTS hdicr_auth;
CREATE SCHEMA IF NOT EXISTS ti;

COMMENT ON SCHEMA hdicr IS 'HDICR logical boundary: identity and consent domain contracts';
COMMENT ON SCHEMA hdicr_auth IS 'HDICR auth boundary: role/user profile contracts';
COMMENT ON SCHEMA ti IS 'TI commercial boundary: marketplace and payments domain contracts';

-- ===========================================
-- 2) APPLICATION ROLES (NOLOGIN FOR SAFE BOOTSTRAP)
-- ===========================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hdicr_app') THEN
    CREATE ROLE hdicr_app NOLOGIN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ti_app') THEN
    CREATE ROLE ti_app NOLOGIN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'db_admin') THEN
    CREATE ROLE db_admin NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA hdicr TO ti_app, hdicr_app, db_admin;
GRANT USAGE ON SCHEMA hdicr_auth TO ti_app, hdicr_app, db_admin;
GRANT USAGE ON SCHEMA ti TO ti_app, hdicr_app, db_admin;

-- ===========================================
-- 3) TI-READABLE CONTRACT VIEWS OVER HDICR DATA
-- ===========================================
-- Actor identity contract (minimal fields for TI workflows).
DO $$
DECLARE
  has_actor_tenant BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'actors'
      AND column_name = 'tenant_id'
  ) INTO has_actor_tenant;

  IF has_actor_tenant THEN
    EXECUTE $sql$
      CREATE OR REPLACE VIEW hdicr.v_actors_for_ti AS
      SELECT
        a.id,
        a.registry_id,
        a.stage_name,
        a.verification_status,
        a.created_at,
        a.tenant_id
      FROM public.actors a
      WHERE a.deleted_at IS NULL
    $sql$;
  ELSE
    EXECUTE $sql$
      CREATE OR REPLACE VIEW hdicr.v_actors_for_ti AS
      SELECT
        a.id,
        a.registry_id,
        a.stage_name,
        a.verification_status,
        a.created_at,
        'trulyimagined'::VARCHAR(100) AS tenant_id
      FROM public.actors a
      WHERE a.deleted_at IS NULL
    $sql$;
  END IF;
END $$;

COMMENT ON VIEW hdicr.v_actors_for_ti IS
  'Contract view for TI to read actor identity status without owning actor records.';

-- Active consent contract for TI consent validation.
DO $$
DECLARE
  has_actor_tenant BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'actors'
      AND column_name = 'tenant_id'
  ) INTO has_actor_tenant;

  IF has_actor_tenant THEN
    EXECUTE $sql$
      CREATE OR REPLACE VIEW hdicr.v_active_consent_for_ti AS
      SELECT
        cl.id,
        cl.actor_id,
        cl.version,
        cl.policy,
        cl.status,
        cl.created_at,
        a.tenant_id
      FROM public.consent_ledger cl
      JOIN public.actors a ON a.id = cl.actor_id
      WHERE cl.status = 'active'
        AND a.deleted_at IS NULL
    $sql$;
  ELSE
    EXECUTE $sql$
      CREATE OR REPLACE VIEW hdicr.v_active_consent_for_ti AS
      SELECT
        cl.id,
        cl.actor_id,
        cl.version,
        cl.policy,
        cl.status,
        cl.created_at,
        'trulyimagined'::VARCHAR(100) AS tenant_id
      FROM public.consent_ledger cl
      JOIN public.actors a ON a.id = cl.actor_id
      WHERE cl.status = 'active'
        AND a.deleted_at IS NULL
    $sql$;
  END IF;
END $$;

COMMENT ON VIEW hdicr.v_active_consent_for_ti IS
  'Contract view for TI consent checks against active policy entries.';

-- Verification contract derived from identity links.
DO $$
DECLARE
  has_identity_tenant BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'identity_links'
      AND column_name = 'tenant_id'
  ) INTO has_identity_tenant;

  IF has_identity_tenant THEN
    EXECUTE $sql$
      CREATE OR REPLACE VIEW hdicr.v_actor_verification_for_ti AS
      SELECT
        a.id AS actor_id,
        il.provider,
        il.provider_type,
        il.verification_level,
        il.assurance_level,
        il.verified_at,
        il.is_active,
        il.tenant_id
      FROM public.identity_links il
      JOIN public.user_profiles up ON up.id = il.user_profile_id
      JOIN public.actors a ON a.auth0_user_id = up.auth0_user_id
      WHERE il.is_active = TRUE
        AND a.deleted_at IS NULL
    $sql$;
  ELSE
    EXECUTE $sql$
      CREATE OR REPLACE VIEW hdicr.v_actor_verification_for_ti AS
      SELECT
        a.id AS actor_id,
        il.provider,
        il.provider_type,
        il.verification_level,
        il.assurance_level,
        il.verified_at,
        il.is_active,
        'trulyimagined'::VARCHAR(100) AS tenant_id
      FROM public.identity_links il
      JOIN public.user_profiles up ON up.id = il.user_profile_id
      JOIN public.actors a ON a.auth0_user_id = up.auth0_user_id
      WHERE il.is_active = TRUE
        AND a.deleted_at IS NULL
    $sql$;
  END IF;
END $$;

COMMENT ON VIEW hdicr.v_actor_verification_for_ti IS
  'Contract view for TI to read actor verification/provider linkage status.';

GRANT SELECT ON hdicr.v_actors_for_ti TO ti_app, db_admin;
GRANT SELECT ON hdicr.v_active_consent_for_ti TO ti_app, db_admin;
GRANT SELECT ON hdicr.v_actor_verification_for_ti TO ti_app, db_admin;

-- ===========================================
-- 4) QUERYABLE DATA FLOW DOCUMENTATION
-- ===========================================
CREATE OR REPLACE FUNCTION public.fn_data_flow_contracts()
RETURNS TABLE (
  from_plane TEXT,
  to_plane TEXT,
  operation TEXT,
  resource_name TEXT,
  is_allowed BOOLEAN,
  purpose TEXT
) AS $$
BEGIN
  RETURN QUERY VALUES
    ('HDICR', 'HDICR', 'READ/WRITE', 'public.actors', TRUE, 'Identity source of truth'),
    ('HDICR', 'HDICR', 'READ/WRITE', 'public.consent_ledger', TRUE, 'Consent source of truth'),
    ('TI', 'HDICR', 'READ', 'hdicr.v_actors_for_ti', TRUE, 'Resolve actor state for TI workflows'),
    ('TI', 'HDICR', 'READ', 'hdicr.v_active_consent_for_ti', TRUE, 'Validate consent before licensing'),
    ('TI', 'HDICR', 'READ', 'hdicr.v_actor_verification_for_ti', TRUE, 'Read provider verification status'),
    ('TI', 'HDICR', 'WRITE', 'public.actors/public.consent_ledger', FALSE, 'TI must not mutate HDICR records'),
    ('HDICR', 'TI', 'WRITE', 'ti.*', FALSE, 'HDICR must not mutate TI commercial records');
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION public.fn_data_flow_contracts() TO ti_app, hdicr_app, db_admin;

COMMIT;
