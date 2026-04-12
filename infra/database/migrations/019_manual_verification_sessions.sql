-- TABLE OWNER: HDICR
-- Migration 019: Manual verification sessions for founder-led onboarding
-- Date: 2026-04-10
-- Description: Adds scheduling/completion records for manual video verification flow (Sprint 1, Story 1.3)

CREATE TABLE IF NOT EXISTS manual_verification_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  actor_id UUID NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
  requested_by_user_profile_id UUID REFERENCES user_profiles(id),
  completed_by_user_profile_id UUID REFERENCES user_profiles(id),

  status VARCHAR(50) NOT NULL DEFAULT 'pending_scheduling'
    CHECK (status IN ('pending_scheduling', 'scheduled', 'completed', 'failed', 'canceled')),

  preferred_timezone VARCHAR(100),
  phone_number VARCHAR(50),
  meeting_platform VARCHAR(50) DEFAULT 'external',
  meeting_link_encrypted TEXT,
  scheduled_at TIMESTAMP WITH TIME ZONE,

  verified BOOLEAN,
  completion_notes TEXT,
  completed_at TIMESTAMP WITH TIME ZONE,

  tenant_id VARCHAR(100) NOT NULL DEFAULT 'trulyimagined',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_manual_verification_sessions_actor_id
  ON manual_verification_sessions(actor_id);
CREATE INDEX IF NOT EXISTS idx_manual_verification_sessions_status
  ON manual_verification_sessions(status)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_manual_verification_sessions_scheduled_at
  ON manual_verification_sessions(scheduled_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_manual_verification_sessions_tenant_id
  ON manual_verification_sessions(tenant_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_manual_verification_sessions_updated_at'
  ) THEN
    CREATE TRIGGER update_manual_verification_sessions_updated_at
      BEFORE UPDATE ON manual_verification_sessions
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

COMMENT ON TABLE manual_verification_sessions IS 'Manual verification scheduling/completion records for founder-led identity verification';
COMMENT ON COLUMN manual_verification_sessions.meeting_link_encrypted IS 'Encrypted meeting link payload for manual verification calls';
COMMENT ON COLUMN manual_verification_sessions.verified IS 'Final decision from manual verification reviewer';
