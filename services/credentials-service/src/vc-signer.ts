/**
 * Server-side Verifiable Credential signing (Stream 3.5b).
 *
 * Signs W3C VC 2.0 credentials with a W3C Data Integrity ECDSA proof
 * (`ecdsa-jcs-2019`: RFC 8785 JCS canonicalization, ECDSA P-256 / SHA-256).
 * The private key is a non-extractable AWS KMS key — signing is delegated to
 * `kms:Sign`, so no key material ever lives in the app. AWS KMS cannot sign
 * Ed25519, which is why new credentials use ECDSA rather than the legacy
 * Ed25519Signature2020 suite (old credentials keep verifying under `#key-1`).
 *
 * The suite is JCS-based (no JSON-LD/RDF canonicalization), so signing and
 * verification need no document loader — only the JSON and the public key.
 */

import { createHash, createPublicKey, verify as cryptoVerify } from 'crypto';
import canonicalize from 'canonicalize';

export const ISSUER_DID = 'did:web:trulyimagined.com';
export const SIGNING_VERIFICATION_METHOD = `${ISSUER_DID}#key-2`;
export const CRYPTOSUITE = 'ecdsa-jcs-2019';
export const PROOF_TYPE = 'DataIntegrityProof';

/** A signer over raw bytes that returns a DER-encoded ECDSA signature. */
export type EcdsaSigner = (message: Buffer) => Promise<Buffer>;

// ---------------------------------------------------------------------------
// Encoding helpers (no external deps beyond `canonicalize`)
// ---------------------------------------------------------------------------

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** base58btc-encode bytes (Bitcoin alphabet), no multibase prefix. */
function base58Encode(buf: Buffer): string {
  let zeros = 0;
  while (zeros < buf.length && buf[zeros] === 0) zeros++;

  const digits = [0];
  for (let i = zeros; i < buf.length; i++) {
    let carry = buf[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }

  let out = '1'.repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i--) out += BASE58_ALPHABET[digits[i]];
  return out;
}

/** Multibase base58btc ('z' prefix) — the proofValue encoding for DI proofs. */
export function multibaseBase58btc(buf: Buffer): string {
  return 'z' + base58Encode(buf);
}

function base58Decode(str: string): Buffer {
  const bytes: number[] = [0];
  for (let i = 0; i < str.length; i++) {
    const value = BASE58_ALPHABET.indexOf(str[i]);
    if (value < 0) throw new Error(`Invalid base58 character: ${str[i]}`);
    for (let j = 0; j < bytes.length; j++) bytes[j] *= 58;
    bytes[0] += value;
    let carry = 0;
    for (let j = 0; j < bytes.length; j++) {
      bytes[j] += carry;
      carry = bytes[j] >> 8;
      bytes[j] &= 0xff;
    }
    while (carry) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (let i = 0; i < str.length && str[i] === '1'; i++) bytes.push(0);
  return Buffer.from(bytes.reverse());
}

/** Decode a multibase base58btc ('z'-prefixed) string back to bytes. */
export function multibaseDecode(mb: string): Buffer {
  if (mb[0] !== 'z') throw new Error("Expected 'z' (base58btc) multibase prefix");
  return base58Decode(mb.slice(1));
}

function stripLeadingZeros(buf: Buffer): Buffer {
  let i = 0;
  while (i < buf.length - 1 && buf[i] === 0) i++;
  return buf.subarray(i);
}

function leftPad32(buf: Buffer): Buffer {
  if (buf.length > 32) throw new Error('ECDSA integer longer than 32 bytes');
  if (buf.length === 32) return buf;
  return Buffer.concat([Buffer.alloc(32 - buf.length, 0), buf]);
}

/**
 * Convert a DER-encoded ECDSA signature (SEQUENCE { INTEGER r, INTEGER s }) to
 * the raw fixed-width 64-byte R‖S form that JOSE / Data Integrity proofs use.
 * KMS (and Node's `sign`) return DER; DI proofValue needs raw R‖S.
 */
export function derToRawSignature(der: Buffer): Buffer {
  let offset = 0;
  if (der[offset++] !== 0x30) throw new Error('Invalid DER: expected SEQUENCE');
  // sequence length (short or long form) — value not otherwise needed
  let seqLen = der[offset++];
  if (seqLen & 0x80) {
    const n = seqLen & 0x7f;
    seqLen = 0;
    for (let i = 0; i < n; i++) seqLen = (seqLen << 8) | der[offset++];
  }

  if (der[offset++] !== 0x02) throw new Error('Invalid DER: expected INTEGER r');
  const rLen = der[offset++];
  const r = der.subarray(offset, offset + rLen);
  offset += rLen;

  if (der[offset++] !== 0x02) throw new Error('Invalid DER: expected INTEGER s');
  const sLen = der[offset++];
  const s = der.subarray(offset, offset + sLen);
  offset += sLen;

  return Buffer.concat([leftPad32(stripLeadingZeros(r)), leftPad32(stripLeadingZeros(s))]);
}

/** Inverse of derToRawSignature: raw 64-byte R‖S → DER SEQUENCE{INTEGER r, INTEGER s}. */
export function rawToDerSignature(raw: Buffer): Buffer {
  if (raw.length !== 64) throw new Error('Raw ECDSA signature must be 64 bytes');
  const toDerInt = (b: Buffer): Buffer => {
    let v = stripLeadingZeros(b);
    if (v[0] & 0x80) v = Buffer.concat([Buffer.from([0x00]), v]); // keep it positive
    return Buffer.concat([Buffer.from([0x02, v.length]), v]);
  };
  const r = toDerInt(raw.subarray(0, 32));
  const s = toDerInt(raw.subarray(32, 64));
  return Buffer.concat([Buffer.from([0x30, r.length + s.length]), r, s]); // P-256 seq len < 128
}

function sha256(data: Buffer | string): Buffer {
  return createHash('sha256').update(data).digest();
}

function jcs(obj: unknown): string {
  const out = canonicalize(obj);
  if (typeof out !== 'string') throw new Error('JCS canonicalization failed');
  return out;
}

// ---------------------------------------------------------------------------
// Credential assembly + signing
// ---------------------------------------------------------------------------

const CREDENTIAL_ID_BASE = 'https://trulyimagined.com/api/credentials';

export interface BuildCredentialParams {
  credentialId: string; // full URL (unique)
  credentialType: string;
  holderDid: string;
  holderProfileId: string;
  claims: Record<string, unknown>;
  validFrom: string;
  validUntil?: string;
  credentialStatus?: unknown;
}

/** Build the unsigned W3C VC 2.0 document (mirrors the legacy TI assembly). */
export function buildUnsignedCredential(params: BuildCredentialParams): Record<string, unknown> {
  const context = [
    'https://www.w3.org/ns/credentials/v2',
    'https://www.w3.org/ns/credentials/examples/v2',
  ];
  if (params.credentialStatus) context.push('https://www.w3.org/ns/credentials/status/v1');
  context.push('https://w3id.org/security/data-integrity/v2');

  const credential: Record<string, unknown> = {
    '@context': context,
    id: params.credentialId,
    type: ['VerifiableCredential', params.credentialType],
    issuer: ISSUER_DID,
    validFrom: params.validFrom,
    ...(params.validUntil ? { validUntil: params.validUntil } : {}),
    credentialSubject: {
      id: params.holderDid,
      profileId: params.holderProfileId,
      ...params.claims,
    },
  };
  if (params.credentialStatus) credential.credentialStatus = params.credentialStatus;
  return credential;
}

export function newCredentialId(uuid: string): string {
  return `${CREDENTIAL_ID_BASE}/${uuid}`;
}

/**
 * Attach an `ecdsa-jcs-2019` Data Integrity proof to an unsigned credential.
 *
 * DI-ECDSA algorithm: JCS-canonicalize the proof config and the document,
 * SHA-256 each, concatenate `proofHash‖docHash`, and ECDSA-sign (SHA-256).
 * `created` is injected (rather than read from a clock) so callers control it
 * and tests stay deterministic.
 */
export async function signCredential(
  unsigned: Record<string, unknown>,
  opts: { created: string; verificationMethod?: string; sign: EcdsaSigner },
): Promise<Record<string, unknown>> {
  const verificationMethod = opts.verificationMethod ?? SIGNING_VERIFICATION_METHOD;

  const proofConfig = {
    type: PROOF_TYPE,
    cryptosuite: CRYPTOSUITE,
    created: opts.created,
    verificationMethod,
    proofPurpose: 'assertionMethod',
    '@context': unsigned['@context'],
  };

  const proofHash = sha256(jcs(proofConfig));
  const docHash = sha256(jcs(unsigned));
  const hashData = Buffer.concat([proofHash, docHash]);

  const der = await opts.sign(hashData);
  const proofValue = multibaseBase58btc(derToRawSignature(der));

  return {
    ...unsigned,
    proof: {
      type: PROOF_TYPE,
      cryptosuite: CRYPTOSUITE,
      created: opts.created,
      verificationMethod,
      proofPurpose: 'assertionMethod',
      proofValue,
    },
  };
}

/**
 * Verify an `ecdsa-jcs-2019` Data Integrity proof against a public key (JWK).
 * Reconstructs `proofHash‖docHash` exactly as signCredential built it, then
 * ECDSA-verifies. This is the canonical verify algorithm TI's dual-suite verify
 * (Stream 3.5c) mirrors for the ECDSA path.
 */
export async function verifyCredentialProof(
  signed: Record<string, unknown>,
  publicKeyJwk: Record<string, unknown>,
): Promise<boolean> {
  const proof = signed.proof as Record<string, unknown> | undefined;
  if (!proof || proof.cryptosuite !== CRYPTOSUITE || typeof proof.proofValue !== 'string') {
    return false;
  }
  const { proof: _omit, ...doc } = signed;
  const proofConfig = {
    type: proof.type,
    cryptosuite: proof.cryptosuite,
    created: proof.created,
    verificationMethod: proof.verificationMethod,
    proofPurpose: proof.proofPurpose,
    '@context': (doc as Record<string, unknown>)['@context'],
  };
  const hashData = Buffer.concat([sha256(jcs(proofConfig)), sha256(jcs(doc))]);
  const der = rawToDerSignature(multibaseDecode(proof.proofValue));
  const key = createPublicKey({ key: publicKeyJwk as any, format: 'jwk' });
  return cryptoVerify('sha256', hashData, key, der);
}

// ---------------------------------------------------------------------------
// AWS KMS backing
// ---------------------------------------------------------------------------

// Lazily import the KMS SDK so unit tests (which inject their own signer) don't
// need it and the bundle keeps @aws-sdk external (runtime-provided).
let kmsClient: any = null;
async function getKms() {
  if (!kmsClient) {
    const { KMSClient } = await import('@aws-sdk/client-kms');
    kmsClient = new KMSClient({});
  }
  return kmsClient;
}

/** Production signer: delegate raw-message signing to KMS (ECDSA P-256 / SHA-256). */
export function makeKmsSigner(keyId: string): EcdsaSigner {
  return async (message: Buffer) => {
    const { SignCommand } = await import('@aws-sdk/client-kms');
    const kms = await getKms();
    const res = await kms.send(
      new SignCommand({
        KeyId: keyId,
        Message: message,
        MessageType: 'RAW', // KMS applies SHA-256 then ECDSA
        SigningAlgorithm: 'ECDSA_SHA_256',
      }),
    );
    if (!res.Signature) throw new Error('[CREDENTIALS] KMS returned no signature');
    return Buffer.from(res.Signature);
  };
}

/** Fetch the KMS public key as a JWK (for TI's DID #key-2 + verify). */
export async function getKmsPublicJwk(keyId: string): Promise<Record<string, unknown>> {
  const { GetPublicKeyCommand } = await import('@aws-sdk/client-kms');
  const kms = await getKms();
  const res = await kms.send(new GetPublicKeyCommand({ KeyId: keyId }));
  if (!res.PublicKey) throw new Error('[CREDENTIALS] KMS returned no public key');
  // PublicKey is DER SubjectPublicKeyInfo — let Node parse it into a JWK.
  const jwk = createPublicKey({ key: Buffer.from(res.PublicKey), format: 'der', type: 'spki' }).export({
    format: 'jwk',
  });
  return jwk as Record<string, unknown>;
}
