# OBSERVABILITY.md — Observability Design (P0-D4)

Status: Draft v0.1 (2026-08-30) for G0-8 review. Requirement baseline: SRS §16 (golden signals, room-offline detection <5 min, SEV-1 = live-event launch/sync impairment with 15-min response), NFR-AVL-01 (zero event-day error budget), NFR-SEC-04/06 (scan SLA, cross-event alerting). Lives in `Pmp-<env>-Observability` (alarms/dashboards) with metric emission owned by the services. Excluded: CI design (P0-D5).

## 1. Signals

**Golden signals per service** (api, web, workers, dispatcher, cron): request rate, error rate (5xx + structured app errors), latency P50/P95/P99, saturation (CPU/memory/task count vs max). Emitted via CloudWatch EMF from the app (structured JSON logs → metrics), following the RFPilot observability approach; Sentry for exception aggregation on api/web/workers and the Electron agent.

**Domain metrics** (custom, per event where applicable):

| Metric | Source | Feeds |
|---|---|---|
| `agent.heartbeat` (room, agent id, version, library hash) | Room Agent → agent API every 60s | Room-offline alarm, sync dashboard (M12) |
| `sync.lag_seconds` / `sync.pending_files` per room | manifest service | Readiness (OBJ-6) |
| `queue.waiting` / `queue.oldest_job_age` per BullMQ queue | worker exporter | Backlog alarms, worker autoscaling (EDGE_APP_TIER §3) |
| `outbox.oldest_unsent_age` / `outbox.depth` | dispatcher | Outbox alarms |
| `scan.duration_median` / `scan.queue_age` | scan worker | NFR-SEC-04 SLA |
| `upload.active` / `upload.resume_rate` | upload service | NFR-PERF-02 tracking |
| `security.cross_event_denials` | API middleware | NFR-SEC-06 alert |
| `audit.chain_verify_result` | nightly verify job | Integrity alarm |
| OBJ-1..7 instrumentation | per TRACEABILITY.md | Reports (M6-1), pilot evidence |

## 2. Alarms

Two severity lanes: **page** (on-call, 24/7 during events, business hours otherwise) and **notify** (Slack/email). Event-mode thresholds tighten automatically when any event is in its freeze window (the deploy-gate service exposes event-mode; alarm thresholds keyed off a CloudWatch composite switch).

| Alarm | Threshold (normal → event-mode) | Lane |
|---|---|---|
| Room agent offline | no heartbeat 3 min (detection <5 min requirement met with margin) | notify → **page** |
| Room readiness regression (ready→amber inside doors−60m) | any | **page** (event-mode only) |
| API 5xx rate | >2% 5 min → >0.5% 2 min | page |
| API latency P95 | >1.5s 10 min → >1s 5 min | notify → page |
| Auth/sync path errors (launch + sync endpoints) | any sustained 2 min during events (zero error budget) | **page** |
| `queue.oldest_job_age` | inspect >10 min; scan >60s median (SLA) | notify; scan → page |
| `outbox.oldest_unsent_age` | >2 min | page (dispatcher down = platform stalls) |
| Dispatcher/cron task count = 0 | 1 min | page |
| RDS: CPU >80% 15m, storage <20%, replica/failover events | — | notify/page |
| Redis failover / memory >75% | — | notify |
| S3 replication RTC missed threshold | any (DATA_TIER §4) | notify |
| Certificate expiry | <30 days | notify |
| `security.cross_event_denials` | ≥3 in 10 min per actor | page security lane |
| `audit.chain_verify_result` failure | any | page |
| WAF blocked spike on magic-link endpoints | 10× baseline | notify |
| Synthetic canaries (below) failing | 2 consecutive | page |

Composite "event-day readiness" alarm rolls up: all rooms' heartbeats, sync lag, scan SLA, api health — this is what the pre-doors certification (SRS §19) reads.

## 3. Synthetics

CloudWatch Synthetics canaries (staging + prod): staff login → event list; speaker magic-link resolve (test token) → portal load; upload preflight; agent API manifest fetch with test device credential. Run every 5 min, 1 min during event windows.

## 4. Logging

- Structured JSON logs everywhere (request id, actor, event id, room id where relevant); CloudWatch Logs with subscription to the access-logs bucket for archive; retention 13 months (security-relevant groups 3 years to match audit retention).
- Agent logs: local ring buffer (72h offline capable), shipped on reconnect via the reconciliation path (FR-SYNC-003) into a dedicated log group per environment — room debugging must work for offline periods after the fact.
- No PII or file content in logs; speaker identifiers are ids, never emails, in log lines (emails only in the comms audit trail).

## 5. Dashboards

1. **Event operations** (the one on screen during events): per-room heartbeat/readiness grid, sync lag, launch log tail, SRR queue depth, scan SLA, api golden signals.
2. **Platform health**: services, queues, outbox, DB/Redis/S3, canaries.
3. **Security**: cross-event denials, WAF, auth failures, audit verify status.
Sync Dashboard (M12) is product UI backed by the same domain metrics — one source of truth.

## 6. On-call & runbook hooks

- Paging via SNS → on-call rotation (tooling choice at G0-8: PagerDuty vs CloudWatch+phone tree). SEV-1 (launch/sync impairment during live event) response 15 min; every page alarm links its runbook (`docs/runbooks/`).
- During events: on-call staffed continuously, event-mode thresholds active, deploy freeze on (EDGE_APP_TIER §5).

## 7. Open items for G0-8

1. Paging tool selection (PagerDuty vs lighter-weight).
2. Whether OpenSearch is added for log search at scale or CloudWatch Logs Insights suffices for MVP (start with Logs Insights; revisit at pilot).
3. Agent-side crash telemetry: Sentry Electron SDK vs minimal custom reporter (decide with G0-1 PoC).
