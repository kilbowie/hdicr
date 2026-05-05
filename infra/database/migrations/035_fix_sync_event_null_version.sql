-- TABLE OWNER: HDICR
-- Migration 035: Fix fn_emit_sync_event NULL source_version for tables without updated_at
-- Date: 2026-05-06
-- Purpose:
--   consent_ledger is append-only and has no updated_at column. The sync event
--   trigger computed source_version via EXTRACT(EPOCH FROM updated_at::TIMESTAMPTZ).
--   When updated_at is absent, the JSONB field is NULL; casting NULL to TIMESTAMPTZ
--   returns NULL (no exception), so source_version was NULL — violating the NOT NULL
--   constraint on sync_events.source_version and blocking all consent_ledger INSERTs.
--
--   Fix: after the EXCEPTION block, add an explicit NULL guard that falls back to
--   EXTRACT(EPOCH FROM NOW()). This makes the function robust for any table that
--   does not carry an updated_at column.

CREATE OR REPLACE FUNCTION public.fn_emit_sync_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_event_type  TEXT;
  v_version     BIGINT;
  v_agg_id      UUID;
  v_tenant_id   VARCHAR(100);
  v_payload     JSONB;
  v_dedupe_key  TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_event_type := 'created';
    v_agg_id    := NEW.id;
    v_tenant_id := NEW.tenant_id;
    v_payload   := to_jsonb(NEW);
  ELSIF TG_OP = 'DELETE' THEN
    v_event_type := 'deleted';
    v_agg_id    := OLD.id;
    v_tenant_id := OLD.tenant_id;
    v_payload   := to_jsonb(OLD);
  ELSE
    IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
      v_event_type := 'deleted';
    ELSE
      v_event_type := 'updated';
    END IF;
    v_agg_id    := NEW.id;
    v_tenant_id := NEW.tenant_id;
    v_payload   := to_jsonb(NEW);
  END IF;

  -- Use updated_at epoch as version when present; fall back to NOW() when
  -- the column is absent (NULL cast) or the cast raises an error.
  BEGIN
    v_version := EXTRACT(EPOCH FROM (v_payload->>'updated_at')::TIMESTAMPTZ)::BIGINT;
  EXCEPTION WHEN OTHERS THEN
    v_version := NULL;
  END;

  IF v_version IS NULL THEN
    v_version := EXTRACT(EPOCH FROM NOW())::BIGINT;
  END IF;

  v_dedupe_key := TG_TABLE_NAME || ':' || v_agg_id::TEXT || ':' || v_version::TEXT;

  INSERT INTO public.sync_events (
    aggregate_type, aggregate_id, event_type, tenant_id,
    payload, source_version, dedupe_key, occurred_at
  ) VALUES (
    TG_TABLE_NAME, v_agg_id, v_event_type, v_tenant_id,
    v_payload, v_version, v_dedupe_key, NOW()
  )
  ON CONFLICT (dedupe_key) DO NOTHING;

  RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION public.fn_emit_sync_event() IS
  'Outbox trigger: emits a sync_events row for every INSERT/UPDATE/DELETE on tracked tables. Falls back to NOW() when updated_at is absent.';
