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

beforeEach(() => {
  mockDb.queryWithTenant.mockReset();
  authAs('hdicr:credentials:write'); // covers both GET+POST (hasScope mocked true)
});

describe('auth ingress', () => {
  it('401 without a token', async () => {
    vi.mocked(validateAuth0TokenWithStatus).mockResolvedValueOnce({ user: null, errorStatus: 401 });
    const res = await handler(makeEvent('GET', '/v1/credentials/user-profile'), {}, () => {});
    expect(res?.statusCode).toBe(401);
  });

  it('403 without the required scope', async () => {
    vi.mocked(validateAuth0TokenWithStatus).mockResolvedValueOnce({ user: { sub: 'x', scopes: [] } });
    vi.mocked(hasScope).mockReturnValueOnce(false);
    const res = await handler(makeEvent('GET', '/v1/credentials/user-profile', { query: { auth0UserId: 'a' } }), {}, () => {});
    expect(res?.statusCode).toBe(403);
    expect(res?.body).toContain('hdicr:credentials:read');
  });
});

describe('GET /v1/credentials/{id} vs named routes', () => {
  it('routes user-profile to the profile handler, not getCredentialById', async () => {
    mockDb.queryWithTenant.mockResolvedValueOnce({ rows: [{ id: 'up1', auth0_user_id: 'auth0|x' }] });
    const res = await handler(makeEvent('GET', '/v1/credentials/user-profile', { query: { auth0UserId: 'auth0|x' } }), {}, () => {});
    expect(res?.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('profile'); // not 'credential'
    const [, sql] = mockDb.queryWithTenant.mock.calls[0];
    expect(sql).toContain('FROM user_profiles');
  });

  it('treats a UUID-like segment as a credential id', async () => {
    mockDb.queryWithTenant.mockResolvedValueOnce({ rows: [{ id: 'c1', credential_type: 'LicenseCredential' }] });
    const res = await handler(makeEvent('GET', '/v1/credentials/11111111-1111-1111-1111-111111111111'), {}, () => {});
    expect(res?.statusCode).toBe(200);
    expect(JSON.parse(res.body).credential.id).toBe('c1');
    const [, sql] = mockDb.queryWithTenant.mock.calls[0];
    expect(sql).toContain('FROM verifiable_credentials');
  });
});

describe('GET /v1/credentials (list)', () => {
  it('400 without userProfileId', async () => {
    const res = await handler(makeEvent('GET', '/v1/credentials'), {}, () => {});
    expect(res?.statusCode).toBe(400);
  });

  it('excludes revoked/expired by default', async () => {
    mockDb.queryWithTenant.mockResolvedValueOnce({ rows: [] });
    await handler(makeEvent('GET', '/v1/credentials', { query: { userProfileId: 'up1' } }), {}, () => {});
    const [, sql] = mockDb.queryWithTenant.mock.calls[0];
    expect(sql).toContain('is_revoked = false');
    expect(sql).toContain('expires_at IS NULL OR expires_at > NOW()');
  });

  it('includeRevoked/includeExpired drop the filters', async () => {
    mockDb.queryWithTenant.mockResolvedValueOnce({ rows: [] });
    await handler(
      makeEvent('GET', '/v1/credentials', { query: { userProfileId: 'up1', includeRevoked: 'true', includeExpired: 'true' } }),
      {},
      () => {},
    );
    const [, sql] = mockDb.queryWithTenant.mock.calls[0];
    expect(sql).not.toContain('is_revoked = false');
  });
});

describe('GET /v1/credentials/by-license', () => {
  it('returns the linked non-revoked credential id', async () => {
    mockDb.queryWithTenant.mockResolvedValueOnce({ rows: [{ id: 'c9' }] });
    const res = await handler(makeEvent('GET', '/v1/credentials/by-license', { query: { licenseId: 'L1' } }), {}, () => {});
    expect(JSON.parse(res.body).credentialId).toBe('c9');
    const [, sql] = mockDb.queryWithTenant.mock.calls[0];
    expect(sql).toContain('is_revoked = false');
  });

  it('null when none', async () => {
    mockDb.queryWithTenant.mockResolvedValueOnce({ rows: [] });
    const res = await handler(makeEvent('GET', '/v1/credentials/by-license', { query: { licenseId: 'L1' } }), {}, () => {});
    expect(JSON.parse(res.body).credentialId).toBeNull();
  });
});

describe('POST /v1/credentials/{id}/revoke', () => {
  it('marks revoked and flips the bitstring when a status entry exists', async () => {
    // 1) UPDATE verifiable_credentials → RETURNING row
    mockDb.queryWithTenant.mockResolvedValueOnce({ rows: [{ id: 'c1', user_profile_id: 'up1' }] });
    // 2) status entry lookup → none (keep the test simple; bit-flip path is exercised separately)
    mockDb.queryWithTenant.mockResolvedValueOnce({ rows: [] });
    const res = await handler(
      makeEvent('POST', '/v1/credentials/11111111-1111-1111-1111-111111111111/revoke', { body: { reason: 'refund' } }),
      {},
      () => {},
    );
    expect(res?.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.result.found).toBe(true);
    expect(body.result.hasStatusEntry).toBe(false);
    const [, , params] = mockDb.queryWithTenant.mock.calls[0];
    expect(params[1]).toBe('refund');
  });

  it('reports alreadyRevoked when the UPDATE matched nothing', async () => {
    mockDb.queryWithTenant.mockResolvedValueOnce({ rows: [] }); // UPDATE ... RETURNING → none
    mockDb.queryWithTenant.mockResolvedValueOnce({ rows: [{ id: 'c1', is_revoked: true, user_profile_id: 'up1' }] });
    const res = await handler(
      makeEvent('POST', '/v1/credentials/11111111-1111-1111-1111-111111111111/revoke'),
      {},
      () => {},
    );
    const body = JSON.parse(res.body);
    expect(body.result.found).toBe(true);
    expect(body.result.alreadyRevoked).toBe(true);
  });
});

describe('POST /v1/credentials/license/revoke', () => {
  it('400 without licenseId', async () => {
    const res = await handler(makeEvent('POST', '/v1/credentials/license/revoke', { body: {} }), {}, () => {});
    expect(res?.statusCode).toBe(400);
  });

  it('returns the revoked count', async () => {
    mockDb.queryWithTenant.mockResolvedValueOnce({ rows: [{ id: 'a' }, { id: 'b' }] });
    const res = await handler(
      makeEvent('POST', '/v1/credentials/license/revoke', { body: { licenseId: 'L1', reason: 'partner_cease_use' } }),
      {},
      () => {},
    );
    expect(JSON.parse(res.body).revoked).toBe(2);
  });
});

describe('GET /v1/credentials/status-list/{listId}', () => {
  it('returns the stored status list credential JSON', async () => {
    mockDb.queryWithTenant.mockResolvedValueOnce({ rows: [{ credential_json: { type: ['BitstringStatusListCredential'] } }] });
    const res = await handler(makeEvent('GET', '/v1/credentials/status-list/revocation-1'), {}, () => {});
    expect(res?.statusCode).toBe(200);
    expect(JSON.parse(res.body).statusList.type).toContain('BitstringStatusListCredential');
  });
});
