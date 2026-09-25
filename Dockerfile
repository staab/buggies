# The game server: the arena that counts, over WebSockets on port 8787.
# Built from the workspace in one stage and run from the built packages in
# another, with only what the server needs at runtime.

FROM node:24-alpine AS base
WORKDIR /app
# pnpm, at the version package.json names, without being asked.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

# Every package's manifest, so the lockfile resolves the whole workspace.
FROM base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/physics/package.json packages/physics/
COPY packages/terrain/package.json packages/terrain/
COPY packages/vehicle/package.json packages/vehicle/
COPY packages/game/package.json packages/game/
COPY packages/net/package.json packages/net/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/

# The build: every dependency, the sources, and the server with everything it depends on built.
FROM manifests AS build
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile
COPY tsconfig.base.json tsconfig.json ./
COPY packages ./packages
RUN pnpm --filter @buggies/server... run build

# The runtime dependencies alone, for the server and the workspace packages it uses.
FROM manifests AS deps
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter @buggies/server...

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=deps /app/packages ./packages
COPY --from=build /app/packages/physics/dist ./packages/physics/dist
COPY --from=build /app/packages/terrain/dist ./packages/terrain/dist
COPY --from=build /app/packages/vehicle/dist ./packages/vehicle/dist
COPY --from=build /app/packages/game/dist ./packages/game/dist
COPY --from=build /app/packages/net/dist ./packages/net/dist
COPY --from=build /app/packages/server/dist ./packages/server/dist
USER node
ENV HOST=0.0.0.0 PORT=8787
EXPOSE 8787
# Alive when the port accepts a connection.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('node:net').connect(process.env.PORT, '127.0.0.1').on('connect', function () { this.end(); process.exit(0) }).on('error', () => process.exit(1))"
CMD ["node", "packages/server/dist/index.js"]
