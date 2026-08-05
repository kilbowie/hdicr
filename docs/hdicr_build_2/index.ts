import Fastify from 'fastify';
import { generateKeyPair, exportJWK, SignJWT, type KeyLike } from 'jose';
import { issue } from '@hdicr/core';
import { StatusList, RevocationService, type Subscriber } from '@hdicr/status';

/**
 * ISSUER — mints Mandates, owns the status list, runs revocation propagation.
 *
 * The three tiers live here:
 *   pull   GET  /status            the status list, as a signed JWT
 *   push   GET  /events            SSE. Gates subscribe. This is what makes sub-second real.
 *   poison POST /reliance          Gates tell us who relied, so we know who to notify on revoke.
 */

const PORT = Number(process.env['ISSUER_PORT'] ?? 3001);
const ISSUER = 'did:web:issuer.hdicr.local';

const keys = await generateKeyPair('EdDSA', { crv: 'Ed25519' });
const list = new StatusList();

// mandateId → status list index
const indexOf = new Map<string, number>();
let nextIndex = 1;

const revocation = new RevocationService(list, (id) => indexOf.get(id) ?? -1);

const app = Fastify({ logger: false });

/** Public key, so the Gate can verify our signatures. */
app.get('/pubkey', async () => exportJWK(keys.publicKey));

/** ISSUE */
app.post('/mandates', async (req) => {
  const b = req.body as {
    authorization_details: any[];
    limits: any;
    validForDays?: number;
    maxPropagationMs?: number;
  };

  const idx = nextIndex++;
  const { mandate, jwt } = await issue({
    issuer: ISSUER,
    principal: { id: 'did:key:zPerformer', assuranceLevel: 'high', verificationMethod: 'uk-dvs-diatf' },
    agent: { id: 'did:web:render.ti.local', operator: 'did:web:ti.local' },
    authorization_details: b.authorization_details,
    limits: b.limits,
    validForDays: b.validForDays ?? 90,
    statusListCredential: `http://localhost:${PORT}/status`,
    statusListIndex: idx,
    revocationEndpoint: `http://localhost:${PORT}/mandates/revoke`,
    maxPropagationMs: b.maxPropagationMs ?? 500,
    accountableParty: 'did:web:implco.local',
    privateKey: keys.privateKey,
  });

  indexOf.set(mandate.id, idx);
  return { mandate, jwt };
});

/** PULL — the status list. `iat` is what the Gate uses to compute freshness. */
app.get('/status', async (_req, reply) => {
  const jwt = await list.toJWT(ISSUER, `http://localhost:${PORT}/status`, keys.privateKey);
  reply.header('cache-control', 'no-store');
  return { status_list_jwt: jwt, issued_at: Date.now() };
});

/** PUSH — SSE. Every connected Gate is notified the instant a Mandate is revoked. */
app.get('/events', (req, reply) => {
  reply.raw.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  reply.raw.write(': connected\n\n');

  const sub: Subscriber = {
    send(event, data) {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
  };
  const unsubscribe = revocation.subscribe(sub);

  const keepalive = setInterval(() => reply.raw.write(': ping\n\n'), 15_000);
  req.raw.on('close', () => {
    clearInterval(keepalive);
    unsubscribe();
  });
});

/** POISON registry — the Gate tells us who relied on what, so we can notify them on revoke. */
app.post('/reliance', async (req) => {
  const { mandateId, rpId, webhook } = req.body as {
    mandateId: string; rpId: string; webhook: string;
  };
  revocation.recordReliance(mandateId, { id: rpId, webhook });
  return { ok: true };
});

/** REVOKE — the whole company, in one endpoint. */
app.post('/mandates/revoke', async (req) => {
  const { mandateId } = req.body as { mandateId: string };
  if (!indexOf.has(mandateId)) return { error: 'unknown mandate' };
  return revocation.revoke(mandateId);   // ← returns propagationMs. That number is the product.
});

await app.listen({ port: PORT, host: '0.0.0.0' });
console.log(`  issuer     :${PORT}`);
