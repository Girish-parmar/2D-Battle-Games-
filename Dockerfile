# UNTESTED: Docker is not available in the environment where this was written.
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN pnpm install --frozen-lockfile && pnpm --filter @war/web build

FROM node:22-slim
WORKDIR /app
RUN corepack enable
ENV NODE_ENV=production PORT=8080 DATA_FILE=/data/db.json
COPY --from=build /app /app
VOLUME /data
EXPOSE 8080
CMD ["pnpm", "--filter", "@war/server", "start"]
