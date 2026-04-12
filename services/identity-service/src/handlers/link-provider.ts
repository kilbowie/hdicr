/**
 * Identity Linking Handler - Link External Provider
 * POST /identity/link
 *
 * Links an external identity provider (gov ID, bank, KYC) to user profile
 * Part of Step 7: Multi-Provider Identity Linking
 */

import { db } from '@trulyimagined/database';

const query = db.query.bind(db);

interface LinkProviderRequest {
  userId: string;
  provider: string; // 'uk-gov-verify', 'bank-openid', 'onfido', 'yoti', 'plaid'
  providerUserId: string;
  providerType: string; // 'oauth', 'oidc', 'kyc', 'government', 'financial'
  verificationLevel?: string; // 'low', 'medium', 'high', 'very-high'
  assuranceLevel?: string; // 'low', 'substantial', 'high'
  credentialData?: Record<string, unknown>; // Encrypted claims
  metadata?: Record<string, unknown>;
  expiresAt?: string;
}

interface LinkProviderResponse {
  success: boolean;
  linkId: string;
  provider: string;
  verificationLevel?: string;
  message: string;
}

/**
 * Link external identity provider to user profile
 */
export async function linkIdentityProvider(
  request: LinkProviderRequest
): Promise<LinkProviderResponse> {
  const {
    userId,
    provider,
    providerUserId,
    providerType,
    verificationLevel,
    assuranceLevel,
    credentialData,
    metadata,
    expiresAt,
  } = request;

  // Validation
  if (!userId || !provider || !providerUserId || !providerType) {
    throw new Error('Missing required fields: userId, provider, providerUserId, providerType');
  }

  // Validate verification level
  const validVerificationLevels = ['low', 'medium', 'high', 'very-high'];
  if (verificationLevel && !validVerificationLevels.includes(verificationLevel)) {
    throw new Error(
      `Invalid verification level. Must be one of: ${validVerificationLevels.join(', ')}`
    );
  }

  // Validate assurance level (eIDAS)
  const validAssuranceLevels = ['low', 'substantial', 'high'];
  if (assuranceLevel && !validAssuranceLevels.includes(assuranceLevel)) {
    throw new Error(`Invalid assurance level. Must be one of: ${validAssuranceLevels.join(', ')}`);
  }

  try {
    // Check if link already exists
    const existingLink = await query(
      `SELECT id, is_active FROM identity_links 
       WHERE user_profile_id = $1 AND provider = $2 AND provider_user_id = $3`,
      [userId, provider, providerUserId]
    );

    if (existingLink.rows.length > 0) {
      const existing = existingLink.rows[0];

      // If exists but inactive, reactivate it
      if (!existing.is_active) {
        await query(
          `UPDATE identity_links 
           SET is_active = TRUE, 
               linked_at = NOW(), 
               verification_level = COALESCE($1, verification_level),
               assurance_level = COALESCE($2, assurance_level),
               credential_data = COALESCE($3, credential_data),
               metadata = COALESCE($4, metadata),
               expires_at = $5,
               last_verified_at = NOW()
           WHERE id = $6`,
          [
            verificationLevel || null,
            assuranceLevel || null,
            credentialData ? JSON.stringify(credentialData) : null,
            metadata ? JSON.stringify(metadata) : null,
            expiresAt || null,
            existing.id,
          ]
        );

        console.log('[IDENTITY-LINK] Reactivated existing link:', {
          linkId: existing.id,
          userId,
          provider,
        });

        return {
          success: true,
          linkId: existing.id,
          provider,
          verificationLevel: verificationLevel || 'medium',
          message: 'Identity provider link reactivated',
        };
      }

      // Already active - return existing
      return {
        success: true,
        linkId: existing.id,
        provider,
        verificationLevel: verificationLevel || 'medium',
        message: 'Identity provider already linked',
      };
    }

    // Create new identity link
    const result = await query(
      `INSERT INTO identity_links (
        user_profile_id,
        provider,
        provider_user_id,
        provider_type,
        verification_level,
        assurance_level,
        credential_data,
        metadata,
        verified_at,
        expires_at,
        last_verified_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9, NOW())
      RETURNING id, provider, verification_level, assurance_level`,
      [
        userId,
        provider,
        providerUserId,
        providerType,
        verificationLevel || 'medium',
        assuranceLevel || null,
        credentialData ? JSON.stringify(credentialData) : null,
        metadata ? JSON.stringify(metadata) : null,
        expiresAt || null,
      ]
    );

    const newLink = result.rows[0];

    console.log('[IDENTITY-LINK] Created new identity link:', {
      linkId: newLink.id,
      userId,
      provider,
      verificationLevel: newLink.verification_level,
      assuranceLevel: newLink.assurance_level,
    });

    return {
      success: true,
      linkId: newLink.id,
      provider: newLink.provider,
      verificationLevel: newLink.verification_level,
      message: 'Identity provider linked successfully',
    };
  } catch (error: any) {
    console.error('[IDENTITY-LINK] Error linking provider:', error);
    throw new Error(`Failed to link identity provider: ${error.message}`);
  }
}

/**
 * Check if a specific provider is already linked
 */
export async function isProviderLinked(userId: string, provider: string): Promise<boolean> {
  const result = await query(
    `SELECT id FROM identity_links 
     WHERE user_profile_id = $1 AND provider = $2 AND is_active = TRUE`,
    [userId, provider]
  );

  return result.rows.length > 0;
}

/**
 * Get all active identity links for a user
 */
export async function getUserIdentityLinks(userId: string) {
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
      metadata
    FROM identity_links 
    WHERE user_profile_id = $1 AND is_active = TRUE
    ORDER BY verification_level DESC, linked_at DESC`,
    [userId]
  );

  return result.rows;
}
