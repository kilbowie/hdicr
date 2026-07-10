# HDICR → hdicr.com cutover runbook (P0)

Moves the running HDICR API from `hdicr.trulyimagined.com` onto `hdicr.com` with **zero downtime** — both hosts and both Auth0 audiences stay valid until Truly Imagined (TI) has flipped, then the legacy ones are retired.

The **code changes are already committed** (see "What the code already does"). The steps below are the **manual infra/credential actions** that require AWS / Cloudflare / Auth0 / Vercel access — they cannot be done from the repo.

---

## What the code already does

- `infra/template.yaml` — opt-in `hdicr.com` custom domain (`HDICRComCustomDomain` + `HDICRComBasePathMapping`), gated by `ManageHdicrComDomain` (default `false`). Runs **alongside** the legacy `hdicr.trulyimagined.com` domain. Outputs `HdicrComDomainTarget` (the API Gateway regional domain to CNAME to). Runtime bumped `nodejs20.x → nodejs24.x` (the old runtime can no longer be deployed as of 2026‑07‑01).
- `shared/middleware/src/index.ts` — `AUTH0_AUDIENCE` now accepts a **comma‑separated list**; the JWT is valid if its `aud` matches any entry. Single value = unchanged behaviour.
- `infra/samconfig.repo.toml` — `Auth0Audience=https://hdicr.com,https://hdicr.trulyimagined.com`; `ManageHdicrComDomain=false` + `HdicrComCertificateArn=""` placeholders ready to flip; stale Stripe secret overrides removed.
- TI `apps/web/src/lib/hdicr/flags.ts` + `hdicr-http-client.ts` — already read the base URL from `HDICR_API_URL` and the audience from `AUTH0_M2M_AUDIENCE`; copy‑paste bug fixed.

---

## Manual steps (in order)

### 1. ACM certificate for hdicr.com (AWS, eu-west-1)
- Request a public cert in **eu-west-1** (same region as the API) for `hdicr.com` (add `*.hdicr.com` if a console/subdomains are wanted later).
- Validate via **DNS**: ACM gives a `_acme-challenge`‑style CNAME → add it in Cloudflare (DNS‑only). Wait for status **Issued**.
- Copy the **certificate ARN**.

### 2. Enable the domain in the stack (repo + deploy)
- In `infra/samconfig.repo.toml` set:
  - `HdicrComCertificateArn=<the ARN from step 1>`
  - `ManageHdicrComDomain=true`
- Deploy: `pnpm build && sam build -t infra/template.yaml && sam deploy --config-file infra/samconfig.repo.toml`.
- From stack **Outputs**, copy `HdicrComDomainTarget` (e.g. `d-xxxx.execute-api.eu-west-1.amazonaws.com`).

### 3. Cloudflare DNS for hdicr.com
- Add a **CNAME** `hdicr.com` (or the apex via CNAME‑flattening) → `HdicrComDomainTarget`.
- Set **DNS‑only (grey cloud)** — the API Gateway regional custom domain terminates its own TLS; proxying (orange cloud) would double‑proxy and can break the cert/SNI. (Revisit only if we deliberately front APIGW with Cloudflare later.)
- Verify: `curl https://hdicr.com/v1/consent/check` returns a `401` (reachable + auth‑gated), not a TLS error.

### 4. Auth0 — add the hdicr.com API audience
- Create a new **API** with identifier **`https://hdicr.com`** (RS256).
- Add the HDICR scopes: `hdicr:identity:read|write`, `hdicr:consent:read|write`, `hdicr:licensing:read|write`, `hdicr:representation:read|write`.
- Authorise the existing **M2M application** (TI's `AUTH0_M2M_CLIENT_ID`) for this new API with those scopes.
- Leave the legacy `https://hdicr.trulyimagined.com` API in place for now (both audiences are accepted by the middleware).

### 5. TI cutover (Vercel env — config only)
- Set on `apps/web`:
  - `HDICR_API_URL=https://hdicr.com`
  - `AUTH0_M2M_AUDIENCE=https://hdicr.com`
- Redeploy TI. The client requests M2M tokens for `https://hdicr.com` and calls the new host; the HDICR middleware accepts them.

### 6. Verify (see also the plan's P0 acceptance)
- From TI prod, exercise: consent grant + `check_consent_enforcement` (via `apps/web/src/lib/licensing/authorize.ts`), a licensing decision, a representation lookup — all 200 with correct `tenant_id` scoping.
- Confirm `hdicr.trulyimagined.com` **still** answers (old tokens still valid) throughout.
- Run `pnpm test:contract` (TI) and `pnpm test` (HDICR).

### 7. Retire the legacy host/audience (later, after TI is stable on hdicr.com)
- Drop `https://hdicr.trulyimagined.com` from `Auth0Audience` in `samconfig.repo.toml` (leave only `https://hdicr.com`); redeploy.
- Remove the legacy Auth0 API and the `hdicr.trulyimagined.com` Cloudflare record + custom‑domain resources.

---

## Rollback
Cutover is reversible at any step: revert TI's `HDICR_API_URL`/`AUTH0_M2M_AUDIENCE` to the legacy values and redeploy — the legacy host/audience remain live until step 7. No data migration is involved in P0.
