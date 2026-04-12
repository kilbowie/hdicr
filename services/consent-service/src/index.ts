import { APIGatewayProxyHandler } from 'aws-lambda';
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
