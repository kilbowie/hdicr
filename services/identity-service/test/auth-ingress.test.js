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
    actors: {
      create: '',
      getById: '',
      list: '',
      update: '',
    },
    userProfiles: {
      listAdminUsersWithActors: '',
    },
  },
}));

import { validateAuth0TokenWithStatus, hasScope } from '@trulyimagined/middleware';
import { handler } from '../src/index';

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

describe('identity-service auth ingress', () => {
  it('returns 401 for missing or invalid auth token', async () => {
    vi.mocked(validateAuth0TokenWithStatus).mockResolvedValueOnce({
      user: null,
      errorStatus: 401,
    });

    const response = await handler(makeEvent('GET', '/v1/identity'), {}, () => {});

    expect(response?.statusCode).toBe(401);
    expect(response?.body).toContain('Unauthorized');
  });

  it('returns 403 when authenticated but missing required scope', async () => {
    vi.mocked(validateAuth0TokenWithStatus).mockResolvedValueOnce({
      user: { sub: 'client@clients', scopes: [] },
    });
    vi.mocked(hasScope).mockReturnValueOnce(false);

    const response = await handler(makeEvent('GET', '/v1/identity'), {}, () => {});

    expect(response?.statusCode).toBe(403);
    expect(response?.body).toContain('hdicr:identity:read');
  });

  it('returns 403 with write scope missing for POST', async () => {
    vi.mocked(validateAuth0TokenWithStatus).mockResolvedValueOnce({
      user: {
        sub: 'client@clients',
        scopes: ['hdicr:identity:read'],
      },
    });
    vi.mocked(hasScope).mockReturnValueOnce(false);

    const response = await handler(makeEvent('POST', '/v1/identity/register'), {}, () => {});

    expect(response?.statusCode).toBe(403);
    expect(response?.body).toContain('hdicr:identity:write');
  });

  it('returns structured 400 details for invalid register payloads', async () => {
    vi.mocked(validateAuth0TokenWithStatus).mockResolvedValueOnce({
      user: { sub: 'client@clients', scopes: [] },
    });
    vi.mocked(hasScope).mockReturnValueOnce(true);

    const response = await handler(
      makeEvent('POST', '/v1/identity/register', {
        body: JSON.stringify({ auth0UserId: '', email: 'not-an-email', firstName: 'Ada' }),
      }),
      {},
      () => {}
    );

    expect(response?.statusCode).toBe(400);
    expect(response?.body).toContain('Validation failed');
    expect(response?.body).toContain('email');
    expect(response?.body).toContain('lastName');
  });

  it('returns structured 400 details for invalid pagination queries', async () => {
    vi.mocked(validateAuth0TokenWithStatus).mockResolvedValueOnce({
      user: { sub: 'client@clients', scopes: [] },
    });
    vi.mocked(hasScope).mockReturnValueOnce(true);

    const response = await handler(
      makeEvent('GET', '/v1/identity', {
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
    const response = await handler(makeEvent('OPTIONS', '/v1/identity'), {}, () => {});

    expect(response?.statusCode).toBe(200);
  });
});
