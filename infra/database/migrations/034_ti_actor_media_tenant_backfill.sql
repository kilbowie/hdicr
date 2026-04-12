-- TABLE OWNER: TI
-- Migration 034: Ensure actor_media tenant/index shape after separation updates
-- Date: 2026-04-11
-- Purpose: Add tenant_id and tenant-scoped indexes for actor_media without hard FK.

ALTER TABLE actor_media
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(100) NOT NULL DEFAULT 'trulyimagined';

CREATE INDEX IF NOT EXISTS idx_actor_media_tenant_id
  ON actor_media(tenant_id);

CREATE INDEX IF NOT EXISTS idx_actor_media_tenant_actor_type
  ON actor_media(tenant_id, actor_id, media_type);

COMMENT ON COLUMN actor_media.tenant_id IS 'Tenant identifier owning this media record';
