-- TABLE OWNER: TI
-- Migration 032: TI admin audit views (soft-delete visibility)
-- Date: 2026-04-11
-- Purpose: Create ti_admin schema with views including soft-deleted rows
--          so admin queries can audit the full TI record lifecycle.

-- ===========================================
-- ADMIN SCHEMA
-- ===========================================
CREATE SCHEMA IF NOT EXISTS ti_admin;

COMMENT ON SCHEMA ti_admin IS 'Admin-only views of TI tables including soft-deleted records';

-- ===========================================
-- ADMIN VIEWS
-- ===========================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'actor_media'
  ) THEN
    EXECUTE 'CREATE OR REPLACE VIEW ti_admin.v_actor_media_all AS
      SELECT *, deleted_at IS NOT NULL AS is_deleted
      FROM public.actor_media';

    EXECUTE 'COMMENT ON VIEW ti_admin.v_actor_media_all IS ''All actor media including soft-deleted; admin use only''';
  END IF;
END $$;

CREATE OR REPLACE VIEW ti_admin.v_support_tickets_all AS
  SELECT *
  FROM public.support_tickets;

COMMENT ON VIEW ti_admin.v_support_tickets_all IS 'All support tickets including soft-deleted; admin use only';

CREATE OR REPLACE VIEW ti_admin.v_support_ticket_messages_all AS
  SELECT *
  FROM public.support_ticket_messages;

COMMENT ON VIEW ti_admin.v_support_ticket_messages_all IS 'All support ticket messages including soft-deleted; admin use only';

CREATE OR REPLACE VIEW ti_admin.v_user_feedback_all AS
  SELECT *
  FROM public.user_feedback;

COMMENT ON VIEW ti_admin.v_user_feedback_all IS 'All user feedback including soft-deleted; admin use only';

CREATE OR REPLACE VIEW ti_admin.v_agents_all AS
  SELECT *
  FROM public.agents;

COMMENT ON VIEW ti_admin.v_agents_all IS 'All agent profiles including soft-deleted; admin use only';

CREATE OR REPLACE VIEW ti_admin.v_representation_requests_all AS
  SELECT *
  FROM public.representation_requests;

COMMENT ON VIEW ti_admin.v_representation_requests_all IS 'All representation requests; admin use only';

CREATE OR REPLACE VIEW ti_admin.v_actor_agent_relationships_all AS
  SELECT *
  FROM public.actor_agent_relationships;

COMMENT ON VIEW ti_admin.v_actor_agent_relationships_all IS 'All actor-agent relationships including terminated; admin use only';

CREATE OR REPLACE VIEW ti_admin.v_agency_team_members_all AS
  SELECT *
  FROM public.agency_team_members;

COMMENT ON VIEW ti_admin.v_agency_team_members_all IS 'All agency team members including removed; admin use only';

CREATE OR REPLACE VIEW ti_admin.v_representation_terminations_all AS
  SELECT *
  FROM public.representation_terminations;

COMMENT ON VIEW ti_admin.v_representation_terminations_all IS 'All representation termination records; admin use only';

CREATE OR REPLACE VIEW ti_admin.v_agent_invitation_codes_all AS
  SELECT *
  FROM public.agent_invitation_codes;

COMMENT ON VIEW ti_admin.v_agent_invitation_codes_all IS 'All invitation codes including soft-deleted; admin use only';

-- ===========================================
-- GRANT ACCESS TO ADMIN ROLES
-- ===========================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ti_admin') THEN
    GRANT USAGE ON SCHEMA ti_admin TO ti_admin;
    GRANT SELECT ON ALL TABLES IN SCHEMA ti_admin TO ti_admin;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ti_owner') THEN
    GRANT USAGE ON SCHEMA ti_admin TO ti_owner;
    GRANT SELECT ON ALL TABLES IN SCHEMA ti_admin TO ti_owner;
  END IF;
END $$;
