-- TABLE OWNER: TI
-- Migration: Add agents table for agency profile data
-- Date: 2026-04-04
-- Description: Creates agent profiles with business details and verification/billing scaffolding

CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Account linkage
  user_profile_id UUID UNIQUE NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  auth0_user_id VARCHAR(255) UNIQUE NOT NULL,

  -- Public profile details
  registry_id VARCHAR(100) UNIQUE,
  agency_name VARCHAR(255) NOT NULL,
  bio TEXT,
  profile_image_url VARCHAR(500),
  location VARCHAR(200),
  website_url VARCHAR(500),
  profile_completed BOOLEAN NOT NULL DEFAULT FALSE,

  -- Registered business details (commercial readiness)
  registered_company_name VARCHAR(255),
  company_registration_number VARCHAR(100),
  vat_number VARCHAR(100),
  registered_address_line1 VARCHAR(255),
  registered_address_line2 VARCHAR(255),
  registered_address_city VARCHAR(120),
  registered_address_postcode VARCHAR(32),
  registered_address_country VARCHAR(120),

  -- Verification
  verification_status VARCHAR(50) NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('pending', 'verified', 'rejected')),
  verified_at TIMESTAMP WITH TIME ZONE,
  verified_by UUID,

  -- Billing framework placeholders (no active billing implementation yet)
  stripe_customer_id VARCHAR(255),
  billing_plan VARCHAR(100) NOT NULL DEFAULT 'free',

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_agents_user_profile_id ON agents(user_profile_id);
CREATE INDEX IF NOT EXISTS idx_agents_auth0_user_id ON agents(auth0_user_id);
CREATE INDEX IF NOT EXISTS idx_agents_registry_id ON agents(registry_id);
CREATE INDEX IF NOT EXISTS idx_agents_verification_status ON agents(verification_status);
CREATE INDEX IF NOT EXISTS idx_agents_profile_completed ON agents(profile_completed);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_agents_updated_at'
  ) THEN
    CREATE TRIGGER update_agents_updated_at
      BEFORE UPDATE ON agents
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

COMMENT ON TABLE agents IS 'Agent registry: agency profiles linked to user profiles';
COMMENT ON COLUMN agents.verification_status IS 'Manual verification state managed by admin IAM';
COMMENT ON COLUMN agents.billing_plan IS 'Billing scaffold for future commercial rollout';
