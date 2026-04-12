# Representation Service

> **Status:** SEP-026 — Promote representation domain to full HDICR service  
> **Phase:** 2 (API consolidation)  
> **Priority:** P2  
> **Audience:** HDICR platform engineers

## Overview

The Representation Service is an HDICR domain service that manages actor-agent representation relationships, including:

- **Actor & Agent Lookups** — retrieve identity profiles by auth0UserId or registry ID
- **Representation Requests** — submission, approval, rejection, and withdrawal of representation requests
- **Relationships** — creation, active state tracking, and termination of actor-agent relationships

## Ownership and Deployment Boundary

- **Service owner:** HDICR domain
- **Database owner:** HDICR (`representation_requests`, `actor_agent_relationships`)
- **Deployment rule:** this service must run with HDICR DB credentials only (`HDICR_DATABASE_URL` / `DATABASE_URL` mapped to HDICR DB)
- **TI integration rule:** TI app must consume representation data via HTTP endpoints, not direct SQL against representation tables

## Endpoints

### GET `/v1/representation/actor`

Retrieve actor by Auth0 user ID.

**Query Parameters**

- `auth0UserId` (string, required) — Auth0 user ID

**Response**

```json
{
  "actor": {
    "id": "uuid",
    "auth0_user_id": "auth0|...",
    "email": "user@example.com",
    "name": "Actor Name",
    "created_at": "2026-04-08T..."
  }
}
```

### GET `/v1/representation/agent`

Retrieve agent by Auth0 user ID.

**Query Parameters**

- `auth0UserId` (string, required) — Auth0 user ID

**Response**

```json
{
  "agent": {
    "id": "uuid",
    "auth0_user_id": "auth0|...",
    "registry_id": "REG-...",
    "agency_name": "Agency Name",
    "verification_status": "verified" | "pending",
    "profile_completed": true | false
  }
}
```

### GET `/v1/representation/active`

Get active representation relationship for an actor.

**Query Parameters**

- `actorId` (string, required) — Actor ID

**Response**

```json
{
  "relationship": {
    "id": "uuid",
    "actor_id": "uuid",
    "agent_id": "uuid",
    "started_at": "2026-04-08T...",
    "registry_id": "REG-...",
    "agency_name": "Agency Name",
    "verification_status": "verified",
    "profile_image_url": "https://...",
    "location": "City, State",
    "website_url": "https://..."
  }
}
```

### GET `/v1/representation/agent-by-registry`

Retrieve agent by registry ID.

**Query Parameters**

- `registryId` (string, required) — Agent registry ID

**Response**

```json
{
  "agent": {
    "id": "uuid",
    "auth0_user_id": "auth0|...",
    "registry_id": "REG-...",
    "agency_name": "Agency Name",
    "verification_status": "verified",
    "profile_completed": true
  }
}
```

### GET `/v1/representation/request/pending`

Check if there is a pending representation request between two profiles.

**Query Parameters**

- `actorId` (string, required) — Actor ID
- `agentId` (string, required) — Agent ID

**Response**

```json
{
  "pending": true | false
}
```

### POST `/v1/representation/request`

Create a new representation request.

**Authentication:** Required (JWT)

**Body**

```json
{
  "actorId": "uuid",
  "agentId": "uuid",
  "message": "Optional request message"
}
```

**Response**

```json
{
  "request": {
    "id": "uuid",
    "actor_id": "uuid",
    "agent_id": "uuid",
    "message": "...",
    "status": "pending",
    "created_at": "2026-04-08T..."
  }
}
```

### GET `/v1/representation/requests/incoming`

List incoming representation requests for an agent.

**Query Parameters**

- `agentId` (string, required) — Agent ID

**Response**

```json
{
  "requests": [
    {
      "id": "uuid",
      "actor_id": "uuid",
      "agent_id": "uuid",
      "message": "...",
      "status": "pending" | "approved" | "rejected",
      "created_at": "2026-04-08T..."
    }
  ]
}
```

### GET `/v1/representation/requests/outgoing`

List outgoing representation requests from an actor.

**Query Parameters**

- `actorId` (string, required) — Actor ID

**Response**

```json
{
  "requests": [
    {
      "id": "uuid",
      "actor_id": "uuid",
      "agent_id": "uuid",
      "status": "pending" | "approved" | "rejected",
      "created_at": "2026-04-08T..."
    }
  ]
}
```

### GET `/v1/representation/request`

Get representation request by ID.

**Query Parameters**

- `id` (string, required) — Request ID

**Response**

```json
{
  "request": {
    "id": "uuid",
    "actor_id": "uuid",
    "agent_id": "uuid",
    "status": "pending",
    "created_at": "2026-04-08T..."
  }
}
```

### POST `/v1/representation/request/update`

Update representation request status (approve/reject/withdraw).

**Authentication:** Required (JWT)

**Body**

```json
{
  "requestId": "uuid",
  "action": "approve" | "reject" | "withdraw",
  "responseNote": "Optional agent response note"
}
```

**Response**

```json
{
  "request": {
    "id": "uuid",
    "status": "approved" | "rejected",
    "response_note": "...",
    "updated_at": "2026-04-08T..."
  }
}
```

### GET `/v1/representation/relationship/active`

Check if an actor has an active representation relationship.

**Query Parameters**

- `actorId` (string, required) — Actor ID

**Response**

```json
{
  "active": true | false
}
```

### POST `/v1/representation/relationship`

Create a new actor-agent relationship after a request is approved.

**Authentication:** Required (JWT)

**Body**

```json
{
  "actorId": "uuid",
  "agentId": "uuid",
  "representationRequestId": "uuid"
}
```

**Response**

```json
{
  "success": true
}
```

### GET `/v1/representation/relationship`

Get actor-agent relationship by ID.

**Query Parameters**

- `id` (string, required) — Relationship ID

**Response**

```json
{
  "relationship": {
    "id": "uuid",
    "actor_id": "uuid",
    "agent_id": "uuid",
    "started_at": "2026-04-08T...",
    "ended_at": null,
    "created_at": "2026-04-08T..."
  }
}
```

### POST `/v1/representation/relationship/end`

End an actor-agent relationship.

**Authentication:** Required (JWT)

**Body**

```json
{
  "relationshipId": "uuid",
  "endedByAuth0UserId": "auth0|...",
  "endedBy": "actor" | "agent"
}
```

**Response**

```json
{
  "relationship": {
    "id": "uuid",
    "ended_at": "2026-04-08T...",
    "ended_by": "actor" | "agent"
  }
}
```

## Configuration

### Environment Variables

- `HDICR_REPRESENTATION_SERVICE_URL` — URL where this service is deployed (e.g., `https://representation.hdicr.example.com`)
- `DATABASE_URL` — HDICR PostgreSQL database connection string

### Database

Requires the following tables (present in shared HDICR database):

- `actors` — HDICR actor registry
- `agents` — Agent profiles (TI-owned, mapped by auth0_user_id)
- `actor_agent_relationships` — Representation relationship ledger
- `representation_requests` — Request state machine

## Separation Boundary (SEP-026)

This service encapsulates all HDICR representation logic. TI web application must:

1. **Never** query representation tables directly
2. **Always** invoke this service via HTTP APIs
3. **Only** authenticate via JWT provided by Auth0
4. Treat all responses as untrusted until validated

## Testing

```bash
npm test
```

Includes:

- Auth ingress tests (SEP-030)
- Request validation tests
- Response shape contract tests

## Deployment

```bash
npm run build
npm run type-check
```

Deploy as AWS Lambda behind API Gateway with `/v1/representation` route prefix.

## Tickets & References

- **SEP-023** — Define OpenAPI spec (see `openapi.yaml`)
- **SEP-026** — Promote representation domain (this ticket)
- **SEP-030** — JWT validation at ingress (implemented)
- **SEP-031** — OAuth 2.1 client credentials (upstream concern)
- **SEP-042** — DB credential isolation (depends on this service being used)
