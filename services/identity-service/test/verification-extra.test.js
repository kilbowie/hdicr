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

describe('GET /v1/identity/by-registry', () => {
  beforeEach(() => {
    mockDb.queryWithTenant.mockReset();
    authAs('hdicr:identity:read');
  });

  it('400 without registryId', async () => {
    const res = await handler(makeEvent('GET', '/v1/identity/by-registry'), {}, () => {});
    expect(res?.statusCode).toBe(400);
  });

  it('returns the mapped actor', async () => {
    mockDb.queryWithTenant.mockResolvedValueOnce({ rows: [{ id: 'a1', registry_id: 'TI-ABC123', stage_name: 'Ada' }] });
    const res = await handler(makeEvent('GET', '/v1/identity/by-registry', { query: { registryId: 'TI-ABC123' } }), {}, () => {});
    const body = JSON.parse(res.body);
    expect(res?.statusCode).toBe(200);
    expect(body.actor.id).toBe('a1');
    expect(body.actor.registry_id).toBe('TI-ABC123');
  });

  it('returns actor:null when not found', async () => {
    mockDb.queryWithTenant.mockResolvedValueOnce({ rows: [] });
    const res = await handler(makeEvent('GET', '/v1/identity/by-registry', { query: { registryId: 'TI-NONE' } }), {}, () => {});
    expect(JSON.parse(res.body).actor).toBeNull();
  });
});

describe('POST /v1/identity/verification-method', () => {
  beforeEach(() => {
    mockDb.queryWithTenant.mockReset();
    authAs('hdicr:identity:write');
  });

  it('400 when neither actorId nor auth0UserId given', async () => {
    const res = await handler(makeEvent('POST', '/v1/identity/verification-method', { body: { method: 'founder_call' } }), {}, () => {});
    expect(res?.statusCode).toBe(400);
  });

  it('stamps by actorId and reports updated count', async () => {
    mockDb.queryWithTenant.mockResolvedValueOnce({ rows: [{ id: 'a1' }] });
    const res = await handler(
      makeEvent('POST', '/v1/identity/verification-method', {
        body: { actorId: '11111111-1111-1111-1111-111111111111', method: 'founder_call' },
      }),
      {},
      () => {},
    );
    const body = JSON.parse(res.body);
    expect(res?.statusCode).toBe(200);
    expect(body.updated).toBe(1);
    const [, , params] = mockDb.queryWithTenant.mock.calls[0];
    expect(params[0]).toBe('founder_call'); // method
  });

  it('accepts a null method (clearing) by auth0UserId', async () => {
    mockDb.queryWithTenant.mockResolvedValueOnce({ rows: [] });
    const res = await handler(
      makeEvent('POST', '/v1/identity/verification-method', { body: { auth0UserId: 'auth0|x', method: null } }),
      {},
      () => {},
    );
    expect(res?.statusCode).toBe(200);
    expect(JSON.parse(res.body).updated).toBe(0);
  });
});

describe('POST /v1/identity/verification-status', () => {
  beforeEach(() => {
    mockDb.queryWithTenant.mockReset();
    authAs('hdicr:identity:write');
  });

  it('returns previous status and new id', async () => {
    mockDb.queryWithTenant
      .mockResolvedValueOnce({ rows: [{ id: 'a1', verification_status: 'pending' }] }) // prev
      .mockResolvedValueOnce({ rows: [{ id: 'a1' }] }); // update
    const res = await handler(
      makeEvent('POST', '/v1/identity/verification-status', { body: { auth0UserId: 'auth0|x', status: 'verified' } }),
      {},
      () => {},
    );
    const body = JSON.parse(res.body);
    expect(res?.statusCode).toBe(200);
    expect(body.previousStatus).toBe('pending');
    expect(body.id).toBe('a1');
  });
});
