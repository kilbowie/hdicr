-- TABLE OWNER: TI
-- Migration: Add agent invitation codes for actor representation onboarding
-- Date: 2026-04-10

CREATE TABLE IF NOT EXISTS agent_invitation_codes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(8) NOT NULL UNIQUE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  used_by_actor_id UUID,
  redeemed_at TIMESTAMP WITH TIME ZONE,
  tenant_id TEXT,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE,
  CONSTRAINT chk_agent_invitation_code_redeem_pair
    CHECK ((used_by_actor_id IS NULL AND redeemed_at IS NULL) OR (used_by_actor_id IS NOT NULL AND redeemed_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_agent_invitation_codes_agent_id
  ON agent_invitation_codes(agent_id);

CREATE INDEX IF NOT EXISTS idx_agent_invitation_codes_expires_at
  ON agent_invitation_codes(expires_at);

CREATE INDEX IF NOT EXISTS idx_agent_invitation_codes_redeemed
  ON agent_invitation_codes(redeemed_at);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_agent_invitation_codes_updated_at'
  ) THEN
    CREATE TRIGGER update_agent_invitation_codes_updated_at
      BEFORE UPDATE ON agent_invitation_codes
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

COMMENT ON TABLE agent_invitation_codes IS 'Agent-generated invitation codes for actors requesting representation';
