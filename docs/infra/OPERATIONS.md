# Operating production — the operator's guide

For whoever runs the Presentation Management Platform day to day. Organised by task: find what you
want to do, follow it, and read the *Why* lines once so the commands make sense. The reference
behind it is [PRODUCTION.md](PRODUCTION.md) (setup, costs, monitoring details); this guide links to it
rather than repeating it.

Out of scope here: building the server from scratch, AWS permissions, and the CI/ECR setup — see
PRODUCTION.md §3–§4.

---

## 0. What you are running (read once)

```
 Speakers ─▶ speakers.av-rfpilot.com ─┐                       ┌─ staff    (control centre)
 DXG staff ─▶ pmp.av-rfpilot.com ─────┴─▶ caddy (HTTPS) ──────┼─ portal   (speaker site)
                                                              └─ api ──┬─ postgres  (all data)
            ONE Lightsail server, 3.146.210.9 (Docker Compose)          ├─ clamav    (virus scan)
                                                                       └─ S3        (files)
   worker      PDF previews + automatic reminders     ──▶ postgres, S3
   dispatcher  sends email from the outbox            ──▶ SES (noreply@av-rfpilot.com)
   backup      nightly database dump at 07:00 UTC     ──▶ S3 backups/ (kept 30 days)
```

- **One server runs everything.** Nine containers, defined in `/opt/pmp/deploy/server/docker-compose.yml`.
  If the server is down, everything is down. Files (presentations, PDFs) are safe in S3 regardless;
  the database is on the server's disk and copied to S3 every night.
- **Four of the containers are "our" code** — `api`, `worker` (same image as api), `dispatcher`, `staff`,
  `portal`. They come as images that GitHub Actions builds and stores in ECR. The rest (`caddy`,
  `postgres`, `clamav`, `backup`) are standard images that rarely change.
- **A release = a commit.** Every image is tagged with the 7-character git commit it was built from.
  `.env` on the server says which commit is running (`PMP_TAG=`), and so does `/opt/pmp/.deployed-commit`.
- **Caddy** is the only thing reachable from the internet. It holds the HTTPS certificates (renewed
  automatically, next expiry Dec 2026) and passes `/api/*` to the api, everything else to the web apps.

**Monitoring that already exists:** Route 53 checks both sites and the worker every 30 seconds. If one
fails for 2 minutes, an email goes to **dxgrfptool@gmail.com** (alarm names `pmp-uptime-pmp`,
`pmp-uptime-speakers`, `pmp-uptime-worker`), and another when it recovers.

---

## 1. Access

| What | Value |
|---|---|
| SSH | `ssh -i ~/.ssh/pmp-lightsail.pem ubuntu@3.146.210.9` |
| Allowed from | **only** IP `103.112.54.213` (Lightsail firewall). From anywhere else SSH just times out. |
| Working folder on the server | `cd /opt/pmp/deploy/server` — run every `docker compose` command from here |
| AWS | account 295229565954, profile `rfpilot`, region **us-east-2** (the uptime alarms live in **us-east-1**) |
| Settings | `/opt/pmp/deploy/server/.env` — passwords and keys. **Never delete it, never commit it, never paste it anywhere.** |

**SSH times out?** Your internet IP has probably changed. AWS console → Lightsail → `pmp-prod` →
Networking → IPv4 firewall → edit the SSH (22) rule to your new IP (`curl https://checkip.amazonaws.com`
shows it). *Why:* port 22 is closed to everyone else on purpose.

**Docker says "permission denied"?** Put `sudo` in front. (The `ubuntu` user is in the `docker`
group, so normally it isn't needed.)

---

## 2. Is everything OK? (the 30-second check)

From your laptop:

```bash
curl -s https://pmp.av-rfpilot.com/ops/health; echo; curl -s https://speakers.av-rfpilot.com/ops/health; echo
```

Healthy is `{"status":"ok","database":"up","worker":"up"}` from both.

| You see | Meaning |
|---|---|
| `"worker":"stale"` or `"none"` | The worker stopped. Sites work, but PDF previews stay "queued" and reminders don't go out. → §7.3 |
| `"database":"down"` / `"status":"error"` | The api can't reach Postgres. → §7.2 |
| No answer / timeout / 502 | That site is down. → §7 |

On the server, the full picture:

```bash
cd /opt/pmp/deploy/server && docker compose ps
```

Every service should be `Up`; `api`, `worker`, `postgres`, `clamav` also say `(healthy)`. The IMAGE
column shows the running commit for our four images. `Restarting` or `Exited` means trouble.

```bash
df -h / && free -m
```

Disk under 80 % (it is normally ~20 %); memory "available" above ~500 MB. ClamAV alone uses ~1 GB —
that's normal.

---

## 3. Release a new version

The normal way. Takes ~15 minutes, of which ~10 is waiting for CI.

1. **On GitHub:** open a pull request from `main` into **`production`** and merge it.
   *Why:* only the `production` branch builds the production images. `main` is where work collects.
2. **Wait for CI:** GitHub → Actions → the newest run on `production`. It goes checks → invariants →
   images → four `publish` jobs. When green, its **Summary** shows
   `Deploy on the server: ./deploy.sh <commit>`. Note that commit.
   If it's red, don't deploy; nothing has changed on the server.
3. **Check whether `deploy/server` changed** in this release (the PR's "Files changed" tab). If it did
   (compose file, Caddyfile, `deploy.sh`, `backup/`), copy it to the server first — from your laptop:
   ```bash
   cd ~/Desktop/rfp/dxg-presentation-platform && git fetch origin && git archive origin/production deploy/server | ssh -i ~/.ssh/pmp-lightsail.pem ubuntu@3.146.210.9 'sudo tar -x -C /opt/pmp && sudo chmod +x /opt/pmp/deploy/server/deploy.sh'
   ```
   *Why:* `deploy.sh` only swaps images; it never touches these files. `.env` is not in git, so this
   can't overwrite it.
4. **Deploy:** on the server:
   ```bash
   cd /opt/pmp/deploy/server && ./deploy.sh <commit>
   ```
5. **Check from outside** (§2), then sign in once as staff and look at the screen that changed.
6. **Record it:** add a dated entry to `docs/PROJECT_STATE.md` — commit, backup name, anything odd.

### What `deploy.sh` does, step by step

| Step | What | If it fails here |
|---|---|---|
| 1/7 | Signs in to ECR (using the server's AWS key, through the `backup` container) | Nothing changed. Usually AWS permissions or a typo in `PMP_IMAGE_PREFIX`. |
| 2/7 | **Downloads all four images** for the commit | Nothing changed. Usually a wrong commit, or CI hasn't finished. |
| 3/7 | **Database backup** → prints `uploaded backups/pmp-….dump` | Nothing changed. Note the backup name when it works — it's your undo. |
| 4/7 | Writes `PMP_TAG=<commit>` into `.env` | Nothing changed for users yet. |
| 5/7 | Runs database **migrations** (only new ones; "up to date" is fine) | Old code still running. Read the error; send it to a developer. |
| 6/7 | Recreates the containers whose image changed (a few seconds of downtime) | Run `docker compose ps` and §5 logs. |
| 7/7 | Checks each container runs the new image, api is healthy, the public URL answers | Ends with `NEEDS ATTENTION` and the rollback command. |

It ends with `Deployed <commit>. Roll back: ./deploy.sh <previous>`. **Copy that last line somewhere.**

*Why it's built this way:* everything that can fail without hurting anyone (downloads, backup) happens
before anything that users would notice (migrations, restart).

---

## 4. Roll back

When a release is broken and you want the previous one back:

```bash
cd /opt/pmp/deploy/server && ./deploy.sh <previous commit>
```

**Finding the previous commit:** the last line of the deploy you're undoing; or `docs/PROJECT_STATE.md`;
or `grep PMP_TAG .env` *before* you deploy. The previous release's images stay on the server for a
week, so a rollback doesn't need to download anything and takes ~1 minute.

*Why this is safe:* migrations only ever **add** tables and columns, so older code runs fine on the
newer database. Rolling back the code never needs a database restore — only restore (§6.3) if the
**data** itself is wrong.

---

## 5. Read the logs

```bash
cd /opt/pmp/deploy/server
docker compose logs --since 30m api            # the last 30 minutes of one service
docker compose logs -f --tail 50 api worker    # follow live (Ctrl-C to stop)
docker compose logs --since 1h api worker dispatcher staff portal | grep -iE "error|fatal|refusing"
```

| Service | Look here for |
|---|---|
| `api` | Anything a user did that failed, sign-ins, uploads, "refusing to start" (bad settings) |
| `worker` | PDF previews (`pdf`), reminders (`[reminders]`) |
| `dispatcher` | Email: `not sent to …` (address suppressed or invalid), SES errors |
| `caddy` | HTTPS certificates, requests that never reached the app |
| `backup` | The nightly `[backup] uploaded backups/…` lines |

**Normal noise — ignore:**
- `staff` — `The Server Reference ID did not match the expected format. Received "x"` — bots probing
  the site. Next.js is patched against that attack.
- `caddy` — `aborting with incomplete response … H3_REQUEST_CANCELLED` — a browser cancelled a
  download (closed the tab, scrolled past an image).

---

## 6. Backups

### 6.1 What exists
- **Database:** dumped every night at **07:00 UTC** to `s3://dxg-pmp-files-295229565954/backups/`,
  kept 30 days. Every `deploy.sh` run makes one more.
- **Files:** presentations, PDFs and archives live in S3 with versioning — nothing to back up.
- **The server itself:** not backed up (no snapshots). If it's lost, it's rebuilt from PRODUCTION.md
  §3–§4 and the database restored from the latest dump.

### 6.2 Take one now, and list them
```bash
cd /opt/pmp/deploy/server && docker compose exec -T backup backup.sh now
docker compose exec -T backup sh -c 'aws s3 ls s3://$S3_BUCKET/backups/ | tail -5'
```
Check last night's ran: `docker compose logs --since 30h backup`.

### 6.3 Test a backup (safe — a scratch database, live data untouched)
Do this every month or two, and after any big migration. *Why:* a backup you've never restored is a hope, not a backup.

```bash
cd /opt/pmp/deploy/server
F=$(docker compose exec -T backup sh -c 'aws s3 ls s3://$S3_BUCKET/backups/ | tail -1' </dev/null | awk '{print $4}'); echo $F
docker compose exec -T postgres createdb -U pmp pmp_restore_test
docker compose exec -T backup sh -c "aws s3 cp s3://\$S3_BUCKET/backups/$F -" </dev/null \
  | docker compose exec -T postgres pg_restore -U pmp -d pmp_restore_test --no-owner --no-privileges
docker compose exec -T postgres psql -U pmp -d pmp_restore_test -c "select count(*) as events from pmp.events" -c "select max(filename) from pmp.schema_migrations"
docker compose exec -T postgres dropdb -U pmp pmp_restore_test
```
Good: `pg_restore` finishes without errors and the counts look like production. The latest migration
matches production's — or is one release behind if the newest dump is the one `deploy.sh` took, because
that backup is made *before* the release's migrations run. **Always run the `dropdb` line at the end.**
(Tested on production 2026-10-11: 11 events, migrations up to 033 in the pre-deploy dump.)

### 6.4 Restore over the live database (last resort)
Only when production data is wrong or lost, and only after telling DXG the site will be down a few
minutes. Follow PRODUCTION.md §7 exactly. Take a fresh backup first (6.2) so you can undo the restore.

---

## 7. Something is wrong

Start with §2. Then find your symptom.

### 7.1 A site is down (alarm email, or it won't load)
```bash
cd /opt/pmp/deploy/server && docker compose ps
```
- **A service is `Exited` / `Restarting`:** read why — `docker compose logs --tail 100 <service>` —
  then start it: `docker compose up -d <service>`. If it keeps restarting, roll back (§4) if this
  started after a release; otherwise send the logs to a developer.
- **Everything `Up` but the site still fails:** `docker compose logs --since 15m caddy api staff portal`.
  Try `docker compose restart caddy`.
- **SSH itself doesn't answer:** the server may be overloaded or stopped. Lightsail console → `pmp-prod`
  → check it's *Running*; the Metrics tab shows CPU. **Reboot** from the console if it's stuck — every
  container starts again by itself (§8.2).
- **Only one alarm from Route 53 and the site works for you:** check from another network; a short blip
  recovers on its own and you'll get an "OK" email.

### 7.2 Database down
```bash
docker compose ps postgres && docker compose logs --tail 50 postgres
df -h /
```
Full disk is the usual cause (§7.5). Otherwise `docker compose up -d postgres`, wait 30 s, then
`docker compose restart api worker dispatcher`.

### 7.3 Worker stale (previews stuck "queued", no reminders)
```bash
docker compose logs --tail 50 worker
docker compose up -d worker
```
Health should show `"worker":"up"` within a minute. If it stops again, the logs say why (often a file
LibreOffice can't convert — send it to a developer). The site keeps working meanwhile.

### 7.4 Emails not arriving
```bash
docker compose logs --since 2h dispatcher
docker compose exec -T postgres psql -U pmp -d pmp -c "select count(*) as waiting from pmp.outbox where dispatched_at is null"
docker compose exec -T postgres psql -U pmp -d pmp -c "select status, count(*) from pmp.communications where created_at > now() - interval '1 day' group by 1"
```
- `waiting` growing → the dispatcher is stuck: `docker compose restart dispatcher`.
- `bounced` / `complained` → the address is bad; the platform suppresses it for good (by design).
- `not sent to …` in the logs → address invalid, previously bounced, or a practice event (practice
  mail is never sent, on purpose).
- Everything says `sent`/`delivered` → it reached the recipient's mail server; ask them to check spam.

### 7.5 Disk filling up
```bash
df -h / && docker system df
docker image prune -af --filter until=168h && docker builder prune -f --filter until=24h && df -h /
```
*Why:* old images and Docker build cache are what fill the disk (55 GB once); the database is only a
few MB. Since images come from CI, this rarely grows now; `deploy.sh` prunes on every release.

### 7.6 Can't sign in
- One staff member: a root admin resets them in the control centre (Staff accounts).
- Everyone: check §2 (database), then `docker compose logs --since 15m api | grep -i auth`.
- A speaker using a staff email address: by design that can't be a speaker account — use another address.

---

## 8. Routine care

### 8.1 Weekly (5 minutes)
- §2 health check, `df -h /`.
- `docker compose logs --since 7d backup | grep uploaded | tail -3` — the last few nights' backups.
- Skim `docker compose logs --since 7d api worker dispatcher | grep -iE "error|fatal" | tail -20`.

### 8.2 Applying server updates and rebooting
Ubuntu installs security updates itself; some need a reboot (`ls /var/run/reboot-required` exists).
Pick a quiet time (not during a DXG event), then:
```bash
cd /opt/pmp/deploy/server && docker compose exec -T backup backup.sh now
sudo apt-get update && sudo apt-get upgrade -y
sudo reboot
```
Wait 2–3 minutes, SSH back in, `docker compose ps`, then §2. *Why it's safe:* Docker starts on boot
and every container is set to `restart: unless-stopped`. ClamAV takes a couple of minutes to become
healthy; the api waits for it.

### 8.3 Restart one service
`docker compose restart <service>` — a few seconds of interruption for that service only.
Use `docker compose up -d <service>` instead if it's stopped.

---

## 9. Never do these

- **Never delete or overwrite `/opt/pmp/deploy/server/.env`.** It holds every password and key; there
  is no other copy on the server.
- **Never `docker compose down -v`** (or `docker volume rm`). `-v` deletes the database volume.
- **Never run `db:seed` or `demo:reset` against production** — they load demo data.
- **Never edit the database by hand** to "fix" something without a fresh backup and a second person.
- **Never build images on the server** while it's serving (`docker compose build`) except in the
  emergency fallback in PRODUCTION.md §6 — it starves ClamAV of memory.
- **Never send real email from a test** to real speakers — use a practice event (its mail is held).

---

## 10. Words you'll see

| Word | Meaning |
|---|---|
| **Commit / tag** | The 7-character id of a release, e.g. `d60dd22`. Images, `PMP_TAG` and `.deployed-commit` all use it. |
| **ECR** | AWS's store for our Docker images. CI puts them there; the server pulls them. |
| **Image / container** | An image is the packaged app; a container is a running copy of it. |
| **Migration** | A numbered SQL file in `db/migrations/` that changes the database; each runs once, in order. |
| **Outbox** | The queue of emails waiting for the dispatcher. |
| **Health check** | `/ops/health` — what Route 53 and §2 look at. |
| **Practice event** | A training event; its emails are held, never sent. |
