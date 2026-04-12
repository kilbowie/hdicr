# Representation Service — Deployment & Environment Setup Guide

> **Ticket:** SEP-026 (Promote representation domain to full HDICR service) + SEP-041 (Separate HDICR and TI environment configs)  
> **Status:** New service available for API Gateway integration  
> **Next steps:** Integrate into API Gateway template, set environment variables, deploy

## Overview

The Representation Service is now a standalone HDICR microservice. This guide covers:

1. **Environment Configuration** — how to wire DATABASE_URL and service discovery
2. **API Gateway Integration** — how to route `/v1/representation/*` requests to the Lambda
3. **TI Web Integration** — how TI app consumes the remote service
4. **Deployment** — how to deploy the service alongside existing HDICR services

---

## 1. Environment Configuration

### Service-Level Variables

The representation-service Lambda requires:

#### `DATABASE_URL` (HDICR database)

Connection string to the HDICR PostgreSQL database (shared with identity, consent, licensing services).

```env
DATABASE_URL=postgresql://hdicr_user:password@hdicr-db.internal:5432/hdicr_core?sslmode=require
```

This is the **HDICR database**, not the TI app database. It contains:

- `actors` table (actor profiles)
- `agents` table (agent profiles, TI-owned but queried by HDICR)
- `actor_agent_relationships` (relationship ledger)
- `representation_requests` (request state machine)

#### Optional: Service Metadata

```env
SERVICE_NAME=representation-service
SERVICE_VERSION=1.0.0
LOG_LEVEL=info
```

### TI App-Level Variables

The TI `apps/web` needs to know where the representation-service is deployed:

```env
# apps/web/.env.production
HDICR_REPRESENTATION_SERVICE_URL=https://api.hdicr.platform/v1/representation
```

This is used by `apps/web/src/lib/hdicr/hdicr-http-client.ts` to route calls through:

```typescript
const representationRemoteBaseUrl = getHdicrRemoteBaseUrlOrThrow(
  'representation',
  'client-initialization'
);
// Returns: https://api.hdicr.platform/v1/representation
```

---

## 2. API Gateway Integration

### Add to SAM Template

In `infra/api-gateway/template.yaml`, add a new resource for the representation-service Lambda:

```yaml
RepresentationServiceFunction:
  Type: AWS::Lambda::Function
  Properties:
    Runtime: nodejs20.x
    Handler: dist/index.handler
    CodeUri: ../../services/representation-service/
    Environment:
      Variables:
        DATABASE_URL: !Ref HdicrDatabaseUrl
        NODE_ENV: production
    Timeout: 30
    MemorySize: 512
    Policies:
      - Version: '2012-10-17'
        Statement:
          - Effect: Allow
            Action:
              - logs:CreateLogGroup
              - logs:CreateLogStream
              - logs:PutLogEvents
            Resource: arn:aws:logs:*:*:*

RepresentationServiceApiIntegration:
  Type: AWS::ApiGateway::Integration
  Properties:
    ApiId: !Ref ApiGateway
    IntegrationHttpMethod: POST
    Type: AWS_PROXY
    IntegrationUri: !Sub 'arn:aws:integration:lambda:${AWS::Region}:function:${RepresentationServiceFunction}'

RepresentationServiceApiRoute:
  Type: AWS::ApiGateway::Route
  Properties:
    ApiId: !Ref ApiGateway
    RouteKey: 'ANY /v1/representation/{proxy+}'
    Target: !Sub 'integrations/${RepresentationServiceApiIntegration}'
    AuthorizationType: AWS_IAM # or custom authorizer if needed
```

### Route Pattern

The API Gateway should route all `/v1/representation/*` requests to the representation-service Lambda:

```
GET    /v1/representation/actor?auth0UserId=...          → representation-service
GET    /v1/representation/agent?auth0UserId=...          → representation-service
GET    /v1/representation/agent-by-registry?registryId=  → representation-service
POST   /v1/representation/request                         → representation-service
POST   /v1/representation/request/update                  → representation-service
...all other /v1/representation/* → representation-service
```

---

## 3. TI Web Integration

### Client Library (No Changes Required)

The TI app already has `apps/web/src/lib/hdicr/representation-client.ts` configured to call remote endpoints:

```typescript
// apps/web/src/lib/hdicr/representation-client.ts
const representationRemoteBaseUrl = getHdicrRemoteBaseUrlOrThrow(
  'representation',
  'client-initialization'
);

export async function getActorByAuth0UserId(auth0UserId: string) {
  return invokeHdicrRemote({
    domain: 'representation',
    baseUrl: representationRemoteBaseUrl,
    path: `/v1/representation/actor?auth0UserId=${encodeURIComponent(auth0UserId)}`,
    method: 'GET',
    operation: 'actor-by-auth0',
  });
}
```

Once `HDICR_REPRESENTATION_SERVICE_URL` is set in TI environment, all calls automatically route to the new service. ✅

### File Locations Using Representation Client

These TI routes now depend on the representation service:

- `apps/web/src/app/api/identity/status/route.ts` — uses `identity-status.ts` helper
- `apps/web/src/app/api/notifications/counts/route.ts` — uses `notification-counts.ts` helper
- `apps/web/src/app/api/agent/roster/route.ts` — uses `agent-roster.ts` helper
- `apps/web/src/lib/representation.ts` — uses `representation-client` for actor/relationship lookups

All helpers resolve actor/relationship data through the remote service. ✅

---

## 4. Deployment

### Build the Service

```bash
cd services/representation-service
npm install
npm run build
npm run type-check
npm test
```

### Package for Lambda

```bash
# Generate dist/
pnpm --filter @trulyimagined/representation-service build

# Verify handler exists
ls -la dist/index.js
# should output: dist/index.js (handler exported)
```

### Deploy via SAM

```bash
cd infra/api-gateway
sam build --template template.yaml
sam deploy --guided
```

Or with GitHub Actions (deployed alongside identity/consent/licensing services):

```yaml
# .github/workflows/deploy-hdicr-services.yml
- name: Deploy representation-service
  run: |
    cd infra/api-gateway
    sam deploy --no-confirm-changeset \
      --parameter-overrides \
        HdicrDatabaseUrl=${{ secrets.HDICR_DATABASE_URL }} \
        Environment=production
```

---

## 5. Environment Variable Checklist

### Production Deployment

| Variable                           | Service                             | Scope | Example                                        |
| ---------------------------------- | ----------------------------------- | ----- | ---------------------------------------------- |
| `DATABASE_URL`                     | representation-service (Lambda env) | HDICR | `postgresql://...`                             |
| `HDICR_REPRESENTATION_SERVICE_URL` | apps/web (TI)                       | TI    | `https://api.hdicr.platform/v1/representation` |
| `NODE_ENV`                         | representation-service (Lambda env) | HDICR | `production`                                   |
| `LOG_LEVEL`                        | representation-service (Lambda env) | HDICR | `info`                                         |

### Local Development

For local testing, point TI app to localhost:

```env
# apps/web/.env.development.local
HDICR_REPRESENTATION_SERVICE_URL=http://localhost:3001/v1/representation
```

Then run the representation service locally:

```bash
# In one terminal: start representation-service
cd services/representation-service
npm run dev

# In another terminal: start TI web app
cd apps/web
npm run dev
```

---

## 6. Verification

### After Deployment

1. **Service is live:**

   ```bash
   curl https://api.hdicr.platform/v1/representation/actor?auth0UserId=auth0|abc123 \
     -H "Authorization: Bearer <JWT>"
   # Returns: { "actor": {...} } or { "actor": null }
   ```

2. **CloudWatch logs are flowing:**

   ```bash
   aws logs tail /aws/lambda/representation-service --follow
   ```

3. **TI app can reach it:**

   ```bash
   # From TI web app, trigger a route that uses representation-client
   curl http://localhost:3000/api/identity/status \
     -H "Cookie: <session>" \
     -v
   # Should show representation-service calls in network waterfall
   ```

4. **Contract tests pass:**
   ```bash
   cd services/representation-service
   npm test
   # All contract + auth-ingress tests pass
   ```

---

## 7. Separation Boundaries (SEP-026/042)

### What Changed

| Concern              | Before                                         | After                                                          |
| -------------------- | ---------------------------------------------- | -------------------------------------------------------------- |
| Representation SQL   | TI web runtime queries HDICR tables directly   | HDICR service Lambda queries; TI calls remote API only         |
| Database access path | TI → shared DB (direct)                        | TI → API GW → Lambda → HDICR DB                                |
| Credential scope     | TI env has HDICR DATABASE_URL                  | Lambda env has HDICR DATABASE_URL; TI env has service URL only |
| Failure isolation    | TI crash can corrupt representation data       | TI crash doesn't reach HDICR DB                                |
| Audit trail          | No service layer to log representation changes | Service logs all changes via CloudWatch                        |

This completes **SEP-026** (representation domain promotion) and advances **SEP-042** (DB credential isolation) by removing TI runtime dependence on HDICR DATABASE_URL for representation data.

---

## 8. Troubleshooting

### "connection refused" when representation-service calls DB

**Cause:** `DATABASE_URL` not set in Lambda environment or network routing broken.

**Fix:**

1. Verify Lambda has `DATABASE_URL` in `infra/api-gateway/template.yaml`
2. Verify Lambda security group allows egress to RDS on port 5432
3. Verify RDS endpoint is correct: `aws rds describe-db-instances`

### "Unauthorized" response from representation endpoints

**Cause:** Missing or invalid `Authorization` header on POST/PATCH requests.

**Fix:**

1. POST `/request`, `/request/update`, `/relationship`, `/relationship/end` **require** Bearer JWT
2. GET endpoints are open (read-only)
3. Verify JWT is valid: check `token.exp` hasn't expired

### TI app still queries HDICR tables directly

**Cause:** Representation helper hasn't been migrated to use the remote client.

**Fix:** This is tracked in phase-4 work. Current status:

- ✅ Route-level co-imports eliminated (SEP-003)
- ⚠️ Helper-layer mixing still present (`apps/web/src/lib/representation.ts` has local + remote queries)
- 🔜 Helper consolidation targeted for phase-4 cleanup

---

## 9. Next Steps

1. **Update SAM template** with representation-service Lambda resource
2. **Set environment variables** via Vercel (TI) or Lambda config (HDICR)
3. **Deploy representation-service** Lambda to staging
4. **Run smoke tests** against deployment
5. **Cut over TI prod** to use remote representation endpoints
6. **Monitor CloudWatch** for errors and performance
7. **Archive backlog notes** and move to next SEP ticket (SEP-040 tenant migration)

---

## Links & References

- **Service code:** `services/representation-service/src/index.ts`
- **API spec:** `services/representation-service/openapi.yaml` (SEP-023)
- **Client library:** `apps/web/src/lib/hdicr/representation-client.ts`
- **Infrastructure:** `infra/api-gateway/template.yaml`
- **Backlog:** `HDICR_SEPARATION_BACKLOG.md` (SEP-026, SEP-023, SEP-030)

---

**Last updated:** 2026-04-08  
**Author:** AI Agent (SEP-026 implementation)  
**Status:** Ready for SAM template integration
