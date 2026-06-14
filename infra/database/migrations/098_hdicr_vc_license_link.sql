-- TABLE OWNER: HDICR
-- Truly Imagined - Migration 098: Link Verifiable Credentials to licences
-- Supports auto-issued, licence-scoped credentials: a VC is issued when a
-- licence becomes active and is valid only for the licence period. The
-- license_id ties a credential to its licence so it can be revoked when the
-- licence ends early (e.g. a refund). No cross-DB FK to licenses (which lives
-- in the TI database) — kept as a plain UUID, consistent with migration 031.

-- 1. Licence linkage column
ALTER TABLE verifiable_credentials
  ADD COLUMN IF NOT EXISTS license_id UUID;

-- 2. Allow the new credential type
ALTER TABLE verifiable_credentials DROP CONSTRAINT IF EXISTS valid_credential_type;
ALTER TABLE verifiable_credentials ADD CONSTRAINT valid_credential_type CHECK (
  credential_type IN (
    'IdentityCredential',
    'AgentCredential',
    'ActorCredential',
    'EnterpriseCredential',
    'VerifiedAgeCredential',
    'VerifiedProfessionalCredential',
    'LicenseCredential'
  )
);

-- 3. Lookups by licence (revoke-on-refund) + at most one active credential per licence
CREATE INDEX IF NOT EXISTS idx_verifiable_credentials_license_id
  ON verifiable_credentials(license_id)
  WHERE license_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_verifiable_credentials_active_per_license
  ON verifiable_credentials(license_id)
  WHERE license_id IS NOT NULL AND is_revoked = false;

COMMENT ON COLUMN verifiable_credentials.license_id IS
  'TI licenses.id this credential was auto-issued for (no cross-DB FK). NULL for manually-issued identity credentials.';
