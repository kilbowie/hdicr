/**
 * Identity Linking Handler - Unlink External Provider
 * POST /identity/unlink
 *
 * Removes link to an external identity provider
 * Part of Step 7: Multi-Provider Identity Linking
 */

import { db } from '@trulyimagined/database';

const query = db.query.bind(db);

interface UnlinkProviderRequest {
  userId: string;
  linkId?: string; // Either linkId or provider must be provided
  provider?: string;
}

interface UnlinkProviderResponse {
  success: boolean;
  message: string;
  unlinkedProvider?: string;
}

/**
 * Unlink external identity provider from user profile
 * (Soft delete - sets is_active = FALSE)
 */
export async function unlinkIdentityProvider(
  request: UnlinkProviderRequest
): Promise<UnlinkProviderResponse> {
  const { userId, linkId, provider } = request;

  // Validation
  if (!userId) {
    throw new Error('Missing required field: userId');
  }

  if (!linkId && !provider) {
    throw new Error('Must provide either linkId or provider to unlink');
  }

  try {
    let result;
    let unlinkedProvider = '';

    if (linkId) {
      // Unlink by specific link ID
      result = await query(
        `UPDATE identity_links 
         SET is_active = FALSE, updated_at = NOW()
         WHERE id = $1 AND user_profile_id = $2
         RETURNING provider`,
        [linkId, userId]
      );

      if (result.rows.length === 0) {
        throw new Error('Identity link not found or unauthorized');
      }

      unlinkedProvider = result.rows[0].provider;
    } else if (provider) {
      // Unlink all links for this provider
      result = await query(
        `UPDATE identity_links 
         SET is_active = FALSE, updated_at = NOW()
         WHERE user_profile_id = $1 AND provider = $2 AND is_active = TRUE
         RETURNING id`,
        [userId, provider]
      );

      if (result.rows.length === 0) {
        throw new Error('No active links found for this provider');
      }

      unlinkedProvider = provider;
    }

    console.log('[IDENTITY-UNLINK] Unlinked provider:', {
      userId,
      linkId,
      provider: unlinkedProvider,
      count: result?.rows.length || 0,
    });

    return {
      success: true,
      message: 'Identity provider unlinked successfully',
      unlinkedProvider,
    };
  } catch (error: any) {
    console.error('[IDENTITY-UNLINK] Error unlinking provider:', error);
    throw new Error(`Failed to unlink identity provider: ${error.message}`);
  }
}

/**
 * Re-link a previously unlinked provider
 */
export async function relinkIdentityProvider(
  userId: string,
  linkId: string
): Promise<UnlinkProviderResponse> {
  try {
    const result = await query(
      `UPDATE identity_links 
       SET is_active = TRUE, linked_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND user_profile_id = $2
       RETURNING provider`,
      [linkId, userId]
    );

    if (result.rows.length === 0) {
      throw new Error('Identity link not found or unauthorized');
    }

    const provider = result.rows[0].provider;

    console.log('[IDENTITY-RELINK] Relinked provider:', {
      userId,
      linkId,
      provider,
    });

    return {
      success: true,
      message: 'Identity provider relinked successfully',
      unlinkedProvider: provider,
    };
  } catch (error: any) {
    console.error('[IDENTITY-RELINK] Error relinking provider:', error);
    throw new Error(`Failed to relink identity provider: ${error.message}`);
  }
}
