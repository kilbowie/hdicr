import { APIGatewayProxyHandler, APIGatewayProxyEvent } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { DatabaseClient } from '@trulyimagined/database';
import {
  validateAuth0TokenWithStatus,
  hasScope,
  getOrCreateCorrelationId,
  withCorrelationHeaders,
} from '@trulyimagined/middleware';
import { decodeBitstring, setBit, encodeBitstring, generateBitstring } from './bitstring';
import {
  ISSUER_DID,
  SIGNING_VERIFICATION_METHOD,
  CRYPTOSUITE,
  buildUnsignedCredential,
  newCredentialId,
  signCredential,
  makeKmsSigner,
  getKmsPublicJwk,
} from './vc-signer';
import { serveStatusList } from './h2a-status';

const STATUS_LIST_BASE_URL = 'https://trulyimagined.com/api/credentials/status';

/**
 * Credentials Service - Lambda Handler (Stream 3.5a)
 *
 * Owns Verifiable Credential records, bitstring status lists and revocation for
 * the HDICR DB, so TI no longer reaches these tables directly. This 3.5a slice
 * ports the non-signing logic from TI's credentials-client.ts / license-credentials.ts
 * verbatim; server-side issuance/signing (KMS) lands in 3.5b.
 *
 * All queries go through db.queryWithTenant so RLS (app.current_tenant_id) applies
 * to verifiable_credentials / bitstring_status_lists / credential_status_entries.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Content-Type': 'application/json',
};

const db = DatabaseClient.getInstance();

export const handler: APIGatewayProxyHandler = async (event) => {
  const correlationId = getOrCreateCorrelationId(event);
  const responseHeaders = withCorrelationHeaders(corsHeaders, correlationId);

  const { httpMethod, path } = event;

  try {
    if (httpMethod === 'OPTIONS') {
      return { statusCode: 200, headers: responseHeaders, body: '' };
    }

    // GET /h2a/status/{listId} — PUBLIC, and placed before the authorizer on purpose (S2.H1).
    //
    // A status list reachable only by callers the operator has authorised makes the operator the
    // gatekeeper of whether a revocation can be OBSERVED, which is the same power the
    // issuer/implementer split exists to remove (ADR-009). A performer's withdrawal has to be
    // checkable by a verifier nobody has heard of, later, without asking anyone's permission.
    //
    // Nothing here is private: the list is a bitstring, an index identifies no one, and that
    // unlinkability is the entire design of W3C Bitstring Status List. Publishing it is the
    // feature. Every other route below stays authenticated.
    if (httpMethod === 'GET' && path.startsWith('/h2a/status/')) {
      const listId = decodeURIComponent(path.slice('/h2a/status/'.length).split('/')[0] ?? '');
      const served = await serveStatusList(listId);
      return {
        statusCode: served.statusCode,
        headers: withCorrelationHeaders({ ...corsHeaders, ...(served.headers ?? {}) }, correlationId),
        body: served.body,
      };
    }

    const authResult = await validateAuth0TokenWithStatus(event);
    if (!authResult.user) {
      return {
        statusCode: authResult.errorStatus || 401,
        headers: responseHeaders,
        body: JSON.stringify({
          error: authResult.errorStatus === 403 ? 'Token rejected' : 'Unauthorized',
        }),
      };
    }

    const user = authResult.user;
    const requiredScope =
      httpMethod === 'GET' ? 'hdicr:credentials:read' : 'hdicr:credentials:write';
    if (!hasScope(user, requiredScope)) {
      return {
        statusCode: 403,
        headers: responseHeaders,
        body: JSON.stringify({
          error: 'Forbidden',
          detail: `Missing required scope: ${requiredScope}`,
        }),
      };
    }

    const tenantId = user.tenantId ?? process.env.HDICR_DEFAULT_TENANT_ID ?? 'trulyimagined';

    // Segment-based routing: rest = the path after /v1/credentials.
    const rest = path.split('/').filter(Boolean).slice(2); // drop ['v1','credentials']

    const wrap = (r: { statusCode: number; body: string }) => ({ ...r, headers: responseHeaders });

    // ---- Named GET routes (must precede the /{id} catch-all) ----
    if (httpMethod === 'GET' && rest.length === 1) {
      switch (rest[0]) {
        case 'user-profile':
          return wrap(await getUserProfileByAuth0UserId(event, tenantId));
        case 'issuance-profile':
          return wrap(await getIssuanceProfileByAuth0UserId(event, tenantId));
        case 'identity-links':
          return wrap(await listActiveIdentityLinks(event, tenantId));
        case 'consent-status':
          return wrap(await getActorConsentStatus(event, tenantId));
        case 'by-license':
          return wrap(await getCredentialIdByLicense(event, tenantId));
        case 'issuer-key':
          return wrap(await getIssuerKey());
        default:
          return wrap(await getCredentialById(rest[0], tenantId));
      }
    }

    // POST /v1/credentials/issue  → server-side KMS-signed issuance
    if (httpMethod === 'POST' && rest.length === 1 && rest[0] === 'issue') {
      return wrap(await issueCredential(event, tenantId));
    }

    // GET /v1/credentials  → list by user profile
    if (httpMethod === 'GET' && rest.length === 0) {
      return wrap(await listCredentialsByProfileId(event, tenantId));
    }

    // GET /v1/credentials/status-list/{listId}
    if (httpMethod === 'GET' && rest.length === 2 && rest[0] === 'status-list') {
      return wrap(await getStatusListById(rest[1], tenantId));
    }

    // POST /v1/credentials/license/revoke
    if (httpMethod === 'POST' && rest.length === 2 && rest[0] === 'license' && rest[1] === 'revoke') {
      return wrap(await revokeLicenseCredentials(event, tenantId));
    }

    // POST /v1/credentials/{id}/revoke
    if (httpMethod === 'POST' && rest.length === 2 && rest[1] === 'revoke') {
      return wrap(await revokeCredentialById(event, rest[0], tenantId));
    }

    return {
      statusCode: 404,
      headers: responseHeaders,
      body: JSON.stringify({ error: 'Not found' }),
    };
  } catch (error: any) {
    console.error('[CREDENTIALS-SERVICE] Error:', { error, correlationId });
    return {
      statusCode: 500,
      headers: responseHeaders,
      body: JSON.stringify({ error: 'Internal server error', message: error?.message }),
    };
  }
};

function badRequest(message: string) {
  return { statusCode: 400, body: JSON.stringify({ error: message }) };
}

function parseBody(event: APIGatewayProxyEvent): Record<string, unknown> {
  try {
    return JSON.parse(event.body ?? '{}');
  } catch {
    return {};
  }
}

// ---- Profile lookups (with drifted-sub self-heal) ----

async function healUserProfileSub(userProfileId: string, auth0UserId: string, tenantId: string) {
  await db
    .queryWithTenant(
      tenantId,
      `UPDATE user_profiles SET auth0_user_id = $1
       WHERE id = $2 AND auth0_user_id IS DISTINCT FROM $1`,
      [auth0UserId, userProfileId],
    )
    .catch(() => {});
}

async function getUserProfileByAuth0UserId(event: APIGatewayProxyEvent, tenantId: string) {
  const auth0UserId = event.queryStringParameters?.auth0UserId?.trim();
  if (!auth0UserId) return badRequest('auth0UserId query parameter is required');

  const direct = await db.queryWithTenant(
    tenantId,
    `SELECT id, auth0_user_id, email, role, username, legal_name, professional_name,
            is_verified, profile_completed
     FROM user_profiles WHERE auth0_user_id = $1 LIMIT 1`,
    [auth0UserId],
  );
  if (direct.rows[0]) {
    return { statusCode: 200, body: JSON.stringify({ profile: direct.rows[0] }) };
  }

  const viaActor = await db.queryWithTenant(
    tenantId,
    `SELECT up.id, up.auth0_user_id, up.email, up.role, up.username,
            up.legal_name, up.professional_name, up.is_verified, up.profile_completed
     FROM actors a
     JOIN user_profiles up ON up.id = a.user_profile_id
     WHERE a.auth0_user_id = $1 AND a.deleted_at IS NULL LIMIT 1`,
    [auth0UserId],
  );
  const row = viaActor.rows[0] as { id: string } | undefined;
  if (!row) return { statusCode: 200, body: JSON.stringify({ profile: null }) };
  await healUserProfileSub(row.id, auth0UserId, tenantId);
  return { statusCode: 200, body: JSON.stringify({ profile: { ...row, auth0_user_id: auth0UserId } }) };
}

async function getIssuanceProfileByAuth0UserId(event: APIGatewayProxyEvent, tenantId: string) {
  const auth0UserId = event.queryStringParameters?.auth0UserId?.trim();
  if (!auth0UserId) return badRequest('auth0UserId query parameter is required');

  const select = `SELECT
       up.id, up.auth0_user_id, up.email, up.role, up.username,
       up.legal_name, up.professional_name, up.is_verified, up.profile_completed,
       a.id AS actor_id,
       a.verification_status AS actor_verification_status,
       a.updated_at AS actor_verified_at`;

  const direct = await db.queryWithTenant(
    tenantId,
    `${select}
     FROM user_profiles up
     LEFT JOIN actors a ON a.user_profile_id = up.id AND a.deleted_at IS NULL
     WHERE up.auth0_user_id = $1 LIMIT 1`,
    [auth0UserId],
  );
  if (direct.rows[0]) {
    return { statusCode: 200, body: JSON.stringify({ profile: direct.rows[0] }) };
  }

  const viaActor = await db.queryWithTenant(
    tenantId,
    `${select}
     FROM actors a
     JOIN user_profiles up ON up.id = a.user_profile_id
     WHERE a.auth0_user_id = $1 AND a.deleted_at IS NULL LIMIT 1`,
    [auth0UserId],
  );
  const row = viaActor.rows[0] as { id: string } | undefined;
  if (!row) return { statusCode: 200, body: JSON.stringify({ profile: null }) };
  await healUserProfileSub(row.id, auth0UserId, tenantId);
  return { statusCode: 200, body: JSON.stringify({ profile: { ...row, auth0_user_id: auth0UserId } }) };
}

// ---- Identity links ----

async function listActiveIdentityLinks(event: APIGatewayProxyEvent, tenantId: string) {
  const userProfileId = event.queryStringParameters?.userProfileId?.trim();
  if (!userProfileId) return badRequest('userProfileId query parameter is required');

  const result = await db.queryWithTenant(
    tenantId,
    `SELECT provider,
            COALESCE(verification_level, 'low') AS verification_level,
            COALESCE(assurance_level, 'low')    AS assurance_level,
            verified_at, is_active
     FROM identity_links
     WHERE user_profile_id = $1 AND is_active = true
     ORDER BY verified_at DESC`,
    [userProfileId],
  );
  return { statusCode: 200, body: JSON.stringify({ links: result.rows }) };
}

// ---- Consent status (licensing gate for public credential visibility) ----

async function getActorConsentStatus(event: APIGatewayProxyEvent, tenantId: string) {
  const userProfileId = event.queryStringParameters?.userProfileId?.trim();
  if (!userProfileId) return badRequest('userProfileId query parameter is required');

  const actorRow = (
    await db.queryWithTenant(
      tenantId,
      `SELECT id FROM actors WHERE user_profile_id = $1 AND deleted_at IS NULL LIMIT 1`,
      [userProfileId],
    )
  ).rows[0] as { id?: string } | undefined;

  const actorId = actorRow?.id ?? null;
  if (!actorId) {
    return { statusCode: 200, body: JSON.stringify({ actorId: null, allowsLicensing: false }) };
  }

  const consentRow = (
    await db.queryWithTenant(
      tenantId,
      `SELECT EXISTS (
         SELECT 1
         FROM consent_ledger cl,
              jsonb_each_text(cl.policy->'mediaUsage') AS usage(key, val)
         WHERE cl.actor_id = $1 AND cl.status = 'active' AND usage.val = 'allow'
       ) AS allows_licensing`,
      [actorId],
    )
  ).rows[0] as { allows_licensing?: boolean } | undefined;

  return {
    statusCode: 200,
    body: JSON.stringify({ actorId, allowsLicensing: consentRow?.allows_licensing === true }),
  };
}

// ---- Credential records ----

async function listCredentialsByProfileId(event: APIGatewayProxyEvent, tenantId: string) {
  const userProfileId = event.queryStringParameters?.userProfileId?.trim();
  if (!userProfileId) return badRequest('userProfileId query parameter is required');
  const includeRevoked = event.queryStringParameters?.includeRevoked === 'true';
  const includeExpired = event.queryStringParameters?.includeExpired === 'true';

  const conditions = ['user_profile_id = $1'];
  if (!includeRevoked) conditions.push('is_revoked = false');
  if (!includeExpired) conditions.push('(expires_at IS NULL OR expires_at > NOW())');

  const result = await db.queryWithTenant(
    tenantId,
    `SELECT id, credential_type, credential_json, issuer_did, holder_did,
            issued_at, expires_at, is_revoked, revoked_at, revocation_reason,
            verification_method, proof_type
     FROM verifiable_credentials
     WHERE ${conditions.join(' AND ')}
     ORDER BY issued_at DESC`,
    [userProfileId],
  );
  return { statusCode: 200, body: JSON.stringify({ credentials: result.rows }) };
}

async function getCredentialById(credentialId: string, tenantId: string) {
  const result = await db.queryWithTenant(
    tenantId,
    `SELECT id, credential_type, credential_json, is_revoked,
            issuer_did, holder_did, issued_at, expires_at, user_profile_id,
            revoked_at, revocation_reason, verification_method, proof_type
     FROM verifiable_credentials
     WHERE id = $1::uuid LIMIT 1`,
    [credentialId],
  );
  return { statusCode: 200, body: JSON.stringify({ credential: result.rows[0] ?? null }) };
}

async function getCredentialIdByLicense(event: APIGatewayProxyEvent, tenantId: string) {
  const licenseId = event.queryStringParameters?.licenseId?.trim();
  if (!licenseId) return badRequest('licenseId query parameter is required');

  const result = await db.queryWithTenant(
    tenantId,
    `SELECT id FROM verifiable_credentials
     WHERE license_id = $1 AND is_revoked = false LIMIT 1`,
    [licenseId],
  );
  return {
    statusCode: 200,
    body: JSON.stringify({ credentialId: (result.rows[0] as { id?: string } | undefined)?.id ?? null }),
  };
}

// ---- Status lists ----

async function getStatusListById(listId: string, tenantId: string) {
  const result = await db.queryWithTenant(
    tenantId,
    `SELECT credential_json FROM bitstring_status_lists WHERE list_id = $1 LIMIT 1`,
    [listId],
  );
  const statusList = (result.rows[0] as { credential_json?: unknown } | undefined)?.credential_json ?? null;
  return { statusCode: 200, body: JSON.stringify({ statusList }) };
}

// ---- Revocation ----

async function revokeCredentialById(
  event: APIGatewayProxyEvent,
  credentialId: string,
  tenantId: string,
) {
  const reason = (parseBody(event).reason as string | undefined) ?? null;

  const updated = (
    await db.queryWithTenant(
      tenantId,
      `UPDATE verifiable_credentials
       SET is_revoked = true, revoked_at = NOW(), revocation_reason = $2, updated_at = NOW()
       WHERE id = $1::uuid AND is_revoked = false
       RETURNING id, user_profile_id`,
      [credentialId, reason],
    )
  ).rows[0] as { id: string; user_profile_id: string } | undefined;

  if (!updated) {
    const existing = (
      await db.queryWithTenant(
        tenantId,
        `SELECT id, is_revoked, revoked_at, user_profile_id
         FROM verifiable_credentials WHERE id = $1::uuid LIMIT 1`,
        [credentialId],
      )
    ).rows[0] as Record<string, unknown> | undefined;
    return {
      statusCode: 200,
      body: JSON.stringify({
        result: {
          found: !!existing,
          alreadyRevoked: existing?.is_revoked === true,
          hasStatusEntry: false,
          revokedAt: (existing?.revoked_at as string | null) ?? null,
          ownerUserProfileId: existing?.user_profile_id as string | undefined,
        },
      }),
    };
  }

  // Best-effort: flip the revocation bit in the bitstring status list.
  let hasStatusEntry = false;
  try {
    const statusRow = (
      await db.queryWithTenant(
        tenantId,
        `SELECT cse.status_list_index, cse.status_list_id, bsl.encoded_list, bsl.list_id
         FROM credential_status_entries cse
         JOIN bitstring_status_lists bsl ON bsl.id = cse.status_list_id
         WHERE cse.credential_id = $1::uuid AND cse.status_purpose = 'revocation' LIMIT 1`,
        [credentialId],
      )
    ).rows[0] as
      | { status_list_index: number; status_list_id: string; encoded_list: string; list_id: string }
      | undefined;

    if (statusRow) {
      hasStatusEntry = true;
      const bits = await decodeBitstring(statusRow.encoded_list);
      setBit(bits, statusRow.status_list_index, 1);
      const newEncoded = await encodeBitstring(bits);
      await db.queryWithTenant(
        tenantId,
        `UPDATE bitstring_status_lists SET encoded_list = $1, updated_at = NOW() WHERE id = $2::uuid`,
        [newEncoded, statusRow.status_list_id],
      );
      await db.queryWithTenant(
        tenantId,
        `UPDATE credential_status_entries
         SET status_value = 1, updated_at = NOW()
         WHERE credential_id = $1::uuid AND status_purpose = 'revocation'`,
        [credentialId],
      );
    }
  } catch {
    // Non-fatal: the credential is still marked revoked in verifiable_credentials.
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      result: {
        found: true,
        alreadyRevoked: false,
        hasStatusEntry,
        revokedAt: new Date().toISOString(),
        ownerUserProfileId: updated.user_profile_id,
      },
    }),
  };
}

async function revokeLicenseCredentials(event: APIGatewayProxyEvent, tenantId: string) {
  const body = parseBody(event);
  const licenseId = (body.licenseId as string | undefined)?.trim();
  const reason = (body.reason as string | undefined) ?? null;
  if (!licenseId) return badRequest('licenseId is required');

  const res = await db.queryWithTenant(
    tenantId,
    `UPDATE verifiable_credentials
     SET is_revoked = true, revoked_at = NOW(), revocation_reason = $2, updated_at = NOW()
     WHERE license_id = $1 AND is_revoked = false
     RETURNING id`,
    [licenseId, reason],
  );
  return { statusCode: 200, body: JSON.stringify({ revoked: res.rows.length }) };
}

// ---- Server-side issuance (KMS-signed, Stream 3.5b) ----

const IssueSchema = z.object({
  userProfileId: z.string().uuid(),
  credentialType: z.string().min(1),
  holderDid: z.string().min(1),
  claims: z.record(z.unknown()).default({}),
  expiresAt: z.string().optional(),
  expiresInDays: z.number().int().positive().optional(),
  licenseId: z.string().uuid().optional(),
});

/**
 * POST /v1/credentials/issue — full server-side issuance: (license idempotency →)
 * insert record → allocate revocation status → KMS-sign (ecdsa-jcs-2019) → finalize.
 * Returns { issued, credentialDbId, credential }. The private key never leaves KMS.
 */
async function issueCredential(event: APIGatewayProxyEvent, tenantId: string) {
  const parsed = IssueSchema.safeParse(parseBody(event));
  if (!parsed.success) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Validation failed', detail: parsed.error.flatten() }) };
  }
  const { userProfileId, credentialType, holderDid, claims, expiresAt, expiresInDays, licenseId } =
    parsed.data;

  const keyId = process.env.VC_SIGNING_KMS_KEY_ID;
  if (!keyId) {
    return { statusCode: 500, body: JSON.stringify({ error: 'VC_SIGNING_KMS_KEY_ID is not configured' }) };
  }

  // Idempotency: one active credential per licence (also enforced by a unique
  // partial index from migration 098).
  if (licenseId) {
    const existing = (
      await db.queryWithTenant(
        tenantId,
        `SELECT id, credential_json FROM verifiable_credentials
         WHERE license_id = $1 AND is_revoked = false LIMIT 1`,
        [licenseId],
      )
    ).rows[0] as { id: string; credential_json: unknown } | undefined;
    if (existing) {
      return {
        statusCode: 200,
        body: JSON.stringify({ issued: false, credentialDbId: existing.id, credential: existing.credential_json }),
      };
    }
  }

  // 1. Placeholder record.
  const insert = licenseId
    ? await db.queryWithTenant(
        tenantId,
        `INSERT INTO verifiable_credentials
           (user_profile_id, credential_type, credential_json, issuer_did, holder_did, license_id, tenant_id)
         VALUES ($1, $2, '{}'::jsonb, $3, $4, $5, $6) RETURNING id`,
        [userProfileId, credentialType, ISSUER_DID, holderDid, licenseId, tenantId],
      )
    : await db.queryWithTenant(
        tenantId,
        `INSERT INTO verifiable_credentials
           (user_profile_id, credential_type, credential_json, issuer_did, holder_did, tenant_id)
         VALUES ($1, $2, '{}'::jsonb, $3, $4, $5) RETURNING id`,
        [userProfileId, credentialType, ISSUER_DID, holderDid, tenantId],
      );
  const credentialDbId = (insert.rows[0] as { id?: string })?.id;
  if (!credentialDbId) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to create credential record' }) };
  }

  // 2. Allocate a revocation status list entry.
  const credentialStatus = await allocateRevocationStatus(credentialDbId, tenantId);

  // 3. Build the unsigned VC.
  const validFrom = new Date().toISOString();
  let validUntil: string | undefined;
  if (expiresAt) {
    validUntil = new Date(expiresAt).toISOString();
  } else if (expiresInDays) {
    const d = new Date();
    d.setDate(d.getDate() + expiresInDays);
    validUntil = d.toISOString();
  }

  const unsigned = buildUnsignedCredential({
    credentialId: newCredentialId(uuidv4()),
    credentialType,
    holderDid,
    holderProfileId: userProfileId,
    claims,
    validFrom,
    validUntil,
    credentialStatus,
  });

  // 4. Sign via KMS (private key never leaves KMS).
  const credential = await signCredential(unsigned, {
    created: new Date().toISOString(),
    sign: makeKmsSigner(keyId),
  });

  // 5. Persist the signed credential.
  await db.queryWithTenant(
    tenantId,
    `UPDATE verifiable_credentials
     SET credential_json = $1::jsonb,
         credential_id = $2,
         expires_at = $3::timestamptz,
         verification_method = $4,
         proof_type = $5,
         updated_at = NOW()
     WHERE id = $6::uuid`,
    [JSON.stringify(credential), credential.id, validUntil ?? null, SIGNING_VERIFICATION_METHOD, CRYPTOSUITE, credentialDbId],
  );

  return { statusCode: 201, body: JSON.stringify({ issued: true, credentialDbId, credential }) };
}

/**
 * Allocate the next revocation-status-list index for a credential, creating a
 * fresh (empty) status list when none has room. Ported from the TI client;
 * every INSERT sets tenant_id so RLS WITH CHECK passes for any tenant.
 */
async function allocateRevocationStatus(credentialId: string, tenantId: string) {
  type StatusListRow = { id: string; list_id: string; current_index: number; max_index: number };
  let statusList = (
    await db.queryWithTenant(
      tenantId,
      `SELECT id, list_id, current_index, max_index
       FROM bitstring_status_lists
       WHERE status_purpose = 'revocation' AND is_full = false LIMIT 1`,
      [],
    )
  ).rows[0] as StatusListRow | undefined;

  if (!statusList) {
    const listId = `revocation-${uuidv4()}`;
    const encodedList = await encodeBitstring(generateBitstring());
    const credJson = {
      '@context': [
        'https://www.w3.org/ns/credentials/v2',
        'https://www.w3.org/ns/credentials/status/v1',
      ],
      id: `${STATUS_LIST_BASE_URL}/${listId}`,
      type: ['VerifiableCredential', 'BitstringStatusListCredential'],
      issuer: ISSUER_DID,
      validFrom: new Date().toISOString(),
      credentialSubject: {
        id: `${STATUS_LIST_BASE_URL}/${listId}#list`,
        type: 'BitstringStatusList',
        statusPurpose: 'revocation',
        encodedList,
      },
    };
    const inserted = await db.queryWithTenant(
      tenantId,
      `INSERT INTO bitstring_status_lists
         (list_id, status_purpose, encoded_list, bitstring_size, current_index, max_index, credential_json, tenant_id)
       VALUES ($1, 'revocation', $2, 131072, 0, 131071, $3::jsonb, $4)
       RETURNING id, list_id, current_index, max_index`,
      [listId, encodedList, JSON.stringify(credJson), tenantId],
    );
    statusList = inserted.rows[0] as StatusListRow | undefined;
    if (!statusList) throw new Error('[CREDENTIALS] Failed to create bitstring status list');
  }

  const claimed = (
    await db.queryWithTenant(
      tenantId,
      `UPDATE bitstring_status_lists
       SET current_index = current_index + 1,
           is_full = (current_index + 1 >= max_index)
       WHERE id = $1 AND is_full = false
       RETURNING current_index - 1 AS claimed_index, list_id`,
      [statusList.id],
    )
  ).rows[0] as { claimed_index: number; list_id: string } | undefined;
  if (!claimed) throw new Error('[CREDENTIALS] Failed to claim a revocation status list index');

  const entryUrl = `${STATUS_LIST_BASE_URL}/${claimed.list_id}#${claimed.claimed_index}`;
  await db.queryWithTenant(
    tenantId,
    `INSERT INTO credential_status_entries
       (credential_id, status_list_id, status_list_index, status_purpose, entry_url, tenant_id)
     VALUES ($1::uuid, $2::uuid, $3, 'revocation', $4, $5)`,
    [credentialId, statusList.id, claimed.claimed_index, entryUrl, tenantId],
  );

  return {
    id: entryUrl,
    type: 'BitstringStatusListEntry',
    statusPurpose: 'revocation',
    statusListIndex: String(claimed.claimed_index),
    statusListCredential: `${STATUS_LIST_BASE_URL}/${claimed.list_id}`,
  };
}

/**
 * GET /v1/credentials/issuer-key — the KMS public key as a JWK, for TI's DID
 * document (#key-2) and the new-suite verify path. Non-secret.
 */
async function getIssuerKey() {
  const keyId = process.env.VC_SIGNING_KMS_KEY_ID;
  if (!keyId) {
    return { statusCode: 500, body: JSON.stringify({ error: 'VC_SIGNING_KMS_KEY_ID is not configured' }) };
  }
  const publicKeyJwk = await getKmsPublicJwk(keyId);
  return {
    statusCode: 200,
    body: JSON.stringify({
      verificationMethod: SIGNING_VERIFICATION_METHOD,
      cryptosuite: CRYPTOSUITE,
      publicKeyJwk,
    }),
  };
}
