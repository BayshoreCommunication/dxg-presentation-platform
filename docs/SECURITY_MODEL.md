# SECURITY_MODEL.md — Security Architecture

Status: Draft v0.1 (2026-08-30). The G0-5 threat-model workshop refines this; SRS NFR-SEC-* / NFR-PRIV-* / NFR-RET-* are the requirement baseline.

## 1. Tenant isolation (client/event)

- Every domain row carries `client_id` and (where applicable) `event_id`. PostgreSQL **RLS policies** enforce isolation; the API sets session context (`SET LOCAL app.client_id / app.event_id / app.user_id`) per request inside a transaction — following RFPilot's tenant-RLS pattern. No query path bypasses RLS except migration/admin tooling with a distinct role.
- Access is event-scoped and least-privilege (SRS §5). Client grants give client-admins visibility into only their own events.
- **Cross-event attempts**: RLS denials on explicitly-addressed foreign resources are logged with actor + target and raise an alert (NFR-SEC-06); repeated attempts flag the account.

## 2. Authentication

- **Staff**: OIDC with MFA mandatory for all DXG roles (NFR-SEC-02). Idle timeout 12h, absolute 24h.
- **Speakers**: passwordless magic links + one-time-code fallback. Tokens are single-purpose, bound to a specific recipient (speaker + talk scope), stored **hashed** (never plaintext), revocable, expiry ≤30 days; portal session 24h. A forwarded link grants only that speaker's scope; suspicious-use signals (many IPs/geos) surface to admins.
- **Room Agents**: registration via room code issued by a PM; the agent generates a device keypair, registration binds device fingerprint + public key to the room, subsequent calls are signed with the device credential. >1 active agent per room warns (FR-AGT-001). Credentials are revocable per device.

## 3. File trust boundaries

Uploaded content is **untrusted data** at every stage:

- **Signed URLs**: uploads and downloads use short-lived signed URLs — downloads ≤15 min, archive links ≤7 days (NFR-SEC-05). No public ACLs anywhere.
- **Quarantine pipeline**: every ingested file (portal upload *and* SRR USB intake) is scanned before entering any library; quarantine SLA <60s median (NFR-SEC-04). **Scanner failure fails closed**: engine down/timeout → `quarantined`, never `stored`; prior approved version is preserved.
- **Macro policy**: macro-enabled decks are flagged by inspection (FR-INSP-002); macros are disabled at playback (agent launches with macro execution off). Waiving the macro finding requires Platform Admin.
- **External links**: detected and reported by inspection; the agent never auto-opens external links; room machines are expected offline during playback anyway.
- Inspection/preview/PDF workers run in isolated containers with no credentials beyond their scoped S3 prefix and no outbound network (except scanner definition updates).

## 4. Agent update integrity

- Agent binaries are code-signed; MSI signed; auto-update verifies signatures before applying. Stable + event-pinned channels; silent updates disabled during active events; rollback to previous version supported; API keeps N/N-1 compatibility (design finalized at G0-1b).

## 5. Audit chain

- Append-only audit table; each record includes `prev_hash` and `record_hash` (SHA-256 over canonical serialization + previous hash). **Concurrency**: chain append is serialized per event partition via a per-partition advisory lock (or single-writer outbox consumer) so hashes never fork; writes are in the same transaction as the audited mutation.
- Integrity verification endpoint re-walks the chain (FR-ADMIN-002). Retention ≥3 years; admin actions 100% covered (NFR-SEC-07). Audit records contain references, not file content.

## 6. Retention, deletion, and S3 versioning

Certified deletion (FR-ARCH-003, NFR-RET-01) must actually remove content despite S3 versioning and replication. Deletion of a file (or event package) removes, within 24h of retention expiry:

1. Current S3 object **and all noncurrent versions** (versioned bucket: enumerate + delete every version ID, then the delete markers).
2. **Replicated copies** in the cross-region bucket (replica bucket processed by the same deletion worker; replication of deletes alone is insufficient for versioned replicas — versions are enumerated and removed there too).
3. **Derivatives**: preview images, converted PDFs, inspection artifacts/extracted media — all derivative keys are tracked in a `derived_objects` table at creation time so deletion is enumerable, not best-effort.
4. **Room-agent cached copies** where operationally possible: a purge instruction enters each affected room's manifest; agents confirm purge on next sync; unreachable agents are listed as exceptions in the certificate.
5. **Database metadata containing PII**: speaker PII fields nulled/tombstoned; checksums and audit references retained (audit chain keeps hashes, not content or PII beyond actor IDs).

**Legal hold**: a hold flag on Event/Talk/File blocks every deletion path (retention worker skips + logs); holds require Platform Admin + reason, are audited, and appear in retention reports. Deletion resumes only when the hold is lifted.

**Deletion certificate**: generated per execution — scope, policy/trigger, timestamp, per-object results (bucket/key/version counts deleted, replica results, derivative counts, DB rows affected), agent purge confirmations and exceptions, operator/system identity, and the certificate's own hash entered into the audit chain.

**PII deletion requests** (NFR-PRIV-01): verified speaker requests honored within 30 days post-retention via the same machinery, scoped to the speaker.

## 7. Secrets management

- AWS Secrets Manager for all service credentials; no secrets in env files in repos, CI logs, or agent binaries. Runtime resolution follows the workspace's `asm-exec`/resolve pattern. Agent device keys live in Windows DPAPI-protected storage. KMS keys per environment; S3 + RDS + backups encrypted (NFR-SEC-01: TLS 1.2+ in transit, AES-256/KMS at rest).

## 8. Permission regression

- The role × permission matrix (G0-5) is encoded as a test suite; CI requires ≥95% coverage of policy-code branches (NFR-SEC-03) and runs the cross-event denial suite.

## 9. Incident response

- SEV-1 = any live-event impairment of launch or sync; 15-minute response target; on-call during events (SRS §16). Runbooks: cloud outage during event (agents/SRR local modes), scanner outage (fail-closed queue drain), suspected content breach (revoke links, rotate keys, audit export), agent compromise (revoke device credential, force re-register). Production is change-frozen during active events.

## 10. Threat model

G0-5 workshop output lands here: data-flow diagram, STRIDE-lite table per trust boundary (browser↔API, speaker link, USB intake, agent↔cloud, workers↔S3, RFPilot boundary), with mitigations mapped to the sections above.
