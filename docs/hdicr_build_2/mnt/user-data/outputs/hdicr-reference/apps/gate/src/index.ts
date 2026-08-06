import Fastify from 'fastify';
import { importJWK, type KeyLike } from 'jose';
import { verify, type StatusClient, type LimitStore, type RelianceReceipt } from '@hdicr/core';
import { StatusList } from '@hdicr/status';

/**
 * GATE — the in-path Verifier.
 *
 * Holds a status view refreshed by TWO paths:
 *   push (SSE)  — primary. Sub-second.
 *   pull (poll) — fallback. Belt and braces.
 *
 * And enforces the invariant that everything else depends on:
 *   if the view is stale or absent, DENY.
 */

const PORT = Number(process.env['GATE_PORT'] ?? 3002);
const ISSUER_URL = process.env['ISSUER_URL'] ?? 'http://localhost:3001';
const RENDER_URL = process.env['RENDER_URL'] ?? 'http://localhost:3003';
const FRESHNESS_MS = Number(process.env['FRESHNESS_WINDOW_MS'] ?? 30_000);
const PULL_MS = Number(process.env['STATUS_PULL_INTERVAL_MS'] ?? 5_000);

const GATE_ID = 'did:web:gate.hdicr.local';
const RP_ID = 'did:web:ti.local';

// ---- status view --------------------------------------------------------
// `updatedAt = 0` means we have never had a usable view. That is NOT "no revocations".
// It is "we do not know", and "we do not know" means DENY.
let view: { list: StatusList; updatedAt: number } = { list: new StatusList(), updatedAt: 0 };
const revoked = new Set<string>();       // mandateIds we have been pushed

async function pull(): Promise<void> {
  try {
    const res = await fetch(`${ISSUER_URL}/status`, { signal: AbortSignal.timeout(2_000) });
    if (!res.ok) return;                 // leave updatedAt alone — it will go stale, and we will DENY
    await res.json();
    view = { list: view.list, updatedAt: Date.now() };
  } catch {
    /* leave the view to age out. Do NOT reset updatedAt to now. */
  }
}

function subscribe(): void {
  (async () => {
    for (;;) {
      try {
        const res = await fetch(`${ISSUER_URL}/events`);
        const reader = res.body!.getReader();
        const dec = new TextDecoder();
        let buf = '';
        view.updatedAt = Date.now();     // connected — the view is live

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });

          const frames = buf.split('\n\n');
          buf = frames.pop() ?? '';
          for (const frame of frames) {
            if (!frame.includes('event: revoked')) { view.updatedAt = Date.now(); continue; }
            const line = frame.split('\n').find((l) => l.startsWith('data: '));
            if (!line) continue;
            const { mandateId } = JSON.parse(line.slice(6)) as { mandateId: string };
            revoked.add(mandateId);      // ← the kill switch lands, here, now
            view.updatedAt = Date.now();
          }
        }
      } catch { /* reconnect */ }
      await new Promise((r) => setTimeout(r, 500));
    }
  })();
}

// ---- the status client the gate hands to verify() ------------------------
const makeStatusClient = (mandateId: string): StatusClient => async (_status, windowMs) => {
  const age = Date.now() - view.updatedAt;
  if (view.updatedAt === 0) return null;          // never connected  → DENY
  if (age > windowMs) return null;                // stale            → DENY
  return { revoked: revoked.has(mandateId), ageMs: age };
};

// ---- limits (in-memory; a real deployment uses Redis) --------------------
const used = new Map<string, { invocations: number; value: number }>();
const limits: LimitStore = {
  async used(id) { return used.get(id) ?? { invocations: 0, value: 0 }; },
  async consume(id, value) {
    const u = used.get(id) ?? { invocations: 0, value: 0 };
    used.set(id, { invocations: u.invocations + 1, value: u.value + value });
  },
};

const receipts: RelianceReceipt[] = [];
let issuerKey: KeyLike;

const app = Fastify({ logger: false });

app.post('/verify', async (req) => {
  const { jwt, request } = req.body as { jwt: string; request: any };
  const mandateId = JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString()).vc.id;

  const decision = await verify({
    jwt,
    request,
    issuerKey,
    statusClient: makeStatusClient(mandateId),
    limits,
    freshnessWindowMs: FRESHNESS_MS,
    verifierId: GATE_ID,
    relyingPartyId: RP_ID,
    signReceipt: async (r) => ({ ...r, proof: { type: 'DataIntegrityProof', sig: 'demo' } }),
  });

  if (decision.receipt) receipts.push(decision.receipt);

  // Tell the Issuer we relied on this Mandate — so it knows to POISON us if she revokes.
  if (decision.decision === 'PERMIT') {
    void fetch(`${ISSUER_URL}/reliance`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mandateId, rpId: RP_ID, webhook: `${RENDER_URL}/hdicr/revoked` }),
    }).catch(() => {});
  }

  const tag = decision.decision === 'PERMIT' ? 'PERMIT' : `DENY  ${decision.reason_code}`;
  console.log(`  gate    ${tag}`);
  return decision;
});

/** L3 — the Principal can retrieve her own receipts. Not just the firm. */
app.get('/receipts', async (req) => {
  const { mandate } = req.query as { mandate?: string };
  return receipts.filter((r) => !mandate || r.mandate_id === mandate);
});

// boot
const jwk = await (await fetch(`${ISSUER_URL}/pubkey`)).json();
issuerKey = (await importJWK(jwk as any, 'EdDSA')) as KeyLike;
subscribe();
setInterval(pull, PULL_MS);
await pull();

await app.listen({ port: PORT, host: '0.0.0.0' });
console.log(`  gate       :${PORT}   freshness=${FRESHNESS_MS}ms`);
