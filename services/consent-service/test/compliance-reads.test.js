import { describe, expect, it, vi, beforeEach } from 'vitest';

const { mockDb } = vi.hoisted(() => ({
  mockDb: { query: vi.fn(), queryWithTenant: vi.fn() },
}));

vi.mock('@trulyimagined/middleware', () => ({
  validateAuth0TokenWithStatus: vi.fn(),
  hasScope: vi.fn().mockReturnValue(true),
  getOrCreateCorrelationId: vi.fn().mockReturnValue('test-correlation-id'),
  withCorrelationHeaders: vi.fn((headers) => headers),
}));

vi.mock('@trulyimagined/database', () => ({
  DatabaseClient: { getInstance: () => mockDb },
}));

import { validateAuth0TokenWithStatus, hasScope } from '@trulyimagined/middleware';
import { handler } from '../src/index';

function makeEvent(method, path, { query } = {}) {
  return {
    body: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: method,
    isBase64Encoded: false,
    path,
    pathParameters: null,
    queryStringParameters: query ?? null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    resource: path,
    requestContext: {},
  };
}

beforeEach(() => {
  mockDb.queryWithTenant.mockReset();
  vi.mocked(hasScope).mockReturnValue(true);
  vi.mocked(validateAuth0TokenWithStatus).mockResolvedValue({
    user: { sub: 'client@clients', scopes: ['hdicr:consent:read'] },
  });
});

describe('GET /v1/consent/log', () => {
  it('400 without actorId', async () => {
    const res = await handler(makeEvent('GET', '/v1/consent/log'), {}, () => {});
    expect(res?.statusCode).toBe(400);
  });

  it('returns entries and clamps the limit', async () => {
    mockDb.queryWithTenant.mockResolvedValueOnce({
      rows: [{ id: 'c1', action: 'granted', consent_type: 'voice', consent_scope: {}, project_name: null, created_at: 't' }],
    });
    const res = await handler(
      makeEvent('GET', '/v1/consent/log', { query: { actorId: '11111111-1111-1111-1111-111111111111', limit: '9999' } }),
      {},
      () => {},
    );
    expect(res?.statusCode).toBe(200);
    expect(JSON.parse(res.body).entries).toHaveLength(1);
    const [, , params] = mockDb.queryWithTenant.mock.calls[0];
    expect(params[2]).toBe(200); // clamped
  });
});

describe('GET /v1/consent/audit-log', () => {
  it('returns entries with no filters', async () => {
    mockDb.queryWithTenant.mockResolvedValueOnce({
      rows: [{ id: 'a1', user_type: 'admin', action: 'verify_actor', resource_type: 'actor', resource_id: 'r1', created_at: 't' }],
    });
    const res = await handler(makeEvent('GET', '/v1/consent/audit-log'), {}, () => {});
    expect(res?.statusCode).toBe(200);
    expect(JSON.parse(res.body).entries[0].id).toBe('a1');
  });

  it('threads resourceType + action filters into the query', async () => {
    mockDb.queryWithTenant.mockResolvedValueOnce({ rows: [] });
    await handler(
      makeEvent('GET', '/v1/consent/audit-log', { query: { resourceType: 'actor', action: 'verify' } }),
      {},
      () => {},
    );
    const [, sql, params] = mockDb.queryWithTenant.mock.calls[0];
    expect(sql).toContain('resource_type =');
    expect(sql).toContain('action ILIKE');
    expect(params).toContain('actor');
    expect(params).toContain('%verify%');
  });

  it('does not fall through to the /v1/consent/ catch-all', async () => {
    mockDb.queryWithTenant.mockResolvedValueOnce({ rows: [] });
    const res = await handler(makeEvent('GET', '/v1/consent/audit-log'), {}, () => {});
    // audit-log handler returns { entries }, listConsents would not
    expect(res?.statusCode).toBe(200);
    expect(res.body).toContain('entries');
  });
});
