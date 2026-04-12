-- TABLE OWNER: HDICR
-- Migration 007: Consent Ledger + Licensing System
-- Date: 2026-03-24
-- Purpose: Implement immutable consent ledger with versioning and license-based access control
--
-- This migration adds:
-- 1. consent_ledger: Versioned, immutable consent policies
-- 2. licenses: License grants to API clients with snapshots
-- 3. api_clients: Registered external API consumers
--
-- Architecture:
-- - consent_ledger is append-only, never updated
-- - Each actor has versioned consent entries
-- - Licenses capture policy snapshot at issuance time
-- - API clients require verification before license issuance

-- ===========================================
-- API CLIENTS TABLE
-- ===========================================
-- External systems that consume actor data via API
CREATE TABLE IF NOT EXISTS api_clients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Client Identity
  name VARCHAR(255) NOT NULL,
  description TEXT,
  website_url VARCHAR(500),
  
  -- Authentication
  public_key TEXT NOT NULL, -- Ed25519 public key for signature verification
  api_key_hash VARCHAR(255) UNIQUE NOT NULL, -- bcrypt hash of API key
  
  -- Verification Status
  credential_status VARCHAR(50) DEFAULT 'unverified' CHECK (credential_status IN ('unverified', 'pending', 'verified', 'suspended', 'revoked')),
  verified_at TIMESTAMP WITH TIME ZONE,
  verified_by UUID REFERENCES user_profiles(id),
  
  -- Contact Info
  contact_email VARCHAR(255) NOT NULL,
  contact_name VARCHAR(255),
  
  -- Metadata
  metadata JSONB DEFAULT '{}'::JSONB,
  
  -- Lifecycle
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_api_clients_status ON api_clients(credential_status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_api_clients_created_at ON api_clients(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_clients_api_key_hash ON api_clients(api_key_hash);

-- ===========================================
-- CONSENT LEDGER TABLE
-- ===========================================
-- Immutable, versioned consent policy entries
CREATE TABLE IF NOT EXISTS consent_ledger (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Actor Reference
  actor_id UUID NOT NULL,
  
  -- Versioning
  version INT NOT NULL, -- Increments per actor (1, 2, 3, ...)
  
  -- Policy Document (Machine-Readable)
  policy JSONB NOT NULL,
  -- Structure:
  -- {
  --   usage: {
  --     film_tv: boolean,
  --     advertising: boolean,
  --     ai_training: boolean,
  --     synthetic_media: boolean,
  --     voice_replication: boolean
  --   },
  --   commercial: {
  --     paymentRequired: boolean,
  --     minFee: number,
  --     revenueShare: number (0-100)
  --   },
  --   constraints: {
  --     duration: number (days),
  --     expiryDate: string (ISO 8601),
  --     territory: array of country codes
  --   },
  --   attributionRequired: boolean,
  --   aiControls: {
  --     trainingAllowed: boolean,
  --     likenessGenerationAllowed: boolean,
  --     voiceCloningAllowed: boolean
  --   }
  -- }
  
  -- Status Lifecycle
  status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'revoked')),
  
  -- Metadata
  reason TEXT, -- Why this entry was created
  updated_by UUID REFERENCES user_profiles(id), -- Who made the change (usually the actor)
  ip_address INET,
  user_agent TEXT,
  
  -- Immutability
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() CHECK (created_at <= NOW()),
  
  -- Constraints
  UNIQUE(actor_id, version), -- Ensure version uniqueness per actor
  CONSTRAINT version_positive CHECK (version > 0)
);

CREATE INDEX IF NOT EXISTS idx_consent_ledger_actor_id ON consent_ledger(actor_id);
CREATE INDEX IF NOT EXISTS idx_consent_ledger_actor_status ON consent_ledger(actor_id, status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_consent_ledger_version ON consent_ledger(actor_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_consent_ledger_created_at ON consent_ledger(created_at DESC);

-- ===========================================
-- LICENSES TABLE
-- ===========================================
-- License grants to API clients with policy snapshot
CREATE TABLE IF NOT EXISTS licenses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- References
  actor_id UUID NOT NULL,
  api_client_id UUID NOT NULL REFERENCES api_clients(id) ON DELETE CASCADE,
  consent_ledger_id UUID NOT NULL REFERENCES consent_ledger(id),
  
  -- License Details
  license_type VARCHAR(100) NOT NULL, -- e.g., 'api_access', 'data_usage', 'synthetic_media'
  
  -- Snapshot of Granted Permissions (immutable)
  granted_permissions_snapshot JSONB NOT NULL,
  -- Captured from consent_ledger.policy at license issuance time
  -- Even if actor later updates consent, this license retains original terms
  
  -- Status
  status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired', 'suspended')),
  revocation_reason TEXT,
  revoked_at TIMESTAMP WITH TIME ZONE,
  revoked_by UUID REFERENCES user_profiles(id),
  
  -- Lifecycle
  issued_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE, -- NULL = no expiration
  
  -- Usage Tracking
  first_used_at TIMESTAMP WITH TIME ZONE,
  last_used_at TIMESTAMP WITH TIME ZONE,
  usage_count BIGINT DEFAULT 0,
  
  -- Metadata
  metadata JSONB DEFAULT '{}'::JSONB, -- Additional terms, rate limits, etc.
  
  -- Audit
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_licenses_actor_id ON licenses(actor_id);
CREATE INDEX IF NOT EXISTS idx_licenses_api_client_id ON licenses(api_client_id);
CREATE INDEX IF NOT EXISTS idx_licenses_status ON licenses(status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_licenses_expires_at ON licenses(expires_at) WHERE expires_at IS NOT NULL AND status = 'active';
CREATE INDEX IF NOT EXISTS idx_licenses_consent_ledger_id ON licenses(consent_ledger_id);

-- ===========================================
-- LICENSE USAGE LOG TABLE (Optional - for analytics)
-- ===========================================
CREATE TABLE IF NOT EXISTS license_usage_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  license_id UUID NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  api_client_id UUID NOT NULL REFERENCES api_clients(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL,
  
  -- Request Details
  endpoint VARCHAR(255),
  method VARCHAR(10),
  requested_usage_type VARCHAR(100), -- What they tried to do
  
  -- Decision
  decision VARCHAR(50) NOT NULL CHECK (decision IN ('allow', 'deny', 'conditional')),
  reason TEXT,
  
  -- Context
  ip_address INET,
  user_agent TEXT,
  request_metadata JSONB DEFAULT '{}'::JSONB,
  
  -- Timing
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() CHECK (created_at <= NOW())
);

CREATE INDEX IF NOT EXISTS idx_license_usage_log_license_id ON license_usage_log(license_id);
CREATE INDEX IF NOT EXISTS idx_license_usage_log_actor_id ON license_usage_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_license_usage_log_created_at ON license_usage_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_license_usage_log_decision ON license_usage_log(decision);

-- ===========================================
-- FUNCTIONS: Consent Ledger Operations
-- ===========================================

-- Function: Get Latest Active Consent
CREATE OR REPLACE FUNCTION get_latest_consent(p_actor_id UUID)
RETURNS TABLE (
  id UUID,
  version INT,
  policy JSONB,
  status VARCHAR,
  created_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    cl.id,
    cl.version,
    cl.policy,
    cl.status,
    cl.created_at
  FROM consent_ledger cl
  WHERE cl.actor_id = p_actor_id
    AND cl.status = 'active'
  ORDER BY cl.version DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Function: Get Next Version Number
CREATE OR REPLACE FUNCTION get_next_consent_version(p_actor_id UUID)
RETURNS INT AS $$
DECLARE
  max_version INT;
BEGIN
  SELECT COALESCE(MAX(version), 0) INTO max_version
  FROM consent_ledger
  WHERE actor_id = p_actor_id;
  
  RETURN max_version + 1;
END;
$$ LANGUAGE plpgsql;

-- ===========================================
-- TRIGGERS
-- ===========================================

-- Trigger: Update updated_at on licenses
CREATE OR REPLACE FUNCTION update_licenses_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_licenses_updated_at
  BEFORE UPDATE ON licenses
  FOR EACH ROW
  EXECUTE FUNCTION update_licenses_updated_at();

-- Trigger: Update updated_at on api_clients
CREATE TRIGGER trigger_api_clients_updated_at
  BEFORE UPDATE ON api_clients
  FOR EACH ROW
  EXECUTE FUNCTION update_licenses_updated_at();

-- ===========================================
-- COMMENTS
-- ===========================================

COMMENT ON TABLE consent_ledger IS 'Immutable, versioned consent policy entries. Never update existing rows.';
COMMENT ON TABLE licenses IS 'License grants to API clients with permission snapshot from consent ledger.';
COMMENT ON TABLE api_clients IS 'Registered external API consumers requiring verified credentials.';
COMMENT ON TABLE license_usage_log IS 'Audit trail of API consent enforcement decisions.';

COMMENT ON COLUMN consent_ledger.version IS 'Incremental version per actor (1, 2, 3...). Use get_next_consent_version().';
COMMENT ON COLUMN consent_ledger.status IS 'active = current, superseded = replaced by newer version, revoked = explicitly canceled';
COMMENT ON COLUMN licenses.granted_permissions_snapshot IS 'Immutable snapshot of consent policy at license issuance time';
COMMENT ON COLUMN api_clients.credential_status IS 'Verification state: unverified → pending → verified. Can be suspended/revoked.';
