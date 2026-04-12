-- TABLE OWNER: HDICR
-- Migration 027: HDICR outbox sync events table and change-capture triggers
-- Date: 2026-04-11
-- Purpose: Provide a reliable transactional outbox for streaming HDICR changes to
--          TI read-model replicas. Consumers poll or tail this table; processed_at
--          is set by the sync worker once the event is applied to TI.
--
-- Design notes:
--   - Outbox writes are in the same transaction as the source mutation (atomicity).
--   - dedupe_key prevents duplicate events on re-run (e.g. table_name:row_id:version).
--   - retry_count + last_error support at-least-once delivery with error logging.
--   - Triggers capture INSERT, UPDATE and soft-delete (deleted_at set) on source tables.

-- ===========================================
-- OUTBOX TABLE
-- ===========================================
CREATE TABLE IF NOT EXISTS public.sync_events (
  id               UUID             PRIMARY KEY DEFAULT uuid_generate_v4(),
  aggregate_type   TEXT             NOT NULL,   -- e.g. 'user_profile', 'actor', 'consent_ledger', 'license'
  aggregate_id     UUID             NOT NULL,
  event_type       TEXT             NOT NULL,   -- 'created', 'updated', 'deleted'
  tenant_id        VARCHAR(100)     NOT NULL,
  payload          JSONB            NOT NULL DEFAULT '{}'::JSONB,
  source_version   BIGINT           NOT NULL DEFAULT 0,
  dedupe_key       TEXT             UNIQUE NOT NULL, -- format: <aggregate_type>:<aggregate_id>:<source_version>
  occurred_at      TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  processed_at     TIMESTAMPTZ,                  -- NULL = pending
  retry_count      INTEGER          NOT NULL DEFAULT 0,
  last_error       TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_events_pending
  ON public.sync_events(occurred_at ASC) WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sync_events_aggregate
  ON public.sync_events(aggregate_type, aggregate_id);
CREATE INDEX IF NOT EXISTS idx_sync_events_tenant
  ON public.sync_events(tenant_id, occurred_at ASC) WHERE processed_at IS NULL;

COMMENT ON TABLE public.sync_events IS 'Transactional outbox: HDICR change events to be synced to TI read models';
COMMENT ON COLUMN public.sync_events.dedupe_key IS 'Unique key preventing duplicate processing: <type>:<id>:<version>';
COMMENT ON COLUMN public.sync_events.processed_at IS 'Set by sync worker once event applied to TI; NULL means pending';

-- ===========================================
-- TRIGGER FUNCTION: build outbox payload
-- ===========================================
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
  -- Determine event type
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
    -- UPDATE: treat as 'deleted' when deleted_at transitions NULL -> non-null
    IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
      v_event_type := 'deleted';
    ELSE
      v_event_type := 'updated';
    END IF;
    v_agg_id    := NEW.id;
    v_tenant_id := NEW.tenant_id;
    v_payload   := to_jsonb(NEW);
  END IF;

  -- Use updated_at epoch as version, falling back to extract(epoch)
  BEGIN
    v_version := EXTRACT(EPOCH FROM (v_payload->>'updated_at')::TIMESTAMPTZ)::BIGINT;
  EXCEPTION WHEN OTHERS THEN
    v_version := EXTRACT(EPOCH FROM NOW())::BIGINT;
  END;

  v_dedupe_key := TG_TABLE_NAME || ':' || v_agg_id::TEXT || ':' || v_version::TEXT;

  INSERT INTO public.sync_events (
    aggregate_type,
    aggregate_id,
    event_type,
    tenant_id,
    payload,
    source_version,
    dedupe_key,
    occurred_at
  ) VALUES (
    TG_TABLE_NAME,
    v_agg_id,
    v_event_type,
    v_tenant_id,
    v_payload,
    v_version,
    v_dedupe_key,
    NOW()
  )
  ON CONFLICT (dedupe_key) DO NOTHING; -- idempotent: skip if already captured

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ===========================================
-- TRIGGERS: user_profiles
-- ===========================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sync_user_profiles') THEN
    CREATE TRIGGER trg_sync_user_profiles
      AFTER INSERT OR UPDATE OR DELETE ON public.user_profiles
      FOR EACH ROW EXECUTE FUNCTION public.fn_emit_sync_event();
  END IF;
END $$;

-- ===========================================
-- TRIGGERS: actors
-- ===========================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sync_actors') THEN
    CREATE TRIGGER trg_sync_actors
      AFTER INSERT OR UPDATE OR DELETE ON public.actors
      FOR EACH ROW EXECUTE FUNCTION public.fn_emit_sync_event();
  END IF;
END $$;

-- ===========================================
-- TRIGGERS: consent_ledger
-- ===========================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sync_consent_ledger') THEN
    CREATE TRIGGER trg_sync_consent_ledger
      AFTER INSERT OR UPDATE OR DELETE ON public.consent_ledger
      FOR EACH ROW EXECUTE FUNCTION public.fn_emit_sync_event();
  END IF;
END $$;

-- ===========================================
-- TRIGGERS: licenses
-- ===========================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sync_licenses') THEN
    CREATE TRIGGER trg_sync_licenses
      AFTER INSERT OR UPDATE OR DELETE ON public.licenses
      FOR EACH ROW EXECUTE FUNCTION public.fn_emit_sync_event();
  END IF;
END $$;

-- ===========================================
-- TRIGGERS: identity_links
-- ===========================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sync_identity_links') THEN
    CREATE TRIGGER trg_sync_identity_links
      AFTER INSERT OR UPDATE OR DELETE ON public.identity_links
      FOR EACH ROW EXECUTE FUNCTION public.fn_emit_sync_event();
  END IF;
END $$;
