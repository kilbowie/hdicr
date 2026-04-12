-- TABLE OWNER: HDICR
-- Migration 018: Neutral schema aliases for multi-tenant terminology
-- Date: 2026-04-08
-- Purpose: provide additive, non-breaking neutral naming aliases for tenant onboarding.

-- Neutral identity-subject projection over legacy actor table names.
CREATE OR REPLACE VIEW v_identity_subjects AS
SELECT
  id AS identity_subject_id,
  id,
  tenant_id,
  auth0_user_id,
  email,
  first_name,
  last_name,
  stage_name,
  COALESCE(NULLIF(stage_name, ''), TRIM(CONCAT(first_name, ' ', last_name))) AS display_name,
  bio,
  location,
  profile_image_url,
  verification_status,
  registry_id,
  is_founding_member,
  created_at,
  updated_at
FROM actors;

COMMENT ON VIEW v_identity_subjects IS
  'Neutral alias view over actors for multi-tenant integrations (non-breaking additive layer).';

COMMENT ON COLUMN v_identity_subjects.identity_subject_id IS
  'Neutral alias for actors.id';

COMMENT ON COLUMN v_identity_subjects.display_name IS
  'Neutral alias for stage_name, with fallback to first_name + last_name';

COMMENT ON COLUMN v_identity_subjects.is_founding_member IS
  'Tenant-specific field (Truly Imagined) retained for backward compatibility.';

COMMENT ON COLUMN v_identity_subjects.registry_id IS
  'Tenant-specific registry identifier format retained for backward compatibility.';
