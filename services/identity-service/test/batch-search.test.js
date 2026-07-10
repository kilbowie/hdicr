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

function makeEvent(method, path, query) {
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

describe('GET /v1/identity/batch', () => {
  beforeEach(() => {
    mockDb.queryWithTenant.mockReset();
    vi.mocked(hasScope).mockReturnValue(true);
    vi.mocked(validateAuth0TokenWithStatus).mockResolvedValue({
      user: { sub: 'client@clients', scopes: ['hdicr:identity:read'] },
    });
  });

  it('400 when neither ids nor auth0Ids provided', async () => {
    const res = await handler(makeEvent('GET', '/v1/identity/batch'), {}, () => {});
    expect(res?.statusCode).toBe(400);
    expect(mockDb.queryWithTenant).not.toHaveBeenCalled();
  });

  it('returns mapped actors for an id list', async () => {
    mockDb.queryWithTenant.mockResolvedValueOnce({
      rows: [
        { id: 'a1', auth0_user_id: 's1', stage_name: 'Ada', first_name: 'Ada', last_name: 'L', verification_status: 'verified' },
        { id: 'a2', auth0_user_id: 's2', stage_name: 'Bob', first_name: 'Bob', last_name: 'M', verification_status: 'pending' },
      ],
    });
    const res = await handler(makeEvent('GET', '/v1/identity/batch', { ids: 'a1,a2' }), {}, () => {});
    const body = JSON.parse(res.body);
    expect(res?.statusCode).toBe(200);
    expect(body.actors).toHaveLength(2);
    expect(body.actors[0].id).toBe('a1');
    // Bound params: ids populated, auth0Ids empty.
    const [, , params] = mockDb.queryWithTenant.mock.calls[0];
    expect(params[1]).toEqual(['a1', 'a2']);
    expect(params[2]).toEqual([]);
  });

  it('passes auth0Ids through when provided', async () => {
    mockDb.queryWithTenant.mockResolvedValueOnce({ rows: [] });
    await handler(makeEvent('GET', '/v1/identity/batch', { auth0Ids: 'x,y' }), {}, () => {});
    const [, , params] = mockDb.queryWithTenant.mock.calls[0];
    expect(params[1]).toEqual([]);
    expect(params[2]).toEqual(['x', 'y']);
  });
});

describe('GET /v1/identity/search', () => {
  beforeEach(() => {
    mockDb.queryWithTenant.mockReset();
    vi.mocked(hasScope).mockReturnValue(true);
    vi.mocked(validateAuth0TokenWithStatus).mockResolvedValue({
      user: { sub: 'client@clients', scopes: ['hdicr:identity:read'] },
    });
  });

  it('400 when q is missing', async () => {
    const res = await handler(makeEvent('GET', '/v1/identity/search'), {}, () => {});
    expect(res?.statusCode).toBe(400);
  });

  it('searches by stage name and passes verifiedOnly + clamped limit', async () => {
    mockDb.queryWithTenant.mockResolvedValueOnce({ rows: [{ id: 'a1', stage_name: 'Ada' }] });
    const res = await handler(
      makeEvent('GET', '/v1/identity/search', { q: 'ad', verifiedOnly: 'true', limit: '9999' }),
      {},
      () => {},
    );
    const body = JSON.parse(res.body);
    expect(res?.statusCode).toBe(200);
    expect(body.actors[0].stage_name).toBe('Ada');
    const [, , params] = mockDb.queryWithTenant.mock.calls[0];
    expect(params[1]).toBe('%ad%');
    expect(params[2]).toBe(true);
    expect(params[3]).toBe(200); // clamped to max
  });
});
