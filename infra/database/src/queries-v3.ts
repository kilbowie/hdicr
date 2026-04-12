/**
 * Database SQL Queries for Truly Imagined v3
 * Phase 1: Identity Registry + Consent Ledger
 *
 * Raw SQL queries to be used with the database client
 */

export const queries = {
  // ===========================================
  // USER PROFILES (Database-Backed Roles)
  // ===========================================

  userProfiles: {
    create: `
      INSERT INTO user_profiles (
        auth0_user_id, email, role, username, legal_name, professional_name,
        use_legal_as_professional, spotlight_id, profile_completed
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *;
    `,

    getByAuth0Id: `
      SELECT * FROM user_profiles WHERE auth0_user_id = $1;
    `,

    getByUsername: `
      SELECT * FROM user_profiles WHERE username = $1;
    `,

    getByProfessionalName: `
      SELECT * FROM user_profiles WHERE professional_name = $1;
    `,

    checkUsernameAvailable: `
      SELECT EXISTS(SELECT 1 FROM user_profiles WHERE username = $1) as exists;
    `,

    checkProfessionalNameAvailable: `
      SELECT EXISTS(SELECT 1 FROM user_profiles WHERE professional_name = $1) as exists;
    `,

    checkSpotlightIdAvailable: `
      SELECT EXISTS(SELECT 1 FROM user_profiles WHERE spotlight_id = $1) as exists;
    `,

    update: `
      UPDATE user_profiles 
      SET role = COALESCE($2, role),
          username = COALESCE($3, username),
          legal_name = COALESCE($4, legal_name),
          professional_name = COALESCE($5, professional_name),
          use_legal_as_professional = COALESCE($6, use_legal_as_professional),
          spotlight_id = COALESCE($7, spotlight_id)
      WHERE auth0_user_id = $1
      RETURNING *;
    `,

    getRole: `
      SELECT role FROM user_profiles WHERE auth0_user_id = $1;
    `,

    listByRole: `
      SELECT * FROM user_profiles 
      WHERE role = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3;
    `,

    listAdminUsersWithActors: `
      SELECT
        up.id,
        up.auth0_user_id,
        up.email,
        up.role,
        up.username,
        up.legal_name,
        up.professional_name,
        up.profile_completed,
        up.is_verified,
        up.is_pro,
        up.created_at,
        up.updated_at,
        a.id AS actor_id,
        a.first_name,
        a.last_name,
        a.stage_name,
        a.verification_status,
        a.registry_id
      FROM user_profiles up
      LEFT JOIN actors a ON a.auth0_user_id = up.auth0_user_id AND a.deleted_at IS NULL AND a.tenant_id = $1
      WHERE a.tenant_id = $1 OR a.id IS NULL
      ORDER BY up.created_at DESC;
    `,
  },

  // ===========================================
  // ACTORS (Identity Registry)
  // ===========================================

  actors: {
    create: `
      INSERT INTO actors (
        tenant_id, auth0_user_id, email, first_name, last_name, stage_name, bio, location
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *;
    `,

    getById: `
      SELECT * FROM actors WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL;
    `,

    getByAuth0Id: `
      SELECT * FROM actors WHERE auth0_user_id = $1 AND tenant_id = $2 AND deleted_at IS NULL;
    `,

    getByEmail: `
      SELECT * FROM actors WHERE email = $1 AND tenant_id = $2 AND deleted_at IS NULL;
    `,

    update: `
      UPDATE actors 
      SET first_name = COALESCE($2, first_name),
          last_name = COALESCE($3, last_name),
          stage_name = COALESCE($4, stage_name),
          bio = COALESCE($5, bio),
          location = COALESCE($6, location),
          profile_image_url = COALESCE($7, profile_image_url)
      WHERE id = $1 AND tenant_id = $8 AND deleted_at IS NULL
      RETURNING *;
    `,

    verify: `
      UPDATE actors 
      SET verification_status = 'verified',
          verified_at = NOW(),
          verified_by = $2
      WHERE id = $1 AND tenant_id = $3 AND deleted_at IS NULL
      RETURNING *;
    `,

    list: `
      SELECT id, auth0_user_id, email, first_name, last_name, stage_name, 
             verification_status, is_founding_member, registry_id, created_at
      FROM actors 
      WHERE tenant_id = $1 AND deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3;
    `,
  },

  // ===========================================
  // CONSENT LOG (Consent Ledger - CRITICAL)
  // ===========================================

  consent: {
    log: `
      INSERT INTO consent_log (
        tenant_id, actor_id, action, consent_type, consent_scope, 
        project_name, project_description, requester_id, requester_type,
        ip_address, user_agent, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *;
    `,

    getHistory: `
      SELECT * FROM consent_log 
      WHERE tenant_id = $1 AND actor_id = $2
      ORDER BY created_at DESC
      LIMIT $3 OFFSET $4;
    `,

    getLatest: `
      SELECT * FROM consent_log 
      WHERE tenant_id = $1 AND actor_id = $2 AND consent_type = $3
      ORDER BY created_at DESC
      LIMIT 1;
    `,

    getAllByActor: `
      SELECT 
        cl.*,
        a.first_name as actor_first_name,
        a.last_name as actor_last_name
      FROM consent_log cl
      JOIN actors a ON cl.actor_id = a.id AND a.tenant_id = $1
      WHERE cl.tenant_id = $1 AND cl.actor_id = $2
      ORDER BY cl.created_at DESC;
    `,
  },

  // ===========================================
  // LICENSING REQUESTS
  // ===========================================

  licensing: {
    create: `
      INSERT INTO licensing_requests (
        tenant_id,
        actor_id, requester_name, requester_email, requester_organization,
        project_name, project_description, usage_type, intended_use,
        duration_start, duration_end, compensation_offered, compensation_currency
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *;
    `,

    getById: `
      SELECT lr.*, a.first_name, a.last_name, a.email as actor_email
      FROM licensing_requests lr
      JOIN actors a ON lr.actor_id = a.id AND a.tenant_id = $2
      WHERE lr.id = $1 AND lr.tenant_id = $2;
    `,

    getByActor: `
      SELECT * FROM licensing_requests 
      WHERE tenant_id = $1 AND actor_id = $2
      ORDER BY created_at DESC
      LIMIT $3 OFFSET $4;
    `,

    approve: `
      UPDATE licensing_requests 
      SET status = 'approved', approved_at = NOW()
      WHERE id = $1 AND tenant_id = $2
      RETURNING *;
    `,

    reject: `
      UPDATE licensing_requests 
      SET status = 'rejected', rejected_at = NOW(), rejection_reason = $2
      WHERE id = $1 AND tenant_id = $3
      RETURNING *;
    `,

    listPending: `
      SELECT lr.*, a.first_name, a.last_name
      FROM licensing_requests lr
      JOIN actors a ON lr.actor_id = a.id AND a.tenant_id = $1
      WHERE lr.tenant_id = $1 AND lr.status = 'pending'
      ORDER BY lr.created_at DESC
      LIMIT $2 OFFSET $3;
    `,
  },

  // ===========================================
  // USAGE TRACKING
  // ===========================================

  usage: {
    log: `
      INSERT INTO usage_tracking (
        tenant_id, actor_id, licensing_request_id, usage_type, quantity, unit,
        project_name, generated_by, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *;
    `,

    getByActor: `
      SELECT * FROM usage_tracking 
      WHERE tenant_id = $1 AND actor_id = $2
      ORDER BY created_at DESC
      LIMIT $3 OFFSET $4;
    `,

    getStats: `
      SELECT 
        usage_type,
        unit,
        SUM(quantity) as total_quantity,
        COUNT(*) as total_records,
        MIN(created_at) as first_usage,
        MAX(created_at) as last_usage
      FROM usage_tracking
      WHERE tenant_id = $1 AND actor_id = $2
      GROUP BY usage_type, unit;
    `,

    getTotalMinutes: `
      SELECT 
        SUM(quantity) as total_minutes
      FROM usage_tracking
      WHERE tenant_id = $1 AND actor_id = $2 AND usage_type = 'voice_minutes' AND unit = 'minutes';
    `,
  },

  // ===========================================
  // AUDIT LOG
  // ===========================================

  audit: {
    log: `
      INSERT INTO audit_log (
        tenant_id, user_id, user_type, action, resource_type, resource_id,
        changes, ip_address, user_agent
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *;
    `,

    getByResource: `
      SELECT * FROM audit_log
      WHERE tenant_id = $1 AND resource_type = $2 AND resource_id = $3
      ORDER BY created_at DESC
      LIMIT $4 OFFSET $5;
    `,

    getByUser: `
      SELECT * FROM audit_log
      WHERE tenant_id = $1 AND user_id = $2
      ORDER BY created_at DESC
      LIMIT $3 OFFSET $4;
    `,

    search: `
      SELECT * FROM audit_log
      WHERE tenant_id = $1 AND (action = $2 OR resource_type = $3)
      ORDER BY created_at DESC
      LIMIT $4 OFFSET $5;
    `,
  },

  // ===========================================
  // ACTOR MEDIA (Headshots, Audio, Video Reels)
  // ===========================================

  actorMedia: {
    create: `
      INSERT INTO actor_media (
        actor_id, media_type, file_name, s3_key, s3_url, file_size_bytes, mime_type,
        title, photo_credit, description, is_primary, display_order
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *;
    `,

    getById: `
      SELECT * FROM actor_media 
      WHERE id = $1 AND deleted_at IS NULL;
    `,

    getByActor: `
      SELECT * FROM actor_media 
      WHERE actor_id = $1 AND deleted_at IS NULL
      ORDER BY display_order ASC, uploaded_at DESC;
    `,

    getByActorAndType: `
      SELECT * FROM actor_media 
      WHERE actor_id = $1 AND media_type = $2 AND deleted_at IS NULL
      ORDER BY display_order ASC, uploaded_at DESC;
    `,

    getPrimary: `
      SELECT * FROM actor_media 
      WHERE actor_id = $1 AND media_type = $2 AND is_primary = TRUE AND deleted_at IS NULL
      LIMIT 1;
    `,

    getHeadshots: `
      SELECT * FROM actor_media 
      WHERE actor_id = $1 AND media_type = 'headshot' AND deleted_at IS NULL
      ORDER BY display_order ASC, uploaded_at DESC;
    `,

    update: `
      UPDATE actor_media 
      SET title = COALESCE($2, title),
          photo_credit = COALESCE($3, photo_credit),
          description = COALESCE($4, description),
          is_primary = COALESCE($5, is_primary),
          display_order = COALESCE($6, display_order)
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING *;
    `,

    updateDisplayOrder: `
      UPDATE actor_media 
      SET display_order = $2
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING *;
    `,

    clearPrimary: `
      UPDATE actor_media 
      SET is_primary = FALSE
      WHERE actor_id = $1 AND media_type = $2 AND deleted_at IS NULL;
    `,

    setPrimary: `
      UPDATE actor_media 
      SET is_primary = TRUE, display_order = 0
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING *;
    `,

    softDelete: `
      UPDATE actor_media 
      SET deleted_at = NOW()
      WHERE id = $1
      RETURNING *;
    `,

    hardDelete: `
      DELETE FROM actor_media 
      WHERE id = $1
      RETURNING *;
    `,
  },

  // ===========================================
  // USER FEEDBACK
  // ===========================================

  feedback: {
    create: `
      INSERT INTO user_feedback (
        user_id, topic, feedback_text, sentiment
      ) VALUES ($1, $2, $3, $4)
      RETURNING *;
    `,

    getById: `
      SELECT * FROM user_feedback_with_details 
      WHERE id = $1;
    `,

    getAll: `
      SELECT * FROM user_feedback_with_details
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2;
    `,

    getByFilters: `
      SELECT * FROM user_feedback_with_details
      WHERE 
        ($1::varchar IS NULL OR topic = $1)
        AND ($2::varchar IS NULL OR sentiment = $2)
        AND ($3::boolean IS NULL OR is_read = $3)
      ORDER BY created_at DESC
      LIMIT $4 OFFSET $5;
    `,

    getByUser: `
      SELECT * FROM user_feedback
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3;
    `,

    markAsRead: `
      UPDATE user_feedback
      SET is_read = TRUE
      WHERE id = $1
      RETURNING *;
    `,

    updateAdminNotes: `
      UPDATE user_feedback
      SET admin_notes = $2
      WHERE id = $1
      RETURNING *;
    `,

    getStats: `
      SELECT 
        COUNT(*) as total_feedback,
        COUNT(*) FILTER (WHERE is_read = FALSE) as unread_count,
        COUNT(DISTINCT user_id) as unique_users,
        COUNT(*) FILTER (WHERE sentiment = 'angry') as angry_count,
        COUNT(*) FILTER (WHERE sentiment = 'sad') as sad_count,
        COUNT(*) FILTER (WHERE sentiment = 'neutral') as neutral_count,
        COUNT(*) FILTER (WHERE sentiment = 'happy') as happy_count,
        COUNT(*) FILTER (WHERE sentiment = 'love') as love_count
      FROM user_feedback;
    `,

    getTopicBreakdown: `
      SELECT 
        topic,
        COUNT(*) as count,
        COUNT(*) FILTER (WHERE is_read = FALSE) as unread_count
      FROM user_feedback
      GROUP BY topic
      ORDER BY count DESC;
    `,
  },
};

export default queries;
