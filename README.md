# hdicr

Production HDICR API service repository.

## Current Readiness Status (2026-04-20)

- Architecture boundary: HDICR remains payment-agnostic and identity/consent/licensing focused.
- Service split: identity, consent, licensing, and representation services are independently buildable and testable.
- Secrets hygiene: Stripe payment/webhook secret mappings were removed from HDICR shared secret name mapping.
- Deployment contract: AWS SAM template exists at `infra/template.yaml` with custom domain and API mapping.

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
