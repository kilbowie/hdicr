import { APIGatewayProxyHandler, APIGatewayProxyEvent } from 'aws-lambda';
import { DatabaseClient } from '@trulyimagined/database';
import {
  validateAuth0TokenWithStatus,
  hasScope,
  getOrCreateCorrelationId,
  withCorrelationHeaders,
} from '@trulyimagined/middleware';
import { decodeBitstring, setBit, encodeBitstring } from './bitstring';

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
        default:
          return wrap(await getCredentialById(rest[0], tenantId));
      }
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
