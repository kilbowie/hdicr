-- TABLE OWNER: HDICR
-- Migration 128: Drop the representation tables from the HDICR database (re-drift cleanup)
-- Date: 2026-07-12
-- Purpose: The representation domain is TI-owned (Part B, 2026-07-12). Migration 028 already
--          dropped these tables on 2026-04-11, but they were re-introduced on the HDICR DB
--          afterwards (drift) and the now-retired representation-service Lambda (PR #8) had
--          been reading them. TI serves representation entirely locally (PR #32), so these
--          tables are orphaned and confirmed empty (0 rows) on db-001. This removes them and
--          their leftover cross-schema union views for good.
--
-- SAFETY: All drops are conditional (IF EXISTS) and the tables were verified empty before
--         this ran in production. On a fresh HDICR DB built from HDICR-owned migrations only
--         (014_representation / 023_representation_terminations are TI-track only) these
--         objects are never created, so this migration is a clean no-op on rebuild.
--
-- ⚠ DO NOT run this on the TI database — representation is TI application data there.

-- Leftover cross-schema union views (stray ti_admin schema on the HDICR DB) depend on the
-- tables; drop them first so the table drops don't need CASCADE.
DROP VIEW IF EXISTS ti_admin.v_representation_requests_all;
DROP VIEW IF EXISTS ti_admin.v_actor_agent_relationships_all;
DROP VIEW IF EXISTS ti_admin.v_representation_terminations_all;

-- Drop in FK-safe dependency order: child tables first, then parents.
DROP TABLE IF EXISTS public.representation_terminations CASCADE;
DROP TABLE IF EXISTS public.actor_agent_relationships CASCADE;
DROP TABLE IF EXISTS public.representation_requests CASCADE;
