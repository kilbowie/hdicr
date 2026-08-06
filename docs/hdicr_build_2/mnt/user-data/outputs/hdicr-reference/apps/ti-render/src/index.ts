import Fastify from 'fastify';
import { createHash } from 'node:crypto';

/**
 * TI RENDER — the Agent.
 *
 * Two call sites. That is the entire integration.
 *   1. Ask the gate BEFORE rendering. Honour DENY.
 *   2. Accept a poison webhook. Halt what has not committed. Report honestly on what has.
 */

const PORT = Number(process.env['RENDER_PORT'] ?? 3003);
const GATE_URL = process.env['GATE_URL'] ?? 'http://localhost:3002';

interface Job {
  id: string;
  mandateId: string;
  frames: number;
  committed: boolean;
  halted: boolean;
  timer?: NodeJS.Timeout;
}
const jobs = new Map<string, Job>();

const app = Fastify({ logger: false });

app.post('/render', async (req) => {
  const { jwt, mandateId, tags = [] } = req.body as {
    jwt: string; mandateId: string; tags?: string[];
  };
  const jobId = `job_${Math.random().toString(36).slice(2, 8)}`;

  // ---- CALL SITE 1: the gate, BEFORE the render ------------------------
  const res = await fetch(`${GATE_URL}/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jwt,
      request: {
        type: 'hdicr:media:likeness',
        action: 'render',
        location: `http://localhost:${PORT}/renders/${jobId}`,
        datatypes: ['face', 'voice'],
        context: { tags },
        requestDigest: 'sha256:' + createHash('sha256').update(jobId).digest('hex').slice(0, 16),
      },
    }),
  });
  const decision = (await res.json()) as { decision: string; reason_code?: string };

  if (decision.decision === 'DENY') {
    // The render does NOT happen. Not queued. Not flagged. Not retried. Denied.
    console.log(`  render  REFUSED  ${jobId}  (${decision.reason_code})`);
    return { jobId, status: 'refused', reason: decision.reason_code };
  }

  const job: Job = { id: jobId, mandateId, frames: 0, committed: false, halted: false };
  jobs.set(jobId, job);

  // a slow render, so there is something in flight to halt
  job.timer = setInterval(() => {
    if (job.halted) return;
    job.frames++;
    if (job.frames >= 40) {
      clearInterval(job.timer);
      job.committed = true;             // published. We do NOT claim to reverse this.
      console.log(`  render  COMMITTED ${jobId}`);
    }
  }, 100);

  console.log(`  render  STARTED  ${jobId}`);
  return { jobId, status: 'rendering' };
});

// ---- CALL SITE 2: the poison webhook ------------------------------------
app.post('/hdicr/revoked', async (req) => {
  const { mandateId } = req.body as { mandateId: string };
  const halted: string[] = [];

  for (const job of jobs.values()) {
    if (job.mandateId !== mandateId) continue;
    if (job.committed) continue;        // already published — honestly reported, never faked
    clearInterval(job.timer);
    job.halted = true;
    halted.push(job.id);
    console.log(`  render  HALTED   ${job.id}  at frame ${job.frames}`);
  }

  return { halted };                    // HDICR puts this in the receipt chain
});

app.get('/jobs', async () => [...jobs.values()].map(({ timer, ...j }) => j));

await app.listen({ port: PORT, host: '0.0.0.0' });
console.log(`  ti-render  :${PORT}`);
