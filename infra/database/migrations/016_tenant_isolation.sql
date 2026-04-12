-- TABLE OWNER: HDICR
-- Migration 016: Tenant isolation for core HDICR tables
-- Date: 2026-04-08
-- Purpose: add tenant_id to the shared HDICR schema so service queries can be scoped
-- by tenant and existing Truly Imagined records are backfilled to 'trulyimagined'.

-- ===========================================
-- ADD TENANT_ID COLUMNS (backfilled via DEFAULT)
-- ===========================================
ALTER TABLE actors
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(100) NOT NULL DEFAULT 'trulyimagined';

ALTER TABLE consent_log
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(100) NOT NULL DEFAULT 'trulyimagined';

ALTER TABLE identity_links
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(100) NOT NULL DEFAULT 'trulyimagined';

ALTER TABLE verifiable_credentials
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(100) NOT NULL DEFAULT 'trulyimagined';

ALTER TABLE licensing_requests
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(100) NOT NULL DEFAULT 'trulyimagined';

ALTER TABLE usage_tracking
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(100) NOT NULL DEFAULT 'trulyimagined';

ALTER TABLE audit_log
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(100) NOT NULL DEFAULT 'trulyimagined';

ALTER TABLE representation_requests
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(100) NOT NULL DEFAULT 'trulyimagined';

ALTER TABLE actor_agent_relationships
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(100) NOT NULL DEFAULT 'trulyimagined';

-- ===========================================
-- TENANT-SCOPED INDEXES
-- ===========================================
CREATE INDEX IF NOT EXISTS idx_actors_tenant_id ON actors(tenant_id);
CREATE INDEX IF NOT EXISTS idx_actors_tenant_auth0_user_id ON actors(tenant_id, auth0_user_id);
CREATE INDEX IF NOT EXISTS idx_actors_tenant_registry_id ON actors(tenant_id, registry_id);

CREATE INDEX IF NOT EXISTS idx_consent_log_tenant_id ON consent_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_consent_log_tenant_actor_type ON consent_log(tenant_id, actor_id, consent_type);
CREATE INDEX IF NOT EXISTS idx_consent_log_tenant_created_at ON consent_log(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_identity_links_tenant_id ON identity_links(tenant_id);
CREATE INDEX IF NOT EXISTS idx_identity_links_tenant_user_active ON identity_links(tenant_id, user_profile_id, is_active);

CREATE INDEX IF NOT EXISTS idx_verifiable_credentials_tenant_id ON verifiable_credentials(tenant_id);
CREATE INDEX IF NOT EXISTS idx_verifiable_credentials_tenant_holder_did ON verifiable_credentials(tenant_id, holder_did);

CREATE INDEX IF NOT EXISTS idx_licensing_requests_tenant_id ON licensing_requests(tenant_id);
CREATE INDEX IF NOT EXISTS idx_licensing_requests_tenant_actor_id ON licensing_requests(tenant_id, actor_id);
CREATE INDEX IF NOT EXISTS idx_licensing_requests_tenant_status ON licensing_requests(tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_usage_tracking_tenant_id ON usage_tracking(tenant_id);
CREATE INDEX IF NOT EXISTS idx_usage_tracking_tenant_actor_id ON usage_tracking(tenant_id, actor_id);

CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_id ON audit_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_resource ON audit_log(tenant_id, resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_user ON audit_log(tenant_id, user_id);

CREATE INDEX IF NOT EXISTS idx_representation_requests_tenant_id ON representation_requests(tenant_id);
CREATE INDEX IF NOT EXISTS idx_representation_requests_tenant_actor_agent ON representation_requests(tenant_id, actor_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_representation_requests_tenant_status ON representation_requests(tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_actor_agent_relationships_tenant_id ON actor_agent_relationships(tenant_id);
CREATE INDEX IF NOT EXISTS idx_actor_agent_relationships_tenant_actor ON actor_agent_relationships(tenant_id, actor_id);
CREATE INDEX IF NOT EXISTS idx_actor_agent_relationships_tenant_agent ON actor_agent_relationships(tenant_id, agent_id);

-- ===========================================
-- DOCUMENTATION
-- ===========================================
COMMENT ON COLUMN actors.tenant_id IS 'Tenant identifier owning this actor record';
COMMENT ON COLUMN consent_log.tenant_id IS 'Tenant identifier owning this immutable consent event';
COMMENT ON COLUMN identity_links.tenant_id IS 'Tenant identifier owning this identity link';
COMMENT ON COLUMN verifiable_credentials.tenant_id IS 'Tenant identifier owning this verifiable credential';
COMMENT ON COLUMN licensing_requests.tenant_id IS 'Tenant identifier owning this licensing request';
COMMENT ON COLUMN usage_tracking.tenant_id IS 'Tenant identifier owning this usage-tracking record';
COMMENT ON COLUMN audit_log.tenant_id IS 'Tenant identifier owning this audit event';
COMMENT ON COLUMN representation_requests.tenant_id IS 'Tenant identifier owning this representation request';
COMMENT ON COLUMN actor_agent_relationships.tenant_id IS 'Tenant identifier owning this representation relationship';