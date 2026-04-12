-- TABLE OWNER: TI
-- Migration: Add manual account status flags for IAM management
-- Date: 2026-03-31
-- Description: Adds verified and pro status flags to user_profiles for admin IAM controls

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_pro BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_user_profiles_is_verified ON user_profiles(is_verified);
CREATE INDEX IF NOT EXISTS idx_user_profiles_is_pro ON user_profiles(is_pro);

COMMENT ON COLUMN user_profiles.is_verified IS 'Manual verification badge flag managed by Admin IAM';
COMMENT ON COLUMN user_profiles.is_pro IS 'Manual Pro badge flag managed by Admin IAM';