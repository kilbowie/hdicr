import { APIGatewayProxyEvent } from 'aws-lambda';
import { DatabaseClient } from '@trulyimagined/database';
import { z } from 'zod';

/**
 * Check Consent Handler
 *
 * Checks if an actor has active consent for a specific usage
 * Used by external consumers to verify they have permission to use actor's identity
 *
 * Logic:
 * - Query consent_log for most recent action (granted or revoked)
 * - Check if consent is not expired
 * - Return isGranted boolean + consent details
 */

const db = DatabaseClient.getInstance();

const NonEmptyString = z.string().trim().min(1);

const CheckConsentQuerySchema = z.object({
  actorId: NonEmptyString,
  consentType: NonEmptyString,
  projectId: NonEmptyString.optional(),
});

function validationErrorResponse(error: z.ZodError) {
  return {
    statusCode: 400,
    body: JSON.stringify({
      error: 'Validation failed',
      details: error.flatten(),
    }),
  };
}

export async function checkConsent(event: APIGatewayProxyEvent, tenantId: string) {
  try {
    const parsedQuery = CheckConsentQuerySchema.safeParse(event.queryStringParameters ?? {});
    if (!parsedQuery.success) {
      return validationErrorResponse(parsedQuery.error);
    }

    const { actorId, consentType, projectId } = parsedQuery.data;

    // Query for most recent consent action (granted or revoked)
    let query = `
      SELECT * FROM consent_log 
      WHERE tenant_id = $1
        AND actor_id = $2 
        AND consent_type = $3
    `;
    const queryParams: (string | number)[] = [tenantId, actorId, consentType];

    // Optional: filter by project ID if provided
    if (projectId) {
      query += ` AND (consent_scope->>'projectId' = $4 OR consent_scope->>'projectId' IS NULL)`;
      queryParams.push(projectId);
    }

    query += ` ORDER BY created_at DESC LIMIT 1`;

    const result = await db.queryWithTenant(tenantId, query, queryParams);

    if (result.rows.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          isGranted: false,
          message: 'No consent record found for this actor and consent type',
          actorId,
          consentType,
          projectId: projectId || null,
        }),
      };
    }

    const latestConsent = result.rows[0];

    // Check if most recent action was 'granted' or 'revoked'
    const isGranted = latestConsent.action === 'granted';

    // Check expiry if consent was granted
    let isExpired = false;
    if (isGranted && latestConsent.consent_scope?.duration?.endDate) {
      const expiryDate = new Date(latestConsent.consent_scope.duration.endDate);
      isExpired = expiryDate < new Date();
    }

    console.log('[CONSENT] Consent check:', {
      actorId,
      consentType,
      projectId,
      isGranted: isGranted && !isExpired,
      action: latestConsent.action,
      isExpired,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        isGranted: isGranted && !isExpired,
        consent:
          isGranted && !isExpired
            ? {
                consentId: latestConsent.id,
                actorId: latestConsent.actor_id,
                consentType: latestConsent.consent_type,
                scope: latestConsent.consent_scope,
                grantedAt: latestConsent.created_at,
                projectName: latestConsent.project_name,
                expiresAt: latestConsent.consent_scope?.duration?.endDate || null,
                isExpired,
              }
            : null,
        latestAction: {
          action: latestConsent.action,
          timestamp: latestConsent.created_at,
          reason: isExpired
            ? 'Consent expired'
            : latestConsent.action === 'revoked'
              ? 'Consent revoked'
              : null,
        },
      }),
    };
  } catch (error: unknown) {
    console.error('[CONSENT] Check consent error:', error);
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
