-- TABLE OWNER: TI
-- Migration: Add representation request and relationship tables
-- Date: 2026-04-04
-- Description: Adds actor-agent request workflow and active representation links

CREATE TABLE IF NOT EXISTS representation_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  actor_id UUID NOT NULL,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,

  status VARCHAR(50) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),

  message TEXT,
  response_note TEXT,

  requested_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  responded_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_representation_requests_actor_id ON representation_requests(actor_id);
CREATE INDEX IF NOT EXISTS idx_representation_requests_agent_id ON representation_requests(agent_id);
CREATE INDEX IF NOT EXISTS idx_representation_requests_status ON representation_requests(status);
CREATE INDEX IF NOT EXISTS idx_representation_requests_requested_at ON representation_requests(requested_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS ux_representation_requests_pending_actor_agent
  ON representation_requests(actor_id, agent_id)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS actor_agent_relationships (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  actor_id UUID NOT NULL,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  representation_request_id UUID REFERENCES representation_requests(id) ON DELETE SET NULL,

  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMP WITH TIME ZONE,
  ended_by_auth0_id VARCHAR(255),
  ended_reason TEXT,

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_actor_agent_relationships_actor_id ON actor_agent_relationships(actor_id);
CREATE INDEX IF NOT EXISTS idx_actor_agent_relationships_agent_id ON actor_agent_relationships(agent_id);
CREATE INDEX IF NOT EXISTS idx_actor_agent_relationships_started_at ON actor_agent_relationships(started_at DESC);

-- Enforce one active representation at a time per actor.
CREATE UNIQUE INDEX IF NOT EXISTS ux_actor_single_active_agent
  ON actor_agent_relationships(actor_id)
  WHERE ended_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_representation_requests_updated_at'
  ) THEN
    CREATE TRIGGER update_representation_requests_updated_at
      BEFORE UPDATE ON representation_requests
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_actor_agent_relationships_updated_at'
  ) THEN
    CREATE TRIGGER update_actor_agent_relationships_updated_at
      BEFORE UPDATE ON actor_agent_relationships
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

COMMENT ON TABLE representation_requests IS 'Representation requests submitted by actors to agents';
COMMENT ON TABLE actor_agent_relationships IS 'Approved representation links between actors and agents';
