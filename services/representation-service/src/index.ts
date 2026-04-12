import { APIGatewayProxyHandler, APIGatewayProxyEvent } from 'aws-lambda';
import { DatabaseClient } from '@trulyimagined/database';
import {
  validateAuth0TokenWithStatus,
  getOrCreateCorrelationId,
  withCorrelationHeaders,
} from '@trulyimagined/middleware';
import { z } from 'zod';

/**
 * Representation Service - Lambda Handler
 * Handles actor-agent representation relationships
 * Manages requests, relationships, and approvals
 *
 * Endpoints:
 * - GET /v1/representation/actor - Get actor by auth0UserId
 * - GET /v1/representation/agent - Get agent by auth0UserId
 * - GET /v1/representation/active - Get active representation for actor
 * - GET /v1/representation/agent-by-registry - Get agent by registry ID
 * - GET /v1/representation/request/pending - Check pending request
 * - POST /v1/representation/request - Create representation request
 * - GET /v1/representation/requests/incoming - List incoming requests
 * - GET /v1/representation/requests/outgoing - List outgoing requests
 * - GET /v1/representation/request - Get request by ID
 * - POST /v1/representation/request/update - Update representation request
 * - GET /v1/representation/relationship/active - Check active relationship
 * - POST /v1/representation/relationship - Create relationship
 * - GET /v1/representation/relationship - Get relationship by ID
 * - POST /v1/representation/relationship/end - End relationship
 */

const db = DatabaseClient.getInstance();

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Content-Type': 'application/json',
};

const NonEmptyString = z.string().trim().min(1);
const ActorIdSchema = NonEmptyString;
const AgentIdSchema = NonEmptyString;
const RequestIdSchema = NonEmptyString;
const RelationshipIdSchema = NonEmptyString;

// Query parameter schemas
const ActorByAuth0Schema = z.object({
  auth0UserId: NonEmptyString,
});

const AgentByAuth0Schema = z.object({
  auth0UserId: NonEmptyString,
});

const ActiveRepresentationSchema = z.object({
  actorId: ActorIdSchema,
});

const AgentByRegistrySchema = z.object({
  registryId: NonEmptyString,
});

const PendingRequestSchema = z.object({
  actorId: ActorIdSchema,
  agentId: AgentIdSchema,
});

const IncomingRequestsSchema = z.object({
  agentId: AgentIdSchema,
});

const OutgoingRequestsSchema = z.object({
  actorId: ActorIdSchema,
});

const RequestByIdSchema = z.object({
  id: RequestIdSchema,
});

const RelationshipByIdSchema = z.object({
  id: RelationshipIdSchema,
});

const ActiveRelationshipSchema = z.object({
  actorId: ActorIdSchema,
});

// Request body schemas
const CreateRepresentationRequestSchema = z.object({
  actorId: ActorIdSchema,
  agentId: AgentIdSchema,
  message: z.string().trim().nullable().optional(),
});

const UpdateRepresentationRequestSchema = z.object({
  requestId: RequestIdSchema,
  action: z.enum(['approve', 'reject', 'withdraw']),
  responseNote: z.string().trim().nullable().optional(),
});

const CreateRelationshipSchema = z.object({
  actorId: ActorIdSchema,
  agentId: AgentIdSchema,
  representationRequestId: RequestIdSchema,
});

const EndRelationshipSchema = z.object({
  relationshipId: RelationshipIdSchema,
  endedByAuth0UserId: NonEmptyString,
  endedBy: z.enum(['actor', 'agent']),
});

/**
 * GET /v1/representation/actor
 * Retrieve actor by auth0UserId
 */
async function handleGetActorByAuth0(event: APIGatewayProxyEvent, tenantId: string) {
  try {
    const auth0UserId = event.queryStringParameters?.auth0UserId;
    if (!auth0UserId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'auth0UserId is required' }),
      };
    }

    const params = ActorByAuth0Schema.parse({ auth0UserId });
    const result = await db.queryWithTenant(
      tenantId,
      'SELECT id, auth0_user_id, email, name, created_at FROM actors WHERE auth0_user_id = $1 AND tenant_id = $2',
      [params.auth0UserId, tenantId]
    );

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ actor: result.rows[0] || null }),
    };
  } catch (error) {
    console.error('Error in handleGetActorByAuth0:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
}

/**
 * GET /v1/representation/agent
 * Retrieve agent by auth0UserId
 */
async function handleGetAgentByAuth0(event: APIGatewayProxyEvent, tenantId: string) {
  try {
    const auth0UserId = event.queryStringParameters?.auth0UserId;
    if (!auth0UserId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'auth0UserId is required' }),
      };
    }

    const params = AgentByAuth0Schema.parse({ auth0UserId });
    const result = await db.queryWithTenant(
      tenantId,
      'SELECT id, auth0_user_id, registry_id, agency_name, verification_status, profile_completed FROM agents WHERE auth0_user_id = $1 AND deleted_at IS NULL AND tenant_id = $2',
      [params.auth0UserId, tenantId]
    );

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ agent: result.rows[0] || null }),
    };
  } catch (error) {
    console.error('Error in handleGetAgentByAuth0:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
}

/**
 * GET /v1/representation/active
 * Get active representation relationship for an actor
 */
async function handleGetActiveRepresentation(event: APIGatewayProxyEvent, tenantId: string) {
  try {
    const actorId = event.queryStringParameters?.actorId;
    if (!actorId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'actorId is required' }),
      };
    }

    const params = ActiveRepresentationSchema.parse({ actorId });
    const result = await db.queryWithTenant(
      tenantId,
      `SELECT r.id, r.actor_id, r.agent_id, r.started_at,
              ag.registry_id, ag.agency_name, ag.verification_status, ag.profile_image_url, ag.location, ag.website_url
       FROM actor_agent_relationships r
       INNER JOIN agents ag ON ag.id = r.agent_id
       WHERE r.actor_id = $1 AND r.ended_at IS NULL AND ag.deleted_at IS NULL AND r.tenant_id = $2
       LIMIT 1`,
      [params.actorId, tenantId]
    );

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ relationship: result.rows[0] || null }),
    };
  } catch (error) {
    console.error('Error in handleGetActiveRepresentation:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
}

/**
 * GET /v1/representation/agent-by-registry
 * Get agent by registry ID
 */
async function handleGetAgentByRegistry(event: APIGatewayProxyEvent, tenantId: string) {
  try {
    const registryId = event.queryStringParameters?.registryId;
    if (!registryId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'registryId is required' }),
      };
    }

    const params = AgentByRegistrySchema.parse({ registryId });
    const result = await db.queryWithTenant(
      tenantId,
      'SELECT id, auth0_user_id, registry_id, agency_name, verification_status, profile_completed FROM agents WHERE registry_id = $1 AND deleted_at IS NULL AND tenant_id = $2',
      [params.registryId, tenantId]
    );

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ agent: result.rows[0] || null }),
    };
  } catch (error) {
    console.error('Error in handleGetAgentByRegistry:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
}

/**
 * GET /v1/representation/request/pending
 * Check if there is a pending representation request
 */
async function handleCheckPendingRequest(event: APIGatewayProxyEvent, tenantId: string) {
  try {
    const actorId = event.queryStringParameters?.actorId;
    const agentId = event.queryStringParameters?.agentId;

    if (!actorId || !agentId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'actorId and agentId are required' }),
      };
    }

    const params = PendingRequestSchema.parse({ actorId, agentId });
    const result = await db.queryWithTenant(
      tenantId,
      'SELECT 1 FROM representation_requests WHERE actor_id = $1 AND agent_id = $2 AND status = $3 AND tenant_id = $4 LIMIT 1',
      [params.actorId, params.agentId, 'pending', tenantId]
    );

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ pending: result.rows.length > 0 }),
    };
  } catch (error) {
    console.error('Error in handleCheckPendingRequest:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
}

/**
 * POST /v1/representation/request
 * Create a new representation request
 */
async function handleCreateRepresentationRequest(event: APIGatewayProxyEvent, tenantId: string) {
  try {
    const body = JSON.parse(event.body || '{}');
    const params = CreateRepresentationRequestSchema.parse(body);

    const requestId = crypto.randomUUID();
    const now = new Date().toISOString();

    await db.queryWithTenant(
      tenantId,
      `INSERT INTO representation_requests 
       (id, actor_id, agent_id, message, status, tenant_id, created_at, updated_at) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        requestId,
        params.actorId,
        params.agentId,
        params.message || null,
        'pending',
        tenantId,
        now,
        now,
      ]
    );

    const result = await db.queryWithTenant(
      tenantId,
      'SELECT * FROM representation_requests WHERE id = $1 AND tenant_id = $2',
      [requestId, tenantId]
    );

    return {
      statusCode: 201,
      headers: corsHeaders,
      body: JSON.stringify({ request: result.rows[0] }),
    };
  } catch (error) {
    console.error('Error in handleCreateRepresentationRequest:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
}

/**
 * GET /v1/representation/requests/incoming
 * List incoming representation requests for an agent
 */
async function handleListIncomingRequests(event: APIGatewayProxyEvent, tenantId: string) {
  try {
    const agentId = event.queryStringParameters?.agentId;
    if (!agentId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'agentId is required' }),
      };
    }

    const params = IncomingRequestsSchema.parse({ agentId });
    const result = await db.queryWithTenant(
      tenantId,
      `SELECT * FROM representation_requests 
       WHERE agent_id = $1 AND tenant_id = $2
       ORDER BY created_at DESC`,
      [params.agentId, tenantId]
    );

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ requests: result.rows }),
    };
  } catch (error) {
    console.error('Error in handleListIncomingRequests:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
}

/**
 * GET /v1/representation/requests/outgoing
 * List outgoing representation requests from an actor
 */
async function handleListOutgoingRequests(event: APIGatewayProxyEvent, tenantId: string) {
  try {
    const actorId = event.queryStringParameters?.actorId;
    if (!actorId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'actorId is required' }),
      };
    }

    const params = OutgoingRequestsSchema.parse({ actorId });
    const result = await db.queryWithTenant(
      tenantId,
      `SELECT * FROM representation_requests 
       WHERE actor_id = $1 AND tenant_id = $2
       ORDER BY created_at DESC`,
      [params.actorId, tenantId]
    );

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ requests: result.rows }),
    };
  } catch (error) {
    console.error('Error in handleListOutgoingRequests:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
}

/**
 * GET /v1/representation/request
 * Get representation request by ID
 */
async function handleGetRepresentationRequest(event: APIGatewayProxyEvent, tenantId: string) {
  try {
    const requestId = event.queryStringParameters?.id;
    if (!requestId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'id is required' }),
      };
    }

    const params = RequestByIdSchema.parse({ id: requestId });
    const result = await db.queryWithTenant(
      tenantId,
      'SELECT * FROM representation_requests WHERE id = $1 AND tenant_id = $2',
      [params.id, tenantId]
    );

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ request: result.rows[0] || null }),
    };
  } catch (error) {
    console.error('Error in handleGetRepresentationRequest:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
}

/**
 * POST /v1/representation/request/update
 * Update representation request (approve/reject/withdraw)
 */
async function handleUpdateRepresentationRequest(event: APIGatewayProxyEvent, tenantId: string) {
  try {
    const body = JSON.parse(event.body || '{}');
    const params = UpdateRepresentationRequestSchema.parse(body);

    const now = new Date().toISOString();

    await db.queryWithTenant(
      tenantId,
      `UPDATE representation_requests 
       SET status = $1, response_note = $2, updated_at = $3 
       WHERE id = $4 AND tenant_id = $5`,
      [params.action, params.responseNote || null, now, params.requestId, tenantId]
    );

    const result = await db.queryWithTenant(
      tenantId,
      'SELECT * FROM representation_requests WHERE id = $1 AND tenant_id = $2',
      [params.requestId, tenantId]
    );

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ request: result.rows[0] }),
    };
  } catch (error) {
    console.error('Error in handleUpdateRepresentationRequest:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
}

/**
 * GET /v1/representation/relationship/active
 * Check if actor has an active representation relationship
 */
async function handleCheckActiveRelationship(event: APIGatewayProxyEvent, tenantId: string) {
  try {
    const actorId = event.queryStringParameters?.actorId;
    if (!actorId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'actorId is required' }),
      };
    }

    const params = ActiveRelationshipSchema.parse({ actorId });
    const result = await db.queryWithTenant(
      tenantId,
      'SELECT 1 FROM actor_agent_relationships WHERE actor_id = $1 AND ended_at IS NULL AND tenant_id = $2 LIMIT 1',
      [params.actorId, tenantId]
    );

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ active: result.rows.length > 0 }),
    };
  } catch (error) {
    console.error('Error in handleCheckActiveRelationship:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
}

/**
 * POST /v1/representation/relationship
 * Create a new actor-agent relationship
 */
async function handleCreateRelationship(event: APIGatewayProxyEvent, tenantId: string) {
  try {
    const body = JSON.parse(event.body || '{}');
    const params = CreateRelationshipSchema.parse(body);

    const relationshipId = crypto.randomUUID();
    const now = new Date().toISOString();

    await db.queryWithTenant(
      tenantId,
      `INSERT INTO actor_agent_relationships 
       (id, actor_id, agent_id, representation_request_id, tenant_id, started_at, created_at, updated_at) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        relationshipId,
        params.actorId,
        params.agentId,
        params.representationRequestId,
        tenantId,
        now,
        now,
        now,
      ]
    );

    return {
      statusCode: 201,
      headers: corsHeaders,
      body: JSON.stringify({ success: true }),
    };
  } catch (error) {
    console.error('Error in handleCreateRelationship:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
}

/**
 * GET /v1/representation/relationship
 * Get actor-agent relationship by ID
 */
async function handleGetRelationship(event: APIGatewayProxyEvent, tenantId: string) {
  try {
    const relationshipId = event.queryStringParameters?.id;
    if (!relationshipId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'id is required' }),
      };
    }

    const params = RelationshipByIdSchema.parse({ id: relationshipId });
    const result = await db.queryWithTenant(
      tenantId,
      'SELECT * FROM actor_agent_relationships WHERE id = $1 AND tenant_id = $2',
      [params.id, tenantId]
    );

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ relationship: result.rows[0] || null }),
    };
  } catch (error) {
    console.error('Error in handleGetRelationship:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
}

/**
 * POST /v1/representation/relationship/end
 * End an actor-agent relationship
 */
async function handleEndRelationship(event: APIGatewayProxyEvent, tenantId: string) {
  try {
    const body = JSON.parse(event.body || '{}');
    const params = EndRelationshipSchema.parse(body);

    const now = new Date().toISOString();

    await db.queryWithTenant(
      tenantId,
      `UPDATE actor_agent_relationships 
       SET ended_at = $1, ended_by = $2, ended_by_auth0_user_id = $3, updated_at = $4 
       WHERE id = $5 AND tenant_id = $6`,
      [now, params.endedBy, params.endedByAuth0UserId, now, params.relationshipId, tenantId]
    );

    const result = await db.queryWithTenant(
      tenantId,
      'SELECT * FROM actor_agent_relationships WHERE id = $1 AND tenant_id = $2',
      [params.relationshipId, tenantId]
    );

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ relationship: result.rows[0] }),
    };
  } catch (error) {
    console.error('Error in handleEndRelationship:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
}

/**
 * Main Lambda handler - routes to appropriate handler based on path and method
 */
export const handler: APIGatewayProxyHandler = async (event: APIGatewayProxyEvent) => {
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

  console.log('[REPRESENTATION-SERVICE] Request received:', {
    path: event.path,
    method: event.httpMethod,
    pathParameters: event.pathParameters,
    correlationId,
  });

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: responseHeaders,
      body: '',
    };
  }

  // Validate authorization token - all endpoints require a valid caller
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

  // Extract tenant_id from authenticated user
  const tenantId = user.tenantId ?? process.env.HDICR_DEFAULT_TENANT_ID ?? 'trulyimagined';

  // Route based on path
  const path = event.path || '';
  const method = event.httpMethod || '';

  if (path.includes('/actor') && method === 'GET' && path.includes('auth0UserId')) {
    return withCorrelation(await handleGetActorByAuth0(event, tenantId));
  }

  if (
    path.includes('/agent') &&
    method === 'GET' &&
    path.includes('auth0UserId') &&
    !path.includes('registry')
  ) {
    return withCorrelation(await handleGetAgentByAuth0(event, tenantId));
  }

  if (path.includes('/agent-by-registry') && method === 'GET') {
    return withCorrelation(await handleGetAgentByRegistry(event, tenantId));
  }

  if (path.includes('/active') && method === 'GET') {
    if (path.includes('/request/')) {
      return withCorrelation(await handleCheckPendingRequest(event, tenantId));
    }
    if (path.includes('/relationship/')) {
      return withCorrelation(await handleCheckActiveRelationship(event, tenantId));
    }
    // Default: assume it's for representation
    return withCorrelation(await handleGetActiveRepresentation(event, tenantId));
  }

  if (
    path.includes('/request') &&
    method === 'POST' &&
    !path.includes('/requests') &&
    !path.includes('update')
  ) {
    return withCorrelation(await handleCreateRepresentationRequest(event, tenantId));
  }

  if (path.includes('/requests/incoming') && method === 'GET') {
    return withCorrelation(await handleListIncomingRequests(event, tenantId));
  }

  if (path.includes('/requests/outgoing') && method === 'GET') {
    return withCorrelation(await handleListOutgoingRequests(event, tenantId));
  }

  if (
    path.includes('/request') &&
    method === 'GET' &&
    !path.includes('requests') &&
    !path.includes('update')
  ) {
    return withCorrelation(await handleGetRepresentationRequest(event, tenantId));
  }

  if (path.includes('/request/update') && method === 'POST') {
    return withCorrelation(await handleUpdateRepresentationRequest(event, tenantId));
  }

  if (path.includes('/relationship') && method === 'POST' && !path.includes('/end')) {
    return withCorrelation(await handleCreateRelationship(event, tenantId));
  }

  if (path.includes('/relationship') && method === 'GET' && !path.includes('/end')) {
    return withCorrelation(await handleGetRelationship(event, tenantId));
  }

  if (path.includes('/relationship/end') && method === 'POST') {
    return withCorrelation(await handleEndRelationship(event, tenantId));
  }

  if (path.includes('/relationship/active') && method === 'GET') {
    return withCorrelation(await handleCheckActiveRelationship(event, tenantId));
  }

  return {
    statusCode: 404,
    headers: responseHeaders,
    body: JSON.stringify({ error: 'Not found' }),
  };
};
