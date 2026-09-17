# DEVELOPMENT.md — running the platform locally

Status: M0 in progress. What exists today is the backend spine — domain state machines, the
database layer, and a thin API slice that proves the approval → room-delivery chain end to end.
There is **no UI yet**: the frontend is blocked on the visual-acceptance gate (`docs/VISUAL_ACCEPTANCE.md` §3).
For a client walkthrough, use `prototype/enhanced.html` (17 screens + the 19-step demo).

## Prerequisites

Node 24+, Docker Desktop running.

## First run

```bash
npm ci
npm run db:up          # postgres :5434, redis :6380
npm run db:migrate     # applies db/migrations in order (idempotent)
npm run db:seed        # synthetic MedTech Forward 2026 fixture — no real content
npm run dev:api        # http://localhost:4000
```

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
