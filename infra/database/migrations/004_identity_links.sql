-- TABLE OWNER: HDICR
-- Truly Imagined v3 - Migration 004: Identity Links
-- Multi-Provider Identity Linking Infrastructure
-- Enables linking to government IDs, financial institutions, KYC providers

-- ===========================================
-- IDENTITY_LINKS TABLE
-- ===========================================
-- Purpose: Store external identity provider links for identity orchestration
-- Supports: UK Gov Verify, eIDAS, Open Banking, Onfido, etc.

CREATE TABLE IF NOT EXISTS identity_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Foreign Key to User Profile
  user_profile_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,

  -- Provider Information
  provider VARCHAR(100) NOT NULL,          -- 'auth0', 'uk-gov-verify', 'bank-openid', 'onfido', 'yoti', 'plaid'
  provider_user_id VARCHAR(255) NOT NULL,  -- User's ID in external provider system
  provider_type VARCHAR(50) NOT NULL,      -- 'oauth', 'oidc', 'kyc', 'government', 'financial'

  -- Verification & Assurance Levels
  verification_level VARCHAR(50),          -- 'low', 'medium', 'high', 'very-high' (GPG 45 alignment)
  assurance_level VARCHAR(50),             -- eIDAS: 'low', 'substantial', 'high'
  verified_at TIMESTAMP WITH TIME ZONE,

  -- Encrypted Claims & Metadata
  credential_data JSONB,                   -- Encrypted claims from provider (PII, credentials, etc.)
  metadata JSONB,                          -- Non-sensitive metadata (provider name, icon URL, etc.)

  -- Lifecycle Management
  is_active BOOLEAN DEFAULT TRUE,
  linked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE,     -- If provider credential has expiry
  last_verified_at TIMESTAMP WITH TIME ZONE,

  -- Audit Trail
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Constraints
  CONSTRAINT unique_user_provider_link UNIQUE(user_profile_id, provider, provider_user_id),
  CONSTRAINT valid_verification_level CHECK (verification_level IN ('low', 'medium', 'high', 'very-high')),
  CONSTRAINT valid_assurance_level CHECK (assurance_level IN ('low', 'substantial', 'high'))
);

-- Indexes for Performance
CREATE INDEX IF NOT EXISTS idx_identity_links_user_profile_id ON identity_links(user_profile_id);
CREATE INDEX IF NOT EXISTS idx_identity_links_provider ON identity_links(provider);
CREATE INDEX IF NOT EXISTS idx_identity_links_is_active ON identity_links(is_active);
CREATE INDEX IF NOT EXISTS idx_identity_links_verification_level ON identity_links(verification_level);
CREATE INDEX IF NOT EXISTS idx_identity_links_assurance_level ON identity_links(assurance_level);

-- Composite index for common query pattern
CREATE INDEX IF NOT EXISTS idx_identity_links_user_active ON identity_links(user_profile_id, is_active);

-- ===========================================
-- UPDATED_AT TRIGGER
-- ===========================================
-- Automatically update 'updated_at' timestamp on row modification

CREATE OR REPLACE FUNCTION update_identity_links_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_identity_links_updated_at
BEFORE UPDATE ON identity_links
FOR EACH ROW
EXECUTE FUNCTION update_identity_links_updated_at();

-- ===========================================
-- COMMENTS
-- ===========================================

COMMENT ON TABLE identity_links IS 'Multi-provider identity links for identity orchestration layer';
COMMENT ON COLUMN identity_links.provider IS 'External identity provider name (e.g., uk-gov-verify, onfido, plaid)';
COMMENT ON COLUMN identity_links.verification_level IS 'GPG 45 verification level: low, medium, high, very-high';
COMMENT ON COLUMN identity_links.assurance_level IS 'eIDAS assurance level: low, substantial, high';
COMMENT ON COLUMN identity_links.credential_data IS 'Encrypted claims from provider (must be encrypted at application layer)';
COMMENT ON COLUMN identity_links.is_active IS 'Whether this identity link is currently active (can be deactivated without deletion)';
