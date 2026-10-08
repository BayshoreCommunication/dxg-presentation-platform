#!/usr/bin/env bash
# Deploy a release that CI built and pushed to ECR (D-149). Run on the server:
#   cd /opt/pmp/deploy/server && ./deploy.sh <commit>      # the 7-character commit on main
# Pulls all four images first (nothing changes if one is missing) -> backup -> PMP_TAG in .env
# -> migrate -> recreate services -> checks. Roll back with ./deploy.sh <previous commit>.
set -euo pipefail
cd "$(dirname "$0")"
TAG=${1:?usage: ./deploy.sh <commit>}
[[ $TAG =~ ^[0-9a-f]{7}$ ]] || { echo "deploy: '$TAG' is not a 7-character commit"; exit 1; }
env_value() { sed -n "s/^$1=//p" .env | tail -n 1; }
PREFIX=$(env_value PMP_IMAGE_PREFIX)
[ -n "$PREFIX" ] || { echo "deploy: set PMP_IMAGE_PREFIX in .env"; exit 1; }
PREVIOUS=$(env_value PMP_TAG)
step() { printf '\n== %s\n' "$*"; }

step "1/7 sign in to ECR"
docker compose exec -T backup aws ecr get-login-password --region "$(env_value AWS_REGION)" </dev/null \
  | docker login --username AWS --password-stdin "${PREFIX%/}"

step "2/7 pull $TAG (all four before anything changes)"
for s in api dispatcher staff portal; do docker pull "${PREFIX}pmp-$s:$TAG"; done

step "3/7 database backup"
docker compose exec -T backup backup.sh now </dev/null

step "4/7 PMP_TAG=$TAG in .env (was ${PREVIOUS:-unset})"
if grep -q '^PMP_TAG=' .env; then sed -i "s/^PMP_TAG=.*/PMP_TAG=$TAG/" .env; else echo "PMP_TAG=$TAG" >> .env; fi

step "5/7 migrations"
docker compose --profile ops run --rm migrate </dev/null

step "6/7 recreate services"
docker compose up -d --no-build </dev/null

step "7/7 checks"
for i in $(seq 1 30); do [ "$(docker inspect -f '{{.State.Health.Status}}' pmp-api-1)" = healthy ] && break; sleep 3; done
bad=0
for c in api worker dispatcher staff portal; do
  img=${PREFIX}pmp-${c/worker/api}:$TAG
  if [ "$(docker inspect -f '{{.Image}}' pmp-$c-1)" = "$(docker image inspect -f '{{.Id}}' "$img")" ]; then echo "$c ok"; else echo "$c NOT on $TAG"; bad=1; fi
done
docker compose ps
curl -fsS "https://$(env_value STAFF_HOST)/ops/health" && echo || { echo "health check FAILED"; bad=1; }
echo "$TAG" | sudo tee /opt/pmp/.deployed-commit >/dev/null
docker image prune -af --filter until=168h >/dev/null
docker builder prune -f --filter until=24h >/dev/null
df -h / | tail -n 1
[ "$bad" = 0 ] && echo "Deployed $TAG. Roll back: ./deploy.sh ${PREVIOUS:-<previous>}" \
  || { echo "NEEDS ATTENTION. Roll back: ./deploy.sh ${PREVIOUS:-<previous>}"; exit 1; }
