-- TABLE OWNER: HDICR
-- Migration 050: Add verification_method and verification_completed_at to actors
-- Date: 2026-04-30
-- Purpose: Record how and when each actor was verified (stripe_identity | founder_call | manual_video).
--          Required by audit trail — regulator must distinguish Stripe Identity from founder's word.

ALTER TABLE actors
  ADD COLUMN IF NOT EXISTS verification_method      VARCHAR(50),
  ADD COLUMN IF NOT EXISTS verification_completed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_actors_verification_method
  ON actors(verification_method)
  WHERE verification_method IS NOT NULL;

COMMENT ON COLUMN actors.verification_method IS 'How the actor was verified: stripe_identity | founder_call | manual_video';
COMMENT ON COLUMN actors.verification_completed_at IS 'Timestamp when verification was marked complete (verified or rejected)';
