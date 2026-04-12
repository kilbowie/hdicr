-- TABLE OWNER: TI
-- Migration: Add user_profiles table for database-backed roles
-- Date: 2026-03-23
-- Description: Replace Auth0 RBAC with PostgreSQL-based role system

-- Enable required extensions (idempotent for both HDICR and TI)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS user_profiles (
  -- Primary key
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Auth0 link (immutable)
  auth0_user_id VARCHAR(255) UNIQUE NOT NULL,
  email VARCHAR(255) NOT NULL,
  
  -- Role (replaces Auth0 RBAC)
  role VARCHAR(50) NOT NULL CHECK (role IN ('Actor', 'Agent', 'Enterprise', 'Admin')),
  
  -- Profile Information
  username VARCHAR(100) UNIQUE NOT NULL,
  legal_name VARCHAR(255) NOT NULL,
  professional_name VARCHAR(255) UNIQUE NOT NULL,
  use_legal_as_professional BOOLEAN DEFAULT FALSE,
  spotlight_id VARCHAR(500) UNIQUE, -- Optional URL to Spotlight profile
  
  -- Metadata
  profile_completed BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Indexes for performance
  CONSTRAINT username_format CHECK (username ~ '^[a-zA-Z0-9_-]{3,50}$'),
  CONSTRAINT spotlight_id_format CHECK (spotlight_id IS NULL OR spotlight_id ~ '^https?://')
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_user_profiles_auth0_user_id ON user_profiles(auth0_user_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_email ON user_profiles(email);
CREATE INDEX IF NOT EXISTS idx_user_profiles_username ON user_profiles(username);
CREATE INDEX IF NOT EXISTS idx_user_profiles_role ON user_profiles(role);

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION update_user_profiles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_user_profiles_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_user_profiles_updated_at();

-- Comments
COMMENT ON TABLE user_profiles IS 'User profiles with database-backed roles (replaces Auth0 RBAC)';
COMMENT ON COLUMN user_profiles.auth0_user_id IS 'Auth0 user identifier (immutable link)';
COMMENT ON COLUMN user_profiles.role IS 'User role: Actor, Agent, Enterprise, or Admin';
COMMENT ON COLUMN user_profiles.username IS 'Unique username chosen by user';
COMMENT ON COLUMN user_profiles.legal_name IS 'User legal name';
COMMENT ON COLUMN user_profiles.professional_name IS 'Professional name (must be unique, can match legal name)';
COMMENT ON COLUMN user_profiles.use_legal_as_professional IS 'Whether professional name is same as legal name';
COMMENT ON COLUMN user_profiles.spotlight_id IS 'Optional URL to Spotlight profile (must be unique if provided)';
COMMENT ON COLUMN user_profiles.profile_completed IS 'Whether user has completed profile setup';
