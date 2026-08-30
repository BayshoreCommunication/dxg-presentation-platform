# WORKFLOW_STATES.md — Domain Lifecycles

Status: Draft v0.1 for DXG sign-off (Phase 0 deliverable, task P0-C4).

The SRS's "19-state workflow" (FR-REV-002, M09) is **not** implemented as one database state field. It is decomposed into six independent lifecycles below; the UI derives a simplified overall presentation status from them (§8). Total distinct states across lifecycles: 24, of which the review/approval + processing pipeline presents the "19-state" configurable subset to reviewers.

Common rules for every lifecycle:

- **Transitions are the only write path.** Each lifecycle has a transition function that validates (current state, action, actor role, reason) and rejects illegal transitions with an explanation (SRS §9).
- **Audit**: every transition emits an audit record (actor, before/after state, reason, timestamp, entity IDs) into the hash-chained audit log. Overrides additionally require an authorized role + mandatory reason.
- **Idempotency**: transition requests carry an idempotency key (client-generated UUID). Replaying the same key returns the original result without re-transitioning. A request whose "from" state already equals the target and whose key matches is a no-op success; otherwise it's a conflict.
- **Optimistic locking**: every stateful row carries a `version` integer; transition requests must present the version they read. Mismatch → 409 with current state (the "two technicians update the same presentation" scenario, SRS §18 → merge prompt in UI).
- **Terminal vs reversible**: marked per state below. Terminal states can only be exited by an audited override where noted.

## 1. Upload/processing state (per FileVersion) — `processing_state`

Covers intake and quarantine before the version is usable (FR-FILE-002/003, NFR-SEC-04).

| State | Meaning | Terminal? |
|---|---|---|
| `uploading` | Multipart upload in progress (resumable) | no |
| `uploaded` | All parts received, checksum pending | no |
| `checksum_failed` | SHA-256 mismatch | yes (speaker must re-upload; new version) |
| `scanning` | Malware scan running | no |
| `quarantined` | Scan failed or engine unavailable | yes (release only via authorized override + reason; never silent) |
| `stored` | Verified + clean; version exists in library | yes (success terminal) |

Legal: `uploading→uploaded→scanning→stored`; `uploaded→checksum_failed`; `scanning→quarantined`. Invalid examples: `quarantined→stored` without override; anything skipping `scanning` (unscanned files never enter the library). Roles: system-driven; override release from `quarantined` requires Platform Admin. Scanner-failure behavior: scan errors (engine down, timeout) land in `quarantined`, not `stored` (fail closed).

## 2. Inspection state (per FileVersion) — `inspection_state`

FR-INSP-001..004. Starts automatically when `processing_state = stored`.

| State | Meaning | Terminal? |
|---|---|---|
| `pending` | Queued for tier-1 checks | no |
| `inspecting` | Checks running | no |
| `passed` | No findings above info; "pass with limitations" copy shown (FR-INSP-004) | yes |
| `passed_with_warnings` | Non-blocking findings | yes |
| `technician_review` | Findings need human judgment (corrupted, macros, linked media…) | no |
| `failed` | Blocking findings | yes (new version required, or waiver) |

Legal: `pending→inspecting→{passed, passed_with_warnings, technician_review, failed}`; `technician_review→{passed_with_warnings, failed}` (technician decision, reason required); waiver (FR-INSP-003) does not change state — it annotates a finding (visible forever, audited) and unblocks review eligibility. Re-upload creates a new FileVersion with a fresh inspection lifecycle. Roles: system; technician decisions require SRR Technician or above; waivers require Presentation Manager or above + reason.

## 3. Review/approval state (per FileVersion) — `review_state`

FR-REV-001..005. Eligible when inspection is in a terminal non-`failed` state (or `failed` fully waived).

| State | Meaning | Terminal? |
|---|---|---|
| `awaiting_review` | In reviewer queue (SLA aging from entry) | no |
| `in_review` | Claimed by a reviewer | no |
| `changes_requested` | Sent back; speaker-visible feedback | no |
| `approved` | Approved for room delivery | reversible |
| `superseded` | A newer version was approved | yes |
| `rejected` | Will not be used | yes (override to reopen) |
| `rolled_back` | Was approved, then rollback restored an earlier version | yes |

Legal: `awaiting_review→in_review→{approved, changes_requested, rejected}`; `changes_requested` resolves when a new version arrives (this version stays; new version starts its own lifecycles); `approved→superseded` (automatic when a newer version is approved); `approved→rolled_back` (FR-REV-005: byte-identical restore of a prior approved version, rooms notified). **Re-approval rule (FR-REV-004)**: a new version never affects room assignments until it independently reaches `approved` — enforced here plus in lifecycle §4. Invalid: `awaiting_review→approved` (skipping review) except via audited override (authorized role + reason); any transition on `superseded`. Roles: reviewer decisions require Content Reviewer or above; overrides and rollback require Presentation Manager or above + reason.

**Final onsite lock** (SRS §9): a boolean `final_locked` on the Talk (set in SRR at sign-off or by PM). When set, speaker-portal replacement is blocked; new versions can only originate in SRR. It is a flag, not a state — it composes with every review state.

**Restricted-from-distribution** is likewise an orthogonal flag on FileVersion/Talk (SRS §9) affecting search visibility, bulk download, and archive — never a workflow state.

## 4. Room assignment/sync state (per FileVersion × Room) — `room_sync_state`

FR-SYNC-001..003, FR-AGT-*. **Keyed by (file_version_id, room_id)** — one approved version has an independent sync state in each room it's assigned to. Room readiness (M12) aggregates these.

| State | Meaning | Terminal? |
|---|---|---|
| `assigned` | In the room's target manifest, not yet delivered | no |
| `syncing` | Agent downloading (resumable) | no |
| `synced` | Checksum-verified on the room machine | no |
| `acknowledged` | Room technician acknowledged a post-delivery change (FR-SYNC-002) | no |
| `active` | Current playable copy for its talk in this room | reversible |
| `obsolete` | Replaced/moved/canceled; retained locally until event close | yes |
| `sync_failed` | Download/verify failed; retry with alerting | no |

Legal: `assigned→syncing→synced`; `sync_failed→syncing` (retry); `synced→acknowledged→active` when the change requires acknowledgment, `synced→active` when it's the first delivery; `active→obsolete` (new version activated, session moved/canceled); rollback flips the prior version's row back from `obsolete→active` (audited, notified). Launch warns when the talk's room copy is not `active`+acknowledged. No partial file is ever visible: `synced` requires full checksum pass (SRS §18 scenario 1). Roles: agent/system transitions are machine-attributed (device credential); acknowledgment requires Room Technician; forced re-sync requires PM or Sync Dashboard operator.

## 5. Session/talk state (per Slot/Talk) — `session_state`

M03 schedule operations.

| State | Meaning | Terminal? |
|---|---|---|
| `scheduled` | Normal | no |
| `moved` | Room/time changed; file re-routing triggered (old room copies → `obsolete`) | no (returns to `scheduled` once re-routed) |
| `replaced` | Replacement speaker; assignment transferred, file history preserved (SRS §18) | no |
| `canceled` | Removed from room lists; files retained per archive rules | reversible (un-cancel via PM + reason) |
| `completed` | Session done (event-day) | yes |

Roles: schedule changes require PM; during event days, changes also fan out room notifications.

## 6. Archive-package state (per ArchivePackage) — `archive_state`

FR-ARCH-001..003.

| State | Meaning | Terminal? |
|---|---|---|
| `draft` | Scope selected | no |
| `building` | Worker assembling (approved-finals rule, exclusions, PDF conversion, manifest) | no |
| `ready` | Package + manifest complete | no |
| `delivered` | Expiring link issued; downloads logged | no |
| `expired` | Link lapsed | no |
| `deleted` | Certified deletion executed (see SECURITY_MODEL.md §retention) | yes (irreversible by design) |

Legal: `draft→building→ready→delivered→expired→deleted`; `building→draft` on failure with error report; re-issue link `expired→delivered` (audited). Legal hold blocks `→deleted` (see SECURITY_MODEL.md). Roles: build/deliver require PM; deletion requires Platform Admin + retention policy trigger.

## 7. The "19-state" reviewer pipeline mapping

The configurable pipeline the SRS describes (M09) is the reviewer-facing projection of lifecycles §1–§3: uploading, uploaded, checksum_failed, scanning, quarantined, stored, pending-inspection, inspecting, passed, passed_with_warnings, technician_review, failed, awaiting_review, in_review, changes_requested, approved, superseded, rejected, rolled_back — 19 states. "Configurable subset" (FR-REV-002) means an event can disable optional stops (e.g. technician_review auto-pass for trusted clients), never reorder or skip security-relevant states (§1 is never configurable).

## 8. UI-derived overall presentation status

The UI never stores a combined status; it derives one per talk, in priority order:

1. Any current version `quarantined`/`checksum_failed` → **Attention**
2. No file version at all → **Missing** (red as deadline nears)
3. Latest version in §1/§2 pipeline → **Processing**
4. Latest version `changes_requested`/`failed` → **Needs revision**
5. Approved version exists, any assigned room not `active` → **Approved — delivering** (room readiness amber)
6. Approved + all assigned rooms `active` (+acknowledged) → **Ready**
7. Session `canceled` → **Canceled**; event closed + archived → **Archived**

Room readiness (OBJ-6) = all talks in that room's upcoming sessions at "Ready", agent heartbeat fresh, no unacknowledged changes.
