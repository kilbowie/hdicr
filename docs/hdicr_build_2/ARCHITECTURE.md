# Architecture

Four services. Resist a fifth.

```
  Wallet ──ISSUE──▶ Issuer ─────────┐
    │                               │ status list (bitstring)
    │ REVOKE                        ▼
    └──────────────▶ ┌─── propagation ───┐
                     │ pull   GET /status │  fallback, 5s poll
                     │ push   SSE /events │  primary. sub-second.
                     │ poison POST hook   │  ← nobody else does this
                     └────────┬───────────┘
                              │
  TI Render ──PRESENT──▶ Gate ─┴──▶ PERMIT / DENY
                          │
                          └──▶ Reliance Receipt ──▶ the Principal
```

## Why three propagation tiers

| Tier | What it is | Why |
|---|---|---|
| **pull** | The Gate polls the status list | The floor. Cacheable, CDN-able, herd-private. Everyone does this. |
| **push** | SSE from Issuer to every Gate | What makes sub-second real. The bit flips and every gate knows. |
| **poison** | Webhook to every RP that already relied | **The moat.** Pull and push stop *future* actions. Poison stops the ones already running. |

Without poison, "revocation" means *"no new renders will start."* The one halfway through her face
keeps going. That is not what she asked for, and it is not what GDPR Art 7(3) means by *as easy to
withdraw as to give*.

## Freshness, and why the Gate fails closed

The Gate keeps a status view with an `updatedAt`. On every `VERIFY` it computes the age.

- `updatedAt === 0` → never connected → **DENY**. "We have never heard from the issuer" is not the
  same as "there are no revocations."
- `age > freshnessWindow` → **DENY**.
- Otherwise → the answer, with its age recorded in the Receipt so it is auditable afterwards.

Note what the Gate does *not* do when a pull fails: it does not touch `updatedAt`. The view simply
ages out and starts denying. **Silence is not consent.**

## The receipt chain

Every `PERMIT` produces a Reliance Receipt: who relied, on what, when, at what status freshness, for
which exact request (digest-bound, so it cannot be replayed against a different action).

On revocation, the poisoned RP reports what it *halted* — and, honestly, what it could not, because
it had already committed. HDICR does not claim to reverse a published video. It claims to stop the
unpublished ones and to prove exactly which was which.

## Freshness windows

| Profile | Window |
|---|---|
| Financial execution | ≤ 1 000 ms |
| Media rendering | ≤ 30 000 ms |
| Absolute ceiling | 60 000 ms |

Profiles may tighten. They may not loosen past the ceiling.
