-- TABLE OWNER: TI
-- Migration: Add agency team member management
-- Date: 2026-04-04
-- Description: Supports inviting and managing additional agents/assistants inside an agency

CREATE TABLE IF NOT EXISTS agency_team_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  agency_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  linked_user_profile_id UUID REFERENCES user_profiles(id) ON DELETE SET NULL,

  email VARCHAR(255) NOT NULL,
  full_name VARCHAR(255),
  member_role VARCHAR(50) NOT NULL DEFAULT 'Assistant'
    CHECK (member_role IN ('Agent', 'Assistant')),

  -- Access permissions, e.g. {"canManageRoster":true,"canManageRequests":false,...}
  access_permissions JSONB NOT NULL DEFAULT '{}'::JSONB,

  status VARCHAR(50) NOT NULL DEFAULT 'invited'
    CHECK (status IN ('invited', 'active', 'disabled')),

  invite_token VARCHAR(255) UNIQUE,
  invite_sent_at TIMESTAMP WITH TIME ZONE,
  joined_at TIMESTAMP WITH TIME ZONE,

  invited_by_auth0_id VARCHAR(255) NOT NULL,

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_agency_team_members_agency_id ON agency_team_members(agency_id);
CREATE INDEX IF NOT EXISTS idx_agency_team_members_email ON agency_team_members(email);
CREATE INDEX IF NOT EXISTS idx_agency_team_members_status ON agency_team_members(status);
CREATE INDEX IF NOT EXISTS idx_agency_team_members_linked_profile ON agency_team_members(linked_user_profile_id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_agency_team_members_agency_email_active
  ON agency_team_members(agency_id, lower(email))
  WHERE deleted_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_agency_team_members_updated_at'
  ) THEN
    CREATE TRIGGER update_agency_team_members_updated_at
      BEFORE UPDATE ON agency_team_members
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

COMMENT ON TABLE agency_team_members IS 'Agency-managed team members (agents/assistants) and invitation state';
COMMENT ON COLUMN agency_team_members.access_permissions IS 'JSON permissions to control feature access per team member';
