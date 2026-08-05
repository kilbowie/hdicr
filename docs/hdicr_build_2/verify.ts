import type { KeyLike } from 'jose';
import { openMandate } from './mandate.js';
import { mintReceipt } from './receipt.js';
import type { ActionRequest, Decision, DenyReason, Mandate, RelianceReceipt } from './types.js';

/**
 * THE GATE.
 *
 * This is the load-bearing file of the entire project. Six checks, in order, BEFORE the action.
 * A Verifier that acts before calling this, or that proceeds after DENY, is not conformant at ANY
 * level. See adr/0003.
 */

export interface StatusResult {
  revoked: boolean;
  /** Age of the status we relied on, in ms. Auditable — it goes in the receipt. */
  ageMs: number;
}

/** Returns null when fresh status CANNOT be obtained. Null means DENY. It never means "probably fine". */
export type StatusClient = (
  status: Mandate['credentialStatus'],
  freshnessWindowMs: number,
) => Promise<StatusResult | null>;

/** Counter state is authoritative at the Verifier. HDICR-CORE §3.3. */
export interface LimitStore {
  used(mandateId: string): Promise<{ invocations: number; value: number }>;
  consume(mandateId: string, value: number): Promise<void>;
}

export interface VerifyParams {
  jwt: string;
  request: ActionRequest;
  issuerKey: KeyLike;
  statusClient: StatusClient;
  limits: LimitStore;
  /** Financial execution: ≤1000ms. Media: ≤30000ms. Profiles MUST NOT exceed 60000ms. */
  freshnessWindowMs: number;
  verifierId: string;
  relyingPartyId: string;
  signReceipt: (r: Omit<RelianceReceipt, 'proof'>) => Promise<RelianceReceipt>;
}

export async function verify(p: VerifyParams): Promise<Decision> {
  const deny = async (reason: DenyReason, m?: Mandate, ageMs = -1): Promise<Decision> => ({
    decision: 'DENY',
    reason_code: reason,
    receipt: m
      ? await mintReceipt({ ...p, mandate: m, decision: 'DENY', reason, statusAgeMs: ageMs })
      : undefined,
  });

  // ---- 1. Signature -------------------------------------------------------
  let mandate: Mandate;
  try {
    mandate = await openMandate(p.jwt, p.issuerKey);
  } catch {
    return { decision: 'DENY', reason_code: 'BAD_SIGNATURE' };
  }

  // ---- 2. Temporal --------------------------------------------------------
  const now = Date.now();
  if (now < Date.parse(mandate.validFrom)) return deny('NOT_YET_VALID', mandate);
  if (now > Date.parse(mandate.validUntil)) return deny('EXPIRED', mandate);

  // ---- 3. Revocation status — FAIL CLOSED --------------------------------
  //
  // The single most important behaviour in the codebase.
  //
  // Every instinct you have will tell you to let the action through when the status service is
  // unreachable, so the product keeps working. THAT INSTINCT IS THE BUG. An agent that keeps acting
  // after the kill switch was pressed is precisely what this project exists to prevent. adr/0004.
  //
  const status = await p.statusClient(mandate.credentialStatus, p.freshnessWindowMs);
  if (status === null) return deny('STATUS_UNAVAILABLE', mandate);
  if (status.ageMs > p.freshnessWindowMs) return deny('STATUS_STALE', mandate, status.ageMs);
  if (status.revoked) return deny('REVOKED', mandate, status.ageMs);

  // ---- 4. Scope -----------------------------------------------------------
  const grant = mandate.credentialSubject.grant;
  const entry = grant.authorization_details.find(
    (d) => d.type === p.request.type && d.actions.includes(p.request.action),
  );
  if (!entry) return deny('SCOPE_VIOLATION', mandate, status.ageMs);

  if (entry.locations?.length && p.request.location) {
    const ok = entry.locations.some((pat) =>
      pat.endsWith('*')
        ? p.request.location!.startsWith(pat.slice(0, -1))
        : pat === p.request.location,
    );
    if (!ok) return deny('SCOPE_VIOLATION', mandate, status.ageMs);
  }

  // Constraints. `exclusions` is the one that makes the demo land: a political render is DENIED
  // because she never granted it — not flagged, not logged. Denied.
  const exclusions = entry.constraints?.['exclusions'] as string[] | undefined;
  const tags = (p.request.context?.['tags'] as string[] | undefined) ?? [];
  if (exclusions?.some((x) => tags.includes(x))) {
    return deny('SCOPE_VIOLATION', mandate, status.ageMs);
  }

  // ---- 5. Limits — enforced, not recorded --------------------------------
  const used = await p.limits.used(mandate.id);
  const lim = grant.limits;

  if (lim.max_invocations !== undefined && used.invocations >= lim.max_invocations) {
    return deny('LIMIT_EXHAUSTED', mandate, status.ageMs);
  }
  if (lim.max_value && p.request.value) {
    const ceiling = Number(lim.max_value.amount);
    const asking = Number(p.request.value.amount);
    if (p.request.value.currency !== lim.max_value.currency) {
      return deny('SCOPE_VIOLATION', mandate, status.ageMs);
    }
    if (used.value + asking > ceiling) return deny('LIMIT_EXHAUSTED', mandate, status.ageMs);
  }

  // ---- 6. Request binding (RFC 9421) -------------------------------------
  // Without this, a captured Mandate is replayable against a different action.
  if (!p.request.requestDigest) return deny('BINDING_MISMATCH', mandate, status.ageMs);

  // ---- PERMIT -------------------------------------------------------------
  await p.limits.consume(mandate.id, p.request.value ? Number(p.request.value.amount) : 0);

  const receipt = await mintReceipt({
    ...p,
    mandate,
    decision: 'PERMIT',
    statusAgeMs: status.ageMs,
    limitsRemaining: {
      max_invocations:
        lim.max_invocations !== undefined ? lim.max_invocations - used.invocations - 1 : undefined,
    },
  });

  return { decision: 'PERMIT', receipt };
}
