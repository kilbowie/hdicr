-- TABLE OWNER: HDICR
-- Migration 028: Drop TI-domain tables from HDICR database
-- Date: 2026-04-11
-- Purpose: Enforce hard separation by removing TI-owned tables from the HDICR database.
--          This runs last in Track A so all HDICR-specific data has already been
--          migrated/rebuilt before these tables are removed.
--
-- SAFETY: All drops are conditional (IF EXISTS). Running on a fresh HDICR DB
--         that was built from only HDICR-owned migrations will be a clean no-op.
--
-- ⚠ DO NOT run this on the TI database — it would destroy TI application data.

-- ===========================================
-- DROP TI-OWNED TABLES (if present on this DB)
-- ===========================================

-- Drop in FK-safe dependency order: child tables first, then parents.

-- Representation workflow
DROP TABLE IF EXISTS public.representation_terminations CASCADE;
DROP TABLE IF EXISTS public.actor_agent_relationships CASCADE;
DROP TABLE IF EXISTS public.representation_requests CASCADE;

-- Agency / team
DROP TABLE IF EXISTS public.agency_team_members CASCADE;
DROP TABLE IF EXISTS public.agent_invitation_codes CASCADE;
DROP TABLE IF EXISTS public.agents CASCADE;

-- Support and feedback
DROP TABLE IF EXISTS public.support_ticket_messages CASCADE;
DROP TABLE IF EXISTS public.support_tickets CASCADE;
DROP TABLE IF EXISTS public.user_feedback CASCADE;

-- Media
DROP TABLE IF EXISTS public.actor_media CASCADE;

-- ===========================================
-- DOCUMENTATION
-- ===========================================
COMMENT ON SCHEMA public IS 'HDICR-owned schema: identity, consent, credential issuance. TI tables removed as of migration 028.';
