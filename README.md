# Own Music App

A private, invite-only, Spotify-style music service.

- `server/` — NestJS API and HLS transcoding worker (Prisma + PostgreSQL, BullMQ + Redis)
- `web/` — React web player and admin panel (coming in Task 4)
- `android/` — Kotlin / Jetpack Compose Android app (coming in Task 12)
- `deploy/` — microk8s manifests and deploy scripts

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

## Deployment (microk8s on the Dev server)

The app runs in namespace `music` on the shared microk8s cluster on the Dev server
(217.216.58.206). That cluster already provides Traefik ingress (class `public`), cert-manager
with the `letsencrypt-prod` ClusterIssuer, and the image registry at `localhost:32000`. The deploy
scripts only check those addons; they never change them or other namespaces.

Data lives in hostPath volumes on the server (reclaim policy `Retain`):

- `/srv/music` — `originals/`, `hls/`, `covers/`, `tmp/` (owned by uid 1000, the app user)
- `/srv/music-db` — PostgreSQL data (owned by uid 70, the postgres user)

Deploy from WSL (uses the `Dev` host alias in `~/.ssh/config`):

```bash
deploy/gen-secrets.sh admin@music.snowsig.in   # once; writes deploy/.env (gitignored, mode 600)
deploy/deploy.sh                               # rsync to /opt/music-app, build, push, apply, wait
deploy/smoke.sh                                # HTTPS health check + certificate check
```

`deploy.sh` tags images with the git short SHA (plus `-dirty-<time>` for uncommitted changes),
recreates the `music-secrets` Secret from `deploy/.env`, and runs Prisma migrations in the api
pod's init container.

Useful commands on the server:

```bash
microk8s kubectl -n music get pods,ingress,certificate
microk8s kubectl -n music logs deploy/api
```
