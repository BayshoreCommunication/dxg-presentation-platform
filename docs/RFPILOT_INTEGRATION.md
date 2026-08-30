# RFPILOT_INTEGRATION.md — Product Boundary with RFPilot

Status: Draft v0.1 (2026-08-30). Positions marked **(proposed)** need confirmation with DXG/product; the prohibitions are firm.

## Hard rules

1. **No direct database access between RFPilot and the presentation platform, in either direction. Prohibited permanently.** All exchange is via versioned HTTP APIs or signed events.
2. Each product owns its own data stores, S3 buckets, queues, and AWS stacks. No shared infrastructure resources except (potentially) the identity provider.
3. Neither product's services hold credentials with write access to the other's stores.

## Identity

- **Shared IdP (proposed)**: DXG staff authenticate to both products through the same OIDC identity provider, giving shared SSO for staff. Each product maintains its own role/permission model — identity is shared, authorization is not.
- Speakers are presentation-platform-only (magic links); RFPilot vendors are RFPilot-only. No cross-product end-user identity.

## Data ownership

- **Client identity**: DXG operates both products for the same clients. Each product owns its own client records; a client may carry an optional `external_ref` to correlate. Neither product is authoritative over the other's client table **(proposed** — revisit if DXG asks for a shared client registry**)**.
- **Events**: the presentation platform owns presentation events end-to-end. RFPilot RFPs/proposals may *reference* a presentation event by ID but never create or mutate one directly.

## Event handoff (future, not MVP)

If DXG wins AV production work through RFPilot and wants a presentation event pre-created:

- RFPilot calls `POST /api/v1/events:import-handoff` (this platform's API) with a signed service token; payload carries client, venue, dates, and optionally schedule/room data.
- The call is **idempotent** (handoff ID as idempotency key); retries are safe; the response returns the created/existing event ID.
- Schedule/room exchange uses the same import pipeline as XLSX (FR-IMP-002 semantics: diff + update-by-key), so re-handoffs reconcile instead of duplicating.
- Reconciliation: a nightly (or on-demand) comparison report, never automatic silent mutation of committed schedules.
- Presentation results returning to RFPilot (e.g. event completion stats): **out of scope for MVP**; if added, RFPilot pulls via a read-scoped API, this platform pushes nothing.

## Authorization between systems

- Service-to-service calls use short-lived signed tokens (client-credentials OIDC or SigV4-style), scoped to the specific integration endpoints only — never staff-level tokens.
- Every cross-system call is audited on both sides (caller identity, handoff ID, outcome).

## Navigation

- Simple cross-links between the two web apps (event page ↔ related RFP), relying on shared SSO. No embedded UI.

## Contract versioning

- Integration endpoints live under the same `/api/v1/...` versioning policy as the rest of the platform; breaking changes require a new version with N/N-1 support during migration. Event/webhook payloads carry a `schema_version` field.

## MVP position

MVP ships with **no live integration** — only the shared-IdP decision (G0) and this boundary doc. The handoff API is designed (OpenAPI stub) but not built until DXG requests it.
