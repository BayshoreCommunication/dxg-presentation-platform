# DEVELOPMENT.md — running the platform locally

Status: M0 in progress. The backend spine (domain state machines, database layer, API) and
**four working Control Center screens** exist: Portfolio, Command center, Review & approval and
Room sync — running on real data, not fixtures in the browser.

The other thirteen screens are still prototype-only (`prototype/enhanced.html`).

## Prerequisites

Node 24+, Docker Desktop running.

## First run

```bash
npm ci
npm run db:up          # postgres :5434, redis :6380
npm run db:migrate     # applies db/migrations in order (idempotent)
npm run db:seed        # synthetic MedTech Forward 2026 fixture — no real content
npm run db:heartbeat   # marks room agents as freshly online
npm run dev            # api on :4000 and the control center on :3000
```

Open http://localhost:3000.

## Demo script (≈3 minutes)

`npm run demo:reset` puts the data back to its starting state, so the walkthrough can be
repeated as often as needed.

1. **Portfolio** (`/`) — the event, its collection percentage and unresolved-warning count,
   all computed from the database.
2. **Command center** (`Open →`) — KPI row, today's risk list and room readiness. Every status
   pill is derived by `packages/domain`, the same code the API and reports use. Room readiness
   combines file state with agent heartbeat freshness: it is computed, never asserted.
3. **Review & approval** — pick the talk with the HEVC codec warning. The finding, its slide
   reference and the suggested fix come from `inspection_findings`. Press **A** (or the Approve
   button).
   - The toast reports how many rooms the delta manifest was queued for.
   - Behind that one click: the previous approved version was superseded, a `room_files` row was
     queued for the room, `sync.rebuild_manifest` and `file_version.state_changed` went to the
     outbox, and a workflow transition plus a hash-chained audit record were written — one
     transaction, all or nothing.
4. **Back to the Command center** — Approved has incremented and the talk now reads
   *Approved — delivering*. Nothing was hand-updated; the status is recomputed from the data.
5. **Room sync** — the same readiness, per room.

Worth saying out loud during the demo: the rules being enforced are the ones that matter
onsite. Try to approve something before claiming it and the API refuses with
*"Cannot approve while review is Submitted. Allowed: claim."* Act on a stale copy and it
returns a conflict rather than overwriting someone else's decision. Sign in as a client admin
and approval is forbidden. An `UPDATE` on the audit log is rejected by the database itself.

## Verification

```bash
npm run ci             # lint + type-check + tests (51 domain tests today)
```

## Trying the API

The dev user is chosen with an `x-dev-user` header: `pm`, `reviewer`, `room_tech`, `client`
(an M0 stand-in for OIDC — M1-1 replaces it).

```bash
EV=22222222-2222-4222-8222-222222222222

curl -s localhost:4000/ops/health
curl -s "http://localhost:4000/api/v1/events/$EV/talks"          # status derived by @pmp/domain
curl -s "http://localhost:4000/api/v1/events/$EV/audit:verify"   # hash-chain verification
```

The review decision, with optimistic locking and role gates:

```bash
VID=<a file_version id>
curl -s -X POST "http://localhost:4000/api/v1/file-versions/$VID:transition" \
  -H 'content-type: application/json' -H 'x-dev-user: reviewer' \
  -d '{"action":"claim","lock_version":0}'
```

Approving fans out: the previous approved version is superseded, a `room_files` row is queued
for each room, `sync.rebuild_manifest` and `file_version.state_changed` land in the outbox, a
workflow transition and a hash-chained audit record are written — all in one transaction.

## What each package is

| Path | Contents |
|---|---|
| `packages/domain` | Pure domain: the six lifecycles, the transition engine, derived status. No I/O. |
| `packages/db` | Pool, RLS scope helper (`withScope`), migration runner, seed, hash-chained audit. |
| `apps/api` | Express 5 slice: health, events, talks, review transition, audit verify. |

## Notes

- `withScope` opens a transaction and sets `app.user_id` / `app.client_id` / `app.event_id`, so
  RLS isolation is enforced by Postgres rather than by remembering a WHERE clause.
- `audit_records` is append-only at the database level: an UPDATE is rejected by a trigger even
  for the superuser. Tampering is therefore not something the application has to prevent.
- API actions use the `:action` suffix from `api/openapi.yaml`; the colon is not a path
  separator, so the segment is split in `apps/api/src/index.ts`.
