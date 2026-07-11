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
  queries: {
    actors: { create: '', getById: '', getByAuth0Id: '', getByEmail: '', update: '', list: '' },
    userProfiles: { listAdminUsersWithActors: '' },
  },
}));

import { validateAuth0TokenWithStatus, hasScope } from '@trulyimagined/middleware';
import { handler } from '../src/index';

function makeEvent(method, path, { query, body } = {}) {
  return {
    body: body ? JSON.stringify(body) : null,
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

function authAs(scope) {
  vi.mocked(hasScope).mockReturnValue(true);
  vi.mocked(validateAuth0TokenWithStatus).mockResolvedValue({
    user: { sub: 'client@clients', scopes: [scope] },
  });
}

describe('GET /v1/identity/by-user-profile', () => {
  beforeEach(() => {
    mockDb.queryWithTenant.mockReset();
    authAs('hdicr:identity:read');
  });

  it('400 without userProfileId', async () => {
    const res = await handler(makeEvent('GET', '/v1/identity/by-user-profile'), {}, () => {});
    expect(res?.statusCode).toBe(400);
  });

  it('returns the full actor identity row', async () => {
    mockDb.queryWithTenant.mockResolvedValueOnce({
      rows: [{ id: 'a1', locations: [], location: 'London', verified_at: 't', stage_name: 'Ada' }],
    });
    const res = await handler(
      makeEvent('GET', '/v1/identity/by-user-profile', { query: { userProfileId: 'up1' } }),
      {},
      () => {},
    );
    expect(res?.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.actor.id).toBe('a1');
    expect(body.actor.verified_at).toBe('t'); // richer projection than mapActorSummary
  });

  it('returns actor:null when not found (not swallowed by the /{id} catch-all)', async () => {
    mockDb.queryWithTenant.mockResolvedValueOnce({ rows: [] });
    const res = await handler(
      makeEvent('GET', '/v1/identity/by-user-profile', { query: { userProfileId: 'up-none' } }),
      {},
      () => {},
    );
    expect(res?.statusCode).toBe(200);
    expect(JSON.parse(res.body).actor).toBeNull();
    // ensure the WHERE targeted user_profile_id, not id
    const [, sql] = mockDb.queryWithTenant.mock.calls[0];
    expect(sql).toContain('user_profile_id = $1');
  });
});

describe('POST /v1/identity/anonymise', () => {
  beforeEach(() => {
    mockDb.queryWithTenant.mockReset();
    authAs('hdicr:identity:write');
  });

  it('400 without auth0UserId', async () => {
    const res = await handler(makeEvent('POST', '/v1/identity/anonymise', { body: {} }), {}, () => {});
    expect(res?.statusCode).toBe(400);
  });

  it('scrubs PII and reports the updated count', async () => {
    mockDb.queryWithTenant.mockResolvedValueOnce({ rows: [{ id: 'a1' }] });
    const res = await handler(
      makeEvent('POST', '/v1/identity/anonymise', { body: { auth0UserId: 'auth0|x' } }),
      {},
      () => {},
    );
    expect(res?.statusCode).toBe(200);
    expect(JSON.parse(res.body).updated).toBe(1);
    const [, sql] = mockDb.queryWithTenant.mock.calls[0];
    expect(sql).toContain("stage_name = '[Deleted]'");
    expect(sql).toContain('first_name = NULL');
    // GDPR erasure applies even to soft-deleted rows
    expect(sql).not.toContain('deleted_at IS NULL');
  });
});
