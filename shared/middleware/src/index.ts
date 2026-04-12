/**
 * Shared Middleware for Truly Imagined v3
 *
 * Auth0 JWT validation and role extraction
 */

import { APIGatewayProxyEvent } from 'aws-lambda';
import jwt, { JwtHeader, SigningKeyCallback } from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import type { AuthUser } from '@trulyimagined/types';

// ==================== TYPE INTERFACES ====================

/**
 * Decoded Auth0 JWT claims — includes standard OIDC fields plus Auth0 extensions.
 * Using a typed interface eliminates bare `any` casts in claim extraction.
 */
interface JwtClaims {
  sub: string;
  iss?: string;
  aud?: string | string[];
  exp?: number;
  iat?: number;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  scope?: string;
  permissions?: string[];
  client_id?: string;
  azp?: string;
  tenant_id?: string;
  org_id?: string;
  organization_id?: string;
  [key: string]: unknown; // allow custom namespace claims without losing type safety on known fields
}

/**
 * Auth0 M2M token response from the /oauth/token endpoint.
 */
export interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  scope?: string;
}

// ==================== JWKS CLIENT ====================

const client = jwksClient({
  jwksUri: `https://${process.env.AUTH0_DOMAIN}/.well-known/jwks.json`,
  cache: true,
  cacheMaxAge: 600000, // 10 minutes
  rateLimit: true,
  jwksRequestsPerMinute: 10,
});

function getKey(header: JwtHeader, callback: SigningKeyCallback) {
  client.getSigningKey(header.kid ?? '', (err, key) => {
    if (err) {
      callback(err);
      return;
    }
    const signingKey = key?.getPublicKey();
    callback(null, signingKey);
  });
}

function getStringClaim(decoded: Record<string, unknown>, key?: string): string | undefined {
  if (!key) {
    return undefined;
  }

  const value = decoded[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function getSubjectClientId(sub: unknown): string | undefined {
  return typeof sub === 'string' && sub.endsWith('@clients') ? sub.slice(0, -8) : undefined;
}

// ==================== AUTH0 JWT VALIDATION ====================

export type AuthValidationResult = {
  user: AuthUser | null;
  errorStatus?: 401 | 403;
};

export async function validateAuth0TokenWithStatus(
  event: APIGatewayProxyEvent
): Promise<AuthValidationResult> {
  const authHeader = event.headers.Authorization || event.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.error('[AUTH] Missing or invalid authorization header');
    return { user: null, errorStatus: 401 };
  }

  const token = authHeader.substring(7);

  try {
    // Verify JWT with Auth0's public key
    const decoded = await new Promise<JwtClaims>((resolve, reject) => {
      jwt.verify(
        token,
        getKey,
        {
          audience: process.env.AUTH0_AUDIENCE,
          issuer: `https://${process.env.AUTH0_DOMAIN}/`,
          algorithms: ['RS256'],
        },
        (err, payload) => {
          if (err || !payload) {
            reject(err ?? new Error('Empty JWT payload'));
          } else {
            resolve(payload as JwtClaims);
          }
        }
      );
    });

    if (!decoded.sub) {
      console.error('[AUTH] Invalid token structure: missing sub');
      return { user: null, errorStatus: 403 };
    }

    // Extract OAuth scopes: M2M tokens use the 'scope' string claim;
    // user RBAC tokens from Auth0 may use a 'permissions' array instead.
    const scopes: string[] = Array.isArray(decoded.permissions)
      ? (decoded.permissions as string[])
      : typeof decoded.scope === 'string' && decoded.scope.length > 0
        ? decoded.scope.split(' ')
        : [];

    const rolesClaimNamespace = process.env.AUTH0_ROLES_CLAIM_NAMESPACE?.trim() ?? '';
    const clientId = decoded.client_id || decoded.azp || getSubjectClientId(decoded.sub);
    const tenantClaimNamespace = process.env.AUTH0_TENANT_ID_CLAIM_NAMESPACE?.trim();
    const defaultTenantId = process.env.HDICR_DEFAULT_TENANT_ID?.trim() || 'trulyimagined';
    const tenantId =
      getStringClaim(decoded, tenantClaimNamespace) ||
      decoded.tenant_id ||
      decoded.org_id ||
      decoded.organization_id ||
      defaultTenantId;

    const user: AuthUser = {
      sub: decoded.sub,
      email: decoded.email,
      emailVerified: decoded.email_verified ?? false,
      name: decoded.name,
      picture: decoded.picture,
      roles: (rolesClaimNamespace ? (decoded[rolesClaimNamespace] as string[]) : undefined) ?? [],
      clientId,
      tenantId,
      scopes,
    };

    const identity = user.email ? user.email : `M2M:${user.sub}`;
    console.log(
      `[AUTH] Authenticated: ${identity} (tenant: ${tenantId}, scopes: ${scopes.join(', ') || 'none'})`
    );
    return { user };
  } catch (error) {
    console.error('[AUTH] Token validation failed:', error);
    return { user: null, errorStatus: 403 };
  }
}

export async function validateAuth0Token(event: APIGatewayProxyEvent): Promise<AuthUser | null> {
  const result = await validateAuth0TokenWithStatus(event);
  return result.user;
}

// ==================== AUTHORIZATION HELPERS ====================

/**
 * Require authentication - throws if user is null
 */
export function requireAuth(user: AuthUser | null): AuthUser {
  if (!user) {
    throw new Error('Unauthorized');
  }
  return user;
}

/**
 * Require specific role(s) - throws if user doesn't have any of the allowed roles
 */
export function requireRole(user: AuthUser, allowedRoles: string[]) {
  const userRoles = user.roles || [];
  const hasRole = userRoles.some((role) => allowedRoles.includes(role));

  if (!hasRole) {
    throw new Error('Forbidden: Insufficient permissions');
  }
}

/**
 * Check if user has a specific role
 */
export function hasRole(user: AuthUser | null, role: string): boolean {
  if (!user) return false;
  return (user.roles || []).includes(role);
}

/**
 * Check if the authenticated principal has the required OAuth scope.
 * Works for both user RBAC tokens (permissions array) and M2M client-credentials
 * tokens (scope string). Returns false for unauthenticated callers.
 */
export function hasScope(user: AuthUser | null, scope: string): boolean {
  if (!user) return false;
  return (user.scopes ?? []).includes(scope);
}

// Internal helpers — role predicates are intentionally NOT exported from shared/middleware
// to avoid coupling this package to TI-specific role naming.
// Define equivalent helpers (isActor, isAgent, isEnterprise, …) in each consuming application.
function isAgent(user: AuthUser | null): boolean {
  return hasRole(user, 'Agent');
}

function isAdmin(user: AuthUser | null): boolean {
  return hasRole(user, 'Admin');
}

/**
 * Check if user can access actor's resources
 * - User must be the actor themselves, their agent, or an admin
 */
export function canAccessActorResources(user: AuthUser, actorAuth0Id: string): boolean {
  // User is the actor themselves
  if (user.sub === actorAuth0Id) {
    return true;
  }

  // User is an agent or admin (can access any actor)
  if (isAgent(user) || isAdmin(user)) {
    return true;
  }

  return false;
}

/**
 * Require access to actor's resources - throws if not allowed
 */
export function requireActorAccess(user: AuthUser, actorAuth0Id: string) {
  if (!canAccessActorResources(user, actorAuth0Id)) {
    throw new Error("Forbidden: Cannot access this actor's resources");
  }
}

// ==================== REQUEST UTILITIES ====================

export function extractRequestIP(event: APIGatewayProxyEvent): string {
  return (
    event.requestContext?.identity?.sourceIp ||
    event.headers['X-Forwarded-For'] ||
    event.headers['x-forwarded-for'] ||
    'unknown'
  );
}

export function extractUserAgent(event: APIGatewayProxyEvent): string {
  return event.headers['User-Agent'] || event.headers['user-agent'] || 'unknown';
}

export function getOrCreateCorrelationId(event: APIGatewayProxyEvent): string {
  const existing =
    event.headers['X-Correlation-ID'] ||
    event.headers['x-correlation-id'] ||
    event.headers['X-Request-ID'] ||
    event.headers['x-request-id'];

  if (typeof existing === 'string' && existing.trim().length > 0) {
    return existing.trim();
  }

  const uuidFactory = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID;
  if (typeof uuidFactory === 'function') {
    return uuidFactory();
  }

  return `corr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function withCorrelationHeaders(
  headers: Record<string, string>,
  correlationId: string
): Record<string, string> {
  return {
    ...headers,
    'X-Correlation-ID': correlationId,
  };
}

// ==================== CONSENT ENFORCEMENT ====================

/**
 * Require consent for actor identity usage
 *
 * Checks if active consent exists for the specified actor and consent type.
 * Throws an error if consent is not granted or has been revoked/expired.
 *
 * @param actorId - The actor's database ID
 * @param consentType - Type of consent required (e.g., 'voice_synthesis', 'image_usage')
 * @param projectId - Optional project ID to scope the consent check
 *
 * @example
 * await requireConsent('actor-123', 'voice_synthesis', 'project-456');
 */
export async function requireConsent(
  actorId: string,
  consentType: string,
  projectId?: string
): Promise<void> {
  try {
    // Build query string
    const queryParams = new URLSearchParams({
      actorId,
      consentType,
      ...(projectId && { projectId }),
    });

    // Call consent check API
    const consentServiceUrl = process.env.CONSENT_SERVICE_URL || 'http://localhost:3001';
    const url = `${consentServiceUrl}/consent/check?${queryParams.toString()}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const data = (await response.json()) as {
      error?: string;
      isGranted: boolean;
      latestAction?: { reason?: string };
    };

    if (!response.ok) {
      throw new Error(`Consent check failed: ${data.error || 'Unknown error'}`);
    }

    // Check if consent is granted
    if (!data.isGranted) {
      const reason = data.latestAction?.reason || 'Consent not granted';
      throw new Error(`Consent required: ${reason}`);
    }

    console.log(`[CONSENT] Active consent verified for actor ${actorId}, type: ${consentType}`);
  } catch (error: any) {
    console.error('[CONSENT] Enforcement failed:', error);
    throw new Error(`Consent validation failed: ${error.message}`);
  }
}

/**
 * Check if consent exists (without throwing)
 *
 * @param actorId - The actor's database ID
 * @param consentType - Type of consent to check
 * @param projectId - Optional project ID
 * @returns boolean indicating if consent is granted
 */
export async function hasConsent(
  actorId: string,
  consentType: string,
  projectId?: string
): Promise<boolean> {
  try {
    await requireConsent(actorId, consentType, projectId);
    return true;
  } catch {
    return false;
  }
}
