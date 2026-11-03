# Own Music App

A private, invite-only, Spotify-style music service.

- `server/` — NestJS API and HLS transcoding worker (Prisma + PostgreSQL, BullMQ + Redis)
- `web/` — React web player and admin panel (Vite, Tailwind, TanStack Query)
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

Web app (proxies `/api`, `/stream` and `/media` to the API on :3100):

```bash
scripts/node.sh web npm ci
scripts/node.sh web npm test                              # Vitest + Testing Library + MSW
scripts/node.sh web npm run build                         # type-check + production build
scripts/node.sh web npx vite --host 127.0.0.1 --port 5173 # dev server
```

With the API in development mode (`NODE_ENV=development`) the refresh cookie is sent without
`Secure`, so login works on plain `http://localhost:5173`.

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
deploy/demo-auth.sh                            # admin login, create listener, check 403/401
scripts/browser-demo.sh --cleanup              # real-browser walkthrough (Playwright on Dev)
```

`browser-demo.sh` runs Chromium in the Playwright image on the Dev server, saves screenshots to
`.data/browser-demo/`, and with `--cleanup` removes the image again. Both demo scripts leave a
deactivated `*-demo-*@music.snowsig.in` listener behind (there is no delete endpoint yet).

`deploy/demo-catalog.sh` creates an artist and album, uploads a cover, fetches it without a
login, then deletes both and checks the files are gone (`--keep` leaves them for a look).

The admin account (`ADMIN_EMAIL` / `ADMIN_PASSWORD` in `deploy/.env`) is created on the first
start. Changing those values later does not change the existing account; use
`PATCH /api/me/password` (or the web app, from Task 4) instead.

`deploy.sh` tags images with the git short SHA (plus `-dirty-<time>` for uncommitted changes),
recreates the `music-secrets` Secret from `deploy/.env`, and runs Prisma migrations in the api
pod's init container.

Useful commands on the server:

```bash
microk8s kubectl -n music get pods,ingress,certificate
microk8s kubectl -n music logs deploy/api
```

## API overview

All `/api` routes need `Authorization: Bearer <accessToken>` except `/api/health` and
`/api/auth/*`. Admin routes (`/api/admin/*`) need the ADMIN role.

| Area | Routes |
| --- | --- |
| Auth | `POST /api/auth/login` (`client: "web"` or `"mobile"`), `/refresh`, `/logout` |
| Me | `GET /api/me`, `PATCH /api/me/password` |
| Catalog (listeners) | `GET /api/home`, `/api/artists`, `/api/artists/:id`, `/api/albums/:id` |
| Users (admin) | `GET/POST /api/admin/users`, `PATCH /api/admin/users/:id` |
| Artists (admin) | `GET/POST /api/admin/artists`, `PATCH/DELETE /api/admin/artists/:id`, `PUT/DELETE /api/admin/artists/:id/image` |
| Albums (admin) | `GET/POST /api/admin/albums`, `PATCH/DELETE /api/admin/albums/:id`, `PUT/DELETE /api/admin/albums/:id/cover` |

- Listener catalog routes only show albums and artists that have at least one playable
  (READY) track.
- Images are uploaded as multipart field `image` (JPEG, PNG, WebP, GIF or AVIF, max 10 MB) and
  stored as 300 px and 600 px square WebP files. Responses give their paths as
  `cover: { small, large }` (albums) or `image: { small, large }` (artists), served publicly
  from `/media/covers/` with a one-year immutable cache.
- An artist can only be deleted once it has no albums or tracks, and an album once it has no
  tracks.
