-- TABLE OWNER: TI
-- Migration 031: Remove cross-database hard FKs; add hdicr_ref validator triggers
-- Date: 2026-04-11
-- Purpose: Eliminate all hard REFERENCES to HDICR-origin tables (actors, user_profiles)
--          that cannot be enforced across separate database instances. Replace with
--          application-level validation triggers that check hdicr_ref read models.
--
-- Background:
--   Prior migrations (013, 014, 015, 023, 024) defined FK constraints to actors(id)
--   and user_profiles(id) which are owned by HDICR. Those constraints work on a
--   shared database but break when HDICR and TI are on separate PostgreSQL instances.
--   This migration drops them and substitutes trigger-based checks against the
--   hdicr_ref read models populated by migration 030.
--
-- NOTE: IF EXISTS safeguards every DROP so this is safe to run on a fresh TI DB
--       built from the Track B execution order (FKs may not exist yet).

-- ===========================================
-- DROP CROSS-DB FK CONSTRAINTS
-- ===========================================

-- agents -> user_profiles
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_type = 'FOREIGN KEY'
      AND table_name = 'agents'
      AND constraint_name LIKE '%user_profile%'
  ) THEN
    ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_user_profile_id_fkey;
  END IF;
END $$;

-- representation_requests -> actors
DO $$
BEGIN
  ALTER TABLE representation_requests DROP CONSTRAINT IF EXISTS representation_requests_actor_id_fkey;
END $$;

-- actor_agent_relationships -> actors
DO $$
BEGIN
  ALTER TABLE actor_agent_relationships DROP CONSTRAINT IF EXISTS actor_agent_relationships_actor_id_fkey;
END $$;

-- representation_terminations -> actors
DO $$
BEGIN
  ALTER TABLE representation_terminations DROP CONSTRAINT IF EXISTS representation_terminations_actor_id_fkey;
END $$;

-- agent_invitation_codes -> actors (used_by_actor_id)
DO $$
BEGIN
  ALTER TABLE agent_invitation_codes DROP CONSTRAINT IF EXISTS agent_invitation_codes_used_by_actor_id_fkey;
END $$;

-- actor_media -> actors
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'actor_media'
  ) THEN
    ALTER TABLE actor_media DROP CONSTRAINT IF EXISTS actor_media_actor_id_fkey;
  END IF;
END $$;

-- ===========================================
-- VALIDATOR FUNCTION: actor must exist in hdicr_ref
-- ===========================================
CREATE OR REPLACE FUNCTION public.fn_validate_hdicr_ref_actor()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_actor_col TEXT;
  v_actor_id  UUID;
BEGIN
  -- Each table stores the actor reference under a column named actor_id
  -- or used_by_actor_id (agent_invitation_codes). We check actor_id first.
  v_actor_id := NEW.actor_id;

  -- Skip check if actor_id is NULL (optional FK semantics preserved)
  IF v_actor_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM hdicr_ref.actors
    WHERE source_id = v_actor_id
      AND tenant_id = NEW.tenant_id
      AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'hdicr_ref validation failed: actor % not found in tenant % (table: %)',
      v_actor_id, NEW.tenant_id, TG_TABLE_NAME
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- ===========================================
-- VALIDATOR FUNCTION: user_profile must exist in hdicr_ref
-- ===========================================
CREATE OR REPLACE FUNCTION public.fn_validate_hdicr_ref_user_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.user_profile_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM hdicr_ref.user_profiles
    WHERE source_id = NEW.user_profile_id
      AND tenant_id = NEW.tenant_id
      AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'hdicr_ref validation failed: user_profile % not found in tenant % (table: %)',
      NEW.user_profile_id, NEW.tenant_id, TG_TABLE_NAME
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- ===========================================
-- VALIDATOR FUNCTION: used_by_actor_id check (agent_invitation_codes)
-- ===========================================
CREATE OR REPLACE FUNCTION public.fn_validate_hdicr_ref_used_by_actor()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.used_by_actor_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM hdicr_ref.actors
    WHERE source_id = NEW.used_by_actor_id
      AND tenant_id = NEW.tenant_id
      AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'hdicr_ref validation failed: actor (used_by) % not found in tenant % (table: %)',
      NEW.used_by_actor_id, NEW.tenant_id, TG_TABLE_NAME
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- ===========================================
-- ATTACH VALIDATOR TRIGGERS
-- ===========================================

-- actor_media
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'actor_media'
  ) AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_validate_actor_media_actor') THEN
    CREATE TRIGGER trg_validate_actor_media_actor
      BEFORE INSERT OR UPDATE ON actor_media
      FOR EACH ROW EXECUTE FUNCTION public.fn_validate_hdicr_ref_actor();
  END IF;
END $$;

-- representation_requests
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_validate_representation_requests_actor') THEN
    CREATE TRIGGER trg_validate_representation_requests_actor
      BEFORE INSERT OR UPDATE ON representation_requests
      FOR EACH ROW EXECUTE FUNCTION public.fn_validate_hdicr_ref_actor();
  END IF;
END $$;

-- actor_agent_relationships
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_validate_actor_agent_relationships_actor') THEN
    CREATE TRIGGER trg_validate_actor_agent_relationships_actor
      BEFORE INSERT OR UPDATE ON actor_agent_relationships
      FOR EACH ROW EXECUTE FUNCTION public.fn_validate_hdicr_ref_actor();
  END IF;
END $$;

-- representation_terminations
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_validate_representation_terminations_actor') THEN
    CREATE TRIGGER trg_validate_representation_terminations_actor
      BEFORE INSERT OR UPDATE ON representation_terminations
      FOR EACH ROW EXECUTE FUNCTION public.fn_validate_hdicr_ref_actor();
  END IF;
END $$;

-- agent_invitation_codes (used_by_actor_id)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_validate_invitation_used_by_actor') THEN
    CREATE TRIGGER trg_validate_invitation_used_by_actor
      BEFORE INSERT OR UPDATE ON agent_invitation_codes
      FOR EACH ROW EXECUTE FUNCTION public.fn_validate_hdicr_ref_used_by_actor();
  END IF;
END $$;

-- agents (user_profile_id)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_validate_agents_user_profile') THEN
    CREATE TRIGGER trg_validate_agents_user_profile
      BEFORE INSERT OR UPDATE ON agents
      FOR EACH ROW EXECUTE FUNCTION public.fn_validate_hdicr_ref_user_profile();
  END IF;
END $$;
