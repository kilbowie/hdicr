# Legacy Archive

## 2026-04-19 - Consent policy legacy usage fallback removal

### Summary

Removed the consent policy legacy `usage` fallback path in enforcement logic. Enforcement now relies on canonical `mediaUsage` policy fields only.

### Removed legacy implementation

- Removed `policy.usage` fallback lookup in:
  - `services/consent-service/src/handlers/check-consent-enforcement.ts`

### Why removed

- Canonical policy schema is `mediaUsage`; legacy fallback caused dual-path policy interpretation.
- Eliminates ambiguity and enforces a single source of truth for consent decisions.

### Validation

- `pnpm -r type-check` passed for workspace projects.
