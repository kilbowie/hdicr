-- TABLE OWNER: HDICR
-- Truly Imagined v3 - Migration 005: Verifiable Credentials
-- W3C Verifiable Credentials Issuance Infrastructure
-- Enables issuing privacy-preserving, cryptographically-signed credentials

-- ===========================================
-- VERIFIABLE_CREDENTIALS TABLE
-- ===========================================
-- Purpose: Store W3C Verifiable Credentials issued to users
-- Standards: W3C VC Data Model 1.1, DID Core 1.0, Ed25519Signature2020

CREATE TABLE IF NOT EXISTS verifiable_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Foreign Key to User Profile
  user_profile_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,

  -- Credential Type
  credential_type VARCHAR(100) NOT NULL,   -- 'IdentityCredential', 'AgentCredential', 'ActorCredential', 'VerifiedAgeCredential'

  -- W3C Verifiable Credential (Full Document)
  credential_json JSONB NOT NULL,          -- Complete W3C VC JSON-LD document with proof

  -- DID Information
  issuer_did VARCHAR(500) NOT NULL,        -- DID of issuer (platform): 'did:web:trulyimagined.com'
  holder_did VARCHAR(500) NOT NULL,        -- DID of holder (user): 'did:web:trulyimagined.com:users:{userId}'

  -- Lifecycle Management
  issued_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE,     -- Optional expiration date
  is_revoked BOOLEAN DEFAULT FALSE,
  revoked_at TIMESTAMP WITH TIME ZONE,
  revocation_reason TEXT,                  -- Optional reason for revocation

  -- Verification Context
  verification_method VARCHAR(500),        -- DID verification method used for signing
  proof_type VARCHAR(100),                 -- 'Ed25519Signature2020', 'JsonWebSignature2020'
  nonce VARCHAR(255),                      -- Anti-replay nonce used in proof

  -- Audit Trail
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Constraints
  CONSTRAINT valid_credential_type CHECK (
    credential_type IN (
      'IdentityCredential',
      'AgentCredential', 
      'ActorCredential',
      'EnterpriseCredential',
      'VerifiedAgeCredential',
      'VerifiedProfessionalCredential'
    )
  )
);

-- ===========================================
-- INDEXES FOR PERFORMANCE
-- ===========================================
CREATE INDEX IF NOT EXISTS idx_verifiable_credentials_user_profile_id ON verifiable_credentials(user_profile_id);
CREATE INDEX IF NOT EXISTS idx_verifiable_credentials_credential_type ON verifiable_credentials(credential_type);
CREATE INDEX IF NOT EXISTS idx_verifiable_credentials_issuer_did ON verifiable_credentials(issuer_did);
CREATE INDEX IF NOT EXISTS idx_verifiable_credentials_holder_did ON verifiable_credentials(holder_did);
CREATE INDEX IF NOT EXISTS idx_verifiable_credentials_is_revoked ON verifiable_credentials(is_revoked);
CREATE INDEX IF NOT EXISTS idx_verifiable_credentials_issued_at ON verifiable_credentials(issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_verifiable_credentials_expires_at ON verifiable_credentials(expires_at) WHERE expires_at IS NOT NULL;

-- ===========================================
-- UPDATE TIMESTAMP TRIGGER
-- ===========================================
CREATE OR REPLACE FUNCTION update_verifiable_credentials_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_verifiable_credentials_updated_at
BEFORE UPDATE ON verifiable_credentials
FOR EACH ROW
EXECUTE FUNCTION update_verifiable_credentials_updated_at();

-- ===========================================
-- COMMENTS FOR DOCUMENTATION
-- ===========================================
COMMENT ON TABLE verifiable_credentials IS 'W3C Verifiable Credentials issued to users based on verified identity links';
COMMENT ON COLUMN verifiable_credentials.credential_json IS 'Complete W3C VC JSON-LD document including @context, type, credentialSubject, issuer, issuanceDate, proof';
COMMENT ON COLUMN verifiable_credentials.issuer_did IS 'Decentralized Identifier of the credential issuer (Truly Imagined platform)';
COMMENT ON COLUMN verifiable_credentials.holder_did IS 'Decentralized Identifier of the credential holder (user)';
COMMENT ON COLUMN verifiable_credentials.verification_method IS 'Public key reference used for signature verification (e.g., did:web:trulyimagined.com#key-1)';
COMMENT ON COLUMN verifiable_credentials.proof_type IS 'Cryptographic signature suite used (Ed25519Signature2020 for EdDSA signatures)';
