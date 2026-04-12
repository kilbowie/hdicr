import { APIGatewayProxyEvent } from 'aws-lambda';
import { DatabaseClient } from '@trulyimagined/database';
import { z } from 'zod';

/**
 * Grant Consent Handler
 *
 * Records a consent grant in the immutable consent_log table
 * This is the primary mechanism for actors to grant permission for their digital identity usage
 */

const db = DatabaseClient.getInstance();

const NonEmptyString = z.string().trim().min(1);

const GrantConsentSchema = z.object({
  actorId: NonEmptyString,
  consentType: NonEmptyString,
  scope: z
    .object({
      projectName: NonEmptyString.optional(),
      projectId: NonEmptyString.optional(),
      projectDescription: NonEmptyString.optional(),
      duration: z
        .object({
          startDate: NonEmptyString.optional(),
          endDate: NonEmptyString.optional(),
        })
        .optional(),
      usageTypes: z.array(NonEmptyString).optional(),
      territories: z.array(NonEmptyString).optional(),
      exclusions: z.array(NonEmptyString).optional(),
    })
    .passthrough()
    .default({}),
  requesterId: NonEmptyString.optional(),
  requesterType: z.enum(['actor', 'agent', 'studio', 'admin', 'enterprise']).optional(),
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

export async function grantConsent(event: APIGatewayProxyEvent, tenantId: string) {
  try {
    let rawBody: unknown = {};
    try {
      rawBody = JSON.parse(event.body ?? '{}');
    } catch {
      return validationErrorResponse('Invalid JSON body');
    }

    const parsedBody = GrantConsentSchema.safeParse(rawBody);
    if (!parsedBody.success) {
      return validationErrorResponse(parsedBody.error);
    }

    const { actorId, consentType, scope, requesterId, requesterType } = parsedBody.data;

    // Get IP and User Agent from request context
    const ipAddress = event.requestContext?.identity?.sourceIp || null;
    const userAgent = event.headers?.['User-Agent'] || null;

    // Insert into consent_log (append-only)
    const result = await db.queryWithTenant(
      tenantId,
      `INSERT INTO consent_log (
        tenant_id, actor_id, action, consent_type, consent_scope,
        project_name, project_description,
        requester_id, requester_type,
        ip_address, user_agent, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *`,
      [
        tenantId,
        actorId,
        'granted',
        consentType,
        JSON.stringify(scope || {}),
        scope?.projectName || null,
        scope?.projectDescription || null,
        requesterId || null,
        requesterType || null,
        ipAddress,
        userAgent,
        JSON.stringify({
          grantedAt: new Date().toISOString(),
          source: 'api',
        }),
      ]
    );

    const consentRecord = result.rows[0];

    console.log('[CONSENT] Consent granted:', {
      id: consentRecord.id,
      actorId,
      consentType,
      projectName: scope?.projectName,
    });

    return {
      statusCode: 201,
      body: JSON.stringify({
        success: true,
        message: 'Consent granted and logged to immutable ledger',
        consent: {
          consentId: consentRecord.id,
          actorId: consentRecord.actor_id,
          action: consentRecord.action,
          consentType: consentRecord.consent_type,
          scope: consentRecord.consent_scope,
          grantedAt: consentRecord.created_at,
          projectName: consentRecord.project_name,
        },
      }),
    };
  } catch (error: unknown) {
    console.error('[CONSENT] Grant consent error:', error);
    const err = error as Error;

    // Handle foreign key violation (actor doesn't exist)
    if ('code' in err && (err as { code?: string }).code === '23503') {
      return {
        statusCode: 404,
        body: JSON.stringify({
          error: 'Actor not found',
          message: 'The specified actor does not exist in the registry',
        }),
      };
    }

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Internal server error',
        message: err.message,
      }),
    };
  }
}
