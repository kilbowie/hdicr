/**
 * THE DEMO.
 *
 *   pnpm demo
 *
 * Boots all three services, runs the whole loop over real HTTP with a real SSE stream, and prints
 * the measured propagation latency.
 *
 * This is what you screen-record. Do not narrate the architecture. Let the render stop.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const ISSUER = 'http://localhost:3001';
const RENDER = 'http://localhost:3003';

const GATE = 'http://localhost:3002';
const kids: ChildProcess[] = [];

const boot = (entry: string) => {
  kids.push(spawn('./node_modules/.bin/tsx', [entry], { stdio: 'inherit', env: process.env }));
};

/** Wait for a service to actually answer, rather than guessing with a sleep. */
async function waitFor(url: string, name: string, ms = 25_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(500) });
      if (r.ok) return;
    } catch { /* not up yet */ }
    await sleep(200);
  }
  throw new Error(`${name} never came up at ${url}`);
}
const post = async (url: string, body: unknown) =>
  (await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })).json() as Promise<any>;

const rule = (s: string) => console.log(`\n\x1b[2m${'─'.repeat(58)}\x1b[0m\n  \x1b[1m${s}\x1b[0m\n`);

let ok = false;

try {
  boot('apps/issuer/src/index.ts');
  await waitFor(`${ISSUER}/pubkey`, 'issuer');
  boot('apps/gate/src/index.ts');
  boot('apps/ti-render/src/index.ts');
  await waitFor(`${GATE}/receipts`, 'gate');
  await waitFor(`${RENDER}/jobs`, 'ti-render');
  await sleep(600);   // let the gate's SSE subscription land

  // ---------------------------------------------------------------- 1
  rule('1 · She grants a bounded mandate');
  const { mandate, jwt } = await post(`${ISSUER}/mandates`, {
    authorization_details: [{
      type: 'hdicr:media:likeness',
      actions: ['render', 'distribute'],
      datatypes: ['face', 'voice'],
      constraints: { exclusions: ['political', 'adult', 'endorsement'], territory: ['GB', 'EU'] },
    }],
    limits: { max_invocations: 500, period: 'P1M' },
    maxPropagationMs: 500,
  });
  console.log(`  face + voice · UK/EU · no political · 500/month · expires ${mandate.validUntil.slice(0, 10)}`);

  // ---------------------------------------------------------------- 2
  rule('2 · The agent asks permission BEFORE it acts');
  const j1 = await post(`${RENDER}/render`, { jwt, mandateId: mandate.id });
  console.log(`  → ${j1.status}`);

  // ---------------------------------------------------------------- 3
  rule('3 · It asks for something she never granted');
  const j2 = await post(`${RENDER}/render`, { jwt, mandateId: mandate.id, tags: ['political'] });
  console.log(`  → ${j2.status}  (${j2.reason})   ← the render did not happen. Not a log line.`);

  // ---------------------------------------------------------------- 4
  rule('4 · More work goes in flight');
  await post(`${RENDER}/render`, { jwt, mandateId: mandate.id });
  await post(`${RENDER}/render`, { jwt, mandateId: mandate.id });
  await sleep(600);

  // ---------------------------------------------------------------- 5
  rule('5 · She changes her mind');
  const r = await post(`${ISSUER}/mandates/revoke`, { mandateId: mandate.id });
  await sleep(150);   // let the SSE frame land at the gate

  console.log(`\n  \x1b[1;33m${r.propagationMs}ms\x1b[0m  — every verifier now refuses`);
  console.log(`  gates notified : ${r.gatesNotified}`);
  console.log(`  RPs poisoned   : ${r.rpsPoisoned}`);
  console.log(`  renders halted : ${r.halted.join(', ') || '—'}`);
  console.log(`  SLA            : ${mandate.credentialSubject.revocation.max_propagation_ms}ms  ` +
              `${r.propagationMs <= mandate.credentialSubject.revocation.max_propagation_ms ? '\x1b[32m✓ met\x1b[0m' : '\x1b[31m✗ MISSED\x1b[0m'}`);

  // ---------------------------------------------------------------- 6
  rule('6 · The agent tries again');
  const j3 = await post(`${RENDER}/render`, { jwt, mandateId: mandate.id });
  console.log(`  → ${j3.status}  (${j3.reason})`);

  // ---------------------------------------------------------------- 7
  rule('7 · She gets signed proof of what ran, and what stopped');
  const jobs = await (await fetch(`${RENDER}/jobs`)).json() as any[];
  for (const j of jobs) {
    const state = j.halted ? '\x1b[33mHALTED\x1b[0m' : j.committed ? 'committed' : 'rendering';
    console.log(`  ${j.id}  ${state}  ${j.frames} frames`);
  }

  const receipts = await (await fetch(`${GATE}/receipts?mandate=${mandate.id}`)).json() as any[];
  console.log(`  ${receipts.length} signed receipts · retrievable by HER, not just the platform`);

  ok = j2.status === 'refused' && j3.status === 'refused'
       && r.propagationMs <= mandate.credentialSubject.revocation.max_propagation_ms
       && r.halted.length > 0;

  console.log('\n');
  console.log(ok ? '  \x1b[32m✓ the kill switch works\x1b[0m\n' : '  \x1b[31m✗ FAILED\x1b[0m\n');
} catch (err) {
  console.error('\n  \x1b[31m✗ demo failed:\x1b[0m', err instanceof Error ? err.message : err, '\n');
} finally {
  for (const k of kids) k.kill('SIGKILL');
  await sleep(300);
  // Children inherit stdio, which holds the event loop open. Exit deliberately.
  process.exit(ok ? 0 : 1);
}
