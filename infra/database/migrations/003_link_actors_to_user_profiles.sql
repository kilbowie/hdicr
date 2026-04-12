-- TABLE OWNER: HDICR
-- Migration: Link actors table to user_profiles
-- Date: 2026-03-23
-- Description: Establish proper foreign key relationship between user_profiles and actors

-- Add user_profile_id column to actors table
ALTER TABLE actors ADD COLUMN IF NOT EXISTS user_profile_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE;

-- CREATE INDEX IF NOT EXISTS for the foreign key
CREATE INDEX IF NOT EXISTS idx_actors_user_profile_id ON actors(user_profile_id);

-- Add constraint: only one actor profile per user_profile
ALTER TABLE actors ADD CONSTRAINT unique_user_profile_id UNIQUE (user_profile_id);

-- Update existing actors to link to user_profiles (if any exist)
-- This will need to be run manually if there's existing data:
-- UPDATE actors a 
-- SET user_profile_id = (SELECT id FROM user_profiles WHERE auth0_user_id = a.auth0_user_id)
-- WHERE user_profile_id IS NULL;

-- Comment
COMMENT ON COLUMN actors.user_profile_id IS 'Foreign key to user_profiles - links actor-specific data to base user profile';
