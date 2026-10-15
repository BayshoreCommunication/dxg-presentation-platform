#!/usr/bin/env bash
# Run by GitHub Actions through SSM (D-191): deploy <commit>; if it fails, put the previous commit back.
set -uo pipefail
cd "$(dirname "$0")"
TAG=${1:?usage: ./auto-deploy.sh <commit>}
[[ $TAG =~ ^[0-9a-f]{7}$ ]] || { echo "auto-deploy: '$TAG' is not a 7-character commit"; exit 2; }
exec 9>/tmp/pmp-deploy.lock
flock -n 9 || { echo "auto-deploy: another deploy is running"; exit 3; }
PREV=$(cat /opt/pmp/.deployed-commit 2>/dev/null || true)
echo "deploying $TAG (current: ${PREV:-unknown})"
if ./deploy.sh "$TAG"; then exit 0; fi
echo "deploy of $TAG FAILED"
if [[ -n "$PREV" && "$PREV" != "$TAG" ]]; then
  echo "rolling back to $PREV"
  if ./deploy.sh "$PREV"; then echo "rolled back to $PREV"; else echo "ROLLBACK FAILED, needs a person"; fi
else
  echo "no previous commit to roll back to, needs a person"
fi
exit 1