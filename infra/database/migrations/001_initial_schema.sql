-- TABLE OWNER: HDICR
-- Truly Imagined v3 - Initial Database Schema
-- PostgreSQL 15+
-- Phase 1: Identity Registry + Consent Ledger

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ===========================================
-- ACTORS TABLE (Identity Registry)
-- ===========================================
CREATE TABLE IF NOT EXISTS actors (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Auth0 Integration
  auth0_user_id VARCHAR(255) UNIQUE NOT NULL,
  
  -- Personal Information
  email VARCHAR(255) UNIQUE NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  stage_name VARCHAR(200),
  
  -- Professional Details
  bio TEXT,
  profile_image_url VARCHAR(500),
  location VARCHAR(200),
  
  -- Verification Status
  verification_status VARCHAR(50) DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified', 'rejected')),
  verified_at TIMESTAMP WITH TIME ZONE,
  verified_by UUID,
  
  -- Registry Metadata
  registry_id VARCHAR(100) UNIQUE, -- Public-facing registry ID (e.g., "TI-ACTOR-00001")
  is_founding_member BOOLEAN DEFAULT FALSE,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE, -- Soft delete
  
  -- Indexes
  CONSTRAINT valid_email CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
);

CREATE INDEX IF NOT EXISTS idx_actors_auth0_user_id ON actors(auth0_user_id);
CREATE INDEX IF NOT EXISTS idx_actors_email ON actors(email);
CREATE INDEX IF NOT EXISTS idx_actors_registry_id ON actors(registry_id);
CREATE INDEX IF NOT EXISTS idx_actors_verification_status ON actors(verification_status);
CREATE INDEX IF NOT EXISTS idx_actors_created_at ON actors(created_at DESC);

-- ===========================================
-- CONSENT LOG (Consent Ledger - CRITICAL)
-- ===========================================
CREATE TABLE IF NOT EXISTS consent_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Actor Reference
  actor_id UUID NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
  
  -- Consent Action
  action VARCHAR(50) NOT NULL CHECK (action IN ('granted', 'revoked', 'updated', 'requested')),
  
  -- Consent Scope
  consent_type VARCHAR(100) NOT NULL, -- e.g., 'voice_synthesis', 'image_usage', 'full_likeness'
  consent_scope JSONB NOT NULL DEFAULT '{}'::JSONB, -- Additional scope details
  
  -- Usage Context
  project_name VARCHAR(255),
  project_description TEXT,
  requester_id UUID, -- Who requested/recorded this consent
  requester_type VARCHAR(50), -- 'actor', 'agent', 'studio', 'admin'
  
  -- Audit Trail Data
  ip_address INET,
  user_agent TEXT,
  metadata JSONB DEFAULT '{}'::JSONB,
  
  -- Immutability
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  
  -- Note: No UPDATE or DELETE operations - append-only log
  CONSTRAINT no_future_dates CHECK (created_at <= NOW())
);

CREATE INDEX IF NOT EXISTS idx_consent_log_actor_id ON consent_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_consent_log_action ON consent_log(action);
CREATE INDEX IF NOT EXISTS idx_consent_log_consent_type ON consent_log(consent_type);
CREATE INDEX IF NOT EXISTS idx_consent_log_created_at ON consent_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_consent_log_requester_id ON consent_log(requester_id);

-- ===========================================
-- LICENSING REQUESTS (MVP)
-- ===========================================
CREATE TABLE IF NOT EXISTS licensing_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Actor Reference
  actor_id UUID NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
  
  -- Request Details
  requester_name VARCHAR(255) NOT NULL,
  requester_email VARCHAR(255) NOT NULL,
  requester_organization VARCHAR(255),
  
  -- Project Information
  project_name VARCHAR(255) NOT NULL,
  project_description TEXT NOT NULL,
  usage_type VARCHAR(100) NOT NULL, -- 'voice', 'image', 'full_likeness'
  intended_use TEXT NOT NULL,
  
  -- Terms
  duration_start DATE,
  duration_end DATE,
  compensation_offered DECIMAL(10, 2),
  compensation_currency VARCHAR(3) DEFAULT 'USD',
  
  -- Status
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  approved_at TIMESTAMP WITH TIME ZONE,
  rejected_at TIMESTAMP WITH TIME ZONE,
  rejection_reason TEXT,
  
  -- Metadata
  metadata JSONB DEFAULT '{}'::JSONB,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  CONSTRAINT valid_compensation CHECK (compensation_offered IS NULL OR compensation_offered >= 0)
);

CREATE INDEX IF NOT EXISTS idx_licensing_requests_actor_id ON licensing_requests(actor_id);
CREATE INDEX IF NOT EXISTS idx_licensing_requests_status ON licensing_requests(status);
CREATE INDEX IF NOT EXISTS idx_licensing_requests_created_at ON licensing_requests(created_at DESC);

-- ===========================================
-- USAGE TRACKING (Minutes Generated)
-- ===========================================
CREATE TABLE IF NOT EXISTS usage_tracking (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Actor Reference
  actor_id UUID NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
  
  -- License Reference
  licensing_request_id UUID REFERENCES licensing_requests(id),
  
  -- Usage Details
  usage_type VARCHAR(100) NOT NULL, -- 'voice_minutes', 'image_generation', 'video_seconds'
  quantity DECIMAL(10, 2) NOT NULL, -- e.g., 5.5 minutes, 10 images
  unit VARCHAR(50) NOT NULL, -- 'minutes', 'images', 'seconds'
  
  -- Context
  project_name VARCHAR(255),
  generated_by VARCHAR(255), -- System/user who generated
  
  -- Metadata
  metadata JSONB DEFAULT '{}'::JSONB,
  
  -- Timestamps (Immutable - append-only)
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  
  CONSTRAINT valid_quantity CHECK (quantity > 0)
);

CREATE INDEX IF NOT EXISTS idx_usage_tracking_actor_id ON usage_tracking(actor_id);
CREATE INDEX IF NOT EXISTS idx_usage_tracking_licensing_request_id ON usage_tracking(licensing_request_id);
CREATE INDEX IF NOT EXISTS idx_usage_tracking_created_at ON usage_tracking(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_tracking_usage_type ON usage_tracking(usage_type);

-- ===========================================
-- AUDIT LOG (System-wide audit trail)
-- ===========================================
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Who
  user_id UUID,
  user_type VARCHAR(50), -- 'actor', 'agent', 'admin', 'system'
  
  -- What
  action VARCHAR(100) NOT NULL,
  resource_type VARCHAR(100) NOT NULL,
  resource_id UUID,
  
  -- Changes
  changes JSONB DEFAULT '{}'::JSONB,
  
  -- Context
  ip_address INET,
  user_agent TEXT,
  
  -- When (Immutable)
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_resource_type ON audit_log(resource_type);
CREATE INDEX IF NOT EXISTS idx_audit_log_resource_id ON audit_log(resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC);

-- ===========================================
-- FUNCTIONS: Auto-update timestamps
-- ===========================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to tables with updated_at
CREATE TRIGGER update_actors_updated_at BEFORE UPDATE ON actors
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_licensing_requests_updated_at BEFORE UPDATE ON licensing_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ===========================================
-- SEED DATA: Admin/System Users (Optional)
-- ===========================================
-- Can be added later via migration scripts

COMMENT ON TABLE actors IS 'Identity Registry: All registered actors';
COMMENT ON TABLE consent_log IS 'Consent Ledger: Immutable append-only consent records (CRITICAL)';
COMMENT ON TABLE licensing_requests IS 'Licensing requests from studios/creators';
COMMENT ON TABLE usage_tracking IS 'Track AI-generated content usage (minutes/images)';
COMMENT ON TABLE audit_log IS 'System-wide audit trail';
