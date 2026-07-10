import { describe, expect, it, vi, beforeEach } from 'vitest';

// Shared, controllable DB mock (hoisted so vi.mock can reference it).
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
    actors: {
      create: 'Q_CREATE',
      getById: 'Q_BYID',
      getByAuth0Id: 'Q_BY_AUTH0',
      getByEmail: 'Q_BY_EMAIL',
      update: 'Q_UPDATE',
      list: 'Q_LIST',
    },
    userProfiles: { listAdminUsersWithActors: '' },
  },
}));

import { validateAuth0TokenWithStatus, hasScope } from '@trulyimagined/middleware';
import { handler } from '../src/index';

function makeEvent(method, path, body) {
  return {
    body: body ? JSON.stringify(body) : null,
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
  };
}

describe('POST /v1/identity/resolve (resolve-or-rebind)', () => {
  beforeEach(() => {
    mockDb.queryWithTenant.mockReset();
    vi.mocked(hasScope).mockReturnValue(true);
    vi.mocked(validateAuth0TokenWithStatus).mockResolvedValue({
      user: { sub: 'client@clients', scopes: ['hdicr:identity:write'] },
    });
  });

  it('returns 400 when auth0UserId is missing', async () => {
    const res = await handler(makeEvent('POST', '/v1/identity/resolve', { email: 'a@b.com' }), {}, () => {});
    expect(res?.statusCode).toBe(400);
  });

  it('returns the direct actor when the sub matches (no email lookup)', async () => {
    mockDb.queryWithTenant.mockResolvedValueOnce({
      rows: [{ id: 'a1', auth0_user_id: 'sub1', email: 'a@b.com' }],
    });

    const res = await handler(
      makeEvent('POST', '/v1/identity/resolve', { auth0UserId: 'sub1', email: 'a@b.com' }),
      {},
      () => {},
    );

    const body = JSON.parse(res.body);
    expect(res?.statusCode).toBe(200);
    expect(body.actor.id).toBe('a1');
    expect(body.rebound).toBe(false);
    expect(mockDb.queryWithTenant).toHaveBeenCalledTimes(1);
  });

  it('rebinds a drifted sub via verified email and returns the healed actor', async () => {
    mockDb.queryWithTenant
      .mockResolvedValueOnce({ rows: [] }) // getByAuth0Id — miss
      .mockResolvedValueOnce({ rows: [{ id: 'a2', auth0_user_id: 'oldsub', email: 'a@b.com' }] }) // getByEmail — hit (drifted)
      .mockResolvedValueOnce({ rows: [] }) // UPDATE rebind
      .mockResolvedValueOnce({ rows: [{ id: 'a2', auth0_user_id: 'newsub', email: 'a@b.com' }] }); // getByAuth0Id — after rebind

    const res = await handler(
      makeEvent('POST', '/v1/identity/resolve', { auth0UserId: 'newsub', email: 'a@b.com' }),
      {},
      () => {},
    );

    const body = JSON.parse(res.body);
    expect(res?.statusCode).toBe(200);
    expect(body.actor.id).toBe('a2');
    expect(body.actor.auth0_user_id).toBe('newsub');
    expect(body.rebound).toBe(true);
  });

  it('returns actor:null when neither the sub nor the email match', async () => {
    mockDb.queryWithTenant
      .mockResolvedValueOnce({ rows: [] }) // getByAuth0Id — miss
      .mockResolvedValueOnce({ rows: [] }); // getByEmail — miss

    const res = await handler(
      makeEvent('POST', '/v1/identity/resolve', { auth0UserId: 'x', email: 'none@b.com' }),
      {},
      () => {},
    );

    const body = JSON.parse(res.body);
    expect(res?.statusCode).toBe(200);
    expect(body.actor).toBeNull();
    expect(body.rebound).toBe(false);
  });

  it('returns actor:null when the sub misses and no email is supplied', async () => {
    mockDb.queryWithTenant.mockResolvedValueOnce({ rows: [] }); // getByAuth0Id — miss

    const res = await handler(
      makeEvent('POST', '/v1/identity/resolve', { auth0UserId: 'x' }),
      {},
      () => {},
    );

    const body = JSON.parse(res.body);
    expect(res?.statusCode).toBe(200);
    expect(body.actor).toBeNull();
    expect(mockDb.queryWithTenant).toHaveBeenCalledTimes(1);
  });
});
