/**
 * Shared TypeScript Types for Truly Imagined v3
 *
 * Core Principles: Identity, Consent, Control, Auditability
 */
export interface PerformerIdentity {
    id: string;
    auth0UserId: string;
    email: string;
    fullName: string;
    stageName?: string;
    industryRole: IndustryRole;
    region: Region;
    createdAt: Date;
    updatedAt: Date;
}
export type IndustryRole = 'actor' | 'voice-actor' | 'performer' | 'stunt-performer' | 'agent';
export type Region = 'UK' | 'US' | 'EU' | 'CA' | 'AU' | 'OTHER';
export interface ConsentBoundaries {
    id: string;
    performerId: string;
    version: number;
    voiceModelTraining: ConsentLevel;
    likenessModelTraining: ConsentLevel;
    performanceReplication: ConsentLevel;
    biometricDataUsage: ConsentLevel;
    derivativeWorks: ConsentLevel;
    commercialUsage: ConsentLevel;
    thirdPartySharing: ConsentLevel;
    additionalNotes?: string;
    consentedAt: Date;
    ipAddress?: string;
    userAgent?: string;
}
export type ConsentLevel = 'allowed' | 'restricted' | 'case-by-case' | 'prohibited';
export interface LicensingPreferences {
    id: string;
    performerId: string;
    version: number;
    requireFinalApproval: boolean;
    requireSceneBySceneApproval: boolean;
    requireScriptApproval: boolean;
    requireDirectorApproval: boolean;
    excludeAdultContent: boolean;
    excludePoliticalContent: boolean;
    excludeReligiousContent: boolean;
    excludeViolence: boolean;
    additionalRestrictions?: string;
    preferredLicenseType?: string;
    minimumFeeExpectation?: number;
    currency: string;
    negotiable: boolean;
    createdAt: Date;
    updatedAt: Date;
}
export interface ApiResponse<T = any> {
    success: boolean;
    data?: T;
    error?: string;
    timestamp: string;
}
export interface PaginatedResponse<T> extends ApiResponse<T> {
    pagination: {
        page: number;
        pageSize: number;
        total: number;
        totalPages: number;
    };
}
export interface AuthUser {
    sub: string;
    email: string;
    emailVerified: boolean;
    name?: string;
    picture?: string;
    roles?: string[];
}
export interface AuditLog {
    id: string;
    performerId: string;
    action: AuditAction;
    entityType: EntityType;
    entityId: string;
    changes?: Record<string, any>;
    ipAddress?: string;
    userAgent?: string;
    timestamp: Date;
}
export type AuditAction = 'create' | 'update' | 'delete' | 'read';
export type EntityType = 'identity' | 'consent' | 'licensing' | 'media';
//# sourceMappingURL=index.d.ts.map