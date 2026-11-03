# Own Music App

A private, invite-only, Spotify-style music service.

- `server/` — NestJS API and HLS transcoding worker (Prisma + PostgreSQL, BullMQ + Redis)
- `web/` — React web player and admin panel (coming in Task 4)
- `android/` — Kotlin / Jetpack Compose Android app (coming in Task 12)
- `deploy/` — microk8s manifests and scripts (coming in Task 2)

Production URL: https://music.snowsig.in

## Local development

Node is not installed on the host. All Node commands run in a container through
`scripts/node.sh <subdir> <command...>`, which builds a small toolbox image
(`music-dev-node:24`: Node 24, openssl, ffmpeg) on first use and mounts the repo at `/repo`
with host networking.

```bash
# Start Postgres (127.0.0.1:5433) and Redis (127.0.0.1:6380) for dev and tests
docker compose -f docker-compose.dev.yml up -d --wait

# Install dependencies and generate the Prisma client
scripts/node.sh server npm ci
scripts/node.sh server npx prisma generate

# Tests
scripts/node.sh server npm test          # unit tests
scripts/node.sh server npm run test:e2e  # e2e tests against the music_test database

# Run the API on :3100 (port 3000 is used by another app on this machine)
scripts/node.sh server sh -c 'npm run build && PORT=3100 \
  DATABASE_URL=postgresql://music:music@127.0.0.1:5433/music node dist/main.js'
curl localhost:3100/api/health   # {"status":"ok","db":"up"}
```
