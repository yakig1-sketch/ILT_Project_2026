# syntax=docker/dockerfile:1
# ILT server images for a cloud install (System Installation Guide §6). Build from the repo root:
#   docker build -f infra/cloud/ilt.Dockerfile --target server -t ilt-server:<version> .
#   docker build -f infra/cloud/ilt.Dockerfile --target web    -t ilt-web:<version> .
#   docker build -f infra/cloud/ilt.Dockerfile --target analytics -t ilt-analytics:<version> .

# ---- build: the whole workspace, compiled ----
FROM node:24-bookworm-slim AS build
ENV TURBO_TELEMETRY_DISABLED=1 CI=1
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
# Packages and the gateway; the web apps are built below with their path prefix.
RUN pnpm turbo run build --filter=!./apps/*
RUN pnpm --filter @ilt/tablet-kiosk exec vite build --base=/tablet/ --outDir /web/tablet \
 && pnpm --filter @ilt/evaluator-cockpit exec vite build --base=/cockpit/ --outDir /web/cockpit \
 && pnpm --filter @ilt/analyst-portal exec vite build --base=/analyst/ --outDir /web/analyst

# ---- server: telemetry-gateway; also runs the database tools (migrate, seed, create-user) ----
FROM build AS server
ENV NODE_ENV=production
RUN chown -R node:node /app
USER node
WORKDIR /app/services/telemetry-gateway
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --retries=4 \
  CMD node -e "fetch('http://127.0.0.1:8080/api/v1/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/server.js"]

# ---- web: Caddy serving the three web apps and proxying /api and /ws to the gateway cells ----
FROM caddy:2.10-alpine AS web
COPY --from=build /web /srv

# ---- analytics: Python service ----
FROM python:3.12-slim-bookworm AS analytics
WORKDIR /srv
COPY services/analytics/pyproject.toml ./
COPY services/analytics/ilt_analytics ./ilt_analytics
RUN pip install --no-cache-dir . && useradd -r ilt
USER ilt
EXPOSE 8090
CMD ["uvicorn", "ilt_analytics.main:app", "--host", "0.0.0.0", "--port", "8090"]
