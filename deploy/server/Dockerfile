# syntax=docker/dockerfile:1.7
#
# One Dockerfile, four images (production readiness — one-server deployment):
#
#   --target api          the API, with LibreOffice for PDF previews; also runs migrations
#                         and the background worker (compose service `worker`, D-103)
#                         and the first-admin bootstrap (`docker compose run --rm api …`)
#   --target dispatcher   the mail process (outbox → SES)
#   --target staff        the control center (Next.js standalone server, :3000)
#   --target portal       the speaker portal (Next.js standalone server, :3001)
#
# Node 24 runs the TypeScript sources directly (native type stripping), so the API and the
# dispatcher are not compiled; the two Next apps are built here, never in a developer's tree.

# Base (D-152): a current Node 24 on Debian 13 (trixie). ECR's scan of the 24.4.1-bookworm images found 7–8
# critical OS-package CVEs in each (gnutls, perl, libtiff). Bump this tag for Node/Debian security releases;
# `runtime` below also applies Debian's security updates at build time, refreshed weekly in CI, so
# releases pick up fixes even before the Node image is refreshed.
ARG NODE_IMAGE=node:24.21.0-trixie-slim

# ── dependencies for the whole workspace ─────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY . .
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

# ── what every shipped image starts from: the base with Debian's security updates applied ─────
FROM ${NODE_IMAGE} AS runtime
# CI passes the ISO week (e.g. 2026-W41): a new value re-runs the upgrade below instead of reusing the
# cached layer, so each week's first build picks up Debian's latest security fixes.
ARG SECURITY_REFRESH=manual
RUN echo "security refresh: $SECURITY_REFRESH" \
 && apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get upgrade -y --no-install-recommends \
 && apt-get clean && rm -rf /var/lib/apt/lists/*

# ── API ───────────────────────────────────────────────────────────────────────────────
FROM runtime AS api
# LibreOffice renders the PDF previews reviewers see (D-074); fonts so slides lay out as authored.
RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends libreoffice-impress-nogui fonts-liberation fonts-dejavu-core fonts-noto-core ca-certificates \
 && apt-get clean && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production LIBREOFFICE_PATH=/usr/bin/soffice
WORKDIR /app
COPY --from=deps /app /app
# In-progress upload parts are written here. Created owned by `node` so the volume mounted
# over it starts writable by the unprivileged user the API runs as.
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/ops/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/api/src/index.ts"]

# ── mail dispatcher ───────────────────────────────────────────────────────────────────
FROM runtime AS dispatcher
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app /app
USER node
CMD ["node", "apps/dispatcher/src/index.ts"]

# ── Next.js builds ────────────────────────────────────────────────────────────────────
FROM deps AS staff-build
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w @pmp/control-center

FROM deps AS portal-build
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w @pmp/speaker-portal

FROM runtime AS staff
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=staff-build /app/apps/control-center/.next/standalone ./
COPY --from=staff-build /app/apps/control-center/.next/static ./apps/control-center/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/control-center/server.js"]

FROM runtime AS portal
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3001 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=portal-build /app/apps/speaker-portal/.next/standalone ./
COPY --from=portal-build /app/apps/speaker-portal/.next/static ./apps/speaker-portal/.next/static
USER node
EXPOSE 3001
CMD ["node", "apps/speaker-portal/server.js"]
