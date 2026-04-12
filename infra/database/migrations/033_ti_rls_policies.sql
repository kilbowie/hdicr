-- TABLE OWNER: TI
-- Migration 033: TI tenant-aware Row-Level Security policies
-- Date: 2026-04-11
-- Purpose: Enforce tenant isolation at the PostgreSQL layer for all TI-owned tables.
--          Mirrors the approach from HDICR migration 017.
--
-- How it works:
--   Application code sets the session variable before any query:
--     SET LOCAL app.current_tenant_id = 'trulyimagined';
--   RLS policies compare tenant_id to this setting.
--   Admin and migration roles bypass RLS via BYPASSRLS privilege.

-- ===========================================
-- ENABLE RLS ON TI TABLES
-- ===========================================
ALTER TABLE support_tickets           ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_ticket_messages   ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_feedback             ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE representation_requests   ENABLE ROW LEVEL SECURITY;
ALTER TABLE actor_agent_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE agency_team_members       ENABLE ROW LEVEL SECURITY;
ALTER TABLE representation_terminations ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_invitation_codes    ENABLE ROW LEVEL SECURITY;

-- ===========================================
-- TENANT ISOLATION POLICIES
-- ===========================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'support_tickets' AND policyname = 'support_tickets_tenant_isolation'
  ) THEN
    EXECUTE 'CREATE POLICY support_tickets_tenant_isolation ON support_tickets
      FOR ALL
      USING (tenant_id = current_setting(''app.current_tenant_id'', true))
      WITH CHECK (tenant_id = current_setting(''app.current_tenant_id'', true))';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'support_ticket_messages' AND policyname = 'support_ticket_messages_tenant_isolation'
  ) THEN
    EXECUTE 'CREATE POLICY support_ticket_messages_tenant_isolation ON support_ticket_messages
      FOR ALL
      USING (tenant_id = current_setting(''app.current_tenant_id'', true))
      WITH CHECK (tenant_id = current_setting(''app.current_tenant_id'', true))';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'user_feedback' AND policyname = 'user_feedback_tenant_isolation'
  ) THEN
    EXECUTE 'CREATE POLICY user_feedback_tenant_isolation ON user_feedback
      FOR ALL
      USING (tenant_id = current_setting(''app.current_tenant_id'', true))
      WITH CHECK (tenant_id = current_setting(''app.current_tenant_id'', true))';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'agents' AND policyname = 'agents_tenant_isolation'
  ) THEN
    EXECUTE 'CREATE POLICY agents_tenant_isolation ON agents
      FOR ALL
      USING (tenant_id = current_setting(''app.current_tenant_id'', true))
      WITH CHECK (tenant_id = current_setting(''app.current_tenant_id'', true))';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'representation_requests' AND policyname = 'representation_requests_tenant_isolation'
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
    SELECT 1 FROM pg_policies WHERE tablename = 'actor_agent_relationships' AND policyname = 'actor_agent_relationships_tenant_isolation'
  ) THEN
    EXECUTE 'CREATE POLICY actor_agent_relationships_tenant_isolation ON actor_agent_relationships
      FOR ALL
      USING (tenant_id = current_setting(''app.current_tenant_id'', true))
      WITH CHECK (tenant_id = current_setting(''app.current_tenant_id'', true))';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'agency_team_members' AND policyname = 'agency_team_members_tenant_isolation'
  ) THEN
    EXECUTE 'CREATE POLICY agency_team_members_tenant_isolation ON agency_team_members
      FOR ALL
      USING (tenant_id = current_setting(''app.current_tenant_id'', true))
      WITH CHECK (tenant_id = current_setting(''app.current_tenant_id'', true))';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'representation_terminations' AND policyname = 'representation_terminations_tenant_isolation'
  ) THEN
    EXECUTE 'CREATE POLICY representation_terminations_tenant_isolation ON representation_terminations
      FOR ALL
      USING (tenant_id = current_setting(''app.current_tenant_id'', true))
      WITH CHECK (tenant_id = current_setting(''app.current_tenant_id'', true))';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'agent_invitation_codes' AND policyname = 'agent_invitation_codes_tenant_isolation'
  ) THEN
    EXECUTE 'CREATE POLICY agent_invitation_codes_tenant_isolation ON agent_invitation_codes
      FOR ALL
      USING (tenant_id = current_setting(''app.current_tenant_id'', true))
      WITH CHECK (tenant_id = current_setting(''app.current_tenant_id'', true))';
  END IF;
END $$;

-- ===========================================
-- ADMIN / MIGRATION BYPASS
-- Roles with BYPASSRLS (e.g. migration runner, ti_admin, ti_owner) skip all policies.
-- Grant BYPASSRLS selectively in the DB provisioning runbook; do not automate here.
-- ===========================================
COMMENT ON TABLE public.agents IS 'TI-owned: RLS tenant isolation active as of migration 033';
COMMENT ON TABLE public.representation_requests IS 'TI-owned: RLS tenant isolation active as of migration 033';
COMMENT ON TABLE public.actor_agent_relationships IS 'TI-owned: RLS tenant isolation active as of migration 033';
