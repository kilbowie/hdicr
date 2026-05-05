import { APIGatewayProxyHandler, APIGatewayProxyEvent } from 'aws-lambda';
import { DatabaseClient, queries } from '@trulyimagined/database';
import {
  validateAuth0TokenWithStatus,
  hasScope,
  getOrCreateCorrelationId,
  withCorrelationHeaders,
} from '@trulyimagined/middleware';
import { z } from 'zod';

/**
 * Licensing Service - Lambda Handler
 * Step 10: Licensing Service MVP (Phase 2)
 *
 * Handles licensing requests and approvals:
 * - POST /license/request - Request license from actor
 * - GET /license/actor/{actorId} - Get license requests for actor
 * - POST /license/{requestId}/approve - Approve license request
 * - POST /license/{requestId}/reject - Reject license request
 */

const db = DatabaseClient.getInstance();

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Content-Type': 'application/json',
};

const NonEmptyString = z.string().trim().min(1);

const PaginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(0).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const RequestLicenseSchema = z.object({
  actorId: NonEmptyString,
  requesterName: NonEmptyString,
  requesterEmail: z.string().trim().email(),
  requesterOrganization: NonEmptyString.optional(),
  projectName: NonEmptyString,
  projectDescription: NonEmptyString,
  usageType: NonEmptyString,
  intendedUse: NonEmptyString,
  durationStart: NonEmptyString.optional(),
  durationEnd: NonEmptyString.optional(),
  compensationOffered: z.union([z.number(), NonEmptyString]).optional(),
  compensationCurrency: NonEmptyString.default('USD'),
});

const RejectLicenseSchema = z.object({
  reason: NonEmptyString.optional(),
});

function validationErrorResponse(error: z.ZodError | string) {
  const details =
    typeof error === 'string' ? { formErrors: [error], fieldErrors: {} } : error.flatten();

  return {
    statusCode: 400,
    headers: corsHeaders,
    body: JSON.stringify({
      error: 'Validation failed',
      details,
    }),
  };
}

function parseJsonBody<T>(event: APIGatewayProxyEvent, schema: z.ZodType<T>) {
  let rawBody: unknown = {};

  try {
    rawBody = JSON.parse(event.body ?? '{}');
  } catch {
    return { success: false as const, response: validationErrorResponse('Invalid JSON body') };
  }

  const parsed = schema.safeParse(rawBody);
  if (!parsed.success) {
    return { success: false as const, response: validationErrorResponse(parsed.error) };
  }

  return { success: true as const, data: parsed.data };
}

export const handler: APIGatewayProxyHandler = async (event) => {
  const correlationId = getOrCreateCorrelationId(event);
  const responseHeaders = withCorrelationHeaders(corsHeaders, correlationId);
  const withCorrelation = (response: {
    statusCode: number;
    headers?: Record<string, string>;
    body: string;
  }) => ({
    ...response,
    headers: withCorrelationHeaders(response.headers ?? corsHeaders, correlationId),
  });

  console.log('[LICENSING-SERVICE] Request received:', {
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
    const requiredScope = httpMethod === 'GET' ? 'hdicr:licensing:read' : 'hdicr:licensing:write';
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

    // Route based on path and method
    if (path === '/v1/license/request' && httpMethod === 'POST') {
      return withCorrelation(await requestLicense(event, tenantId));
    }

    // has-pending-verification must be checked before the generic actor/ catch-all
    if (path.startsWith('/v1/license/actor/') && path.endsWith('/has-pending-verification') && httpMethod === 'GET') {
      return withCorrelation(await checkHasPendingVerification(event, tenantId));
    }

    if (path.startsWith('/v1/license/actor/') && httpMethod === 'GET') {
      return withCorrelation(await getLicenseRequests(event, tenantId));
    }

    if (path.startsWith('/v1/license/') && path.endsWith('/approve') && httpMethod === 'POST') {
      return withCorrelation(await approveLicense(event, tenantId));
    }

    if (path.startsWith('/v1/license/') && path.endsWith('/reject') && httpMethod === 'POST') {
      return withCorrelation(await rejectLicense(event, tenantId));
    }

    // /v1/licensing/ namespace — alias routes used by TI web app
    if (path === '/v1/licensing/actor-id' && httpMethod === 'GET') {
      return withCorrelation(await resolveActorId(event, tenantId));
    }

    if (path === '/v1/licensing/actor-requests' && httpMethod === 'GET') {
      return withCorrelation(await listActorRequestsAlias(event, tenantId));
    }

    if (path === '/v1/licensing/request' && httpMethod === 'GET') {
      return withCorrelation(await getLicensingRequestByIdAlias(event, tenantId));
    }

    if (path === '/v1/licensing/decision' && httpMethod === 'POST') {
      return withCorrelation(await applyDecision(event, tenantId));
    }

    if (path === '/v1/licensing/actor/licenses-and-stats' && httpMethod === 'GET') {
      return withCorrelation(await getActorLicensesAndStats(event, tenantId));
    }

    if (path === '/v1/licensing/agent-actor-data' && httpMethod === 'GET') {
      return withCorrelation(await getAgentActorData(event, tenantId));
    }

    if (path === '/v1/licensing/representation/active' && httpMethod === 'GET') {
      return withCorrelation(await checkRepresentationActive(event, tenantId));
    }

    return {
      statusCode: 404,
      headers: responseHeaders,
      body: JSON.stringify({ error: 'Not found' }),
    };
  } catch (error: any) {
    console.error('[LICENSING-SERVICE] Error:', { error, correlationId });
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

/**
 * Request a license from an actor
 */
async function requestLicense(event: APIGatewayProxyEvent, tenantId: string) {
  try {
    const parsedBody = parseJsonBody(event, RequestLicenseSchema);
    if (!parsedBody.success) {
      return parsedBody.response;
    }

    const {
      actorId,
      requesterName,
      requesterEmail,
      requesterOrganization,
      projectName,
      projectDescription,
      usageType,
      intendedUse,
      durationStart,
      durationEnd,
      compensationOffered,
      compensationCurrency,
    } = parsedBody.data;

    const result = await db.queryWithTenant(tenantId, queries.licensing.create, [
      tenantId,
      actorId,
      requesterName,
      requesterEmail,
      requesterOrganization,
      projectName,
      projectDescription,
      usageType,
      intendedUse,
      durationStart,
      durationEnd,
      compensationOffered,
      compensationCurrency,
    ]);

    const request = result.rows[0];

    return {
      statusCode: 201,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        message: 'License request submitted',
        request: {
          id: request.id,
          actorId: request.actor_id,
          projectName: request.project_name,
          usageType: request.usage_type,
          status: request.status,
          createdAt: request.created_at,
        },
      }),
    };
  } catch (error: any) {
    if (error.code === '23503') {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Actor not found' }),
      };
    }
    throw error;
  }
}

/**
 * Get license requests for an actor — path: /v1/license/actor/{actorId}
 */
async function getLicenseRequests(event: APIGatewayProxyEvent, tenantId: string) {
  const segments = event.path.split('/').filter(Boolean);
  const actorId = segments[3]; // ['v1', 'license', 'actor', '<actorId>']
  if (!actorId) {
    return validationErrorResponse('actorId is required in path');
  }

  const parsedQuery = PaginationQuerySchema.safeParse(event.queryStringParameters ?? {});
  if (!parsedQuery.success) {
    return validationErrorResponse(parsedQuery.error);
  }
  const { limit, offset } = parsedQuery.data;

  const result = await db.queryWithTenant(tenantId, queries.licensing.getByActor, [
    tenantId,
    actorId,
    limit,
    offset,
  ]);

  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      actorId,
      requests: result.rows.map((req: Record<string, unknown>) => ({
        id: req.id,
        requesterName: req.requester_name,
        requesterEmail: req.requester_email,
        requesterOrganization: req.requester_organization,
        projectName: req.project_name,
        projectDescription: req.project_description,
        usageType: req.usage_type,
        intendedUse: req.intended_use,
        compensationOffered: req.compensation_offered,
        compensationCurrency: req.compensation_currency,
        status: req.status,
        createdAt: req.created_at,
      })),
      pagination: { limit, offset, total: result.rowCount },
    }),
  };
}

/**
 * Approve a license request — path: /v1/license/{requestId}/approve
 */
async function approveLicense(event: APIGatewayProxyEvent, tenantId: string) {
  const segments = event.path.split('/').filter(Boolean);
  const requestId = segments[2]; // ['v1', 'license', '<requestId>', 'approve']
  if (!requestId) {
    return validationErrorResponse('requestId is required in path');
  }

  const result = await db.queryWithTenant(tenantId, queries.licensing.approve, [
    requestId,
    tenantId,
  ]);

  if (result.rows.length === 0) {
    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'License request not found' }),
    };
  }

  const request = result.rows[0];

  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      success: true,
      message: 'License approved',
      request: {
        id: request.id,
        status: request.status,
        approvedAt: request.approved_at,
      },
    }),
  };
}

/**
 * Reject a license request — path: /v1/license/{requestId}/reject
 */
async function rejectLicense(event: APIGatewayProxyEvent, tenantId: string) {
  const segments = event.path.split('/').filter(Boolean);
  const requestId = segments[2]; // ['v1', 'license', '<requestId>', 'reject']
  if (!requestId) {
    return validationErrorResponse('requestId is required in path');
  }

  const parsedBody = parseJsonBody(event, RejectLicenseSchema);
  if (!parsedBody.success) {
    return parsedBody.response;
  }
  const { reason } = parsedBody.data;

  const result = await db.queryWithTenant(tenantId, queries.licensing.reject, [
    requestId,
    reason,
    tenantId,
  ]);

  if (result.rows.length === 0) {
    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'License request not found' }),
    };
  }

  const request = result.rows[0];

  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      success: true,
      message: 'License rejected',
      request: {
        id: request.id,
        status: request.status,
        rejectedAt: request.rejected_at,
        rejectionReason: request.rejection_reason,
      },
    }),
  };
}

// ======================== /v1/licensing/ alias handlers ========================

async function resolveActorId(event: APIGatewayProxyEvent, tenantId: string) {
  const auth0UserId = event.queryStringParameters?.auth0UserId?.trim();
  if (!auth0UserId) {
    return validationErrorResponse('auth0UserId query parameter is required');
  }

  const result = await db.queryWithTenant(
    tenantId,
    'SELECT id FROM actors WHERE auth0_user_id = $1 AND tenant_id = $2 AND deleted_at IS NULL LIMIT 1',
    [auth0UserId, tenantId],
  );

  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({ actorId: result.rows[0]?.id ?? null }),
  };
}

async function listActorRequestsAlias(event: APIGatewayProxyEvent, tenantId: string) {
  const actorId = event.queryStringParameters?.actorId?.trim();
  const status = event.queryStringParameters?.status?.trim();
  const limit = Math.min(parseInt(event.queryStringParameters?.limit ?? '50', 10), 500);
  const offset = Math.max(parseInt(event.queryStringParameters?.offset ?? '0', 10), 0);

  if (!actorId) {
    return validationErrorResponse('actorId query parameter is required');
  }

  const params: unknown[] = [tenantId, actorId];
  let query = `SELECT * FROM licensing_requests WHERE tenant_id = $1 AND actor_id = $2::uuid`;

  if (status) {
    params.push(status);
    query += ` AND status = $${params.length}`;
  }

  query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);

  const result = await db.queryWithTenant(tenantId, query, params);
  const rows = result.rows as Record<string, unknown>[];

  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      requests: rows.map((req) => ({
        id: req.id,
        actorId: req.actor_id,
        requesterName: req.requester_name,
        requesterEmail: req.requester_email,
        requesterOrganization: req.requester_organization,
        projectName: req.project_name,
        projectDescription: req.project_description,
        usageType: req.usage_type,
        intendedUse: req.intended_use,
        compensationOffered: req.compensation_offered,
        compensationCurrency: req.compensation_currency,
        status: req.status,
        createdAt: req.created_at,
        approvedAt: req.approved_at,
        rejectedAt: req.rejected_at,
        rejectionReason: req.rejection_reason,
      })),
      pendingCount: rows.filter((r) => r.status === 'pending').length,
    }),
  };
}

async function getLicensingRequestByIdAlias(event: APIGatewayProxyEvent, tenantId: string) {
  const requestId = event.queryStringParameters?.id?.trim();
  if (!requestId) {
    return validationErrorResponse('id query parameter is required');
  }

  const result = await db.queryWithTenant(tenantId, queries.licensing.getById, [requestId, tenantId]);

  if (result.rows.length === 0) {
    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Licensing request not found' }),
    };
  }

  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({ request: result.rows[0] }),
  };
}

async function applyDecision(event: APIGatewayProxyEvent, tenantId: string) {
  const parsedBody = parseJsonBody(
    event,
    z.object({
      requestId: NonEmptyString,
      actorId: NonEmptyString.optional(),
      action: z.enum(['approve', 'reject']),
      rejectionReason: z.string().trim().optional(),
    }),
  );
  if (!parsedBody.success) {
    return parsedBody.response;
  }

  const { requestId, action, rejectionReason } = parsedBody.data;

  if (action === 'approve') {
    const result = await db.queryWithTenant(tenantId, queries.licensing.approve, [requestId, tenantId]);
    if (result.rows.length === 0) {
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: 'Request not found' }) };
    }
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ decision: result.rows[0] }) };
  }

  const result = await db.queryWithTenant(tenantId, queries.licensing.reject, [requestId, rejectionReason ?? null, tenantId]);
  if (result.rows.length === 0) {
    return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: 'Request not found' }) };
  }
  return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ decision: result.rows[0] }) };
}

async function getActorLicensesAndStats(event: APIGatewayProxyEvent, tenantId: string) {
  const actorId = event.queryStringParameters?.actorId?.trim();
  const status = event.queryStringParameters?.status?.trim();

  if (!actorId) {
    return validationErrorResponse('actorId query parameter is required');
  }

  const params: unknown[] = [tenantId, actorId];
  let query = `SELECT * FROM licensing_requests WHERE tenant_id = $1 AND actor_id = $2::uuid`;

  if (status) {
    params.push(status);
    query += ` AND status = $${params.length}`;
  }

  query += ` ORDER BY created_at DESC LIMIT 200`;

  const result = await db.queryWithTenant(tenantId, query, params);
  const rows = result.rows as Record<string, unknown>[];

  const stats = {
    total: rows.length,
    pending: rows.filter((r) => r.status === 'pending').length,
    approved: rows.filter((r) => r.status === 'approved').length,
    rejected: rows.filter((r) => r.status === 'rejected').length,
  };

  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      licenses: rows.map((req) => ({
        id: req.id,
        actorId: req.actor_id,
        requesterName: req.requester_name,
        projectName: req.project_name,
        usageType: req.usage_type,
        status: req.status,
        compensationOffered: req.compensation_offered,
        compensationCurrency: req.compensation_currency,
        createdAt: req.created_at,
        approvedAt: req.approved_at,
      })),
      stats,
    }),
  };
}

async function getAgentActorData(event: APIGatewayProxyEvent, tenantId: string) {
  const actorId = event.queryStringParameters?.actorId?.trim();
  if (!actorId) {
    return validationErrorResponse('actorId query parameter is required');
  }

  const result = await db.queryWithTenant(tenantId, queries.licensing.getByActor, [tenantId, actorId, 100, 0]);
  const rows = result.rows as Record<string, unknown>[];

  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      licensingRequests: rows.map((req) => ({
        id: req.id,
        requesterName: req.requester_name,
        projectName: req.project_name,
        usageType: req.usage_type,
        status: req.status,
        createdAt: req.created_at,
      })),
      licenses: rows
        .filter((r) => r.status === 'approved')
        .map((req) => ({
          id: req.id,
          projectName: req.project_name,
          usageType: req.usage_type,
          approvedAt: req.approved_at,
        })),
    }),
  };
}

async function checkRepresentationActive(event: APIGatewayProxyEvent, tenantId: string) {
  const actorId = event.queryStringParameters?.actorId?.trim();
  if (!actorId) {
    return validationErrorResponse('actorId query parameter is required');
  }

  // Confirm actor exists in this tenant; representation state lives in TI DB
  const result = await db.queryWithTenant(
    tenantId,
    'SELECT id FROM actors WHERE id = $1::uuid AND tenant_id = $2 AND deleted_at IS NULL LIMIT 1',
    [actorId, tenantId],
  );

  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({ active: result.rows.length > 0 }),
  };
}

async function checkHasPendingVerification(event: APIGatewayProxyEvent, tenantId: string) {
  const segments = event.path.split('/').filter(Boolean);
  const actorId = segments[3]; // ['v1', 'license', 'actor', '<actorId>', 'has-pending-verification']
  if (!actorId) {
    return validationErrorResponse('actorId is required in path');
  }

  const result = await db.queryWithTenant(
    tenantId,
    `SELECT EXISTS(
       SELECT 1 FROM manual_verification_sessions
       WHERE actor_id = $1::uuid
         AND tenant_id = $2
         AND status IN ('pending_scheduling', 'scheduled')
         AND deleted_at IS NULL
     ) AS has_pending`,
    [actorId, tenantId],
  );

  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      hasManualVerificationRequest: Boolean(result.rows[0]?.has_pending),
    }),
  };
}
