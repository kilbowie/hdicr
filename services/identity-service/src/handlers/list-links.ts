/**
 * Identity Linking Handler - List Identity Links
 * GET /identity/links/{userId}
 *
 * Retrieves all identity provider links for a user
 * Part of Step 7: Multi-Provider Identity Linking
 */

import { db } from '@trulyimagined/database';

const query = db.query.bind(db);

interface IdentityLink {
  linkId: string;
  provider: string;
  providerType: string;
  verificationLevel: string | null;
  assuranceLevel: string | null;
  verifiedAt: string | null;
  linkedAt: string;
  lastVerifiedAt: string | null;
  expiresAt: string | null;
  isActive: boolean;
  isExpired: boolean;
  metadata: Record<string, unknown> | null;
}

interface ListLinksResponse {
  userId: string;
  links: IdentityLink[];
  summary: {
    total: number;
    active: number;
    inactive: number;
    byProvider: Record<string, number>;
    highestVerificationLevel: string | null;
    highestAssuranceLevel: string | null;
  };
}

/**
 * List all identity links for a user (active and inactive)
 */
export async function listIdentityLinks(
  userId: string,
  activeOnly: boolean = false
): Promise<ListLinksResponse> {
  if (!userId) {
    throw new Error('Missing required parameter: userId');
  }

  try {
    let sql = `
      SELECT 
        id,
        provider,
        provider_type,
        verification_level,
        assurance_level,
        verified_at,
        linked_at,
        last_verified_at,
        expires_at,
        is_active,
        metadata
      FROM identity_links 
      WHERE user_profile_id = $1
    `;

    if (activeOnly) {
      sql += ` AND is_active = TRUE`;
    }

    sql += ` ORDER BY 
      CASE verification_level 
        WHEN 'very-high' THEN 4 
        WHEN 'high' THEN 3 
        WHEN 'medium' THEN 2 
        WHEN 'low' THEN 1 
        ELSE 0 
      END DESC,
      linked_at DESC`;

    const result = await query(sql, [userId]);

    const now = new Date();

    // Transform and enrich results
    const links: IdentityLink[] = result.rows.map((row: Record<string, any>) => {
      const expiresAt = row.expires_at ? new Date(row.expires_at) : null;
      const isExpired = expiresAt ? expiresAt < now : false;

      return {
        linkId: row.id,
        provider: row.provider,
        providerType: row.provider_type,
        verificationLevel: row.verification_level,
        assuranceLevel: row.assurance_level,
        verifiedAt: row.verified_at,
        linkedAt: row.linked_at,
        lastVerifiedAt: row.last_verified_at,
        expiresAt: row.expires_at,
        isActive: row.is_active && !isExpired,
        isExpired,
        metadata: row.metadata,
      };
    });

    // Calculate summary statistics
    const summary = calculateLinksSummary(links);

    console.log('[IDENTITY-LINKS] Listed identity links:', {
      userId,
      total: links.length,
      active: summary.active,
    });

    return {
      userId,
      links,
      summary,
    };
  } catch (error: any) {
    console.error('[IDENTITY-LINKS] Error listing identity links:', error);
    throw new Error(`Failed to list identity links: ${error.message}`);
  }
}

/**
 * Calculate summary statistics for identity links
 */
function calculateLinksSummary(links: IdentityLink[]) {
  const byProvider: Record<string, number> = {};
  let active = 0;
  let inactive = 0;

  const verificationLevelRank = {
    'very-high': 4,
    high: 3,
    medium: 2,
    low: 1,
  };

  const assuranceLevelRank = {
    high: 3,
    substantial: 2,
    low: 1,
  };

  let highestVerificationLevel: string | null = null;
  let highestVerificationRank = 0;

  let highestAssuranceLevel: string | null = null;
  let highestAssuranceRank = 0;

  for (const link of links) {
    // Count by provider
    byProvider[link.provider] = (byProvider[link.provider] || 0) + 1;

    // Count active/inactive
    if (link.isActive && !link.isExpired) {
      active++;

      // Track highest verification level (only for active links)
      if (link.verificationLevel) {
        const rank =
          verificationLevelRank[link.verificationLevel as keyof typeof verificationLevelRank] || 0;
        if (rank > highestVerificationRank) {
          highestVerificationRank = rank;
          highestVerificationLevel = link.verificationLevel;
        }
      }

      // Track highest assurance level (only for active links)
      if (link.assuranceLevel) {
        const rank =
          assuranceLevelRank[link.assuranceLevel as keyof typeof assuranceLevelRank] || 0;
        if (rank > highestAssuranceRank) {
          highestAssuranceRank = rank;
          highestAssuranceLevel = link.assuranceLevel;
        }
      }
    } else {
      inactive++;
    }
  }

  return {
    total: links.length,
    active,
    inactive,
    byProvider,
    highestVerificationLevel,
    highestAssuranceLevel,
  };
}

/**
 * Get a single identity link by ID
 */
export async function getIdentityLink(
  userId: string,
  linkId: string
): Promise<IdentityLink | null> {
  const result = await query(
    `SELECT 
      id,
      provider,
      provider_type,
      verification_level,
      assurance_level,
      verified_at,
      linked_at,
      last_verified_at,
      expires_at,
      is_active,
      metadata
    FROM identity_links 
    WHERE id = $1 AND user_profile_id = $2`,
    [linkId, userId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  const expiresAt = row.expires_at ? new Date(row.expires_at) : null;
  const isExpired = expiresAt ? expiresAt < new Date() : false;

  return {
    linkId: row.id,
    provider: row.provider,
    providerType: row.provider_type,
    verificationLevel: row.verification_level,
    assuranceLevel: row.assurance_level,
    verifiedAt: row.verified_at,
    linkedAt: row.linked_at,
    lastVerifiedAt: row.last_verified_at,
    expiresAt: row.expires_at,
    isActive: row.is_active && !isExpired,
    isExpired,
    metadata: row.metadata,
  };
}
