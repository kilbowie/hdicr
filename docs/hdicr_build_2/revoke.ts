import { StatusList } from './list.js';

/**
 * REVOCATION PROPAGATION — the moat.
 *
 * Three tiers, all REQUIRED at L2:
 *   pull   — flip the bit. Everyone does this. It is the floor, not the product.
 *   push   — SSE to every subscribed Gate. This is what makes sub-second real.
 *   poison — webhook every RP that holds a Reliance Receipt inside the validity window.
 *            NOBODY ELSE DOES THIS, and it is what GDPR Art 7(3) actually requires once an agent
 *            has already acted on the grant.
 *
 * revoke() measures itself. `propagationMs` is your demo, your YC update, and your pitch. Print it.
 */

export interface Subscriber { send(event: string, data: unknown): void; }        // an SSE-connected Gate
export interface PoisonTarget { id: string; webhook: string; }                    // an RP holding a receipt

export interface RevocationResult {
  mandateId: string;
  propagationMs: number;
  gatesNotified: number;
  rpsPoisoned: number;
  halted: string[];          // what the RPs reported stopping
}

export class RevocationService {
  private readonly gates = new Set<Subscriber>();
  private readonly receipts = new Map<string, PoisonTarget[]>();   // mandateId → RPs that relied on it

  constructor(
    private readonly list: StatusList,
    private readonly indexOf: (mandateId: string) => number,
  ) {}

  subscribe(gate: Subscriber): () => void {
    this.gates.add(gate);
    return () => this.gates.delete(gate);
  }

  /** Called by the Gate on every PERMIT, so we know who to poison later. */
  recordReliance(mandateId: string, rp: PoisonTarget): void {
    const list = this.receipts.get(mandateId) ?? [];
    if (!list.some((r) => r.id === rp.id)) list.push(rp);
    this.receipts.set(mandateId, list);
  }

  async revoke(mandateId: string): Promise<RevocationResult> {
    const t0 = performance.now();

    // --- tier 1: PULL. Flip the bit. Terminal and idempotent — there is no un-revoke.
    this.list.set(this.indexOf(mandateId), true);

    // --- tier 2: PUSH. Every subscribed Gate, now.
    for (const g of this.gates) g.send('revoked', { mandateId, at: Date.now() });

    // --- tier 3: POISON. Every RP that already relied on this Mandate.
    const targets = this.receipts.get(mandateId) ?? [];
    const halted: string[] = [];

    await Promise.allSettled(
      targets.map(async (rp) => {
        const res = await fetch(rp.webhook, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'hdicr.revoked', mandateId }),
          signal: AbortSignal.timeout(2_000),
        });
        // The RP tells us what it managed to stop. We do NOT claim to reverse committed actions —
        // we claim to stop uncommitted ones and to prove exactly which was which. REVOCATION.md §5.
        const body = (await res.json().catch(() => ({}))) as { halted?: string[] };
        if (body.halted) halted.push(...body.halted);
      }),
    );

    const propagationMs = Math.round(performance.now() - t0);

    // eslint-disable-next-line no-console
    console.log(`\n  ⏱  REVOKED ${mandateId}\n     propagation: ${propagationMs}ms` +
                `  ·  gates: ${this.gates.size}  ·  RPs poisoned: ${targets.length}` +
                `  ·  halted: ${halted.length}\n`);

    return {
      mandateId,
      propagationMs,
      gatesNotified: this.gates.size,
      rpsPoisoned: targets.length,
      halted,
    };
  }
}
