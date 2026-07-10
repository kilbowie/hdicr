-- TABLE OWNER: HDICR
-- Migration 053: Add gen_ai_alpha flag to actors
-- Date: 2026-04-30
-- Purpose: Gate early-access gen-AI features per actor. FALSE by default.
--          Admins set this via platform_admin tooling; it is not self-service.

ALTER TABLE actors
  ADD COLUMN IF NOT EXISTS gen_ai_alpha BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_actors_gen_ai_alpha
  ON actors(gen_ai_alpha) WHERE gen_ai_alpha = TRUE;
