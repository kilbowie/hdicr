/**
 * Common Database Queries
 * 
 * Reusable query builders for services
 */

import { db } from './client';
import type {
  PerformerIdentity,
  ConsentBoundaries,
  LicensingPreferences,
} from '@trulyimagined/types';

// ==================== IDENTITY QUERIES ====================

export async function getPerformerByAuth0Id(
  auth0UserId: string
): Promise<PerformerIdentity | null> {
  const result = await db.query<PerformerIdentity>(
    'SELECT * FROM performers WHERE auth0_user_id = $1',
    [auth0UserId]
  );
  return result.rows[0] || null;
}

export async function createPerformer(data: Partial<PerformerIdentity>): Promise<PerformerIdentity> {
  const result = await db.query<PerformerIdentity>(
    `INSERT INTO performers (auth0_user_id, email, full_name, stage_name, industry_role, region)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [data.auth0UserId, data.email, data.fullName, data.stageName, data.industryRole, data.region]
  );
  return result.rows[0];
}

// ==================== CONSENT QUERIES ====================

export async function getConsentByPerformerId(
  performerId: string
): Promise<ConsentBoundaries | null> {
  const result = await db.query<ConsentBoundaries>(
    'SELECT * FROM consent_boundaries WHERE performer_id = $1 ORDER BY version DESC LIMIT 1',
    [performerId]
  );
  return result.rows[0] || null;
}

export async function saveConsent(data: Partial<ConsentBoundaries>): Promise<ConsentBoundaries> {
  const result = await db.query<ConsentBoundaries>(
    `INSERT INTO consent_boundaries 
     (performer_id, version, voice_model_training, likeness_model_training, 
      performance_replication, biometric_data_usage, derivative_works, 
      commercial_usage, third_party_sharing, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      data.performerId,
      data.version,
      data.voiceModelTraining,
      data.likenessModelTraining,
      data.performanceReplication,
      data.biometricDataUsage,
      data.derivativeWorks,
      data.commercialUsage,
      data.thirdPartySharing,
      data.ipAddress,
      data.userAgent,
    ]
  );
  return result.rows[0];
}

// ==================== LICENSING QUERIES ====================

export async function getLicensingByPerformerId(
  performerId: string
): Promise<LicensingPreferences | null> {
  const result = await db.query<LicensingPreferences>(
    'SELECT * FROM licensing_preferences WHERE performer_id = $1 ORDER BY version DESC LIMIT 1',
    [performerId]
  );
  return result.rows[0] || null;
}

export async function saveLicensing(
  data: Partial<LicensingPreferences>
): Promise<LicensingPreferences> {
  const result = await db.query<LicensingPreferences>(
    `INSERT INTO licensing_preferences 
     (performer_id, version, require_final_approval, require_scene_by_scene_approval,
      require_script_approval, exclude_adult_content, exclude_political_content,
      exclude_religious_content, exclude_violence, currency)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      data.performerId,
      data.version,
      data.requireFinalApproval,
      data.requireSceneBySceneApproval,
      data.requireScriptApproval,
      data.excludeAdultContent,
      data.excludePoliticalContent,
      data.excludeReligiousContent,
      data.excludeViolence,
      data.currency,
    ]
  );
  return result.rows[0];
}
