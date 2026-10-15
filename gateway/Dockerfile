# Server-mode image for the Agent Gateway. Build from the repo root:
#   docker build -f gateway/Dockerfile -t foundry-agent-gateway:<version> .
# Debian Chromium is in the final stage for the headless runner (task 37).

# Production dependencies only, installed from the lockfile.
FROM node:22-slim AS deps
WORKDIR /src
COPY package.json package-lock.json ./
COPY protocol/package.json protocol/
COPY module/package.json module/
COPY gateway/package.json gateway/
RUN npm ci --omit=dev --ignore-scripts --workspace gateway --no-audit --no-fund

# Build the single esbuild bundle (gateway/dist/bin/cli.js).
FROM node:22-slim AS build
WORKDIR /src
COPY package.json package-lock.json tsconfig.base.json ./
COPY protocol/ protocol/
COPY module/package.json module/
COPY gateway/ gateway/
RUN npm ci --ignore-scripts --include-workspace-root --workspace protocol --workspace gateway --no-audit --no-fund \
 && npm run build -w protocol \
 && npm run build -w gateway

FROM node:22-slim
# Chromium for the headless runner; found as the system browser at /usr/bin/chromium.
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-liberation \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    AGENT_GATEWAY_HEADLESS_NO_SANDBOX=1 \
    AGENT_GATEWAY_SERVER_MODE=1 \
    AGENT_GATEWAY_DB=/data/gateway.db
WORKDIR /app
COPY --from=deps /src/node_modules ./node_modules
COPY --from=build /src/gateway/package.json ./gateway/package.json
COPY --from=build /src/gateway/dist ./gateway/dist
RUN ln -s /app/gateway/dist/bin/cli.js /usr/local/bin/foundry-agent-gateway \
 && mkdir -p /data/backups && chown -R node:node /data && chmod 700 /data
USER node
VOLUME /data
EXPOSE 7420 7421
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:7421/status').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
ENTRYPOINT ["node", "/app/gateway/dist/bin/cli.js"]
