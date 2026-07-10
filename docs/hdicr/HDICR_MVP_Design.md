# HDICR — MVP Design Document

> Drop this at repo root as `DESIGN.md`. It defines what the MVP is, the data model, the product surfaces, and the payout architecture. It supersedes the earlier console prototype where they differ (notably the earnings/wallet surface).

## 1. What the MVP is

HDICR is the neutral **personhood + consent/rights control plane** that sits *above* the agent protocols (AP2, MCP, the card networks) and extends them — it never competes with them. The MVP is deliberately the **fundable floor plus one wedge**:

- **Core primitive:** verified personhood + an append-only consent/rights **ledger** + an enforcement **gate**.
- **Wedge:** the **Likeness Rights & Royalty Rail**, dogfooded on the three Truly Imagined platforms.

Enterprise-first. Product design is **black-and-white, simple and direct**, with features split into clearly separated sections. The mark is the hexagon + H + fingerprint.

Everything downstream (reputation, underwriting, provenance, the consumer control plane) is an earned adjacency and is **out of scope** for the MVP — it reads from the same ledger later.

## 2. Scope & non-goals

**In scope (MVP)**
- Personhood verification → `PersonhoodCredential` (via Stripe Identity behind a pluggable verifier).
- Authorization frames (human grants bounded authority to an agent) + consent capture.
- The enforcement gate (allow / deny / revoke per action) + the append-only, hash-chained ledger.
- Registry / audit surface (read the ledger).
- Likeness rail: `LikenessCredential`, `LicenseGrant`, signed `UsageEvent`, `RoyaltyStatement`.
- **Creator earnings surface (the wallet) — Tier 1 "Reported Earnings" only.**
- Developer API + MCP server + TS SDK.
- Settings: issuer identities, trust policy, team.

**Non-goals (explicitly not in the MVP)**
- Agent reputation, autonomous-action underwriting, provenance-as-a-product, the consumer control-plane app.
- **HDICR moving or holding money (Tier 3).** HDICR is never in the flow of funds.
- **Tier 2 payout facilitation** — designed for now, *built only after Tier 1 is proven operationally and functionally*.
- Self-custody keys — MVP is custodial (managed) keys to avoid the recovery cliff.

## 3. Design principles (load-bearing — these are constraints, not preferences)

1. **Liability follows custody of funds.** HDICR never holds, receives, or transmits money as principal. It is a software + identity layer, not a money-services business. Every payout design must preserve this invariant.
2. **Rule 1 — Reported Earnings, not balances.** The wallet total is labelled **"Reported Earnings"** and is defined as *the sum of what platforms report to HDICR via the SDK*. Stripe and each platform are the **source of truth** for the exact, withdrawable balance. The UI states this and links out to the source of truth. HDICR figures are indicative, net of nothing, and may lag actual settlement.
3. **Rule 2 — HDICR is not a "platform operator."** HDICR aggregates *reported data* and *links out*; it does **not** facilitate the payment, hold the funds, act as merchant of record, or sit in the underlying licence transaction. Tax reporting (US 1099s; UK/EU digital-platform reporting) sits with **the paying platform**, not HDICR. Nothing in the aggregation flow may make HDICR the operator that facilitates the payment or the contract. (Confirm with counsel before any Tier 2 money-moving code.)
4. **Rule 3 — UX synergy is shared across the ecosystem.** One identity moment is reused everywhere. The single Stripe Identity verification that issues the `PersonhoodCredential` is reused for: proving humanity, signing licence consent, and (Tier 2) linking a payout destination. Shared components, shared design tokens, one session/identity — a smooth, clean, consistent experience across every HDICR surface.
5. **Ledger integrity + neutrality.** The ledger is append-only and hash-chained; it is the moat, the compliance record, and the future actuarial base. Keep it clean, provable, and neutral. Open-source the schema extensions; keep the ledger and network proprietary.

## 4. Architecture (MVP)

```
Businesses / platforms            Creators (rights holders)
        │                                  │
        ▼                                  ▼
┌───────────────────────────────────────────────────────┐
│  HDICR control plane                                   │
│  ┌───────────┐ ┌────────┐ ┌────────┐ ┌──────────────┐  │
│  │ Personhood│ │ Frames │ │  Gate  │ │ Likeness rail│  │
│  └───────────┘ └────────┘ └────────┘ └──────────────┘  │
│  Append-only, hash-chained LEDGER  (the moat)          │
│  SDK + MCP server + REST API                           │
└───────────────────────────────────────────────────────┘
        │  extends, never competes            │  reports usage / reads earnings
        ▼                                     ▼
  AP2 · MCP · Visa/MC · ACP/x402      Stripe (Identity = IDV, Connect = payouts*)
                                      *Tier 1: reporting/deep-link only. Tier 2 later.
```

HDICR runs on the existing TI registry stack: **AWS Lambda + SAM** (API), **RDS PostgreSQL** (ledger + records), **Cloudflare** (DNS/edge), **AWS KMS** (issuer keys), **OpenAPI**. Identity primitives: **did:key (Ed25519)**, **W3C Verifiable Credentials**, **RFC 8785 (JCS)** canonicalisation — reused from the scaffold.

## 5. Core data model

TypeScript-flavoured; implement as Postgres tables + typed accessors.

```ts
HumanIdentity      { did: DidKey; keyRef: string /*KMS/custodial*/; createdAt }
PersonhoodCredential /*VC*/ { issuer: DidKey; subject: DidKey;
                     assuranceLevel: 'low'|'substantial'|'high'; method: string;
                     verifiedAt; proof /*eddsa-jcs-2022*/ }
AgentIdentity      { did: DidKey; operator: string; operatorVerified: boolean }
ConsentProof       { humanDid; termsDigest /*JCS hash*/; signature; signedAt }
AuthorizationFrame { id; agentDid; humanDid; scope: string[];
                     spendCap?: { amount; currency; period }; jurisdiction?;
                     expiresAt?; status: 'active'|'revoked'; consent: ConsentProof }
LedgerEntry        { id; seq; type: 'issue'|'consent'|'action'|'revoke'|'usage'|'statement';
                     actorDid; payload; prevHash; hash; signature; timestamp }  // append-only chain

// Likeness rail
LikenessCredential { id; humanDid; templateRef /*hash, not raw biometric*/;
                     assuranceLevel; proof }
LicenseGrant       { id; humanDid; platform; uses: ('video'|'voice'|'image')[];
                     start; end; exclusivity: 'exclusive'|'non_exclusive';
                     terms: { base; currency; royaltyPct };
                     status: 'active'|'revoked'|'pending'; consent: ConsentProof }
UsageEvent         { id; licenseId; platform; use; quantity; reportedAmount; currency;
                     c2paRef?; platformSignature; timestamp }   // signed receipt from platform
RoyaltyStatement   { id; humanDid; period;
                     byPlatform: { platform; reportedAmount; eventCount; sourceUrl }[];
                     totalReported; source: 'reported'; asOf }  // Rule 1: reported, not settled

// Tier 2 only (designed now, built after Tier 1 proof)
PayoutDestination  { humanDid; provider: 'stripe'; connectedAccountRef;
                     accountType: 'standard'; verified: boolean; linkedAt }

TrustPolicy        { requiredAssurance; trustedIssuers: DidKey[] }
ApiKey             { id; name; scope; hashedKey; createdAt }
```

The ledger's `prevHash`/`hash` chain makes tampering detectable and the audit trail provable — this is the property regulators, insurers and courts will later require.

## 6. Product surfaces (sectioned, black-and-white)

Console sections, each a cleanly separated area:

| Section | Purpose | Key elements |
|---|---|---|
| **Dashboard** | at-a-glance platform health | verified humans, active frames, consent events, gate allow/deny, reported royalties |
| **Verify** | issue personhood | verify-a-human (Stripe Identity), verified identities table, credential preview |
| **Frames** | grant/authorise agents | create-frame (scope, cap, jurisdiction, expiry), active frames, revoke |
| **Registry** | the ledger | append-only activity (allowed/denied + reason), filters |
| **Likeness rights** | platform-side admin | grant licence, usage-event feed, licences table, revoke |
| **Earnings (wallet)** | creator-side | **Reported Earnings** total + per-platform breakdown + source-of-truth links (see §7) |
| **Developers** | build | MCP tools, API keys, quickstart, OpenAPI, webhooks |
| **Settings** | config | issuer DIDs (KMS), trust policy, team, payout-provider config |

### 6.1 Earnings / Wallet section — detailed spec (Tier 1)

- Header reads **"Reported Earnings"** (exact label). Subtitle: *"Totals reflect what platforms report to HDICR. Your exact, withdrawable balance lives with Stripe and each platform."*
- Primary figure: total **reported** earnings for the period, visibly tagged *reported*.
- Per-platform table: `platform · reported earnings · events · [View on Stripe] [Withdraw on {platform}]` — the actions are **deep-links out**, never an in-HDICR withdrawal.
- Persistent source-of-truth note (Rule 1) and, where a figure is stale, an "as of {time}" stamp.
- Tier 2 affordance shown but **disabled** with a roadmap tag: *"Set up a portable payout destination — available after Tier 1."* No functional payout wiring in the MVP.
- There is **no** "withdraw from HDICR" control anywhere (Rule: never in the flow of funds).

## 7. Payout architecture — Tier 1 now, Tier 2 later

**Tier 1 (MVP — visibility only, the open-banking pattern).**
Platforms report usage and royalties to HDICR via the SDK as **signed `UsageEvent`s**. HDICR aggregates them into `RoyaltyStatement`s and shows **Reported Earnings** with a per-platform breakdown. "View / Withdraw" deep-links to Stripe or the paying platform, which is where the real balance and payout live. **HDICR touches no money and is not the payer, merchant, or contract party.** Ship and prove this first — operationally (TI paying royalties, reconciliation validated) and functionally (the wallet reflects reported earnings reliably).

**Tier 2 (post-proof — Connect-facilitated direct payout).** *Gate: only after Tier 1 is proven.*
The SDK adds a "Set up payouts" module that helps a creator **connect or create one Stripe Standard account via OAuth**. HDICR records a **verified payout identity** (`PayoutDestination`: this verified human ⇄ this payout account) as a credential in the ledger. Every integrating platform then pays the creator's own account **directly** through its own Stripe relationship — money never routes through HDICR. Because a Standard account connects via OAuth to *many* platforms, one destination becomes portable, and **"verified human + verified payout destination, portable across every platform"** finally holds. HDICR remains the identity + linkage + view layer; Stripe is the money-mover; each platform is the payer.

**Guardrails carried through both tiers**
- HDICR never holds/receives/transmits funds (custody = liability).
- Wallet is Reported Earnings; Stripe/platform is source of truth (Rule 1).
- Tax reporting sits with the paying platform; HDICR's aggregation must not make it the "platform operator" facilitating the payment or the contract (Rule 2).
- HDICR does not *initiate* payments (a "withdraw" that HDICR executes as principal is a regulated activity) — deep-link or platform-executed only.
- Confirm the FCA/tax specifics with counsel before writing any Tier 2 money-moving code.

## 8. SDK & API surface (MVP)

**MCP tools** (also exposed as REST): `verify_human`, `check_consent`, `check_license`, `execute_within_frame`, `list_activity`, `revoke`, `report_usage`.

**REST (OpenAPI), representative:**
```
POST /v1/identities/verify        → start Stripe Identity, issue PersonhoodCredential
POST /v1/frames                    → create frame (capture consent signature)
POST /v1/gate/execute              → execute_within_frame → { allowed, reason, ledgerId }
GET  /v1/registry?filter=          → list_activity (the ledger)
POST /v1/revoke                    → narrow/withdraw a frame or licence
POST /v1/licenses                  → grant a likeness licence
POST /v1/licenses/check            → check_license → { allowed, terms, licenseId }
POST /v1/usage                     → report_usage (signed UsageEvent)  ← platforms call this
GET  /v1/earnings?humanDid=        → Reported Earnings + per-platform (Tier 1 wallet)
POST /v1/payout-destinations/connect  → Tier 2 only (Stripe Connect OAuth)
```

**Signed `UsageEvent` receipt (Rule 1 provenance of the number):** each event is signed by the reporting platform's key so the ledger records *who reported what*; HDICR aggregates signed reports, it does not assert settlement.

## 9. UX synergy spec (Rule 3)

- **One verification moment.** The Stripe Identity check that mints the `PersonhoodCredential` is the single source of verified humanity, reused for: proving personhood, signing licence consent, and (Tier 2) linking a payout destination. No re-verification per surface.
- **Shared component library** (monochrome tokens): `VerificationWidget`, `ConsentModal`, `StatusPill` (solid = allowed/active, dashed = denied, ghost = other), `IdentityChip` (the verified-human badge), `EarningsCard`.
- **One identity / session** across the platform console and the creator surfaces.
- **Consistent language and status vocabulary** everywhere (an action keeps its name through the whole flow).
- Design tokens: `--ink #0A0A0A`, `--bg #FFFFFF`, hairlines `--line #E6E6E6`, grays `#6B6B6B / #9A9A9A`; type `Geist` → `Inter` fallback, `Geist Mono` → `IBM Plex Mono`.

## 10. Non-liability checklist (Rules 1 & 2 — Claude Code must honour)

- [ ] HDICR never holds, receives, or moves funds in any code path.
- [ ] Wallet total is labelled **Reported Earnings**; every figure links to Stripe/platform as source of truth.
- [ ] No payment is *initiated* by HDICR — deep-link or platform-executed only.
- [ ] HDICR is not merchant of record and not a party to the licence transaction (it records the grant; the platform transacts).
- [ ] Tax-reporting responsibility is documented as the paying platform's; aggregation does not make HDICR the platform operator.
- [ ] Biometric material is stored as references/hashes, never raw.
- [ ] Before any Tier 2 money-moving code: counsel sign-off (FCA / tax / DAC7-equivalent) recorded.

## 11. Tech stack & repo shape

Monorepo (pnpm + turbo):
```
/packages/core      did:key, Ed25519, VC issue/verify, JCS, gate logic, shared types  (reuse scaffold)
/packages/sdk       TS client (REST helpers) + MCP tool definitions
/apps/api           AWS Lambda + SAM handlers, OpenAPI, RDS (Postgres) access, Stripe (Identity; Connect T2)
/apps/console       Next.js — the sectioned black-and-white UI + shared component library
/infra              SAM / IaC, KMS (issuer DIDs), Cloudflare config
```
DB: RDS PostgreSQL — hash-chained ledger, credentials, frames, licences, usage, statements. Keys: AWS KMS for issuer/verifier DIDs; custodial holder-key service. External: Stripe Identity (IDV), Stripe Connect (Tier 2), C2PA via `trulyimagined.ai`.
