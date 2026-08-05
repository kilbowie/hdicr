# hdicr

Production HDICR API service repository.

## Status

**Current state is not asserted here.** See `_implementation/PROGRESS.md` at the estate root for
what is true as of the last session, and `git log` for what actually landed.

This section previously carried a "Current Readiness Status" block dated **2026-04-20** — over three
months stale by the time it was read, and by then wrong: it stated that *"identity, consent,
licensing, and representation services are independently buildable and testable"*, but the
representation service was retired in `124c204` (Stream 4b) and its tables dropped in `62c5659`
(Stream 4c). A dated status block in a README ages into a false claim without anyone editing it,
which is exactly the failure mode this estate's claims discipline exists to prevent.

Standing facts, which do not go stale:

- **Architecture boundary.** HDICR is payment-agnostic and focused on identity, consent and
  licensing. Stripe payment/webhook secret mappings are deliberately absent from the shared
  secret-name mapping.
- **Deployment contract.** AWS SAM template at `infra/template.yaml`, with custom domain and API
  mapping. Deploys via GitHub OIDC (`.github/workflows/deploy.yml`).
- **⚠️ Every merge to `main` is a production deployment.** `deploy.yml` triggers on push to `main`,
  and HDICR is the only genuinely deployed service in the estate. Approving a PR here approves a
  deploy — review accordingly.

## Validation Commands

Run from repository root:

```bash
pnpm type-check
pnpm test
pnpm sam:validate
```

## Deployment Inputs

Core deployment parameters are defined in `infra/template.yaml`:

- `HDICRDatabaseURL`
- `Auth0Domain`
- `Auth0Audience`
- `AUTH0ClientId`
- `AUTH0ClientSecret`
- `JwtSigningKey`
- `CustomDomainName`
- `CertificateArn`

## Remaining Operational Gaps

- Final rollback dry-run in non-production (documented in planning repo checklist, not yet executed).
- TI production validation still has an open launch blocker: public login entrypoint verification is failing in the planning repo checklist.
