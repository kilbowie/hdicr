-- TABLE OWNER: TI
-- Migration 029: Complete tenant_id coverage for TI tables
-- Date: 2026-04-11
-- Purpose: Add tenant_id to TI-owned tables and normalize the existing nullable
--          TEXT tenant_id on agent_invitation_codes to VARCHAR(100) NOT NULL.

ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(100) NOT NULL DEFAULT 'trulyimagined';

ALTER TABLE support_ticket_messages
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(100) NOT NULL DEFAULT 'trulyimagined';

ALTER TABLE user_feedback
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(100) NOT NULL DEFAULT 'trulyimagined';

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(100) NOT NULL DEFAULT 'trulyimagined';

ALTER TABLE representation_requests
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(100) NOT NULL DEFAULT 'trulyimagined';

ALTER TABLE actor_agent_relationships
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(100) NOT NULL DEFAULT 'trulyimagined';

ALTER TABLE agency_team_members
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(100) NOT NULL DEFAULT 'trulyimagined';

ALTER TABLE representation_terminations
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(100) NOT NULL DEFAULT 'trulyimagined';

-- ===========================================
-- NORMALIZE agent_invitation_codes.tenant_id
-- Existing column is TEXT NULLABLE (migration 024).
-- Convert to VARCHAR(100), backfill NULLs, enforce NOT NULL.
-- ===========================================
DO $$
BEGIN
  -- Backfill NULLs before the NOT NULL constraint is added
  UPDATE agent_invitation_codes
  SET tenant_id = 'trulyimagined'
  WHERE tenant_id IS NULL;

  -- Change type from TEXT to VARCHAR(100)
  ALTER TABLE agent_invitation_codes
    ALTER COLUMN tenant_id TYPE VARCHAR(100) USING tenant_id::VARCHAR(100);

  -- Enforce NOT NULL and default
  ALTER TABLE agent_invitation_codes
    ALTER COLUMN tenant_id SET NOT NULL,
    ALTER COLUMN tenant_id SET DEFAULT 'trulyimagined';
END $$;

-- ===========================================
-- TENANT-SCOPED INDEXES
-- ===========================================

-- support_tickets
CREATE INDEX IF NOT EXISTS idx_support_tickets_tenant_id
  ON support_tickets(tenant_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_tenant_status_created_at
  ON support_tickets(tenant_id, status, created_at DESC);

-- support_ticket_messages
CREATE INDEX IF NOT EXISTS idx_support_ticket_messages_tenant_id
  ON support_ticket_messages(tenant_id);
CREATE INDEX IF NOT EXISTS idx_support_ticket_messages_tenant_ticket
  ON support_ticket_messages(tenant_id, ticket_id);

-- user_feedback
CREATE INDEX IF NOT EXISTS idx_user_feedback_tenant_id
  ON user_feedback(tenant_id);
CREATE INDEX IF NOT EXISTS idx_user_feedback_tenant_created_at
  ON user_feedback(tenant_id, created_at DESC);

-- agents
CREATE INDEX IF NOT EXISTS idx_agents_tenant_id
  ON agents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_agents_tenant_auth0_user_id
  ON agents(tenant_id, auth0_user_id);

-- representation_requests
CREATE INDEX IF NOT EXISTS idx_representation_requests_tenant_id
  ON representation_requests(tenant_id);
CREATE INDEX IF NOT EXISTS idx_representation_requests_tenant_actor_status
  ON representation_requests(tenant_id, actor_id, status);

-- actor_agent_relationships
CREATE INDEX IF NOT EXISTS idx_actor_agent_relationships_tenant_id
  ON actor_agent_relationships(tenant_id);
CREATE INDEX IF NOT EXISTS idx_actor_agent_relationships_tenant_actor
  ON actor_agent_relationships(tenant_id, actor_id) WHERE ended_at IS NULL;

-- agency_team_members
CREATE INDEX IF NOT EXISTS idx_agency_team_members_tenant_id
  ON agency_team_members(tenant_id);
CREATE INDEX IF NOT EXISTS idx_agency_team_members_tenant_agent
  ON agency_team_members(tenant_id, agency_id);

-- representation_terminations
CREATE INDEX IF NOT EXISTS idx_representation_terminations_tenant_id
  ON representation_terminations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_representation_terminations_tenant_actor
  ON representation_terminations(tenant_id, actor_id);

-- agent_invitation_codes
CREATE INDEX IF NOT EXISTS idx_agent_invitation_codes_tenant_id
  ON agent_invitation_codes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_agent_invitation_codes_tenant_agent
  ON agent_invitation_codes(tenant_id, agent_id);

-- ===========================================
-- COLUMN DOCUMENTATION
-- ===========================================
COMMENT ON COLUMN support_tickets.tenant_id IS 'Tenant identifier owning this support ticket';
COMMENT ON COLUMN support_ticket_messages.tenant_id IS 'Tenant identifier owning this support ticket message';
COMMENT ON COLUMN user_feedback.tenant_id IS 'Tenant identifier owning this feedback submission';
COMMENT ON COLUMN agents.tenant_id IS 'Tenant identifier owning this agent profile';
COMMENT ON COLUMN representation_requests.tenant_id IS 'Tenant identifier owning this representation request';
COMMENT ON COLUMN actor_agent_relationships.tenant_id IS 'Tenant identifier owning this active representation';
COMMENT ON COLUMN agency_team_members.tenant_id IS 'Tenant identifier owning this team membership';
COMMENT ON COLUMN representation_terminations.tenant_id IS 'Tenant identifier owning this termination record';
COMMENT ON COLUMN agent_invitation_codes.tenant_id IS 'Tenant identifier owning this invitation code';
