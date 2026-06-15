-- TABLE OWNER: HDICR
-- Migration 068: Add allow_studio_discovery opt-in flag to actors
-- Date: 2026-05-28

ALTER TABLE actors
  ADD COLUMN IF NOT EXISTS allow_studio_discovery BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN actors.allow_studio_discovery IS 'When TRUE the actor appears in studio actor-discovery search results.';
