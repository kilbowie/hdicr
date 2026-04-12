import { describe, it, expect, vi } from 'vitest';
import { APIGatewayProxyEvent } from 'aws-lambda';

vi.mock('@trulyimagined/database', () => ({
  DatabaseClient: {
    getInstance: () => ({
      query: vi.fn(),
      queryWithTenant: vi.fn(),
    }),
  },
}));

vi.mock('@trulyimagined/middleware', () => ({
  validateAuth0TokenWithStatus: vi.fn(async (event: APIGatewayProxyEvent) => {
    const authHeader = event.headers?.Authorization || event.headers?.authorization;
    if (!authHeader) {
      return { user: null, errorStatus: 401 };
    }
    if (authHeader === 'Bearer invalid-token') {
      return { user: null, errorStatus: 403 };
    }
    return {
      user: {
        sub: 'client@clients',
        tenantId: 'trulyimagined',
        scopes: ['hdicr:representation:read'],
      },
    };
  }),
  getOrCreateCorrelationId: vi.fn().mockReturnValue('test-correlation-id'),
  withCorrelationHeaders: vi.fn((headers, correlationId) => ({
    ...headers,
    'X-Correlation-ID': correlationId,
  })),
}));

import { handler } from '../src/index';

/**
 * Auth Ingress Test — Representation Service
 * Validates that representation service endpoints require and validate Auth0 tokens
 * (similar to identity-service auth-ingress.test.js pattern)
 */

describe('[SEP-030] Representation Service - Auth Ingress', () => {
  it('should fail a request without Authorization header', async () => {
    const event: Partial<APIGatewayProxyEvent> = {
      httpMethod: 'POST',
      path: '/v1/representation/request',
      headers: {},
      body: JSON.stringify({
        actorId: 'test-actor',
        agentId: 'test-agent',
        message: 'Test',
      }),
    };

    const response = await handler(event as APIGatewayProxyEvent);
    expect(response.statusCode).toBe(401);
    expect(response.body).toContain('Unauthorized');
  });

  it('should fail a request with invalid Authorization token', async () => {
    const event: Partial<APIGatewayProxyEvent> = {
      httpMethod: 'POST',
      path: '/v1/representation/request',
      headers: {
        Authorization: 'Bearer invalid-token',
      },
      body: JSON.stringify({
        actorId: 'test-actor',
        agentId: 'test-agent',
        message: 'Test',
      }),
    };

    const response = await handler(event as APIGatewayProxyEvent);
    expect(response.statusCode).toBe(403);
    expect(response.body).toContain('Token rejected');
  });

  it('should reject unauthenticated GET requests', async () => {
    const event: Partial<APIGatewayProxyEvent> = {
      httpMethod: 'GET',
      path: '/v1/representation/actor',
      queryStringParameters: {
        auth0UserId: 'test-user',
      },
      headers: {},
    };

    const response = await handler(event as APIGatewayProxyEvent);
    expect(response.statusCode).toBe(401);
  });

  it('should handle CORS preflight requests', async () => {
    const event: Partial<APIGatewayProxyEvent> = {
      httpMethod: 'OPTIONS',
      path: '/v1/representation/request',
      headers: {},
    };

    const response = await handler(event as APIGatewayProxyEvent);
    expect(response.statusCode).toBe(200);
    expect(response.headers['Access-Control-Allow-Methods']).toContain('POST');
  });
});
