import { APIGatewayProxyEvent } from 'aws-lambda';
import { DatabaseClient } from '@trulyimagined/database';
import { z } from 'zod';

/**
 * List Consents Handler
 *
 * Returns full consent history for an actor from the immutable ledger
 * Useful for actors to view their consent trail and manage permissions
 */

const db = DatabaseClient.getInstance();

const NonEmptyString = z.string().trim().min(1);

const ListConsentsQuerySchema = z.object({
  actorId: NonEmptyString,
  limit: z.coerce.number().int().min(0).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
  action: NonEmptyString.optional(),
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

interface ConsentRecord {
  id: string;
  actor_id: string;
  action: string;
  consent_type: string;
  consent_scope: {
    projectId?: string;
    projectName?: string;
    duration?: {
      startDate?: string;
      endDate?: string;
    };
    [key: string]: unknown;
  };
  project_name?: string;
  project_description?: string;
  created_at: string;
  metadata?: Record<string, unknown>;
}

interface ConsentSummary {
  consentId: string;
  consentType: string;
  action: string;
  scope: Record<string, unknown>;
  projectName?: string;
  projectDescription?: string;
  grantedAt?: string;
  revokedAt?: string;
  expiredAt?: Date;
  expiresAt?: Date | null;
  metadata?: Record<string, unknown>;
}

export async function listConsents(event: APIGatewayProxyEvent, tenantId: string) {
  try {
    const parsedQuery = ListConsentsQuerySchema.safeParse({
      actorId: event.pathParameters?.actorId || event.queryStringParameters?.actorId,
      limit: event.queryStringParameters?.limit,
      offset: event.queryStringParameters?.offset,
      action: event.queryStringParameters?.action,
    });
    if (!parsedQuery.success) {
      return validationErrorResponse(parsedQuery.error);
    }

    const { actorId, limit, offset, action } = parsedQuery.data;

    // Build query
    let query = `
      SELECT * FROM consent_log 
      WHERE tenant_id = $1 AND actor_id = $2
    `;
    const queryParams: (string | number)[] = [tenantId, actorId];

    // Optional filter by action
    if (action) {
      query += ` AND action = $${queryParams.length + 1}`;
      queryParams.push(action);
    }

    query += ` ORDER BY created_at DESC LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}`;
    queryParams.push(limit, offset);

    // Execute query
    const result = await db.queryWithTenant(tenantId, query, queryParams);

    // Get total count (for pagination)
    let countQuery = `SELECT COUNT(*) FROM consent_log WHERE tenant_id = $1 AND actor_id = $2`;
    const countParams: (string | number)[] = [tenantId, actorId];

    if (action) {
      countQuery += ` AND action = $3`;
      countParams.push(action);
    }

    const countResult = await db.queryWithTenant(tenantId, countQuery, countParams);
    const totalCount = parseInt(countResult.rows[0].count);

    // Group consents by current status (active/revoked/expired)
    const activeConsents: ConsentSummary[] = [];
    const revokedConsents: ConsentSummary[] = [];
    const expiredConsents: ConsentSummary[] = [];

    // Map to track latest action per consent type + project
    const latestByTypeProject = new Map<string, ConsentRecord>();

    for (const record of result.rows) {
      const key = `${record.consent_type}:${record.consent_scope?.projectId || 'general'}`;

      const existing = latestByTypeProject.get(key);
      if (!existing || new Date(record.created_at) > new Date(existing.created_at)) {
        latestByTypeProject.set(key, record);
      }
    }

    // Categorize consents
    for (const [, record] of latestByTypeProject) {
      const consentObj = {
        consentId: record.id,
        consentType: record.consent_type,
        action: record.action,
        scope: record.consent_scope,
        projectName: record.project_name,
        projectDescription: record.project_description,
        grantedAt: record.created_at,
        metadata: record.metadata,
      };

      if (record.action === 'granted') {
        // Check expiry
        const expiryDate = record.consent_scope?.duration?.endDate
          ? new Date(record.consent_scope.duration.endDate)
          : null;

        if (expiryDate && expiryDate < new Date()) {
          expiredConsents.push({ ...consentObj, expiredAt: expiryDate });
        } else {
          activeConsents.push({ ...consentObj, expiresAt: expiryDate });
        }
      } else if (record.action === 'revoked') {
        revokedConsents.push({ ...consentObj, revokedAt: record.created_at });
      }
    }

    console.log('[CONSENT] List consents:', {
      actorId,
      totalRecords: result.rows.length,
      active: activeConsents.length,
      revoked: revokedConsents.length,
      expired: expiredConsents.length,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        actorId,
        summary: {
          active: activeConsents.length,
          revoked: revokedConsents.length,
          expired: expiredConsents.length,
          totalRecords: totalCount,
        },
        consents: {
          active: activeConsents,
          revoked: revokedConsents,
          expired: expiredConsents,
        },
        fullHistory: result.rows.map((record) => ({
          id: record.id,
          action: record.action,
          consentType: record.consent_type,
          scope: record.consent_scope,
          projectName: record.project_name,
          timestamp: record.created_at,
          metadata: record.metadata,
        })),
        pagination: {
          limit,
          offset,
          total: totalCount,
          hasMore: offset + limit < totalCount,
        },
        message: 'Consent ledger is append-only and immutable',
      }),
    };
  } catch (error: unknown) {
    console.error('[CONSENT] List consents error:', error);
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
