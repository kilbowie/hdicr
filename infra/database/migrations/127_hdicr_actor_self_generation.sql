-- TABLE OWNER: HDICR
-- Migration 127: Actor self-generation opt-in
-- Date: 2026-06-26
-- Purpose: Actors can enable AI generation of their own likeness — OFF by
--          default and toggleable any time. Enabling mints a self-licence
--          (TI licenses.origin='self', migration 125); disabling revokes it.
--          The flag is also a kill-switch the consent gate checks.

ALTER TABLE actors
  ADD COLUMN IF NOT EXISTS self_generation_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE actors
  ADD COLUMN IF NOT EXISTS self_generation_enabled_at TIMESTAMPTZ;

COMMENT ON COLUMN actors.self_generation_enabled IS 'Actor opted in to generating their own likeness (Generative Studio). Off by default; toggleable. Enabling mints a self-licence.';
