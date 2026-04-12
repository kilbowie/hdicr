-- TABLE OWNER: HDICR
-- Migration 021: Guardrails immutability and audit enforcement
-- Date: 2026-04-10
-- Purpose:
--   1) Enforce append-only behavior on public.consent_ledger.
--   2) Log blocked UPDATE/DELETE attempts into existing public.audit_log.
--
-- Notes:
-- - This migration is adapted to current schema (public tables + existing audit_log format).
-- - INSERT into consent_ledger remains allowed.

BEGIN;

-- ===========================================
-- 1) HELPER: RESOLVE TENANT FOR A CONSENT ROW
-- ===========================================
CREATE OR REPLACE FUNCTION public.fn_guardrails_actor_tenant(p_actor_id UUID)
RETURNS VARCHAR AS $$
DECLARE
  v_tenant VARCHAR(100);
  has_actor_tenant BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'actors'
      AND column_name = 'tenant_id'
  ) INTO has_actor_tenant;

  IF has_actor_tenant THEN
    EXECUTE 'SELECT tenant_id FROM public.actors WHERE id = $1 LIMIT 1'
      INTO v_tenant
      USING p_actor_id;
  END IF;

  RETURN COALESCE(v_tenant, 'trulyimagined');
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION public.fn_guardrails_actor_tenant(UUID) IS
  'Returns actor tenant_id for consent_ledger audit records.';

-- ===========================================
-- 2) IMMUTABILITY TRIGGER FUNCTION
-- ===========================================
CREATE OR REPLACE FUNCTION public.fn_guardrails_block_consent_ledger_mutation()
RETURNS TRIGGER AS $$
DECLARE
  v_tenant VARCHAR(100);
BEGIN
  v_tenant := public.fn_guardrails_actor_tenant(COALESCE(OLD.actor_id, NEW.actor_id));

  INSERT INTO public.audit_log (
    user_id,
    user_type,
    action,
    resource_type,
    resource_id,
    changes,
    tenant_id
  )
  VALUES (
    NULL,
    current_user,
    'guardrails.consent_ledger.mutation_blocked',
    'consent_ledger',
    COALESCE(OLD.id, NEW.id),
    jsonb_build_object(
      'operation', TG_OP,
      'reason', 'consent_ledger is append-only',
      'before', CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
      'after', CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(NEW) ELSE NULL END
    ),
    v_tenant
  );

  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'consent_ledger is immutable: UPDATE is not allowed. Insert a new version row instead.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'consent_ledger is immutable: DELETE is not allowed.';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.fn_guardrails_block_consent_ledger_mutation() IS
  'Prevents UPDATE/DELETE on consent_ledger and records blocked attempts in audit_log.';

-- ===========================================
-- 3) ATTACH TRIGGER (IDEMPOTENT)
-- ===========================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_guardrails_consent_ledger_immutable'
  ) THEN
    CREATE TRIGGER trg_guardrails_consent_ledger_immutable
      BEFORE UPDATE OR DELETE ON public.consent_ledger
      FOR EACH ROW
      EXECUTE FUNCTION public.fn_guardrails_block_consent_ledger_mutation();
  END IF;
END $$;

-- ===========================================
-- 4) OPERATIONAL VIEW FOR BLOCKED ATTEMPTS
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
      CREATE OR REPLACE VIEW public.v_guardrails_blocked_mutations AS
      SELECT
        id,
        user_type,
        action,
        resource_type,
        resource_id,
        changes,
        created_at,
        tenant_id
      FROM public.audit_log
      WHERE action = 'guardrails.consent_ledger.mutation_blocked'
      ORDER BY created_at DESC
    $sql$;
  ELSE
    EXECUTE $sql$
      CREATE OR REPLACE VIEW public.v_guardrails_blocked_mutations AS
      SELECT
        id,
        user_type,
        action,
        resource_type,
        resource_id,
        changes,
        created_at,
        'trulyimagined'::VARCHAR(100) AS tenant_id
      FROM public.audit_log
      WHERE action = 'guardrails.consent_ledger.mutation_blocked'
      ORDER BY created_at DESC
    $sql$;
  END IF;
END $$;

COMMENT ON VIEW public.v_guardrails_blocked_mutations IS
  'Lists blocked consent_ledger UPDATE/DELETE attempts captured by guardrails.';

COMMIT;
