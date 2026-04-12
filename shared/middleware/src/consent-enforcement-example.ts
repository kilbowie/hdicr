/**
 * Consent Enforcement Example
 *
 * This example demonstrates how to use the requireConsent middleware
 * in Lambda functions to enforce consent before processing requests.
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { requireConsent, hasConsent } from '@trulyimagined/middleware';

/**
 * Example: AI Voice Generation Service
 *
 * Before generating an AI voice for an actor, this handler checks:
 * 1. If the actor has granted voice_synthesis consent
 * 2. If the consent is still active (not revoked or expired)
 * 3. If the consent applies to the specific project
 *
 * If consent is not granted, the request is rejected with a 403 Forbidden response.
 */
export const generateVoiceHandler: APIGatewayProxyHandler = async (event) => {
  try {
    const body = JSON.parse(event.body || '{}');
    const { actorId, projectId, text } = body;

    // Validation
    if (!actorId || !text) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: 'Missing required fields: actorId, text',
        }),
      };
    }

    // ✅ CONSENT ENFORCEMENT
    // This will throw an error if consent is not granted
    try {
      await requireConsent(actorId, 'voice_synthesis', projectId);
    } catch (consentError: unknown) {
      const err = consentError as Error;
      return {
        statusCode: 403,
        body: JSON.stringify({
          error: 'Consent required',
          message: err.message,
          action: 'The actor must grant voice_synthesis consent before their voice can be used.',
        }),
      };
    }

    // If we reached here, consent is granted - proceed with voice generation
    console.log(`[VOICE] Generating voice for actor ${actorId}, project: ${projectId}`);

    // ... actual voice generation logic here ...

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: 'Voice generated successfully',
        actorId,
        text,
        audioUrl: 'https://example.com/audio.mp3',
      }),
    };
  } catch (error: unknown) {
    console.error('[VOICE] Error:', error);
    const err = error as Error;
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Internal server error',
        message: err.message,
      }),
    };
  }
};

/**
 * Example: Image Usage Service
 *
 * Before using an actor's image in a project, check for image_usage consent.
 */
export const useImageHandler: APIGatewayProxyHandler = async (event) => {
  try {
    const body = JSON.parse(event.body || '{}');
    const { actorId, projectId, imageUrl, usageType } = body;

    // ✅ CONSENT ENFORCEMENT
    await requireConsent(actorId, 'image_usage', projectId);

    // Proceed with image processing
    console.log(`[IMAGE] Using image for actor ${actorId}`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: 'Image usage authorized',
        actorId,
        imageUrl,
        usageType,
      }),
    };
  } catch (error: unknown) {
    // If consent check fails, return 403
    const err = error as Error;
    if (err.message.includes('Consent')) {
      return {
        statusCode: 403,
        body: JSON.stringify({
          error: 'Consent required',
          message: err.message,
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
};

/**
 * Example: Conditional Logic Based on Consent
 *
 * Use hasConsent() to check consent without throwing an error.
 * Useful for conditional features.
 */
export const getActorProfileHandler: APIGatewayProxyHandler = async (event) => {
  try {
    const actorId = event.pathParameters?.actorId;

    if (!actorId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Actor ID required' }),
      };
    }

    // Fetch actor profile from database
    const profile = {
      id: actorId,
      name: 'John Doe',
      bio: 'Actor bio...',
    };

    // Check if voice synthesis consent is granted
    const hasVoiceConsent = await hasConsent(actorId, 'voice_synthesis');
    const hasImageConsent = await hasConsent(actorId, 'image_usage');

    // Return profile with consent status
    return {
      statusCode: 200,
      body: JSON.stringify({
        ...profile,
        capabilities: {
          voiceSynthesisAvailable: hasVoiceConsent,
          imageUsageAvailable: hasImageConsent,
        },
      }),
    };
  } catch (error: unknown) {
    const err = error as Error;
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Internal server error',
        message: err.message,
      }),
    };
  }
};
