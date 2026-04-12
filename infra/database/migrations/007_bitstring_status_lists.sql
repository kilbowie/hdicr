-- TABLE OWNER: HDICR
-- Truly Imagined v3 - Migration 006: Bitstring Status Lists
-- W3C Bitstring Status List v1.0 Implementation
-- Standards: https://www.w3.org/TR/vc-bitstring-status-list/

-- ===========================================
-- BITSTRING_STATUS_LISTS TABLE
-- ===========================================
-- Purpose: Store BitstringStatusListCredentials for efficient revocation checking
-- Each list can hold 131,072 credentials (16KB uncompressed bitstring)

CREATE TABLE IF NOT EXISTS bitstring_status_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Status List Metadata
  list_id VARCHAR(100) UNIQUE NOT NULL,    -- e.g., 'revocation-2024-01'
  status_purpose VARCHAR(50) NOT NULL,     -- 'revocation', 'suspension', or 'message'
  
  -- Bitstring Data (GZIP compressed, multibase-encoded)
  encoded_list TEXT NOT NULL,              -- Base64url-encoded GZIP-compressed bitstring (min 16KB uncompressed)
  bitstring_size INTEGER NOT NULL DEFAULT 131072,  -- Number of bits in uncompressed bitstring (default 131,072)
  
  -- List Capacity
  current_index INTEGER NOT NULL DEFAULT 0,        -- Next available index in the list
  max_index INTEGER NOT NULL DEFAULT 131071,       -- Maximum index (bitstring_size - 1)
  is_full BOOLEAN DEFAULT FALSE,                   -- TRUE when current_index >= max_index
  
  -- W3C VerifiableCredential (BitstringStatusListCredential)
  credential_json JSONB NOT NULL,          -- Complete signed BitstringStatusListCredential
  
  -- Time-to-Live (caching hint)
  ttl_milliseconds INTEGER,                -- Time to live before refresh (milliseconds)
  
  -- Validity Period
  valid_from TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  valid_until TIMESTAMP WITH TIME ZONE,    -- Optional expiration
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT valid_status_purpose CHECK (
    status_purpose IN ('revocation', 'suspension', 'message')
  ),
  CONSTRAINT valid_current_index CHECK (current_index >= 0 AND current_index <= max_index),
  CONSTRAINT valid_bitstring_size CHECK (bitstring_size >= 131072)  -- W3C minimum
);

-- ===========================================
-- CREDENTIAL_STATUS_ENTRIES TABLE
-- ===========================================
-- Purpose: Track which credential is at which index in which status list
-- Enables fast lookup and prevents index collisions

CREATE TABLE IF NOT EXISTS credential_status_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Foreign Keys
  credential_id UUID NOT NULL REFERENCES verifiable_credentials(id) ON DELETE CASCADE,
  status_list_id UUID NOT NULL REFERENCES bitstring_status_lists(id) ON DELETE CASCADE,
  
  -- Status Entry Details (from BitstringStatusListEntry)
  status_list_index INTEGER NOT NULL,      -- Position in bitstring (0 to max_index)
  status_purpose VARCHAR(50) NOT NULL,     -- Must match status_list's purpose
  status_size INTEGER DEFAULT 1,           -- Size of status entry in bits (default 1)
  
  -- Entry Status URL (for credentialStatus.id in VC)
  entry_url VARCHAR(500) NOT NULL UNIQUE,  -- e.g., 'https://trulyimagined.com/api/credentials/status/revocation-2024-01#12345'
  
  -- Current Status Value
  status_value INTEGER DEFAULT 0,          -- 0 = valid/unrevoked, 1 = invalid/revoked
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT unique_credential_status_purpose UNIQUE (credential_id, status_purpose),
  CONSTRAINT unique_list_index UNIQUE (status_list_id, status_list_index),
  CONSTRAINT valid_status_value CHECK (status_value >= 0)
);

-- ===========================================
-- INDEXES FOR PERFORMANCE
-- ===========================================

-- Bitstring Status Lists
CREATE INDEX IF NOT EXISTS idx_bitstring_status_lists_list_id ON bitstring_status_lists(list_id);
CREATE INDEX IF NOT EXISTS idx_bitstring_status_lists_status_purpose ON bitstring_status_lists(status_purpose);
CREATE INDEX IF NOT EXISTS idx_bitstring_status_lists_is_full ON bitstring_status_lists(is_full) WHERE is_full = FALSE;
CREATE INDEX IF NOT EXISTS idx_bitstring_status_lists_valid_from ON bitstring_status_lists(valid_from DESC);
CREATE INDEX IF NOT EXISTS idx_bitstring_status_lists_updated_at ON bitstring_status_lists(updated_at DESC);

-- Credential Status Entries
CREATE INDEX IF NOT EXISTS idx_credential_status_entries_credential_id ON credential_status_entries(credential_id);
CREATE INDEX IF NOT EXISTS idx_credential_status_entries_status_list_id ON credential_status_entries(status_list_id);
CREATE INDEX IF NOT EXISTS idx_credential_status_entries_status_list_index ON credential_status_entries(status_list_id, status_list_index);
CREATE INDEX IF NOT EXISTS idx_credential_status_entries_status_value ON credential_status_entries(status_value);
CREATE INDEX IF NOT EXISTS idx_credential_status_entries_entry_url ON credential_status_entries(entry_url);

-- ===========================================
-- UPDATE TIMESTAMP TRIGGERS
-- ===========================================

CREATE OR REPLACE FUNCTION update_bitstring_status_lists_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_bitstring_status_lists_updated_at
BEFORE UPDATE ON bitstring_status_lists
FOR EACH ROW
EXECUTE FUNCTION update_bitstring_status_lists_updated_at();

CREATE OR REPLACE FUNCTION update_credential_status_entries_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_credential_status_entries_updated_at
BEFORE UPDATE ON credential_status_entries
FOR EACH ROW
EXECUTE FUNCTION update_credential_status_entries_updated_at();

-- ===========================================
-- ADD CREDENTIAL_ID COLUMN TO verifiable_credentials
-- ===========================================
-- Add unique credential ID for W3C VC 2.0 compliance

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'verifiable_credentials' 
    AND column_name = 'credential_id'
  ) THEN
    ALTER TABLE verifiable_credentials 
    ADD COLUMN credential_id VARCHAR(500) UNIQUE;
    
    -- CREATE INDEX IF NOT EXISTS for fast lookup
    CREATE INDEX IF NOT EXISTS idx_verifiable_credentials_credential_id 
    ON verifiable_credentials(credential_id);
  END IF;
END $$;

-- ===========================================
-- COMMENTS FOR DOCUMENTATION
-- ===========================================

COMMENT ON TABLE bitstring_status_lists IS 'W3C BitstringStatusListCredentials for privacy-preserving credential status checking';
COMMENT ON COLUMN bitstring_status_lists.encoded_list IS 'Multibase-encoded base64url GZIP-compressed bitstring (min 131,072 bits uncompressed)';
COMMENT ON COLUMN bitstring_status_lists.status_purpose IS 'Purpose of status list: revocation (permanent), suspension (temporary), or message (custom)';
COMMENT ON COLUMN bitstring_status_lists.current_index IS 'Next available index for new credentials (increments as credentials are added)';
COMMENT ON COLUMN bitstring_status_lists.ttl_milliseconds IS 'Time-to-live hint for caching (milliseconds before refresh should be attempted)';

COMMENT ON TABLE credential_status_entries IS 'Maps credentials to their position in bitstring status lists (BitstringStatusListEntry)';
COMMENT ON COLUMN credential_status_entries.status_list_index IS 'Position in bitstring (0-based index, multiply by status_size for bit position)';
COMMENT ON COLUMN credential_status_entries.status_size IS 'Size of status entry in bits (1 for boolean, >1 for multi-state)';
COMMENT ON COLUMN credential_status_entries.status_value IS '0 = valid/unrevoked, 1 = invalid/revoked (for status_size=1)';
COMMENT ON COLUMN credential_status_entries.entry_url IS 'URL fragment for BitstringStatusListEntry.id in credential';

COMMENT ON COLUMN verifiable_credentials.credential_id IS 'Unique credential ID (URL) for W3C VC 2.0 compliance: https://trulyimagined.com/api/credentials/{uuid}';
