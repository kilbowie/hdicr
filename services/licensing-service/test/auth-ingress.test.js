import { describe, expect, it, vi } from 'vitest';

vi.mock('@trulyimagined/middleware', () => ({
  validateAuth0TokenWithStatus: vi.fn(),
  hasScope: vi.fn().mockReturnValue(false),
  getOrCreateCorrelationId: vi.fn().mockReturnValue('test-correlation-id'),
  withCorrelationHeaders: vi.fn((headers, correlationId) => ({
    ...headers,
    'X-Correlation-ID': correlationId,
  })),
}));

vi.mock('@trulyimagined/database', () => ({
  DatabaseClient: {
    getInstance: () => ({
      query: vi.fn(),
    }),
  },
  queries: {
    licensing: {
      create: '',
      getByActor: '',
      approve: '',
      reject: '',
    },
  },
}));

import { validateAuth0TokenWithStatus, hasScope } from '@trulyimagined/middleware';
import { handler } from '../src/handler';

function makeEvent(method, path, overrides = {}) {
  return {
    body: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: method,
    isBase64Encoded: false,
    path,
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    resource: path,
    requestContext: {},
    ...overrides,
  };
}

describe('licensing-service auth ingress', () => {
  it('returns 401 for missing or invalid auth token', async () => {
    vi.mocked(validateAuth0TokenWithStatus).mockResolvedValueOnce({
      user: null,
      errorStatus: 401,
    });

    const response = await handler(makeEvent('POST', '/v1/license/request'), {}, () => {});

    expect(response?.statusCode).toBe(401);
    expect(response?.body).toContain('Unauthorized');
  });

  it('returns 403 when authenticated but missing read scope for GET', async () => {
    vi.mocked(validateAuth0TokenWithStatus).mockResolvedValueOnce({
      user: { sub: 'client@clients', scopes: [] },
    });
    vi.mocked(hasScope).mockReturnValueOnce(false);

    const response = await handler(makeEvent('GET', '/v1/license/actor/actor-123'), {}, () => {});

    expect(response?.statusCode).toBe(403);
    expect(response?.body).toContain('hdicr:licensing:read');
  });

  it('returns 403 when authenticated but missing write scope for POST', async () => {
    vi.mocked(validateAuth0TokenWithStatus).mockResolvedValueOnce({
      user: {
        sub: 'client@clients',
        scopes: ['hdicr:licensing:read'],
      },
    });
    vi.mocked(hasScope).mockReturnValueOnce(false);

    const response = await handler(makeEvent('POST', '/v1/license/request'), {}, () => {});

    expect(response?.statusCode).toBe(403);
    expect(response?.body).toContain('hdicr:licensing:write');
  });

  it('returns structured 400 details for invalid request payloads', async () => {
    vi.mocked(validateAuth0TokenWithStatus).mockResolvedValueOnce({
      user: { sub: 'client@clients', scopes: [] },
    });
    vi.mocked(hasScope).mockReturnValueOnce(true);

    const response = await handler(
      makeEvent('POST', '/v1/license/request', {
        body: JSON.stringify({
          actorId: '',
          requesterName: 'Requester',
          requesterEmail: 'not-an-email',
        }),
      }),
      {},
      () => {}
    );

    expect(response?.statusCode).toBe(400);
    expect(response?.body).toContain('Validation failed');
    expect(response?.body).toContain('actorId');
    expect(response?.body).toContain('requesterEmail');
  });

  it('returns structured 400 details for invalid licensing pagination queries', async () => {
    vi.mocked(validateAuth0TokenWithStatus).mockResolvedValueOnce({
      user: { sub: 'client@clients', scopes: [] },
    });
    vi.mocked(hasScope).mockReturnValueOnce(true);

    const response = await handler(
      makeEvent('GET', '/v1/license/actor/actor-123', {
        pathParameters: { actorId: 'actor-123' },
        queryStringParameters: { limit: '-1', offset: '0' },
      }),
      {},
      () => {}
    );

    expect(response?.statusCode).toBe(400);
    expect(response?.body).toContain('Validation failed');
    expect(response?.body).toContain('limit');
  });

  it('keeps CORS preflight unauthenticated', async () => {
    const response = await handler(makeEvent('OPTIONS', '/v1/license/request'), {}, () => {});

    expect(response?.statusCode).toBe(200);
  });
});
