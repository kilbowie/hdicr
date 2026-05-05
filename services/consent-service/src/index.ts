import { APIGatewayProxyHandler, APIGatewayProxyEvent } from 'aws-lambda';
import { DatabaseClient } from '@trulyimagined/database';
import {
  validateAuth0TokenWithStatus,
  hasScope,
  getOrCreateCorrelationId,
  withCorrelationHeaders,
} from '@trulyimagined/middleware';
import { grantConsent } from './handlers/grant-consent';
import { revokeConsent } from './handlers/revoke-consent';
import { checkConsent } from './handlers/check-consent';
import { checkConsentEnforcement } from './handlers/check-consent-enforcement';
import { listConsents } from './handlers/list-consents';

/**
 * Consent Service - Lambda Handler
 * Step 6: Consent Ledger (CRITICAL)
 *
 * Routes requests to modular handlers:
 * - POST /consent/grant - Grant consent
 * - POST /consent/revoke - Revoke consent
 * - GET /consent/check - Check if consent is active
 * - GET /consent/{actorId} - List all consents for actor
 *
 * CRITICAL: This is an append-only ledger. No updates or deletes allowed.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Content-Type': 'application/json',
};

export const handler: APIGatewayProxyHandler = async (event) => {
  const correlationId = getOrCreateCorrelationId(event);
  const responseHeaders = withCorrelationHeaders(corsHeaders, correlationId);

  console.log('[CONSENT-SERVICE] Request received:', {
    path: event.path,
    method: event.httpMethod,
    pathParameters: event.pathParameters,
    correlationId,
  });

  const { httpMethod, path } = event;

  try {
    // Handle CORS preflight
    if (httpMethod === 'OPTIONS') {
      return { statusCode: 200, headers: responseHeaders, body: '' };
    }

    const authResult = await validateAuth0TokenWithStatus(event);
    if (!authResult.user) {
      return {
        statusCode: authResult.errorStatus || 401,
        headers: responseHeaders,
        body: JSON.stringify({
          error: authResult.errorStatus === 403 ? 'Token rejected' : 'Unauthorized',
        }),
      };
    }

    const user = authResult.user;

    // Scope-based authorization: require appropriate scope per HTTP method.
    const requiredScope = httpMethod === 'GET' ? 'hdicr:consent:read' : 'hdicr:consent:write';
    if (!hasScope(user, requiredScope)) {
      return {
        statusCode: 403,
        headers: responseHeaders,
        body: JSON.stringify({
          error: 'Forbidden',
          detail: `Missing required scope: ${requiredScope}`,
        }),
      };
    }

    const tenantId = user.tenantId ?? process.env.HDICR_DEFAULT_TENANT_ID ?? 'trulyimagined';

    // Route to handlers
    if (path === '/v1/consent/grant' && httpMethod === 'POST') {
      const response = await grantConsent(event, tenantId);
      return { ...response, headers: responseHeaders };
    }

    if (path === '/v1/consent/revoke' && httpMethod === 'POST') {
      const response = await revokeConsent(event, tenantId);
      return { ...response, headers: responseHeaders };
    }

    if (path === '/v1/consent/check' && httpMethod === 'GET') {
      const response = await checkConsent(event, tenantId);
      return { ...response, headers: responseHeaders };
    }

    if (path === '/v1/consent/enforcement/check' && httpMethod === 'POST') {
      const response = await checkConsentEnforcement(event, tenantId);
      return { ...response, headers: responseHeaders };
    }

    if (path === '/v1/consent/list' && httpMethod === 'GET') {
      const response = await listConsents(event, tenantId);
      return { ...response, headers: responseHeaders };
    }

    if (path === '/v1/consent/actor-context' && httpMethod === 'GET') {
      const response = await resolveActorContext(event, tenantId);
      return { ...response, headers: responseHeaders };
    }

    if (path === '/v1/consent-ledger/create' && httpMethod === 'POST') {
      const response = await createConsentLedgerEntry(event, tenantId);
      return { ...response, headers: responseHeaders };
    }

    if (path === '/v1/consent-ledger/current' && httpMethod === 'GET') {
      const response = await getConsentLedgerCurrent(event, tenantId);
      return { ...response, headers: responseHeaders };
    }

    if (path.startsWith('/v1/consent/') && httpMethod === 'GET') {
      const response = await listConsents(event, tenantId);
      return { ...response, headers: responseHeaders };
    }

    return {
      statusCode: 404,
      headers: responseHeaders,
      body: JSON.stringify({ error: 'Not found' }),
    };
  } catch (error: any) {
    console.error('[CONSENT-SERVICE] Error:', { error, correlationId });
    return {
      statusCode: 500,
      headers: responseHeaders,
      body: JSON.stringify({
        error: 'Internal server error',
        message: error.message,
      }),
    };
  }
};

async function resolveActorContext(
  event: APIGatewayProxyEvent,
  tenantId: string,
) {
  const db = DatabaseClient.getInstance();
  const auth0UserId = event.queryStringParameters?.auth0UserId?.trim();
  if (!auth0UserId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'auth0UserId query parameter is required' }),
    };
  }

  const result = await db.queryWithTenant(
    tenantId,
    `SELECT up.id AS user_profile_id, a.id AS actor_id
     FROM user_profiles up
     JOIN actors a
       ON a.auth0_user_id = up.auth0_user_id
       AND a.tenant_id = $2
       AND a.deleted_at IS NULL
     WHERE up.auth0_user_id = $1
     LIMIT 1`,
    [auth0UserId, tenantId],
  );

  if (result.rows.length === 0) {
    return {
      statusCode: 200,
      body: JSON.stringify({ context: null }),
    };
  }

  const row = result.rows[0];
  return {
    statusCode: 200,
    body: JSON.stringify({
      context: {
        userProfileId: row.user_profile_id,
        actorId: row.actor_id,
      },
    }),
  };
}

async function createConsentLedgerEntry(
  event: APIGatewayProxyEvent,
  tenantId: string,
) {
  const db = DatabaseClient.getInstance();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { actorId, policy, reason, updatedBy, ipAddress, userAgent } = body as Record<string, any>;
  if (!actorId || !policy || !updatedBy) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'actorId, policy, and updatedBy are required' }),
    };
  }

  const result = await db.queryWithTenant(
    tenantId,
    `WITH superseded AS (
       UPDATE consent_ledger
       SET status = 'superseded'
       WHERE actor_id = $1::uuid AND tenant_id = $5 AND status = 'active'
     )
     INSERT INTO consent_ledger (
       actor_id, version, policy, status, reason, updated_by, ip_address, user_agent, tenant_id
     ) VALUES (
       $1::uuid,
       get_next_consent_version($1::uuid),
       $2::jsonb,
       'active',
       $3,
       $4,
       $6,
       $7,
       $5
     )
     RETURNING *`,
    [actorId, JSON.stringify(policy), reason || null, updatedBy, tenantId, ipAddress || null, userAgent || null],
  );

  return {
    statusCode: 201,
    body: JSON.stringify({ entry: result.rows[0] }),
  };
}

async function getConsentLedgerCurrent(
  event: APIGatewayProxyEvent,
  tenantId: string,
) {
  const db = DatabaseClient.getInstance();
  const actorId = event.queryStringParameters?.actorId?.trim();
  const includeHistory = event.queryStringParameters?.includeHistory === 'true';

  if (!actorId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'actorId query parameter is required' }) };
  }

  const currentResult = await db.queryWithTenant(
    tenantId,
    `SELECT * FROM consent_ledger
     WHERE actor_id = $1::uuid AND tenant_id = $2 AND status = 'active'
     ORDER BY version DESC LIMIT 1`,
    [actorId, tenantId],
  );

  const current = currentResult.rows[0] ?? null;
  let history: unknown[] = [];

  if (includeHistory) {
    const historyResult = await db.queryWithTenant(
      tenantId,
      `SELECT * FROM consent_ledger
       WHERE actor_id = $1::uuid AND tenant_id = $2
       ORDER BY version DESC`,
      [actorId, tenantId],
    );
    history = historyResult.rows;
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ current, history, licensesOnCurrentVersion: 0 }),
  };
}
