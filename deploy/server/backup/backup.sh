#!/bin/sh
# Nightly logical backup of the database to S3 (production readiness).
#
# Runs pg_dump in custom format (restorable table by table with pg_restore), gzip-free
# because the format is compressed, and uploads it to s3://$S3_BUCKET/backups/. Retention
# is the bucket's lifecycle rule, not this script. `backup.sh now` takes one immediately.
set -eu

dump() {
  stamp=$(date -u +%Y-%m-%dT%H%M%SZ)
  file="/tmp/pmp-$stamp.dump"
  echo "[backup] dumping $PGDATABASE at $stamp"
  pg_dump --format=custom --no-owner --file="$file"
  aws s3 cp "$file" "s3://$S3_BUCKET/backups/pmp-$stamp.dump" --sse AES256 --only-show-errors
  rm -f "$file"
  echo "[backup] uploaded backups/pmp-$stamp.dump"
}

if [ "${1:-}" = "now" ]; then dump; exit 0; fi

while true; do
  now=$(date -u +%s)
  target=$(date -u -d "$(date -u +%Y-%m-%d) ${BACKUP_HOUR_UTC}:00:00" +%s 2>/dev/null || echo $((now + 86400)))
  [ "$target" -le "$now" ] && target=$((target + 86400))
  sleep $((target - now))
  dump || echo "[backup] FAILED — the next attempt is in 24 hours"
done
