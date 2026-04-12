import { APIGatewayProxyEvent } from 'aws-lambda';
import { DatabaseClient } from '@trulyimagined/database';
import { z } from 'zod';

/**
 * Revoke Consent Handler
 *
 * Records a consent revocation in the immutable consent_log table
 * Does NOT delete previous grants - maintains full audit trail
 */

const db = DatabaseClient.getInstance();

const NonEmptyString = z.string().trim().min(1);

const RevokeConsentSchema = z
  .object({
    actorId: NonEmptyString,
    consentId: NonEmptyString.optional(),
    consentType: NonEmptyString.optional(),
    projectId: NonEmptyString.optional(),
    reason: NonEmptyString.optional(),
  })
  .refine((value) => Boolean(value.consentId || value.consentType || value.projectId), {
    message: 'At least one of consentId, consentType, or projectId is required',
  });

function validationErrorResponse(error: z.ZodError | string) {
  const details =
    typeof error === 'string' ? { formErrors: [error], fieldErrors: {} } : error.flatten();

  return {
    statusCode: 400,
    body: JSON.stringify({
      error: 'Validation failed',
      details,
    }),
  };
}

export async function revokeConsent(event: APIGatewayProxyEvent, tenantId: string) {
  try {
    let rawBody: unknown = {};
    try {
      rawBody = JSON.parse(event.body ?? '{}');
    } catch {
      return validationErrorResponse('Invalid JSON body');
    }

    const parsedBody = RevokeConsentSchema.safeParse(rawBody);
    if (!parsedBody.success) {
      return validationErrorResponse(parsedBody.error);
    }

    const { actorId, consentId, consentType, projectId, reason } = parsedBody.data;

    // Get IP and User Agent
    const ipAddress = event.requestContext?.identity?.sourceIp || null;
    const userAgent = event.headers?.['User-Agent'] || null;

    let result;

    // Scenario 1: Revoke specific consent by ID
    if (consentId) {
      // Fetch the original consent to copy its details
      const original = await db.queryWithTenant(
        tenantId,
        `SELECT * FROM consent_log WHERE id = $1 AND actor_id = $2 AND tenant_id = $3 ORDER BY created_at DESC LIMIT 1`,
        [consentId, actorId, tenantId]
      );

      if (original.rows.length === 0) {
        return {
          statusCode: 404,
          body: JSON.stringify({ error: 'Consent not found' }),
        };
      }

      const originalConsent = original.rows[0];

      // Insert revocation record
      result = await db.queryWithTenant(
        tenantId,
        `INSERT INTO consent_log (
          tenant_id, actor_id, action, consent_type, consent_scope,
          project_name, project_description,
          ip_address, user_agent, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *`,
        [
          tenantId,
          actorId,
          'revoked',
          originalConsent.consent_type,
          originalConsent.consent_scope,
          originalConsent.project_name,
          originalConsent.project_description,
          ipAddress,
          userAgent,
          JSON.stringify({
            originalConsentId: consentId,
            reason: reason || 'User requested revocation',
            revokedAt: new Date().toISOString(),
          }),
        ]
      );
    }
    // Scenario 2: Revoke all consents of specific type
    else if (consentType) {
      result = await db.queryWithTenant(
        tenantId,
        `INSERT INTO consent_log (
          tenant_id, actor_id, action, consent_type, consent_scope,
          ip_address, user_agent, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *`,
        [
          tenantId,
          actorId,
          'revoked',
          consentType,
          JSON.stringify({ projectId: projectId || null }),
          ipAddress,
          userAgent,
          JSON.stringify({
            reason: reason || 'User revoked all consents of this type',
            revokedAt: new Date().toISOString(),
          }),
        ]
      );
    }
    if (!result || result.rows.length === 0) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to create revocation record' }),
      };
    }
    const revocationRecord = result.rows[0];

    console.log('[CONSENT] Consent revoked:', {
      id: revocationRecord.id,
      actorId,
      consentType: revocationRecord.consent_type,
      reason,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: 'Consent revoked and logged to immutable ledger',
        revocation: {
          revocationId: revocationRecord.id,
          actorId: revocationRecord.actor_id,
          action: revocationRecord.action,
          consentType: revocationRecord.consent_type,
          revokedAt: revocationRecord.created_at,
          reason: reason || 'Not specified',
        },
      }),
    };
  } catch (error: unknown) {
    console.error('[CONSENT] Revoke consent error:', error);
    const err = error as Error;

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Internal server error',
        message: err.message,
      }),
    };
  }
}
