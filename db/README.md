# db/ — Physical Schema (P0-C1, gate G0-3)

Ordered PostgreSQL migrations covering every SRS §10 entity, the WORKFLOW_STATES.md lifecycles, and the RLS tenant boundary. These migrations move into the backend repo's migration runner when it is scaffolded (post-G0); order and content are the source of truth until then.

| Migration | Contents |
|---|---|
| `001_foundations.sql` | Extensions, `pmp` schema, tenant-context functions, idempotency keys, transactional outbox |
| `002_identity_events_schedule.sql` | Clients, users, client grants, event roles, venues, events, rooms/tracks/days/sessions/slots, speakers, assignments, hashed speaker tokens |
| `003_files_workflow_sync.sql` | Files/file_versions (processing/inspection/review state columns), inspection findings + waivers, workflow-transition journal, comment lanes, room agents, **room_files (per version × room sync state)**, sync manifests, launch logs (replay-dedup), SRR check-ins/USB/sign-offs/receipts |
| `004_comms_archive_audit.sql` | Communication templates/messages/webhook events, schedule imports, retention policies, legal holds, archive packages/downloads, derived_objects, report exports, **hash-chained append-only audit** (UPDATE/DELETE rejected by trigger) |
| `005_rls.sql` | `pmp_app` role (no BYPASSRLS), FORCE RLS + client-isolation policies on all tenant tables, append-only grants |

Conventions: uuid PKs, `lock_version` optimistic locking on stateful rows, text+CHECK lifecycle states (configurable subsets, no PG enums), `client_id`/`event_id` on tenant rows, timestamptz.

## Verify (G0-3 check)

```bash
docker run -d --rm --name pmp-schema-test -e POSTGRES_PASSWORD=test -e POSTGRES_USER=pmp -e POSTGRES_DB=pmp_test postgres:16-alpine
for f in db/migrations/*.sql; do docker exec -i pmp-schema-test psql -U pmp -d pmp_test -v ON_ERROR_STOP=1 -q < "$f" || break; done
docker stop pmp-schema-test
```

Verified 2026-08-30 on postgres:16-alpine — all 5 apply cleanly (41 tables, 40 policies); smoke-tested: RLS client isolation, platform context, audit append-only rejection.

## Known follow-ups

- `users`/`event_roles`/`venues` RLS is a permissive placeholder until the permission matrix (P0-E8) is signed off — tightening is a planned migration.
- Partition strategy for `launch_logs`/`audit_records` revisited at pilot scale.
- Event-configurable workflow subsets (FR-REV-002) live in `events.settings`; validation in app layer.
