# HDICR — Implementation Package

Everything needed to build the HDICR MVP. This is the hand-off for the VS Code / Claude Code session — start with this file.

## What's in here

| File | Role | Put it |
|---|---|---|
| `CLAUDE.md` | Standing guardrails + conventions — read on **every** task | repo root |
| `HDICR_MVP_Design.md` → rename `DESIGN.md` | What to build: scope, data model, payout architecture, the rules | repo root |
| `HDICR_Build_Roadmap.md` → rename `ROADMAP.md` | Phased build, acceptance criteria, gates | repo root |
| `HDICR_MVP_prototype.html` | **Full visual mockup** — the design reference for the console UI | `/design` (reference only) |

## Read order
1. **`CLAUDE.md`** — the non-negotiable rules and conventions.
2. **`DESIGN.md`** — the MVP spec, data model, and the Tier 1 → Tier 2 payout approach.
3. **`ROADMAP.md`** — build Phase 0 → 3, with the acceptance tests to keep green and the two gates.
4. **Open `HDICR_MVP_prototype.html`** in a browser — the visual reference for the sectioned, black-and-white console: Dashboard · Verify · Frames · Registry · Likeness rights · **Earnings** · Developers · Settings.

## The design in one line
Verified personhood + an append-only, hash-chained consent/rights **ledger** + an enforcement **gate**, sitting above AP2/MCP — plus the **Likeness Rights & Royalty Rail** with a Tier-1 **"Reported Earnings"** wallet. Enterprise-first, dogfooded on Truly Imagined. Black-and-white, sectioned UI.

## Guardrails you must not break (full detail in `CLAUDE.md`)
- **Never in the flow of funds.** No "withdraw from HDICR" anywhere.
- **Wallet is "Reported Earnings"** — Stripe / the platform is the source of truth; every figure links out.
- **Not a "platform operator"** — tax reporting is the paying platform's responsibility.
- **Tier 2 (Connect payout) is gated** on Tier 1 proof + counsel sign-off. No money-moving code before then.
- **Ledger is append-only + hash-chained** — never mutate/delete; `verifyChain()` stays green.
- **Gate A** (legal + external security review) before any real-human identity data in production.

## Repo shape (from `DESIGN.md` §11)
```
/packages/core      did:key (Ed25519), VC issue/verify, JCS, gate logic, shared types  (port the scaffold)
/packages/sdk       TS client + MCP tool definitions
/apps/api           AWS Lambda + SAM, OpenAPI, RDS (Postgres), Stripe (Identity; Connect = Tier 2)
/apps/console       Next.js — the sectioned black-and-white UI (mirror the mockup)
/infra              SAM / IaC, KMS (issuer DIDs), Cloudflare
```

## Start here — Phase 0
Init the monorepo, port the scaffold's did:key / VC / JCS / gate into `/packages/core`, stand up the Postgres **hash-chained ledger** and **KMS** issuer keys, split sandbox/prod, and get the acceptance **gate-trace** passing (allow £30 / deny £40 over cap / deny out-of-scope / deny after revoke). Then Phase 1 — personhood via Stripe Identity, frames, gate, registry. Full detail in `ROADMAP.md`.

---
*The console UI you build should mirror `HDICR_MVP_prototype.html`: monochrome, hairline borders, sectioned nav, the hexagon + H + fingerprint mark, and the shared components in `DESIGN.md` §9 (VerificationWidget, ConsentModal, StatusPill, IdentityChip, EarningsCard).*
