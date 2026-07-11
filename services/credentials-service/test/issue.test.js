import { describe, expect, it, vi, beforeEach } from 'vitest';
import { generateKeyPairSync, sign as nodeSign } from 'crypto';

const { mockDb } = vi.hoisted(() => ({
  mockDb: { query: vi.fn(), queryWithTenant: vi.fn() },
}));

// A local P-256 key backs the mocked KMS SignCommand so the endpoint runs the
// full sign flow end-to-end without AWS.
const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });

vi.mock('@aws-sdk/client-kms', () => ({
  KMSClient: class {
    async send(cmd) {
      if (cmd.__type === 'Sign') {
        return { Signature: nodeSign('sha256', Buffer.from(cmd.input.Message), privateKey) };
      }
      throw new Error('unexpected KMS command');
    }
  },
  SignCommand: class {
    constructor(input) {
      this.__type = 'Sign';
      this.input = input;
    }
  },
  GetPublicKeyCommand: class {
    constructor(input) {
      this.__type = 'GetPublicKey';
      this.input = input;
    }
  },
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

const VALID_BODY = {
  userProfileId: '11111111-1111-1111-1111-111111111111',
  credentialType: 'LicenseCredential',
  holderDid: 'did:web:trulyimagined.com:users:11111111-1111-1111-1111-111111111111',
  claims: { licenseId: 'L1', role: 'Actor' },
  expiresAt: '2026-08-11',
  licenseId: '22222222-2222-2222-2222-222222222222',
};

beforeEach(() => {
  mockDb.queryWithTenant.mockReset();
  process.env.VC_SIGNING_KMS_KEY_ID = 'test-key';
  vi.mocked(hasScope).mockReturnValue(true);
  vi.mocked(validateAuth0TokenWithStatus).mockResolvedValue({
    user: { sub: 'client@clients', scopes: ['hdicr:credentials:write'] },
  });
});

describe('POST /v1/credentials/issue', () => {
  it('400 on an invalid body', async () => {
    const res = await handler(makeEvent('POST', '/v1/credentials/issue', { credentialType: 'x' }), {}, () => {});
    expect(res?.statusCode).toBe(400);
  });

  it('500 when the KMS key id is unconfigured', async () => {
    delete process.env.VC_SIGNING_KMS_KEY_ID;
    const res = await handler(makeEvent('POST', '/v1/credentials/issue', VALID_BODY), {}, () => {});
    expect(res?.statusCode).toBe(500);
  });

  it('returns the existing credential (issued:false) for a licence already credentialed', async () => {
    mockDb.queryWithTenant.mockResolvedValueOnce({ rows: [{ id: 'existing', credential_json: { id: 'vc://x' } }] });
    const res = await handler(makeEvent('POST', '/v1/credentials/issue', VALID_BODY), {}, () => {});
    expect(res?.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.issued).toBe(false);
    expect(body.credentialDbId).toBe('existing');
  });

  it('issues a KMS-signed credential end-to-end (#key-2, DataIntegrityProof)', async () => {
    mockDb.queryWithTenant
      // 1) idempotency check → none
      .mockResolvedValueOnce({ rows: [] })
      // 2) placeholder insert → id
      .mockResolvedValueOnce({ rows: [{ id: 'cred-db-1' }] })
      // 3) allocate: find non-full list → none
      .mockResolvedValueOnce({ rows: [] })
      // 4) allocate: insert new status list → row
      .mockResolvedValueOnce({ rows: [{ id: 'sl1', list_id: 'revocation-x', current_index: 0, max_index: 131071 }] })
      // 5) allocate: claim index → row
      .mockResolvedValueOnce({ rows: [{ claimed_index: 0, list_id: 'revocation-x' }] })
      // 6) allocate: insert status entry
      .mockResolvedValueOnce({ rows: [] })
      // 7) finalize update
      .mockResolvedValueOnce({ rows: [] });

    const res = await handler(makeEvent('POST', '/v1/credentials/issue', VALID_BODY), {}, () => {});
    expect(res?.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.issued).toBe(true);
    expect(body.credentialDbId).toBe('cred-db-1');
    expect(body.credential.proof.type).toBe('DataIntegrityProof');
    expect(body.credential.proof.verificationMethod).toBe('did:web:trulyimagined.com#key-2');
    expect(body.credential.proof.cryptosuite).toBe('ecdsa-jcs-2019');
    expect(body.credential.credentialStatus.statusPurpose).toBe('revocation');

    // finalize persisted the signed json + #key-2 + cryptosuite
    const finalize = mockDb.queryWithTenant.mock.calls.at(-1);
    expect(finalize[1]).toContain('UPDATE verifiable_credentials');
    expect(finalize[2]).toContain('did:web:trulyimagined.com#key-2');
    expect(finalize[2]).toContain('ecdsa-jcs-2019');
  });
});
