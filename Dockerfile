# Observer + dashboard. One image, one process: Hono on Node 22 serving
# /rpc, /api, /whoami and the built React app.
FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/observer/package.json packages/observer/
COPY packages/web/package.json packages/web/
COPY packages/runner/package.json packages/runner/
COPY spikes/package.json spikes/
RUN pnpm install --frozen-lockfile --filter "@anonscope/observer..." --filter "@anonscope/web..." --filter anonscope
COPY . .
# Fetch the pinned worker bundles from the specifier's resolvers and verify
# keccak256 == workerHash before including them (build time only).
RUN pnpm bundles && pnpm build

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=8080 \
    DB_PATH=/data/anonscope.db \
    TRUSTED_IP_HEADER=fly-client-ip \
    WEB_DIST=/app/packages/web/dist
WORKDIR /app
COPY --from=build /app /app
RUN mkdir -p /data
WORKDIR /app/packages/observer
EXPOSE 8080
CMD ["./node_modules/.bin/tsx", "src/server.ts"]
