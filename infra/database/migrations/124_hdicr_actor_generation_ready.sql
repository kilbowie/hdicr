-- TABLE OWNER: HDICR
-- Migration 124: Actor capture-kit + generation-ready flags
-- Date: 2026-06-25
-- Purpose: Track whether an actor has completed the Digital Identity Capture Kit
--          and is "generation-ready". Complements actors.gen_ai_alpha (migration
--          053). The generation-ready badge = gen_ai_alpha AND capture kit done.
--          (AI plan §11/§17.)

ALTER TABLE actors
  ADD COLUMN IF NOT EXISTS capture_kit_completed_at TIMESTAMPTZ;

ALTER TABLE actors
  ADD COLUMN IF NOT EXISTS generation_ready BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN actors.capture_kit_completed_at IS 'When the actor completed the Digital Identity Capture Kit upload (AI plan §11).';
COMMENT ON COLUMN actors.generation_ready IS 'Actor is generation-ready (capture kit done + gen_ai_alpha). Drives the profile badge.';
