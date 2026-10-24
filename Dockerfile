# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# better-sqlite3 can use a prebuilt binary, but these packages also allow
# deterministic source compilation when a prebuilt binary is unavailable.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
ARG NEXT_PUBLIC_TKD_MODE=LOCAL
ENV NEXT_PUBLIC_TKD_MODE=${NEXT_PUBLIC_TKD_MODE}
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
  NEXT_TELEMETRY_DISABLED=1 \
  NEXT_PUBLIC_TKD_MODE=LOCAL \
  TKD_MODE=LOCAL \
  PORT=3000 \
  WEB_INTERNAL_URL=http://127.0.0.1:3001 \
  TKD_DATABASE_PATH=/data/tournament.db \
  SEED_DEVELOPMENT=false \
  ALLOW_DEMO_LOGIN=false

# Keep the production start dependencies used by npm start. The build and
# runtime images share the same Node/libc platform for better-sqlite3.
COPY --from=build /app /app
RUN mkdir -p /data && chown -R node:node /data /app

USER node
EXPOSE 3000
STOPSIGNAL SIGTERM

# Run concurrently directly so container signals reach both child processes.
# If either Express or Next exits, the container exits for orchestrator recovery.
CMD ["./node_modules/.bin/concurrently", "--kill-others", "-n", "LOCAL,WEB", "-c", "green,cyan", "tsx apps/local-server/src/index.ts", "wait-on tcp:127.0.0.1:3000 && next start apps/web -p 3001 -H 127.0.0.1"]
