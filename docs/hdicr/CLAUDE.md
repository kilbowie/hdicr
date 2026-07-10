# CLAUDE.md — HDICR

Standing instructions for Claude Code working in this repo. Read `DESIGN.md` (what to build, data model, rules) and `ROADMAP.md` (build sequence, acceptance criteria) before starting any task.

## Project

HDICR is the neutral **personhood + consent/rights control plane** that sits *above* the agent protocols (AP2, MCP, the card networks) and extends them — it never competes. The MVP is the **core** (verified personhood + an append-only consent/rights ledger + an enforcement gate) plus one wedge, the **Likeness Rights & Royalty Rail**, dogfooded on the three Truly Imagined platforms. Enterprise-first. Product UI is **black-and-white, simple, sectioned**.

## Golden rules — never violate (these override convenience and speed)

1. **HDICR is never in the flow of funds.** No code path may hold, receive, or transmit money as principal. There is **no "withdraw from HDICR."** Payouts are deep-links out or platform-executed only. Liability follows custody of funds — keep HDICR a software + identity layer.
2. **Earnings are "Reported Earnings."** Any earnings figure is the sum of what platforms report via the SDK. Label it **Reported Earnings**, mark it indicative, and link to **Stripe / the platform as the source of truth** for the exact, withdrawable balance. Never present a settled or withdrawable balance as HDICR's own.
3. **HDICR is not a "platform operator."** Aggregate reported data and link out. HDICR is **not** merchant of record, **not** a party to the licence transaction, and does **not** facilitate the payment. Tax reporting (US 1099s; UK/EU digital-platform reporting) is the **paying platform's** responsibility — never assume it.
4. **Tier 2 is gated.** The Stripe Connect payout module (`PayoutDestination`, direct payouts, the "portable payout destination") is **not built** until the Tier 1 proof gate passes (see ROADMAP.md). **No money-moving code** is written until counsel sign-off (FCA / tax) is recorded in the repo.
5. **The ledger is append-only + hash-chained.** Never mutate or delete a `LedgerEntry`. Every write is signed and chains `prevHash → hash`. `verifyChain()` must pass in tests after any ledger change.
6. **Privacy.** Biometric material is stored as references/hashes only — never raw. No PII in logs, URLs, query strings, or error messages.
7. **Secrets & keys.** Issuer/verifier DIDs live in **AWS KMS**; holder keys are custodial via a managed service. No secrets committed to the repo; use env + secret manager.

If a task would require breaking any golden rule, **stop and flag it** rather than implementing — especially anything that moves money.

## Stack & layout

Monorepo (pnpm + turbo):

```
/packages/core      did:key (Ed25519), VC issue/verify, JCS (RFC 8785), gate logic, shared types
/packages/sdk       TS client (REST helpers) + MCP tool definitions
/apps/api           AWS Lambda + SAM, OpenAPI, RDS (Postgres) access, Stripe (Identity; Connect = Tier 2)
/apps/console       Next.js — the sectioned black-and-white UI + shared component library
/infra              SAM / IaC, KMS (issuer DIDs), Cloudflare config
```

Data: **RDS PostgreSQL** (hash-chained ledger, credentials, frames, licences, usage, statements). Identity: **did:key**, **W3C Verifiable Credentials**, **JCS**. External: **Stripe Identity** (IDV), **Stripe Connect** (Tier 2 only), **C2PA** via `trulyimagined.ai`. Hosted at `hdicr.trulyimagined.com`.

## Conventions

- **TypeScript everywhere**, strict mode. Shared types live in `/packages/core`.
- **Credentials**: W3C VC shape; sign with `eddsa-jcs-2022` (Ed25519 over JCS-canonicalised bytes). Verifiers resolve keys from the DID — no embedded-key trust.
- **Ledger entries**: `{ seq, type, actorDid, payload, prevHash, hash, signature, timestamp }`; append through a single writer path that derives `hash` from `prevHash`. Types: `issue | consent | action | revoke | usage | statement`.
- **API**: OpenAPI-first; thin handlers; validate at the edge; typed errors; idempotency keys on writes.
- **MCP tools mirror REST**: `verify_human`, `check_consent`, `check_license`, `execute_within_frame`, `list_activity`, `revoke`, `report_usage`. `report_usage` accepts **platform-signed** `UsageEvent`s.
- **UX synergy** (DESIGN.md §9): one Stripe Identity verification mints the `PersonhoodCredential` and is reused for personhood, licence consent, and (Tier 2) payout linking — no re-verification per surface. Use the shared component library (`VerificationWidget`, `ConsentModal`, `StatusPill`, `IdentityChip`, `EarningsCard`).
- **Design tokens** (monochrome): `--ink #0A0A0A`, `--bg #FFFFFF`, `--line #E6E6E6`, grays `#6B6B6B / #9A9A9A`; type `Geist → Inter`, `Geist Mono → IBM Plex Mono`. `StatusPill`: solid = allowed/active, dashed = denied, ghost = other.

## Environments & gates

- **Sandbox / prod split.** Do **not** enable real-human identity data in prod until **Gate A**: external crypto/security review passed **and** legal sign-off recorded.
- **Tier 1 proof gate** before Tier 2: Tier 1 proven operationally (TI paying royalties; Reported Earnings reconciled vs Stripe) **and** functionally (wallet reflects reported earnings reliably).

## Commands (fill in as the repo takes shape)

```
pnpm install                     # install
pnpm --filter console dev        # run the console
turbo run build                  # build all
pnpm test                        # tests (must include verifyChain + gate-trace)
sam build && sam deploy          # deploy the API
```

## Definition of done (every task)

- Types + tests added; `verifyChain()` passes if the ledger was touched; the **gate-trace** still passes (allow £30 / deny £40 over cap / deny out-of-scope / deny after revoke).
- No funds-movement path introduced; no secrets committed; PII handling respected.
- All seven golden rules honoured. When in doubt about liability or regulatory posture, flag rather than implement.
