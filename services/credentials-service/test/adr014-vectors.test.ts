/**
 * hdicr against the NORMATIVE ADR-014 vectors.
 *
 * When the estate was measured on 5 August 2026 it had four canonicalisers and two signature
 * encodings, and hdicr was the only conformant implementation on both axes. Every other component
 * — the four h2a reference services, the Python reference, and Bridle's core — was then ported onto
 * what hdicr already did.
 *
 * That makes this file load-bearing rather than routine. "hdicr is the correct one" was an
 * ASSUMPTION the whole port rested on, and until now nothing had checked it: this service's own
 * tests sign with its canonicaliser and verify with its canonicaliser, which is a closed loop that
 * stays green whether or not the bytes are the ones anyone else produces. If the assumption were
 * wrong, the estate would now be uniformly, confidently wrong — and every suite would still pass.
 *
 * The vectors are external and normative: from h2a-protocol's `interop/vectors/`, anchored to
 * RFC 8785's own published test data, pinned by SHA-256. Vendored rather than read across
 * repositories — hdicr and h2a-protocol do not share a checkout, and a test that silently skips
 * when a path is absent is worse than no test.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSign, createVerify, generateKeyPairSync, verify as cryptoVerify } from 'node:crypto';
import { jcs, jcsBytes, derToRawSignature, rawToDerSignature } from '../src/vc-signer.js';

const vectors = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/h2a-vectors.json', import.meta.url)), 'utf8'),
);

describe('ADR-014 canonicalisation — hdicr reproduces every normative vector', () => {
  for (const v of vectors.canonicalization_vectors) {
    it(`${v.id}`, () => {
      expect(jcs(JSON.parse(v.input_json))).toBe(v.canonical);
    });
  }

  it('agrees with the RFC on its own published sample', () => {
    // Vector 01 is RFC 8785 Appendix B verbatim. If this passes and the others do not, the fault is
    // in the vectors, not here — which is the point of anchoring the file to the RFC.
    const rfc = vectors.canonicalization_vectors.find(
      (v: { id: string }) => v.id === '01-rfc8785-appendix-b',
    );
    expect(rfc).toBeDefined();
    expect(jcs(JSON.parse(rfc.input_json))).toBe(rfc.canonical);
  });

  it('sorts by UTF-16 code unit, not by locale, and does not rebuild the object', () => {
    // The two defects every other TypeScript implementation in the estate shipped.
    expect(jcs({ Zeta: 1, alpha: 2, Beta: 3 })).toBe('{"Beta":3,"Zeta":1,"alpha":2}');
    expect(jcs({ '10': 'ten', '2': 'two' })).toBe('{"10":"ten","2":"two"}');
  });

  it('emits literal UTF-8 and ECMAScript numbers', () => {
    // The two the Python reference shipped.
    expect(jcs({ subject_ref: 'José Muñoz' })).toBe('{"subject_ref":"José Muñoz"}');
    expect(jcs({ cap: 500.0, zero: -0 })).toBe('{"cap":500,"zero":0}');
  });
});

describe('ADR-014 §2 — the DER <-> raw R‖S converters', () => {
  const s = vectors.signature_vectors;
  const raw = Buffer.from(s.signature_raw_r_s_base64url, 'base64url');
  const der = Buffer.from(s.signature_same_signature_as_der_base64url, 'base64url');

  it('canonicalises the committed preimage to the vector', () => {
    expect(jcsBytes(JSON.parse(s.preimage_input_json)).toString('utf8')).toBe(s.preimage_canonical);
  });

  it('derToRawSignature(der) matches the committed raw signature', () => {
    expect(derToRawSignature(der).equals(raw)).toBe(true);
    expect(raw.length).toBe(64);
  });

  it('rawToDerSignature(raw) matches the committed DER signature', () => {
    expect(rawToDerSignature(raw).equals(der)).toBe(true);
  });

  it('verifies the committed raw signature and refuses it as DER', () => {
    const preimage = Buffer.from(s.preimage_canonical, 'utf8');
    const key = { key: s.public_key_pem, dsaEncoding: 'ieee-p1363' as const };
    expect(cryptoVerify('sha256', preimage, key, raw)).toBe(true);
    expect(cryptoVerify('sha256', preimage, key, der)).toBe(false);
  });

  it('round-trips a freshly generated signature both ways', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const msg = jcsBytes({ grant_id: 'g-1', use: 'advertising' });
    const freshDer = createSign('SHA256').update(msg).end().sign(privateKey);
    const freshRaw = derToRawSignature(freshDer);

    expect(freshRaw.length).toBe(64);
    // Raw verifies under the JOSE encoding...
    expect(cryptoVerify('sha256', msg, { key: publicKey, dsaEncoding: 'ieee-p1363' }, freshRaw)).toBe(true);
    // ...and converting back yields something the DER path still accepts.
    expect(createVerify('SHA256').update(msg).end().verify(publicKey, rawToDerSignature(freshRaw))).toBe(true);
  });
});

describe('the issuer namespace is configurable, not hardcoded', () => {
  it('defaults to the current production values so nothing changes on deploy', async () => {
    const { ISSUER_DID, newCredentialId } = await import('../src/vc-signer.js');
    expect(ISSUER_DID).toBe('did:web:trulyimagined.com');
    expect(newCredentialId('abc')).toBe('https://trulyimagined.com/api/credentials/abc');
  });
});
