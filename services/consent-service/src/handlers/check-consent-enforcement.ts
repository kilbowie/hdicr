import { APIGatewayProxyEvent } from 'aws-lambda';
import { DatabaseClient } from '@trulyimagined/database';
import { z } from 'zod';

const db = DatabaseClient.getInstance();

const ConsentEnforcementSchema = z.object({
  actorId: z.string().uuid(),
  requestedUsage: z.enum([
    'film_tv',
    'advertising',
    'ai_training',
    'synthetic_media',
    'voice_replication',
  ]),
  apiClientId: z.string().uuid(),
  metadata: z.record(z.unknown()).optional(),
  ipAddress: z.string().trim().optional(),
  userAgent: z.string().trim().optional(),
});

type EnforcementBody = z.infer<typeof ConsentEnforcementSchema>;

type Decision = 'allow' | 'deny' | 'conditional';

function buildResponse(httpStatus: number, payload: Record<string, unknown>) {
  return {
    statusCode: 200,
    body: JSON.stringify({
      httpStatus,
      ...payload,
    }),
  };
}

function evaluateRequestedUsage(
  policy: Record<string, unknown>,
  requestedUsage: EnforcementBody['requestedUsage']
) {
  if (policy.usageBlocked === true) {
    return {
      allowed: false,
      reason: 'All usage is globally blocked by actor consent settings',
    };
  }

  if (requestedUsage === 'ai_training') {
    const allowed =
      (policy.aiControls as Record<string, unknown> | undefined)?.trainingAllowed === true;
    return allowed
      ? { allowed: true }
      : { allowed: false, reason: 'AI training is not permitted by actor consent settings' };
  }

  if (requestedUsage === 'synthetic_media') {
    const allowed =
      (policy.aiControls as Record<string, unknown> | undefined)?.syntheticGenerationAllowed ===
      true;
    return allowed
      ? { allowed: true }
      : {
          allowed: false,
          reason: 'Synthetic media generation is not permitted by actor consent settings',
        };
  }

  const mediaUsage = (policy.mediaUsage as Record<string, unknown> | undefined) || {};
  const legacyUsage = (policy.usage as Record<string, unknown> | undefined) || {};

  const keyMap: Record<string, string[]> = {
    film_tv: ['television', 'film_tv'],
    advertising: ['advertising', 'commercial'],
    voice_replication: ['voiceReplication', 'voice_replication'],
  };

  const keys = keyMap[requestedUsage] || [];
  const mediaPermission = keys.map((key) => mediaUsage[key]).find((value) => value !== undefined);
  const legacyPermission = keys.map((key) => legacyUsage[key]).find((value) => value !== undefined);

  const permission = mediaPermission ?? legacyPermission;

  if (typeof permission === 'boolean') {
    return permission
      ? { allowed: true }
      : {
          allowed: false,
          reason: `Usage '${requestedUsage}' is explicitly denied by actor consent policy`,
        };
  }

  if (permission === 'allow') {
    return { allowed: true };
  }

  if (permission === 'require_approval') {
    return {
      allowed: false,
      reason: `Usage '${requestedUsage}' requires explicit approval from actor`,
    };
  }

  if (permission === 'deny') {
    return {
      allowed: false,
      reason: `Usage '${requestedUsage}' is explicitly denied by actor consent policy`,
    };
  }

  return {
    allowed: false,
    reason: `Unknown usage type '${requestedUsage}' for current consent policy`,
  };
}

async function logUsage(params: {
  tenantId: string;
  licenseId: string;
  apiClientId: string;
  actorId: string;
  decision: Decision;
  requestedUsageType: string;
  reason: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}) {
  await db.queryWithTenant(
    params.tenantId,
    `INSERT INTO license_usage_log (
      license_id,
      api_client_id,
      actor_id,
      endpoint,
      method,
      requested_usage_type,
      decision,
      reason,
      ip_address,
      user_agent,
      request_metadata
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULLIF($9, '')::inet, $10, $11::jsonb)`,
    [
      params.licenseId,
      params.apiClientId,
      params.actorId,
      '/v1/consent/enforcement/check',
      'POST',
      params.requestedUsageType,
      params.decision,
      params.reason,
      params.ipAddress || null,
      params.userAgent || null,
      JSON.stringify(params.metadata || {}),
    ]
  );
}

export async function checkConsentEnforcement(event: APIGatewayProxyEvent, tenantId: string) {
  const startedAt = Date.now();

  try {
    let rawBody: unknown = {};

    try {
      rawBody = JSON.parse(event.body ?? '{}');
    } catch {
      return buildResponse(400, {
        decision: 'deny',
        reason: 'Invalid request format',
        error: 'BAD_REQUEST',
        details: { formErrors: ['Invalid JSON body'], fieldErrors: {} },
      });
    }

    const parsedBody = ConsentEnforcementSchema.safeParse(rawBody);
    if (!parsedBody.success) {
      return buildResponse(400, {
        decision: 'deny',
        reason: 'Invalid request format',
        error: 'BAD_REQUEST',
        details: parsedBody.error.flatten(),
      });
    }

    const { actorId, requestedUsage, apiClientId, metadata, ipAddress, userAgent } =
      parsedBody.data;

    const apiClientResult = await db.queryWithTenant(
      tenantId,
      `SELECT id
       FROM api_clients
       WHERE id = $1
         AND credential_status = 'verified'
         AND deleted_at IS NULL
       LIMIT 1`,
      [apiClientId]
    );

    if (apiClientResult.rows.length === 0) {
      return buildResponse(403, {
        decision: 'deny',
        reason: 'API client is not verified. Contact support@trulyimagined.com',
        error: 'UNVERIFIED_CLIENT',
      });
    }

    const licenseResult = await db.queryWithTenant(
      tenantId,
      `SELECT id, expires_at
       FROM licenses
       WHERE actor_id = $1
         AND api_client_id = $2
         AND status = 'active'
       ORDER BY issued_at DESC
       LIMIT 1`,
      [actorId, apiClientId]
    );

    if (licenseResult.rows.length === 0) {
      return buildResponse(403, {
        decision: 'deny',
        reason: 'No active license found for this actor. Request license first.',
        error: 'NO_LICENSE',
      });
    }

    const license = licenseResult.rows[0] as { id: string; expires_at?: string | null };
    const isExpired =
      license.expires_at !== null && license.expires_at !== undefined
        ? new Date(license.expires_at) < new Date()
        : false;

    if (isExpired) {
      await logUsage({
        tenantId,
        licenseId: license.id,
        apiClientId,
        actorId,
        decision: 'deny',
        requestedUsageType: requestedUsage,
        reason: 'License has expired',
        ipAddress,
        userAgent,
        metadata,
      });

      return buildResponse(403, {
        decision: 'deny',
        reason: 'License has expired. Renew license to continue.',
        error: 'LICENSE_EXPIRED',
        licenseId: license.id,
      });
    }

    const consentResult = await db.queryWithTenant(
      tenantId,
      `SELECT id, version, policy
       FROM consent_ledger
       WHERE actor_id = $1
         AND status = 'active'
       ORDER BY version DESC
       LIMIT 1`,
      [actorId]
    );

    if (consentResult.rows.length === 0) {
      await logUsage({
        tenantId,
        licenseId: license.id,
        apiClientId,
        actorId,
        decision: 'deny',
        requestedUsageType: requestedUsage,
        reason: 'No active consent policy found',
        ipAddress,
        userAgent,
        metadata,
      });

      return buildResponse(403, {
        decision: 'deny',
        reason: 'Actor has no active consent policy',
        error: 'NO_CONSENT',
        licenseId: license.id,
      });
    }

    const consentEntry = consentResult.rows[0] as {
      id: string;
      version: number;
      policy: Record<string, unknown>;
    };

    const evaluation = evaluateRequestedUsage(consentEntry.policy || {}, requestedUsage);
    if (!evaluation.allowed) {
      await logUsage({
        tenantId,
        licenseId: license.id,
        apiClientId,
        actorId,
        decision: 'deny',
        requestedUsageType: requestedUsage,
        reason: evaluation.reason || 'Usage not permitted',
        ipAddress,
        userAgent,
        metadata,
      });

      return buildResponse(403, {
        decision: 'deny',
        reason: evaluation.reason || 'Usage not permitted by consent policy',
        policyVersion: consentEntry.version,
        licenseId: license.id,
        error: 'USAGE_NOT_PERMITTED',
      });
    }

    const commercial = (consentEntry.policy?.commercial || {}) as Record<string, unknown>;
    const paymentRequired = commercial.paymentRequired === true;
    const minFee =
      typeof commercial.minFee === 'number'
        ? commercial.minFee
        : typeof commercial.minFee === 'string'
          ? Number(commercial.minFee)
          : undefined;
    const revenueShare =
      typeof commercial.revenueShare === 'number'
        ? commercial.revenueShare
        : typeof commercial.revenueShare === 'string'
          ? Number(commercial.revenueShare)
          : undefined;

    const decision: Decision = paymentRequired ? 'conditional' : 'allow';

    await db.queryWithTenant(
      tenantId,
      `UPDATE licenses
       SET usage_count = usage_count + 1,
           last_used_at = NOW(),
           first_used_at = COALESCE(first_used_at, NOW()),
           updated_at = NOW()
       WHERE id = $1`,
      [license.id]
    );

    await logUsage({
      tenantId,
      licenseId: license.id,
      apiClientId,
      actorId,
      decision,
      requestedUsageType: requestedUsage,
      reason: paymentRequired
        ? 'Usage permitted by consent with payment requirements'
        : 'Usage permitted by consent',
      ipAddress,
      userAgent,
      metadata,
    });

    const constraints = (consentEntry.policy?.constraints || {}) as Record<string, unknown>;

    return buildResponse(200, {
      decision,
      reason: paymentRequired
        ? 'Usage permitted - payment required per actor consent'
        : 'Usage permitted by actor consent',
      policyVersion: consentEntry.version,
      licenseId: license.id,
      commercial: {
        paymentRequired,
        minFee,
        revenueShare,
      },
      attribution: {
        required: consentEntry.policy?.attributionRequired === true,
      },
      constraints: {
        territory: constraints.territory,
        expiryDate: constraints.expiryDate,
      },
      meta: {
        responseTime: `${Date.now() - startedAt}ms`,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error: unknown) {
    console.error('[CONSENT] Enforcement check error:', error);

    return buildResponse(500, {
      decision: 'deny',
      reason: 'Internal server error while checking consent',
      error: 'INTERNAL_ERROR',
    });
  }
}
