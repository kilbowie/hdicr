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

describe('consent-service auth ingress', () => {
  it('returns 401 for missing or invalid auth token', async () => {
    vi.mocked(validateAuth0TokenWithStatus).mockResolvedValueOnce({
      user: null,
      errorStatus: 401,
    });

    const response = await handler(makeEvent('GET', '/v1/consent/check'), {}, () => {});

    expect(response?.statusCode).toBe(401);
    expect(response?.body).toContain('Unauthorized');
  });

  it('returns 403 when authenticated but missing read scope', async () => {
    vi.mocked(validateAuth0TokenWithStatus).mockResolvedValueOnce({
      user: { sub: 'client@clients', scopes: [] },
    });
    vi.mocked(hasScope).mockReturnValueOnce(false);

    const response = await handler(makeEvent('GET', '/v1/consent/check'), {}, () => {});

    expect(response?.statusCode).toBe(403);
    expect(response?.body).toContain('hdicr:consent:read');
  });

  it('returns 403 when authenticated but missing write scope', async () => {
    vi.mocked(validateAuth0TokenWithStatus).mockResolvedValueOnce({
      user: {
        sub: 'client@clients',
        scopes: ['hdicr:consent:read'],
      },
    });
    vi.mocked(hasScope).mockReturnValueOnce(false);

    const response = await handler(makeEvent('POST', '/v1/consent/grant'), {}, () => {});

    expect(response?.statusCode).toBe(403);
    expect(response?.body).toContain('hdicr:consent:write');
  });

  it('returns structured 400 details for invalid grant payloads', async () => {
    vi.mocked(validateAuth0TokenWithStatus).mockResolvedValueOnce({
      user: { sub: 'client@clients', scopes: [] },
    });
    vi.mocked(hasScope).mockReturnValueOnce(true);

    const response = await handler(
      makeEvent('POST', '/v1/consent/grant', {
        body: JSON.stringify({ actorId: '', consentType: '' }),
      }),
      {},
      () => {}
    );

    expect(response?.statusCode).toBe(400);
    expect(response?.body).toContain('Validation failed');
    expect(response?.body).toContain('actorId');
    expect(response?.body).toContain('consentType');
  });

  it('returns structured 400 details for invalid consent-check queries', async () => {
    vi.mocked(validateAuth0TokenWithStatus).mockResolvedValueOnce({
      user: { sub: 'client@clients', scopes: [] },
    });
    vi.mocked(hasScope).mockReturnValueOnce(true);

    const response = await handler(
      makeEvent('GET', '/v1/consent/check', {
        queryStringParameters: { consentType: 'voice_synthesis' },
      }),
      {},
      () => {}
    );

    expect(response?.statusCode).toBe(400);
    expect(response?.body).toContain('Validation failed');
    expect(response?.body).toContain('actorId');
  });

  it('keeps CORS preflight unauthenticated', async () => {
    const response = await handler(makeEvent('OPTIONS', '/v1/consent/check'), {}, () => {});

    expect(response?.statusCode).toBe(200);
  });
});
