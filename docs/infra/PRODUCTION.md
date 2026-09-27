# Production — one server (runbook)

Status: **deployed 2026-09-27** (commit `35932fa`) to account 295229565954, us-east-2 — Lightsail
`pmp-prod` (4 GB, static IP `3.146.210.9`), S3 `dxg-pmp-files-295229565954`, IAM user `pmp-server`. DNS for
av-rfpilot.com is at **GoDaddy**, not Route 53. Code is at `/opt/pmp` on the server (a `git archive` of the
commit, not a clone — the server has no GitHub access); SSH as `ubuntu@3.146.210.9`, allowed only from the
deploying machine's IP. Updating: `git archive HEAD` → copy → extract over `/opt/pmp` → §6.

Target: DXG staff, their client admins and their speakers, for DXG's events. Accounts are created
by DXG (no public sign-up).

| Address | What |
|---|---|
| `https://pmp.av-rfpilot.com` | Control center (staff, client admins), API under `/api` |
| `https://speakers.av-rfpilot.com` | Speaker portal, API under `/api` |

## 1. Shape

One Linux server running Docker Compose (`deploy/server/docker-compose.yml`):

```
            Internet ── 80/443 ──▶ caddy ──┬─▶ staff    (Next.js, :3000)
                                            ├─▶ portal   (Next.js, :3001)
                                            └─▶ api      (/api/*, :4000) ──┬─▶ postgres (volume)
                                                                          ├─▶ clamav   (virus scan)
             dispatcher (outbox → SES) ─────────────────────────────────── ├─▶ S3       (files, backups)
             backup (nightly pg_dump → S3)                                 └─▶ SES      (email)
```

Only Caddy is published. It obtains and renews TLS certificates itself (Let's Encrypt), adds HSTS
and security headers, and replaces `X-Forwarded-For` with the address it saw. Each app and its API
share one origin, so the staff cookie (`pmp_session`) and the speaker cookie (`pmp_presenter`) each
stay on their own site, and the browser never makes a cross-site call.

Inside the API: PDF previews (LibreOffice, in the API image) and automatic reminders run in-process.
That is correct for one API instance; running several needs the planned worker (not built).

## 2. Cost (estimate, us-east-2)

| Item | Monthly |
|---|---|
| Server: Lightsail 8 GB / 2 vCPU (or EC2 t3.large) — ClamAV alone needs ~1.5 GB, LibreOffice and two Next servers the rest | ~$44 (Lightsail) |
| S3: presentations + PDFs + archives + 30 days of backups, a few GB–tens of GB | ~$1–5 |
| SES: $0.10 per 1,000 emails | <$1 |
| Data transfer out beyond the Lightsail allowance | usually $0 |
| **Total** | **≈ $50 / month** |

4 GB works for a pilot if ClamAV's memory is watched; below that, ClamAV will be killed.

## 3. One-time AWS setup (a person runs these; nothing is created by the code)

Use the `rfpilot` AWS profile (the account where SES for av-rfpilot.com lives), region `us-east-2`.

1. **S3 bucket** — private, versioned, encrypted, with backups expiring:
   ```bash
   aws s3api create-bucket --bucket <bucket> --region us-east-2 --create-bucket-configuration LocationConstraint=us-east-2
   aws s3api put-public-access-block --bucket <bucket> --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
   aws s3api put-bucket-versioning --bucket <bucket> --versioning-configuration Status=Enabled
   aws s3api put-bucket-encryption --bucket <bucket> --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
   aws s3api put-bucket-lifecycle-configuration --bucket <bucket> --lifecycle-configuration '{"Rules":[{"ID":"backups-30d","Filter":{"Prefix":"backups/"},"Status":"Enabled","Expiration":{"Days":30},"NoncurrentVersionExpiration":{"NoncurrentDays":30}}]}'
   ```
   Retention of presentations follows the product's own rules (archive, deletion); do not add a
   lifecycle rule for anything but `backups/`.
2. **IAM user for the server** with only: `s3:GetObject`, `s3:PutObject`, `s3:ListBucket` on the bucket,
   and `ses:SendEmail` / `ses:SendRawEmail` for `noreply@av-rfpilot.com` with configuration set
   `pmp-email`. Create an access key; it goes in the server's `.env` only.
3. **SES** — `av-rfpilot.com` is already verified with production access in `us-east-2`. For delivery,
   bounce and complaint events: an SNS topic subscribed to the `pmp-email` configuration set's event
   destination, with an HTTPS subscription to `https://pmp.av-rfpilot.com/api/v1/webhooks/email`
   (after the server is up; the API confirms the subscription and verifies every message's
   signature). Put the topic ARN in `SNS_TOPIC_ARNS`. Bounces then suppress the address for good
   (D-097).
4. **Server** — Lightsail (or EC2) Ubuntu 24.04, 8 GB, static IP, firewall open to 22 (your IP only),
   80 and 443. Install Docker Engine + the compose plugin.
5. **DNS** — `A` records for `pmp.av-rfpilot.com` and `speakers.av-rfpilot.com` → the static IP
   (`AAAA` too if the server has IPv6). Caddy cannot obtain certificates until these resolve.

## 4. First deploy

```bash
git clone git@github.com:BayshoreCommunication/dxg-presentation-platform.git && cd dxg-presentation-platform/deploy/server
cp .env.example .env            # fill in every value (§5)
docker compose build
docker compose up -d postgres clamav     # ClamAV downloads ~300 MB of signatures on first start
docker compose --profile ops run --rm migrate
docker compose run --rm --no-deps --entrypoint node api scripts/bootstrapAdmin.ts \
  --email <first admin's work email> --name "<Name>" \
  --client "<first client>" --event "<first event>" --starts YYYY-MM-DD --ends YYYY-MM-DD --timezone America/New_York
docker compose up -d
```

The bootstrap prints a **one-time password** — hand it over directly, never by email. First sign-in
forces a new password and authenticator enrolment. It refuses to run once any platform admin exists.
**Never run `db:seed` in production** — it is demo data.

Check: `https://pmp.av-rfpilot.com/login` and `https://speakers.av-rfpilot.com/login` load with a valid
certificate; `https://pmp.av-rfpilot.com/ops/health` returns `{"status":"ok","database":"up"}`.

## 5. Settings (`deploy/server/.env`)

`deploy/server/.env.example` lists every value. The API **refuses to start** in production if any
of these is missing or unsafe (`apps/api/src/config.ts`): https `STAFF_BASE`/`PORTAL_BASE`,
`PGHOST`/`PGPASSWORD`, `FILE_STORAGE=s3` + `S3_BUCKET`, `CLAMAV_HOST`, `MAIL_TRANSPORT=ses` +
`MAIL_FROM`, `TRUST_PROXY=1`, and no `DEV_MFA_SECRET`. Compose derives most of them from the few
values in `.env`.

Optional: `AUTH_RATE_LIMIT` (sign-in attempts per address per 5 minutes, default 30 in production),
`REMINDERS_DISABLED=1`, `EMAIL_DNS_CHECK=0`, `CORS_ORIGINS` (extra allowed origins).

## 6. Updating

```bash
cd dxg-presentation-platform && git pull
cd deploy/server && docker compose build
docker compose --profile ops run --rm migrate      # migrations are forward-only and idempotent
docker compose up -d                                # recreates changed services; ~seconds of downtime
```
The API drains in-flight requests on SIGTERM before exiting.

## 7. Backups and restore

- **Database** — `backup` dumps nightly (hour `BACKUP_HOUR_UTC`, default 07:00 UTC) to
  `s3://<bucket>/backups/pmp-<timestamp>.dump`, kept 30 days by the lifecycle rule. Take one now:
  `docker compose exec backup backup.sh now`.
- **Files** — S3 with versioning; nothing to back up on the server (it holds only in-progress parts).
- **Restore drill (do it once before launch, and after any schema change you are nervous about):**
  ```bash
  aws s3 cp s3://<bucket>/backups/<file>.dump ./restore.dump
  docker compose stop api dispatcher
  docker compose exec -T postgres pg_restore -U pmp -d pmp --clean --if-exists --no-owner < restore.dump
  docker compose --profile ops run --rm migrate
  docker compose up -d
  ```

## 8. Monitoring

- **Uptime**: an external monitor (UptimeRobot, Better Stack, Route 53 health check) on
  `https://pmp.av-rfpilot.com/ops/health`, alerting by email/SMS.
- **Logs**: `docker compose logs -f api dispatcher`. Worth watching: `[dispatcher] not sent to …`
  (suppressed or invalid addresses), `[reminders] …`, `pdf` failures, `refusing to start`.
- **Disk**: Postgres volume and Docker images; alert at 80 %.
- **SES**: bounce and complaint rates in the SES console (keep bounce < 2 %, complaints < 0.1 %).

## 9. Rehearsal (before every significant change)

The same stack runs locally with MinIO in place of S3 and `*.localhost` hosts on port 8443:

```bash
cd deploy/server
docker compose -f docker-compose.yml -f docker-compose.rehearsal.yml --env-file rehearsal.env up -d
```
2026-09-27 rehearsal: 21/21 smoke checks through Caddy — both sites over HTTPS with HSTS; first-admin
bootstrap → forced password change → authenticator enrolment; Secure/HttpOnly session cookie;
signed-in server-rendered pages; a speaker signing in on the portal's origin; a real `.pptx` uploaded
in parts, scanned by **clamd** (audit: `scanner: clamd, verdict: clean`), stored in S3 under its
SHA-256 key, converted to PDF by LibreOffice and served back from S3 — with **no file left on the
API server's disk**. It found and fixed three production-only bugs: extensions created in the wrong
schema on a fresh database (migration 021), a ClamAV config that never became ready, and an upload
folder the unprivileged API user could not write.

## 10. Go-live checklist

- [ ] AWS: bucket, IAM user + key, SNS topic + subscription, server, DNS (§3)
- [ ] `.env` filled; `docker compose up` starts with no "refusing to start"
- [ ] First admin bootstrapped; signed in; password changed; authenticator enrolled
- [ ] Staff accounts created for the DXG team (Staff accounts screen), each with the right event roles
- [ ] A test event end to end: agenda import → speaker invited → **email arrives with a working
      `https://speakers.av-rfpilot.com/t/…` link** → upload → PDF preview → approve → archive package
- [ ] Bounce test: send to `bounce@simulator.amazonses.com` → the address is suppressed afterwards
- [ ] Backup taken and **a restore drill done** (§7)
- [ ] Uptime monitor and SES bounce/complaint alarms set (§8)
- [ ] Open product gates acknowledged (below)

**Product gates still open** (from the project's own plan, not infrastructure): the 17-screen visual
sign-off with DXG (G0-6b), and the Room Agent PowerPoint proof of concept on Windows hardware
(G0-1) — the in-room playback path is not proven until it passes.
