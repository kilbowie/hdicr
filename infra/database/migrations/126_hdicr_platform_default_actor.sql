-- TABLE OWNER: HDICR
-- Migration 126: Platform default ("founder") generative model flag
-- Date: 2026-06-26
-- Purpose: Mark exactly one actor as the platform-owned default generative model
--          (the founder's captured voice+face). Generating with it for DEVELOPMENT
--          is free and needs no licence; production assets still require a licence.
--          Resolved by lib/ai/founder-model.ts (env AI_FOUNDER_ACTOR_ID overrides
--          this flag). The default actor row is designated by an admin action,
--          never seeded in the migration (migrations stay data-free).

ALTER TABLE actors
  ADD COLUMN IF NOT EXISTS is_platform_default BOOLEAN NOT NULL DEFAULT FALSE;

-- At most one platform-default actor at a time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_actors_platform_default
  ON actors(is_platform_default) WHERE is_platform_default = TRUE;

COMMENT ON COLUMN actors.is_platform_default IS 'The platform-owned default generative model (founder). Free for development; licence required for production (Generative Studio).';
