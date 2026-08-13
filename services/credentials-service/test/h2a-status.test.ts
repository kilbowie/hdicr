/**
 * S2.H1 — the signed status list.
 *
 * The tests that matter here are not "does it return JSON". They are the four properties a
 * verifier's fail-closed logic depends on, each of which the previous route got wrong:
 *
 *   - a missing list is a 404, not a 200 with a null body;
 *   - `validUntil` is ALWAYS present, because Bridle refuses a list without one;
 *   - the proof names the h2a-issuer key, never the credential-signing key;
 *   - the TTL in the document and the TTL in Cache-Control agree.
 *
 * Plus one that is easy to leave untested and is the whole reason the endpoint exists: it must be
 * reachable WITHOUT authentication.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createSign, generateKeyPairSync, createPublicKey, createVerify } from 'node:crypto';

const KEY = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const PRIVATE_PEM = KEY.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const PUBLIC_JWK = KEY.publicKey.export({ format: 'jwk' });

/** Rows as the database actually returns them. */
const ROW = {
  list_id: 'revocation-2026',
  status_purpose: 'revocation',
  encoded_list: 'uH4sIAAAAAAAAA-3BMQEAAADCoPVPbQwfoAAAAAAAAAAAAAAAAAAAAOBthtJUqwBAAAA',
  bitstring_size: 131072,
  valid_from: new Date('2026-08-01T00:00:00.000Z'),
  valid_until: null as Date | null,
  ttl_milliseconds: null as number | null,
};

const rows: { rows: unknown[] } = { rows: [ROW] };
const queryWithTenant = vi.fn(async () => rows);

vi.mock('@trulyimagined/database', () => ({
  DatabaseClient: { getInstance: () => ({ queryWithTenant }) },
}));

// A local ECDSA signer standing in for KMS. Returns DER, as KMS does.
vi.mock('../src/vc-signer', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    makeKmsSigner: (keyId: string) => {
      capturedKeyId = keyId;
      return async (message: Buffer) => {
        const signer = createSign('SHA256');
        signer.update(message);
        signer.end();
        return signer.sign(PRIVATE_PEM);
      };
    },
  };
});

let capturedKeyId = '';
const NOW = new Date('2026-08-09T12:00:00.000Z');

beforeEach(() => {
  vi.resetModules();
  rows.rows = [{ ...ROW }];
  queryWithTenant.mockClear();
  capturedKeyId = '';
  process.env.H2A_ISSUER_KMS_KEY_ID = 'alias/h2a-issuer-prod';
  process.env.H2A_ISSUER_ORIGIN = 'https://issuer.example.org';
  delete process.env.H2A_STATUS_MIRRORS;
  delete process.env.H2A_STATUS_TTL_MS;
});

afterEach(() => {
  delete process.env.H2A_ISSUER_KMS_KEY_ID;
  delete process.env.H2A_ISSUER_ORIGIN;
  delete process.env.H2A_STATUS_MIRRORS;
});

async function serve(listId = 'revocation-2026') {
  const { serveStatusList } = await import('../src/h2a-status');
  return serveStatusList(listId, { now: NOW });
}

describe('a list that is not there is a 404', () => {
  it('does not return 200 with a null body', async () => {
    // The old route did exactly that. A verifier that reads the status code before the body sees
    // success — "this list does not exist" becomes "this list says nothing is revoked". Fail-open
    // by politeness, which is the hardest kind to notice.
    rows.rows = [];
    const res = await serve('does-not-exist');
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toMatchObject({ error: 'unknown-status-list' });
  });

  it('does not cache the 404', async () => {
    // A 404 cached for the TTL is a status list that stays missing for five minutes after it is
    // created.
    rows.rows = [];
    const res = await serve('does-not-exist');
    expect(res.headers?.['Cache-Control']).toBe('no-store');
  });

  it('rejects a malformed list id without touching the database', async () => {
    const res = await serve('../../etc/passwd');
    expect(res.statusCode).toBe(400);
    expect(queryWithTenant).not.toHaveBeenCalled();
  });

  it('refuses to serve a list below the W3C minimum', async () => {
    // With 1,024 entries an index is a much smaller anonymity set, and the unlinkability the whole
    // mechanism rests on stops holding. Refusing beats serving something that verifies correctly
    // and quietly identifies people.
    rows.rows = [{ ...ROW, bitstring_size: 1024 }];
    const res = await serve();
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body)).toMatchObject({ error: 'status-list-below-w3c-minimum' });
  });
});

describe('the credential a verifier actually reads', () => {
  it('is a BitstringStatusListCredential with the list in it', async () => {
    const res = await serve();
    expect(res.statusCode).toBe(200);
    const vc = JSON.parse(res.body);
    expect(vc.type).toEqual(['VerifiableCredential', 'BitstringStatusListCredential']);
    expect(vc.credentialSubject.type).toBe('BitstringStatusList');
    expect(vc.credentialSubject.statusPurpose).toBe('revocation');
    expect(vc.credentialSubject.encodedList).toBe(ROW.encoded_list);
    expect(vc.id).toBe('https://issuer.example.org/h2a/status/revocation-2026');
  });

  it('ALWAYS carries validUntil, even when the row has none', async () => {
    // Bridle fails closed on a list without one (S1.B4) — a permit that never expires is a
    // revocation that never lands. Omitting it produces a list that fails everywhere, which looks
    // like an outage rather than the misconfiguration it is.
    const vc = JSON.parse((await serve()).body);
    expect(vc.validFrom).toBe('2026-08-01T00:00:00.000Z');
    expect(vc.validUntil).toBe('2026-08-09T12:05:00.000Z'); // now + 300s default TTL
  });

  it('honours a stored validUntil when there is one', async () => {
    rows.rows = [{ ...ROW, valid_until: new Date('2026-08-09T12:01:00.000Z') }];
    const vc = JSON.parse((await serve()).body);
    expect(vc.validUntil).toBe('2026-08-09T12:01:00.000Z');
  });

  it('mints the credential per request rather than serving a stored one', async () => {
    // credential_json holds whatever was written when the list was created, INCLUDING its validity
    // window — so serving it verbatim serves a document whose window was decided in the past and
    // has very likely expired. The list content is stored; the credential around it is not.
    await serve();
    const sql = String(queryWithTenant.mock.calls[0][1]);
    expect(sql).not.toMatch(/credential_json/);
    expect(sql).toMatch(/encoded_list/);
  });
});

describe('the signing key is the issuer key, not the credential key', () => {
  it('signs with H2A_ISSUER_KMS_KEY_ID', async () => {
    await serve();
    expect(capturedKeyId).toBe('alias/h2a-issuer-prod');
  });

  it('names the h2a-issuer verification method, never #key-2', async () => {
    // If one key signed both credentials and status lists, whoever can mint a credential could
    // also clear a revocation bit — and the issuer/implementer split would be a diagram rather
    // than a fact (ADR-009).
    const vc = JSON.parse((await serve()).body);
    expect(vc.proof.verificationMethod).toMatch(/#h2a-issuer$/);
    expect(vc.proof.verificationMethod).not.toMatch(/#key-2$/);
    expect(vc.proof.cryptosuite).toBe('ecdsa-jcs-2019');
  });

  it('refuses to sign at all when the issuer key is unset', async () => {
    // Falling back to the credential key would silently reunite the two authorities this endpoint
    // exists to keep apart, and would do it while producing a perfectly valid-looking signed list.
    delete process.env.H2A_ISSUER_KMS_KEY_ID;
    await expect(serve()).rejects.toThrow(/H2A_ISSUER_KMS_KEY_ID/);
  });

  it('produces a proof that actually verifies', async () => {
    // Closed-loop verification is worth little, so this recomputes the DI-ECDSA hash independently
    // — JCS(proofConfig) and JCS(document minus proof), SHA-256 each, concatenated — rather than
    // calling the same helper that produced it.
    const { jcs, multibaseDecode, rawToDerSignature } = await import('../src/vc-signer');
    const { createHash } = await import('node:crypto');
    const vc = JSON.parse((await serve()).body);

    const { proof, ...doc } = vc;
    const proofConfig = {
      type: proof.type,
      cryptosuite: proof.cryptosuite,
      created: proof.created,
      verificationMethod: proof.verificationMethod,
      proofPurpose: proof.proofPurpose,
      '@context': doc['@context'],
    };
    const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest();
    const hashData = Buffer.concat([sha256(jcs(proofConfig)), sha256(jcs(doc))]);

    const verifier = createVerify('SHA256');
    verifier.update(hashData);
    verifier.end();
    const der = rawToDerSignature(multibaseDecode(proof.proofValue));
    expect(verifier.verify(createPublicKey({ key: PUBLIC_JWK as never, format: 'jwk' }), der)).toBe(true);
  });

  it('a tampered bitstring fails verification', async () => {
    const { jcs, multibaseDecode, rawToDerSignature } = await import('../src/vc-signer');
    const { createHash } = await import('node:crypto');
    const vc = JSON.parse((await serve()).body);

    const { proof, ...doc } = vc;
    // Clear the revocation bit — the attack the signature exists to stop.
    doc.credentialSubject.encodedList = 'uH4sIAAAAAAAAA-3BAQEAAAAIn-h_6HkAAAAAAAAAAAAAAAAAAAAAAB4G';
    const proofConfig = {
      type: proof.type, cryptosuite: proof.cryptosuite, created: proof.created,
      verificationMethod: proof.verificationMethod, proofPurpose: proof.proofPurpose,
      '@context': doc['@context'],
    };
    const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest();
    const hashData = Buffer.concat([sha256(jcs(proofConfig)), sha256(jcs(doc))]);

    const verifier = createVerify('SHA256');
    verifier.update(hashData);
    verifier.end();
    const der = rawToDerSignature(multibaseDecode(proof.proofValue));
    expect(verifier.verify(createPublicKey({ key: PUBLIC_JWK as never, format: 'jwk' }), der)).toBe(false);
  });
});

describe('freshness — the document and the cache must agree', () => {
  it('states the TTL and sets a matching max-age', async () => {
    // If the cache outlives the document, a verifier is handed an expired list by its own CDN and
    // fails closed for a reason that has nothing to do with the performer.
    const res = await serve();
    const vc = JSON.parse(res.body);
    expect(vc.ttl).toBe(300_000);
    expect(res.headers?.['Cache-Control']).toBe('public, max-age=300, must-revalidate');
  });

  it('honours a per-list TTL from the row', async () => {
    rows.rows = [{ ...ROW, ttl_milliseconds: 60_000 }];
    const res = await serve();
    expect(JSON.parse(res.body).ttl).toBe(60_000);
    expect(res.headers?.['Cache-Control']).toContain('max-age=60');
  });

  it('serves it as a verifiable credential, readable from any origin', async () => {
    // A browser-based verifier is a verifier. The operator's own CORS restriction would make the
    // public status list unreadable from one.
    const res = await serve();
    expect(res.headers?.['Content-Type']).toBe('application/vc+ld+json');
    expect(res.headers?.['Access-Control-Allow-Origin']).toBe('*');
  });
});

describe('mirrors', () => {
  it('declares none when unconfigured, rather than an empty array', async () => {
    const vc = JSON.parse((await serve()).body);
    expect(vc.mirrors).toBeUndefined();
  });

  it('declares configured mirrors', async () => {
    process.env.H2A_STATUS_MIRRORS = 'https://cdn.example.org/status/revocation-2026, https://mirror2.example.org/s';
    const vc = JSON.parse((await serve()).body);
    expect(vc.mirrors).toEqual([
      'https://cdn.example.org/status/revocation-2026',
      'https://mirror2.example.org/s',
    ]);
  });

  it('covers the mirrors with the signature', async () => {
    // A mirror list an attacker can append to is a redirect to a list they control. It has to be
    // inside the signed document, not a header.
    process.env.H2A_STATUS_MIRRORS = 'https://cdn.example.org/s';
    const withMirror = JSON.parse((await serve()).body);
    delete process.env.H2A_STATUS_MIRRORS;
    const without = JSON.parse((await serve()).body);
    expect(withMirror.proof.proofValue).not.toBe(without.proof.proofValue);
  });
});
