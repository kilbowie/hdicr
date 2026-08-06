# hdicr-reference

The reference implementation of the [HDICR specification](../hdicr-spec) — a mandate layer for AI agents.

**This repository is the commercial implementation. It is not the standard.**
The spec, schemas, conformance suite and certification mark live in `hdicr-spec`, owned by the HDICR
Foundation, and are free. This repo implements them, and is where SLAs, indemnity and evidence
products are built.

---

## The claim

> A human revokes. Within 500ms every verifier refuses, in-flight work halts, and the human gets
> signed proof of exactly what stopped.

```bash
pnpm install
pnpm test          # the conformance test. It must be green.
pnpm demo          # the whole loop, end to end, with real HTTP and real SSE
```

`pnpm demo` prints the measured propagation latency. **That number is the product.**

## Services

Four processes. Resist a fifth.

| Service | Port | Does |
|---|---|---|
| **issuer** | 3001 | Mints Mandates. Owns the status list. Runs revocation propagation (pull · push · poison). |
| **gate** | 3002 | The in-path Verifier. `PERMIT` / `DENY`. Emits Reliance Receipts. Subscribes to the revocation stream. |
| **ti-render** | 3003 | The Agent. Asks the gate *before* rendering. Halts on poison. |
| **wallet** | 3004 | The Principal. Grant, view — and **REVOKE**. |

## The one invariant

```ts
if (status === null) return deny('STATUS_UNAVAILABLE');   // FAIL CLOSED
```

If revocation status cannot be obtained inside the freshness window, the answer is `DENY`. Not
"probably fine." Not a warning. **Denied.**

Every engineering instinct you have will tell you to fail open so the demo keeps working when the
issuer is down. **That instinct is the bug** — an agent that keeps acting after the kill switch was
pressed is the exact failure this project exists to prevent. There is a test that catches it.

## Conformance

This implementation targets **L2** today and **L3** on receipt persistence.

| Level | | Status |
|---|---|---|
| L0 | Recording | *explicitly non-conformant. A ledger is a database.* |
| L1 | Enforcing — `VERIFY` before the action, `DENY` blocks | ✅ |
| L2 | Revocable — freshness enforced, fails closed, propagation SLA | ✅ |
| L3 | Accountable — Receipts, retrievable **by the Principal** | 🚧 in memory; needs persistence |

## Layout

```
packages/core      the Mandate, and the gate (verify.ts is the load-bearing file)
packages/status    the status list, and revocation propagation (revoke.ts is the moat)
apps/*             four small services
scripts/demo.ts    the end-to-end run. This is what you screen-record.
docs/              architecture and runbook
```

## Licence

Apache-2.0. The specification it implements is CC-BY-4.0 and lives elsewhere, because a standard that
is not free is not a standard.
