-- TABLE OWNER: HDICR
-- Migration 022: Guardrails data-flow contracts and compliance views
-- Date: 2026-04-10
-- Purpose:
--   1) Add queryable compliance views over existing public.audit_log.
--   2) Provide read-only contract views for each plane's audit needs.

BEGIN;

-- ===========================================
-- 1) HDICR-FOCUSED AUDIT TRAIL VIEW
-- ===========================================
DO $$
DECLARE
  has_audit_tenant BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'audit_log'
      AND column_name = 'tenant_id'
  ) INTO has_audit_tenant;

  IF has_audit_tenant THEN
    EXECUTE $sql$
      CREATE OR REPLACE VIEW public.v_hdicr_audit_trail AS
      SELECT
        id,
        user_id,
        user_type,
        action,
        resource_type,
        resource_id,
        changes,
        created_at,
        tenant_id
      FROM public.audit_log
      WHERE resource_type IN (
        'actors',
        'consent_log',
        'consent_ledger',
        'identity_links',
        'verifiable_credentials'
      )
      ORDER BY created_at DESC
    $sql$;
  ELSE
    EXECUTE $sql$
      CREATE OR REPLACE VIEW public.v_hdicr_audit_trail AS
      SELECT
        id,
        user_id,
        user_type,
        action,
        resource_type,
        resource_id,
        changes,
        created_at,
        'trulyimagined'::VARCHAR(100) AS tenant_id
      FROM public.audit_log
      WHERE resource_type IN (
        'actors',
        'consent_log',
        'consent_ledger',
        'identity_links',
        'verifiable_credentials'
      )
      ORDER BY created_at DESC
    $sql$;
  END IF;
END $$;

COMMENT ON VIEW public.v_hdicr_audit_trail IS
  'Compliance view of audit_log entries related to HDICR domain resources.';

-- ===========================================
-- 2) TI-FOCUSED AUDIT TRAIL VIEW
-- ===========================================
DO $$
DECLARE
  has_audit_tenant BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'audit_log'
      AND column_name = 'tenant_id'
  ) INTO has_audit_tenant;

  IF has_audit_tenant THEN
    EXECUTE $sql$
      CREATE OR REPLACE VIEW public.v_ti_audit_trail AS
      SELECT
        id,
        user_id,
        user_type,
        action,
        resource_type,
        resource_id,
        changes,
        created_at,
        tenant_id
      FROM public.audit_log
      WHERE resource_type IN (
        'representation_requests',
        'actor_agent_relationships',
        'agents',
        'agency_team_members',
        'licenses',
        'licensing_requests',
        'usage_tracking',
        'payouts'
      )
      ORDER BY created_at DESC
    $sql$;
  ELSE
    EXECUTE $sql$
      CREATE OR REPLACE VIEW public.v_ti_audit_trail AS
      SELECT
        id,
        user_id,
        user_type,
        action,
        resource_type,
        resource_id,
        changes,
        created_at,
        'trulyimagined'::VARCHAR(100) AS tenant_id
      FROM public.audit_log
      WHERE resource_type IN (
        'representation_requests',
        'actor_agent_relationships',
        'agents',
        'agency_team_members',
        'licenses',
        'licensing_requests',
        'usage_tracking',
        'payouts'
      )
      ORDER BY created_at DESC
    $sql$;
  END IF;
END $$;

COMMENT ON VIEW public.v_ti_audit_trail IS
  'Compliance view of audit_log entries related to TI commercial resources.';

-- ===========================================
-- 3) CROSS-PLANE ACCESS SUMMARY
-- ===========================================
CREATE OR REPLACE VIEW public.v_cross_plane_access AS
SELECT
  user_type AS app_role,
  resource_type,
  COUNT(*)::BIGINT AS access_count,
  MAX(created_at) AS last_access_at,
  CASE
    WHEN user_type = 'ti_app' AND resource_type IN ('actors', 'consent_log', 'consent_ledger', 'identity_links')
      THEN 'TI reading HDICR domain'
    WHEN user_type = 'hdicr_app' AND resource_type IN ('licenses', 'licensing_requests', 'usage_tracking', 'payouts')
      THEN 'HDICR reading TI domain'
    WHEN user_type = 'ti_app' AND resource_type = 'consent_ledger'
      THEN 'TI access to HDICR consent domain'
    ELSE 'Unclassified'
  END AS access_pattern
FROM public.audit_log
GROUP BY user_type, resource_type
ORDER BY access_count DESC;

COMMENT ON VIEW public.v_cross_plane_access IS
  'Operational summary of cross-plane activity derived from audit_log.';

COMMIT;
