import { describe, it, expect, beforeEach } from 'vitest';
import { generateKeyPair } from 'jose';
import { issue, verify, type StatusClient, type LimitStore } from '../src/index.js';
import { StatusList, RevocationService } from '@hdicr/status';

/**
 * THE CONFORMANCE TEST — spec/REVOCATION.md §7.
 *
 *   "A Principal revokes. Within max_propagation_ms, every Verifier returns DENY, in-flight
 *    uncommitted work halts, and the Principal retrieves signed proof of what stopped."
 *
 * It passes or it does not. There is no partial credit.
 */

const INDEX = 94_567;

describe('the kill switch', () => {
  let keys: Awaited<ReturnType<typeof generateKeyPair>>;
  let list: StatusList;
  let revocation: RevocationService;
  let statusClient: StatusClient;
  let limits: LimitStore;

  const mkMandate = () =>
    issue({
      issuer: 'did:web:issuer.hdicr.test',
      principal: { id: 'did:key:zPerformer', assuranceLevel: 'high' },
      agent: { id: 'did:web:render.ti.test', operator: 'did:web:ti.test' },
      authorization_details: [{
        type: 'hdicr:media:likeness',
        actions: ['render', 'distribute'],
        datatypes: ['face', 'voice'],
        constraints: { exclusions: ['political', 'adult'] },
      }],
      limits: { max_invocations: 500, period: 'P1M' },
      validForDays: 90,
      statusListCredential: 'https://status.hdicr.test/2026-07',
      statusListIndex: INDEX,
      revocationEndpoint: 'https://revoke.hdicr.test/x',
      accountableParty: 'did:web:implco.test',
      privateKey: keys.privateKey,
    });

  const gate = (jwt: string, action: string, tags: string[] = []) =>
    verify({
      jwt,
      request: {
        type: 'hdicr:media:likeness',
        action,
        context: { tags },
        requestDigest: 'sha256:deadbeef',
      },
      issuerKey: keys.publicKey,
      statusClient,
      limits,
      freshnessWindowMs: 30_000,
      verifierId: 'did:web:gate.test',
      relyingPartyId: 'did:web:ti.test',
      signReceipt: async (r) => ({ ...r, proof: { sig: 'test' } }),
    });

  beforeEach(async () => {
    keys = await generateKeyPair('EdDSA', { crv: 'Ed25519' });
    list = new StatusList();
    revocation = new RevocationService(list, () => INDEX);

    let used = 0;
    limits = {
      used: async () => ({ invocations: used, value: 0 }),
      consume: async () => { used += 1; },
    };

    // Fresh status by default.
    statusClient = async () => ({ revoked: list.get(INDEX), ageMs: 40 });
  });

  it('PERMITs an in-scope action', async () => {
    const { jwt } = await mkMandate();
    const d = await gate(jwt, 'render');
    expect(d.decision).toBe('PERMIT');
    expect(d.receipt?.principal_retrievable).toBe(true);   // L3 — the Principal gets proof too
  });

  it('DENIEs an out-of-scope action — the render never starts', async () => {
    const { jwt } = await mkMandate();
    const d = await gate(jwt, 'render', ['political']);    // she never granted political
    expect(d.decision).toBe('DENY');
    expect(d.reason_code).toBe('SCOPE_VIOLATION');
  });

  it('DENIEs within max_propagation_ms of revocation', async () => {
    const { jwt, mandate } = await mkMandate();

    expect((await gate(jwt, 'render')).decision).toBe('PERMIT');

    const result = await revocation.revoke(mandate.id);

    // The whole company, in three assertions:
    expect(result.propagationMs).toBeLessThanOrEqual(
      mandate.credentialSubject.revocation.max_propagation_ms,
    );
    const after = await gate(jwt, 'render');
    expect(after.decision).toBe('DENY');
    expect(after.reason_code).toBe('REVOKED');
  });

  it('FAILS CLOSED when status is unreachable', async () => {
    // adr/0004. The instinct to fail open is the bug. If this test ever goes green on a PERMIT,
    // the project has become the thing it exists to prevent.
    const { jwt } = await mkMandate();
    statusClient = async () => null;                        // status service is down

    const d = await gate(jwt, 'render');
    expect(d.decision).toBe('DENY');
    expect(d.reason_code).toBe('STATUS_UNAVAILABLE');
  });

  it('DENIEs on stale status', async () => {
    const { jwt } = await mkMandate();
    statusClient = async () => ({ revoked: false, ageMs: 45_000 });   // older than the window

    const d = await gate(jwt, 'render');
    expect(d.decision).toBe('DENY');
    expect(d.reason_code).toBe('STATUS_STALE');
  });

  it('DENIEs when the limit is exhausted', async () => {
    const { jwt } = await mkMandate();
    let used = 500;
    limits = { used: async () => ({ invocations: used, value: 0 }), consume: async () => { used++; } };

    const d = await gate(jwt, 'render');
    expect(d.decision).toBe('DENY');
    expect(d.reason_code).toBe('LIMIT_EXHAUSTED');          // limits are ENFORCED, not recorded
  });
});
