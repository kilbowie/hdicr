# HDICR — Build & Implementation Roadmap (primitive core)

> Drop at repo root as `ROADMAP.md`. Sequenced so you reach a **working, testable core with the ledger accumulating** (via Truly Imagined) — the thing to demo and submit to YC — before anything money-moving. Week ranges are indicative for a lean team; treat phases as gated, not calendar-locked.

## How to use this
Work top-to-bottom. Each phase has **tasks** (for Claude Code) and **acceptance criteria** (how you know it's done). Do not start Tier 2 until the Tier 1 gate passes. Do not put real-human identity data in production until Gate A passes.

---

## Phase 0 — Scaffold & foundations · ~Week 1–2

**Tasks**
- Init monorepo (pnpm + turbo): `/packages/core`, `/packages/sdk`, `/apps/api`, `/apps/console`, `/infra`.
- Port the HVA scaffold into `/packages/core`: did:key (Ed25519), VC issue/verify, JCS canonicalisation, gate logic, shared types.
- Provision infra in `/infra`: SAM API skeleton, RDS PostgreSQL, AWS KMS (issuer + verifier DIDs), Cloudflare DNS for `hdicr.trulyimagined.com`, environment split (sandbox / prod).
- Define Postgres schema for all §5 entities; implement the **append-only, hash-chained ledger** (`prevHash`/`hash`/`signature` per entry) with a verify-chain function.
- Stand up a **custodial key service** (managed Ed25519 keys per human/agent).
- Scaffold `/apps/console` (Next.js) with the shared component library + monochrome tokens.

**Acceptance**
- `verifyChain()` detects any tampered/inserted ledger entry.
- Issuer DIDs resolve from KMS; a credential issued in sandbox verifies end-to-end.
- CI green; sandbox and prod deploy from the pipeline.

## Phase 1 — Core primitives working · ~Week 3–5

**Tasks**
- **Personhood:** integrate **Stripe Identity** behind the `IdentityVerifier` interface → issue `PersonhoodCredential` at assurance `substantial`.
- **Frames:** `POST /v1/frames` — capture the human's consent signature (`ConsentProof`, JCS digest), persist the `AuthorizationFrame`.
- **Gate:** `POST /v1/gate/execute` (`execute_within_frame`) — evaluate scope + spend cap + jurisdiction + expiry + revocation → `{ allowed, reason, ledgerId }`, and write a `LedgerEntry`.
- **Registry:** `GET /v1/registry` (`list_activity`) with filters.
- **Revoke:** `POST /v1/revoke` with live status + webhook/stream.
- **MCP server:** expose `verify_human`, `check_consent`, `execute_within_frame`, `list_activity`, `revoke`.
- Console sections live: Dashboard, Verify, Frames, Registry.

**Acceptance — the gate-trace passes end-to-end on real infra:**
- allow `purchase £30`; deny `purchase £40` (would exceed £50 weekly cap); deny `send_message` (out of scope); deny `purchase £10` after revoke — each with the correct `reason` and a signed ledger entry.
- A `PersonhoodCredential` is issued from a real Stripe Identity session and verifies.

## Phase 2 — Likeness rail + Tier 1 wallet + TI dogfood · ~Week 6–9

**Tasks**
- **Likeness types & flows:** `LikenessCredential`, `LicenseGrant`; `POST /v1/licenses` (grant, with consent), `POST /v1/licenses/check` (`check_license` → `{ allowed, terms, licenseId }`).
- **Usage reporting:** `POST /v1/usage` (`report_usage`) accepting **platform-signed** `UsageEvent`s; aggregate into `RoyaltyStatement`s.
- **Tier 1 wallet:** `GET /v1/earnings?humanDid=` and the **Earnings** console section — labelled **"Reported Earnings"**, per-platform breakdown, source-of-truth links, disabled Tier 2 CTA. No in-HDICR withdrawal anywhere.
- **SDK:** publish `/packages/sdk` with the MCP tools + REST helpers so a platform integrates in a few calls.
- **Truly Imagined integration (the dogfood):**
  - `trulyimagined.com` marketplace → issues `LicenseGrant`s via HDICR.
  - `trulyimagined.ai` → calls `check_license` before generation and posts signed `UsageEvent`s at generation; embeds a **C2PA** content credential referencing the HDICR licence (provenance-consent v0).
  - Earnings surface shows TI-reported royalties as **Reported Earnings**, deep-linking to Stripe for the settled balance.

**Acceptance**
- Full licence lifecycle works: grant → usage events reported (signed) → Reported Earnings updates → revoke → subsequent use denied and downstream content flagged.
- **The ledger is accumulating real events from TI** — this is the metric that matters for YC.
- Wallet never shows a withdrawable balance or a withdraw action; every figure links to source of truth.

## Phase 3 — Harden, instrument, YC-ready · ~Week 10–12

**Tasks**
- **Ledger analytics v0:** usage/consent insights (volume, per-platform, per-agent) — the beginning of the moat as a data asset.
- Console polish; OpenAPI + developer docs; webhooks (revocation, usage).
- Wire the **demo path**: the console + the TI integration + the two existing prototypes (MVP + vision) as the narrative.
- **Legal engagement kicked off** (Gate A prep: GDPR / eIDAS / UK-DVS / BIPA; and the Tier 2 payout/tax questions) and **external security review scheduled** for the credential layer.
- Open-source v0 of the personhood + rights **schema extensions** (VC/AP2-compatible) for neutrality/adoption.

**Acceptance**
- A clean, clickable end-to-end demo: verify a human → grant a licence → generate on `trulyimagined.ai` → see the gate + ledger entry → see Reported Earnings.
- A metrics view for the application: verified identities, licences issued, **usage events logged (ledger volume)**, consent events, platforms integrated.

---

## Gates (do not cross early)

- **Gate A — before real-human identity data in production:** external crypto/security review passed **and** legal sign-off received.
- **Tier 1 proof gate — before building Tier 2:** Tier 1 is proven *operationally* (TI paying royalties; reconciliation of Reported Earnings vs Stripe validated) **and** *functionally* (wallet reflects reported earnings reliably, source-of-truth links correct).

## Tier 2 — Connect-facilitated payout (post-proof, not in the MVP build)

Only after the Tier 1 proof gate: add the SDK "Set up payouts" module → creator connects/creates **one Stripe Standard account via OAuth** → record the **verified payout identity** (`PayoutDestination`) → integrating platforms pay that account **directly**. HDICR stays out of the flow of funds; Stripe is the money-mover; each platform is the payer. At this point **"verified human + verified payout destination, portable across every platform"** becomes real. Counsel sign-off (FCA / tax) recorded before any money-moving code.

---

## What to test (validation checklist)

- Gate-trace: allow £30 / deny £40 over cap / deny out-of-scope / deny after revoke — correct reasons + signed ledger entries.
- Personhood: real Stripe Identity session → `PersonhoodCredential` verifies; assurance enforced by trust policy.
- Likeness lifecycle: grant → signed usage events → Reported Earnings → revoke → denied + downstream flagged.
- Wallet: labelled Reported Earnings; no withdrawable balance; source-of-truth links resolve; Tier 2 CTA disabled.
- Ledger: `verifyChain()` catches tampering; append-only holds under concurrent writes.
- Non-liability: grep the codebase — no path holds/receives/moves funds; no HDICR-initiated payment.

## YC submission track (run in parallel from Phase 2)

- **Working demo:** the Phase-3 end-to-end path, live against TI.
- **Traction/insight evidence:** ledger volume from the TI dogfood + any external pilot conversation; the "human-is-behind-everything is the era's Y2K" thesis; the neutral-control-plane-above-AP2/MCP positioning.
- **Deck:** assemble the control-plane diagram, the likeness one-pager, the primitive map + 10-year ARR, the adjacency specs, and the two prototypes into 8–10 slides.
- **1-minute video:** the demo path narrated.
- **Application answers:** what/why-now/wedge/moat (the ledger + cross-platform insights)/team; enterprise-first floor, consumer control plane as option value.
- **Ownership:** structure to retain 100% control through the round (dual-class).

## Milestones at a glance

| When | Milestone |
|---|---|
| End P0 | Monorepo + hash-chained ledger + KMS issuer DIDs; CI/deploy live |
| End P1 | Gate-trace passes on real infra; personhood via Stripe Identity |
| End P2 | Likeness rail + Tier 1 wallet; **TI dogfood → ledger accumulating** |
| End P3 | Clean end-to-end demo + metrics; legal + security review in motion; **YC-ready** |
| Post-proof | Tier 2 payout module; portable payout identity holds |
