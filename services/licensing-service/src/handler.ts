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

const ActorIdPathSchema = z.object({
  actorId: NonEmptyString,
});

const RequestIdPathSchema = z.object({
  requestId: NonEmptyString,
});

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

    if (path.startsWith('/v1/license/actor/') && httpMethod === 'GET') {
      return withCorrelation(await getLicenseRequests(event, tenantId));
    }

    if (path.startsWith('/v1/license/') && path.endsWith('/approve') && httpMethod === 'POST') {
      return withCorrelation(await approveLicense(event, tenantId));
    }

    if (path.startsWith('/v1/license/') && path.endsWith('/reject') && httpMethod === 'POST') {
      return withCorrelation(await rejectLicense(event, tenantId));
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
 * Get license requests for an actor
 */
async function getLicenseRequests(event: APIGatewayProxyEvent, tenantId: string) {
  const parsedPath = ActorIdPathSchema.safeParse(event.pathParameters ?? {});
  if (!parsedPath.success) {
    return validationErrorResponse(parsedPath.error);
  }

  const parsedQuery = PaginationQuerySchema.safeParse(event.queryStringParameters ?? {});
  if (!parsedQuery.success) {
    return validationErrorResponse(parsedQuery.error);
  }

  const { actorId } = parsedPath.data;
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
 * Approve a license request
 */
async function approveLicense(event: APIGatewayProxyEvent, tenantId: string) {
  const parsedPath = RequestIdPathSchema.safeParse(event.pathParameters ?? {});
  if (!parsedPath.success) {
    return validationErrorResponse(parsedPath.error);
  }

  const { requestId } = parsedPath.data;

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
 * Reject a license request
 */
async function rejectLicense(event: APIGatewayProxyEvent, tenantId: string) {
  const parsedPath = RequestIdPathSchema.safeParse(event.pathParameters ?? {});
  if (!parsedPath.success) {
    return validationErrorResponse(parsedPath.error);
  }

  const parsedBody = parseJsonBody(event, RejectLicenseSchema);
  if (!parsedBody.success) {
    return parsedBody.response;
  }

  const { requestId } = parsedPath.data;
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
