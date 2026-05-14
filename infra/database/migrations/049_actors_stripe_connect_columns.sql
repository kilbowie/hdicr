-- TABLE OWNER: HDICR
-- Migration 049: Add Stripe Connect denorm columns to actors table
-- Date: 2026-04-29
-- Purpose: stripe_account_id, stripe_account_status, stripe_onboarding_complete
--          are referenced by webhook and deals routes. The stripe_accounts table
--          (TI-owned) is the authoritative source; these columns are a denorm cache.

ALTER TABLE actors
  ADD COLUMN IF NOT EXISTS stripe_account_id        TEXT,
  ADD COLUMN IF NOT EXISTS stripe_account_status    VARCHAR(50) DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS stripe_onboarding_complete BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_actors_stripe_account_id
  ON actors(stripe_account_id)
  WHERE stripe_account_id IS NOT NULL;
