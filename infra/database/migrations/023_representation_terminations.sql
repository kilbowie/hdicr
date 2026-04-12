-- TABLE OWNER: TI
-- Migration: Add 30-day representation termination notices
-- Date: 2026-04-10
-- Description: Legal notice workflow for actor/agent relationship termination.

CREATE TABLE IF NOT EXISTS representation_terminations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  relationship_id UUID NOT NULL REFERENCES actor_agent_relationships(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,

  initiated_by VARCHAR(20) NOT NULL CHECK (initiated_by IN ('actor', 'agent')),
  initiated_by_auth0_id VARCHAR(255) NOT NULL,
  reason TEXT,

  notice_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  effective_date TIMESTAMP WITH TIME ZONE NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'pending_termination'
    CHECK (status IN ('pending_termination', 'completed', 'cancelled', 'failed')),
  completed_at TIMESTAMP WITH TIME ZONE,
  last_error TEXT,

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_representation_terminations_relationship_id
  ON representation_terminations(relationship_id);

CREATE INDEX IF NOT EXISTS idx_representation_terminations_actor_id
  ON representation_terminations(actor_id);

CREATE INDEX IF NOT EXISTS idx_representation_terminations_agent_id
  ON representation_terminations(agent_id);

CREATE INDEX IF NOT EXISTS idx_representation_terminations_status_effective_date
  ON representation_terminations(status, effective_date);

CREATE UNIQUE INDEX IF NOT EXISTS ux_representation_terminations_pending_relationship
  ON representation_terminations(relationship_id)
  WHERE status = 'pending_termination';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_representation_terminations_updated_at'
  ) THEN
    CREATE TRIGGER update_representation_terminations_updated_at
      BEFORE UPDATE ON representation_terminations
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

COMMENT ON TABLE representation_terminations IS '30-day legal notice records for actor-agent relationship termination';
