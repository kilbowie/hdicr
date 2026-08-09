import { DatabaseClient } from '@trulyimagined/database';
import {
  ISSUER_DID,
  CRYPTOSUITE,
  PROOF_TYPE,
  signCredential,
  makeKmsSigner,
} from './vc-signer';

/**
 * GET /h2a/status/{listId} — the signed status list every verifier reads (S2.H1, W3.2, B5).
 *
 * THIS ENDPOINT IS PUBLIC AND UNAUTHENTICATED, AND THAT IS THE POINT.
 *
 * The existing `/v1/credentials/status-list/{listId}` sits behind the Auth0 authorizer, requires
 * the `hdicr:credentials:read` scope, and is tenant-scoped by RLS. A status list reachable only by
 * callers the operator has authorised is not a status list: it makes the operator the gatekeeper of
 * whether a revocation can be *observed*, which is the same power the issuer/implementer split
 * exists to remove (ADR-009, THREAT-MODEL "Implementer as revocation authority"). A performer's
 * withdrawal has to be checkable by a verifier nobody has heard of, on a laptop, later.
 *
 * Nothing here is private. The list is a bitstring; an index reveals nothing about who holds it, and
 * that unlinkability is the whole design of W3C Bitstring Status List. Publishing it is the feature.
 *
 * FOUR THINGS THE OLD ROUTE GOT WRONG, EACH FIXED HERE:
 *
 *   1. It returned 200 with `{"statusList": null}` for a list that does not exist. A verifier that
 *      reads the status code before the body sees success. Fail-open by politeness. Now 404.
 *   2. It served whatever `credential_json` held — signed by `#key-2`, the key that also signs
 *      ordinary credentials. If one key does both, whoever can mint a credential can also clear a
 *      revocation bit, and the split is nominal. Signed here by the h2a-issuer KMS key.
 *   3. No `validUntil`. Bridle fails closed without one (S1.B4) — a permit that never expires is a
 *      revocation that never lands — so a list without it is a list no verifier will accept.
 *   4. No cache directives, so intermediaries were free to invent their own freshness. The TTL is
 *      now stated in the credential AND in Cache-Control, and the two agree.
 */

const db = DatabaseClient.getInstance();

/** `${ISSUER_ORIGIN}` — one build-time constant, so D-E's handover is DNS and not a code change. */
export const ISSUER_ORIGIN = process.env.H2A_ISSUER_ORIGIN ?? 'https://trulyimagined.com';

/** The h2a-issuer key, NOT `#key-2`. See point 2 above. */
export const H2A_VERIFICATION_METHOD = `${ISSUER_DID}#h2a-issuer`;

/**
 * How long a verifier may treat a fetched list as fresh.
 *
 * Bounded by the media freshness window, not chosen for cache efficiency: this number IS the
 * revocation horizon as far as any verifier is concerned. A list cached for an hour means a
 * withdrawal can take an hour to be observed, whatever the issuer does at its end — and Art 7(3)
 * is a claim about elapsed time. Five minutes is the interim value; ADR-011's drills measure what
 * is actually achieved and DECLARED_HORIZONS.md records only measured values.
 */
export const STATUS_TTL_MS = Number(process.env.H2A_STATUS_TTL_MS ?? 300_000);

/**
 * Byte-identical mirrors, declared in the credential so a verifier can fall back without asking.
 *
 * "Byte-identical" is load-bearing and is not a deployment detail: the proof covers the canonical
 * bytes of the whole document, so a mirror that re-serialises the JSON — different key order,
 * different whitespace, a re-encoded bitstring — serves something that fails verification. Mirrors
 * must be object copies, not re-renders.
 */
export function statusMirrors(): string[] {
  const raw = process.env.H2A_STATUS_MIRRORS?.trim();
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface StatusListRow {
  list_id: string;
  status_purpose: string;
  encoded_list: string;
  bitstring_size: number;
  valid_from: Date | string;
  valid_until: Date | string | null;
  ttl_milliseconds: number | null;
}

function iso(value: Date | string): string {
  return typeof value === 'string' ? new Date(value).toISOString() : value.toISOString();
}

/**
 * Build the unsigned BitstringStatusListCredential (W3C Bitstring Status List v1.0).
 *
 * Assembled here rather than read from the stored `credential_json`, deliberately. That column
 * holds whatever was written when the list was created, including its `validUntil` — so serving it
 * verbatim serves a document whose validity window was decided in the past and has very likely
 * expired. The list CONTENT is stored; the credential around it is minted per request, which is
 * also what makes the TTL mean anything.
 */
export function buildStatusListCredential(
  row: StatusListRow,
  opts: { now: Date; ttlMs: number; mirrors: string[] },
): Record<string, unknown> {
  const validFrom = iso(row.valid_from);
  // Always present. A stored NULL becomes now+TTL rather than being omitted: Bridle refuses a list
  // without one, so omitting it produces a list that fails closed everywhere, which looks like an
  // outage rather than the misconfiguration it is.
  const validUntil = row.valid_until
    ? iso(row.valid_until)
    : new Date(opts.now.getTime() + opts.ttlMs).toISOString();

  const credential: Record<string, unknown> = {
    '@context': [
      'https://www.w3.org/ns/credentials/v2',
      'https://w3id.org/security/data-integrity/v2',
    ],
    id: `${ISSUER_ORIGIN}/h2a/status/${row.list_id}`,
    type: ['VerifiableCredential', 'BitstringStatusListCredential'],
    issuer: ISSUER_DID,
    validFrom,
    validUntil,
    credentialSubject: {
      id: `${ISSUER_ORIGIN}/h2a/status/${row.list_id}#list`,
      type: 'BitstringStatusList',
      statusPurpose: row.status_purpose,
      encodedList: row.encoded_list,
    },
    ttl: opts.ttlMs,
  };
  if (opts.mirrors.length) credential.mirrors = opts.mirrors;
  return credential;
}

/** The KMS key that signs status lists. Distinct from the credential-signing key by design. */
function h2aSigner() {
  const keyId = process.env.H2A_ISSUER_KMS_KEY_ID;
  if (!keyId) {
    // Fail loudly. Falling back to the credential key would silently reunite the two authorities
    // this endpoint exists to keep apart, and it would do it in a way that still produced a
    // perfectly valid-looking signed list.
    throw new Error(
      'H2A_ISSUER_KMS_KEY_ID is not set. The status list must be signed by the h2a-issuer key, ' +
        'not the credential key — see ADR-009 and infra/template.yaml (H2aIssuerKeyAliasName).',
    );
  }
  return makeKmsSigner(keyId);
}

export interface ServeResult {
  statusCode: number;
  body: string;
  headers?: Record<string, string>;
}

/**
 * Serve a signed status list. Unauthenticated by design; see the module comment.
 *
 * `now` is injected so tests are deterministic and so the `created` in the proof, the `validUntil`
 * and the Cache-Control max-age are all derived from ONE instant rather than three clock reads.
 */
export async function serveStatusList(
  listId: string,
  opts: { now?: Date; tenantId?: string } = {},
): Promise<ServeResult> {
  const now = opts.now ?? new Date();
  const tenantId = opts.tenantId ?? process.env.HDICR_DEFAULT_TENANT_ID ?? 'trulyimagined';

  if (!/^[A-Za-z0-9._-]{1,100}$/.test(listId)) {
    return json(400, { error: 'invalid-list-id' });
  }

  const result = await db.queryWithTenant(
    tenantId,
    `SELECT list_id, status_purpose, encoded_list, bitstring_size, valid_from, valid_until, ttl_milliseconds
       FROM bitstring_status_lists
      WHERE list_id = $1
      LIMIT 1`,
    [listId],
  );
  const row = result.rows[0] as StatusListRow | undefined;

  // 404, not 200-with-null. A verifier that checks the status code before the body must not read
  // "this list does not exist" as "this list says nothing is revoked".
  if (!row) return json(404, { error: 'unknown-status-list', list_id: listId });

  // W3C minimum. A short list leaks: with 1,024 entries an index is a much smaller anonymity set,
  // and the unlinkability the whole mechanism is built on stops holding. Refuse to serve rather
  // than serve something that verifies and quietly identifies people.
  if (!row.bitstring_size || row.bitstring_size < 131_072) {
    return json(500, { error: 'status-list-below-w3c-minimum', minimum: 131072 });
  }

  const ttlMs = row.ttl_milliseconds ?? STATUS_TTL_MS;
  const credential = buildStatusListCredential(row, { now, ttlMs, mirrors: statusMirrors() });

  const signed = await signCredential(credential, {
    created: now.toISOString(),
    verificationMethod: H2A_VERIFICATION_METHOD,
    sign: h2aSigner(),
  });

  const maxAgeSeconds = Math.max(1, Math.floor(ttlMs / 1000));
  return {
    statusCode: 200,
    body: JSON.stringify(signed),
    headers: {
      'Content-Type': 'application/vc+ld+json',
      // The TTL in the credential and the TTL an intermediary will honour must agree. If the cache
      // outlives the document, a verifier is handed an expired list by its own CDN and fails
      // closed for a reason that has nothing to do with the performer.
      'Cache-Control': `public, max-age=${maxAgeSeconds}, must-revalidate`,
      // Any verifier, from any origin. The document is public and the CORS restriction that
      // applies to the operator's own API would make it unreadable from a browser-based verifier.
      'Access-Control-Allow-Origin': '*',
    },
  };
}

function json(statusCode: number, body: unknown): ServeResult {
  return {
    statusCode,
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      // Errors must not be cached: a 404 cached for five minutes is a status list that stays
      // missing for five minutes after it is created.
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    },
  };
}

/** Re-exported so the handler and the tests agree on what a proof should look like. */
export const H2A_PROOF_SHAPE = { type: PROOF_TYPE, cryptosuite: CRYPTOSUITE } as const;
