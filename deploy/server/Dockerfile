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

ARG NODE_IMAGE=node:24.4.1-bookworm-slim

# ── dependencies for the whole workspace ─────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY . .
# The Room Agent (apps/room-agent) is a Windows desktop app; servers never need Electron's binary.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

# ── API ───────────────────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS api
# LibreOffice renders the PDF previews reviewers see (D-074); fonts so slides lay out as authored.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libreoffice-impress-nogui fonts-liberation fonts-dejavu-core fonts-noto-core ca-certificates \
 && rm -rf /var/lib/apt/lists/*
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
FROM ${NODE_IMAGE} AS dispatcher
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

FROM ${NODE_IMAGE} AS staff
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=staff-build /app/apps/control-center/.next/standalone ./
COPY --from=staff-build /app/apps/control-center/.next/static ./apps/control-center/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/control-center/server.js"]

FROM ${NODE_IMAGE} AS portal
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3001 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=portal-build /app/apps/speaker-portal/.next/standalone ./
COPY --from=portal-build /app/apps/speaker-portal/.next/static ./apps/speaker-portal/.next/static
USER node
EXPOSE 3001
CMD ["node", "apps/speaker-portal/server.js"]
