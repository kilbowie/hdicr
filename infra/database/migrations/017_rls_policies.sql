-- TABLE OWNER: HDICR
-- Migration 017: Row-Level Security policies for tenant isolation
-- Date: 2026-04-08
-- Purpose: enforce tenant isolation at the PostgreSQL layer as a safety backstop.

-- ===========================================
-- ENABLE RLS ON HDICR TABLES
-- ===========================================
ALTER TABLE actors ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE verifiable_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE licensing_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE representation_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE actor_agent_relationships ENABLE ROW LEVEL SECURITY;

-- ===========================================
-- TENANT ISOLATION POLICIES
-- Uses app.current_tenant_id session setting from service handler context.
-- ===========================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'actors' AND policyname = 'actors_tenant_isolation'
  ) THEN
    EXECUTE 'CREATE POLICY actors_tenant_isolation ON actors
      FOR ALL
      USING (tenant_id = current_setting(''app.current_tenant_id'', true))
      WITH CHECK (tenant_id = current_setting(''app.current_tenant_id'', true))';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'consent_log' AND policyname = 'consent_log_tenant_isolation'
  ) THEN
    EXECUTE 'CREATE POLICY consent_log_tenant_isolation ON consent_log
      FOR ALL
      USING (tenant_id = current_setting(''app.current_tenant_id'', true))
      WITH CHECK (tenant_id = current_setting(''app.current_tenant_id'', true))';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'identity_links' AND policyname = 'identity_links_tenant_isolation'
  ) THEN
    EXECUTE 'CREATE POLICY identity_links_tenant_isolation ON identity_links
      FOR ALL
      USING (tenant_id = current_setting(''app.current_tenant_id'', true))
      WITH CHECK (tenant_id = current_setting(''app.current_tenant_id'', true))';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'verifiable_credentials' AND policyname = 'verifiable_credentials_tenant_isolation'
  ) THEN
    EXECUTE 'CREATE POLICY verifiable_credentials_tenant_isolation ON verifiable_credentials
      FOR ALL
      USING (tenant_id = current_setting(''app.current_tenant_id'', true))
      WITH CHECK (tenant_id = current_setting(''app.current_tenant_id'', true))';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'licensing_requests' AND policyname = 'licensing_requests_tenant_isolation'
  ) THEN
    EXECUTE 'CREATE POLICY licensing_requests_tenant_isolation ON licensing_requests
      FOR ALL
      USING (tenant_id = current_setting(''app.current_tenant_id'', true))
      WITH CHECK (tenant_id = current_setting(''app.current_tenant_id'', true))';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'usage_tracking' AND policyname = 'usage_tracking_tenant_isolation'
  ) THEN
    EXECUTE 'CREATE POLICY usage_tracking_tenant_isolation ON usage_tracking
      FOR ALL
      USING (tenant_id = current_setting(''app.current_tenant_id'', true))
      WITH CHECK (tenant_id = current_setting(''app.current_tenant_id'', true))';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'audit_log' AND policyname = 'audit_log_tenant_isolation'
  ) THEN
    EXECUTE 'CREATE POLICY audit_log_tenant_isolation ON audit_log
      FOR ALL
      USING (tenant_id = current_setting(''app.current_tenant_id'', true))
      WITH CHECK (tenant_id = current_setting(''app.current_tenant_id'', true))';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'representation_requests' AND policyname = 'representation_requests_tenant_isolation'
  ) THEN
    EXECUTE 'CREATE POLICY representation_requests_tenant_isolation ON representation_requests
      FOR ALL
      USING (tenant_id = current_setting(''app.current_tenant_id'', true))
      WITH CHECK (tenant_id = current_setting(''app.current_tenant_id'', true))';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'actor_agent_relationships' AND policyname = 'actor_agent_relationships_tenant_isolation'
  ) THEN
    EXECUTE 'CREATE POLICY actor_agent_relationships_tenant_isolation ON actor_agent_relationships
      FOR ALL
      USING (tenant_id = current_setting(''app.current_tenant_id'', true))
      WITH CHECK (tenant_id = current_setting(''app.current_tenant_id'', true))';
  END IF;
END $$;

-- ===========================================
-- MIGRATION ROLE EXEMPTION (if role exists)
-- ===========================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'trimg_admin') THEN
    EXECUTE 'ALTER ROLE trimg_admin BYPASSRLS';
  END IF;
END $$;
