import { describe, expect, it } from 'vitest';
import { generateKeyPairSync, sign as nodeSign } from 'crypto';
import {
  buildUnsignedCredential,
  newCredentialId,
  signCredential,
  verifyCredentialProof,
  derToRawSignature,
  rawToDerSignature,
  multibaseBase58btc,
  multibaseDecode,
  SIGNING_VERIFICATION_METHOD,
  CRYPTOSUITE,
} from '../src/vc-signer';

// A local P-256 key stands in for KMS. Node's `sign('sha256', msg, key)` applies
// SHA-256 then ECDSA and returns DER — exactly what KMS RAW + ECDSA_SHA_256 does.
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const publicJwk = publicKey.export({ format: 'jwk' });
const localSigner = async (message) => nodeSign('sha256', message, privateKey); // DER

describe('DER ↔ raw signature conversion', () => {
  it('round-trips a DER signature through raw R‖S', () => {
    const der = nodeSign('sha256', Buffer.from('hello'), privateKey);
    const raw = derToRawSignature(der);
    expect(raw.length).toBe(64);
    // rawToDer(derToRaw(der)) must re-verify against the same key
    const der2 = rawToDerSignature(raw);
    // both DER encodings verify the same message
    const ok = require('crypto').verify('sha256', Buffer.from('hello'), publicKey, der2);
    expect(ok).toBe(true);
  });
});

describe('multibase base58btc', () => {
  it('round-trips arbitrary bytes', () => {
    const bytes = Buffer.from([0, 0, 1, 2, 3, 255, 128, 64]);
    expect(multibaseDecode(multibaseBase58btc(bytes)).equals(bytes)).toBe(true);
  });
});

describe('signCredential (ecdsa-jcs-2019)', () => {
  const unsigned = () =>
    buildUnsignedCredential({
      credentialId: newCredentialId('11111111-1111-1111-1111-111111111111'),
      credentialType: 'LicenseCredential',
      holderDid: 'did:web:trulyimagined.com:users:up1',
      holderProfileId: 'up1',
      claims: { licenseId: 'L1', role: 'Actor' },
      validFrom: '2026-07-11T00:00:00.000Z',
      validUntil: '2026-08-11T23:59:59.000Z',
      credentialStatus: {
        id: 'https://trulyimagined.com/api/credentials/status/revocation-1#5',
        type: 'BitstringStatusListEntry',
        statusPurpose: 'revocation',
        statusListIndex: '5',
        statusListCredential: 'https://trulyimagined.com/api/credentials/status/revocation-1',
      },
    });

  it('attaches a DataIntegrityProof with the #key-2 verification method', async () => {
    const signed = await signCredential(unsigned(), { created: '2026-07-11T00:00:00.000Z', sign: localSigner });
    expect(signed.proof.type).toBe('DataIntegrityProof');
    expect(signed.proof.cryptosuite).toBe(CRYPTOSUITE);
    expect(signed.proof.verificationMethod).toBe(SIGNING_VERIFICATION_METHOD);
    expect(signed.proof.proofPurpose).toBe('assertionMethod');
    expect(String(signed.proof.proofValue).startsWith('z')).toBe(true);
  });

  it('verifies against the signer public key (full crypto round-trip)', async () => {
    const signed = await signCredential(unsigned(), { created: '2026-07-11T00:00:00.000Z', sign: localSigner });
    expect(await verifyCredentialProof(signed, publicJwk)).toBe(true);
  });

  it('fails verification when the document is tampered', async () => {
    const signed = await signCredential(unsigned(), { created: '2026-07-11T00:00:00.000Z', sign: localSigner });
    const tampered = { ...signed, credentialSubject: { ...signed.credentialSubject, role: 'Admin' } };
    expect(await verifyCredentialProof(tampered, publicJwk)).toBe(false);
  });

  it('fails verification under a different key', async () => {
    const signed = await signCredential(unsigned(), { created: '2026-07-11T00:00:00.000Z', sign: localSigner });
    const other = generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({ format: 'jwk' });
    expect(await verifyCredentialProof(signed, other)).toBe(false);
  });
});
