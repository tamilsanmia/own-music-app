# Own Music App

A private, invite-only, Spotify-style music service: the admin uploads music, invited
listeners stream it on the web and on Android (with offline downloads).

- `server/` — NestJS API and HLS transcoding worker (Prisma + PostgreSQL, BullMQ + Redis)
- `web/` — React web player and admin panel (Vite, Tailwind, TanStack Query)
- `android/` — Kotlin / Jetpack Compose Android app (Media3, Hilt, Retrofit, Room)
- `deploy/` — microk8s manifests, deploy, backup and demo scripts

Production URL: https://music.snowsig.in

**Everyday tasks**

| What | How |
| --- | --- |
| Add music | Web app → Admin → Artists → New artist → New album → drop audio files |
| Invite a listener | Web app → Admin → Users → Add listener |
| Deploy a change | `deploy/deploy.sh`, then `deploy/smoke.sh` |
| Back up / check a backup | `ssh Dev /opt/music-app/deploy/backup.sh`, `ssh Dev /opt/music-app/deploy/restore-test.sh` |
| Build the Android app | Android Studio → open `android/` → Run (or `scripts/android.sh assembleDebug`) |
| Signed release APK | See [Release APK](#release-apk) |

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
scripts/browser-demo.sh auth                   # real-browser walkthrough (Playwright on Dev)
scripts/browser-demo.sh --cleanup catalog      # create artist/album, upload cover + 3 tracks in the UI
scripts/browser-demo.sh --cleanup player       # real playback in Google Chrome (has the AAC decoder)
```

`browser-demo.sh` runs Chromium in the Playwright image on the Dev server, saves screenshots to
`.data/browser-demo/`, and with `--cleanup` removes the image again. The auth demos leave a
deactivated `*-demo-*@music.snowsig.in` listener behind (there is no delete endpoint yet); the
catalog demo creates "Browser Demo Artist / Browser Demo Album" with 3 short test tracks
(delete it afterwards from Admin → Albums).

## Admin pages

Admins see Albums, Artists and Users in the sidebar. The usual flow: **Artists → New artist**
(add a photo), **New album** (add a cover), then drop audio files onto the album page. Files
upload one at a time in 4 MiB chunks with a progress bar each, and keep going while you move
around the admin pages (the browser warns before you close the tab). The track table updates
by itself while tracks are queued or converting; failed tracks show the ffmpeg error and a
Retry button. Tracks can be renamed, renumbered, moved up or down, and deleted.

`deploy/demo-catalog.sh` creates an artist and album, uploads a cover, fetches it without a
login, then deletes both and checks the files are gone (`--keep` leaves them for a look).

The admin account (`ADMIN_EMAIL` / `ADMIN_PASSWORD` in `deploy/.env`) is created on the first
start. Changing those values later does not change the existing account; change the password
on the web app's Account page instead (and update `ADMIN_PASSWORD` in `deploy/.env` if you
want the demo scripts to keep working).

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
| Streaming | `GET /api/tracks/:id/stream-url`, then `GET /stream/<token>/<id>/master.m3u8` (no auth header) |
| Search | `GET /api/search?q=` → `{ tracks, albums, artists }` |
| Library | `GET /api/me/likes`, `GET /api/me/likes/ids`, `PUT/DELETE /api/me/likes/:trackId`, `POST /api/me/history`, `GET /api/me/recent` |
| Users (admin) | `GET/POST /api/admin/users`, `PATCH /api/admin/users/:id` |
| Artists (admin) | `GET/POST /api/admin/artists`, `PATCH/DELETE /api/admin/artists/:id`, `PUT/DELETE /api/admin/artists/:id/image` |
| Albums (admin) | `GET/POST /api/admin/albums`, `GET/PATCH/DELETE /api/admin/albums/:id`, `PUT/DELETE /api/admin/albums/:id/cover` |
| Tracks (admin) | `POST /api/admin/tracks`, `GET/PATCH/DELETE /api/admin/tracks/:id`, `GET/PUT /api/admin/tracks/:id/upload`, `POST /api/admin/tracks/:id/upload/complete`, `POST /api/admin/tracks/:id/retry` |

- Listener catalog routes only show albums and artists that have at least one playable
  (READY) track.
- Images are uploaded as multipart field `image` (JPEG, PNG, WebP, GIF or AVIF, max 10 MB) and
  stored as 300 px and 600 px square WebP files. Responses give their paths as
  `cover: { small, large }` (albums) or `image: { small, large }` (artists), served publicly
  from `/media/covers/` with a one-year immutable cache.
- An artist can only be deleted once it has no albums or tracks. An album with tracks is
  deleted with `DELETE /api/admin/albums/:id?deleteTracks=true`, which also removes its tracks,
  their uploaded files, streams, likes and play history (without the flag it returns 409). In
  the web app, use **Delete album** on the album page or the trash icon in the Albums list.
- `deploy/admin-api.sh catalog` lists artists and albums on production;
  `deploy/admin-api.sh call METHOD PATH [JSON]` makes one-off admin API calls.

### Uploading tracks

Uploads are chunked so that no single request runs into Traefik's 60-second timeout:

1. `POST /api/admin/tracks` with `{ albumId, filename, sizeBytes, title?, trackNumber?, artistId? }`.
   Title defaults to the file name without extension, track number to the next free one on
   the album. The response has the track (status `UPLOADING`) and `upload.chunkBytes` (4 MiB).
2. `PUT /api/admin/tracks/:id/upload?offset=N` with the raw bytes
   (`Content-Type: application/octet-stream`, at most 16 MiB). `offset` must equal the bytes
   received so far; on a mismatch the 409 response includes `receivedBytes`.
   `GET /api/admin/tracks/:id/upload` also reports it, so an interrupted upload can resume.
3. `POST /api/admin/tracks/:id/upload/complete`. ffprobe checks the file. Non-audio files are
   discarded (400); audio becomes `PENDING` and is queued.

The worker (`node dist/worker.js`, Deployment `worker`) then transcodes one track at a time:
`PROCESSING`, then `READY` with `hls/<id>/master.m3u8` plus `96k/`, `160k/`, `320k/`
(AAC in fMP4 segments of 6 s), or `FAILED` with `errorMessage` after 3 attempts.
`POST .../retry` re-queues a failed track. A 3-minute MP3 takes about 45 s, and the HLS output
is about 1.6 times the size of a 320 kbps original.

`deploy/demo-upload.sh [file]` runs the whole flow against production and prints the result.

### Streaming

`GET /api/tracks/:id/stream-url` (any logged-in user, READY tracks only) returns
`{ url: "/stream/<token>/<trackId>/master.m3u8", expiresAt }`. Hand that URL, prefixed with the
site origin, straight to hls.js, Safari's `<audio>` or ExoPlayer; no headers are needed.

- The token is `base64url(userId.trackId.exp)` plus an HMAC-SHA256 signature with
  `STREAM_SECRET`. It is valid for one track for 6 hours (`STREAM_TTL_SECONDS`). Players should
  fetch a new URL when a track starts or the old one is close to `expiresAt`.
- Segment URLs inside the playlists are relative, so they carry the token without the server
  rewriting playlists.
- Only `master.m3u8` and `<96k|160k|320k>/{index.m3u8, init_N.mp4, seg_NNN.m4s}` can be
  fetched. Originals and anything else are unreachable.
- Deactivating a user stops their stream links at once.
- Responses are `Cache-Control: private, max-age=<seconds until expiry>` and support byte ranges.

`deploy/demo-stream.sh` gets a stream URL for the newest track, decodes it with ffmpeg over
HTTPS, and shows tampered tokens, missing tokens and other paths being refused.

## Web player

Listeners browse Home (newest albums), album pages and artist pages. Clicking a track plays the
album from there. The player bar has shuffle, previous, play/pause, next, repeat (off, all,
one), a seek bar and volume (remembered per browser). OS media keys, headset buttons and the
lock screen work through the Media Session API.

- `src/player/queue.ts`: pure queue rules. "Previous" restarts the track after 3 s. A manual
  "next" moves on even with repeat one. Shuffle keeps the playing track and orders the rest
  randomly.
- `src/player/store.ts`: zustand store with the queue and the user's intent (playing or not).
- `src/player/engine.ts`: drives one `<audio>` element from the store. It fetches a signed
  stream URL per track and plays it with hls.js (loaded on first play), or natively in Safari.
  On a 401/403, or when resuming after the URL expired, it fetches a new URL and continues at
  the same position.

Unit tests use a fake hls.js. Playwright's bundled Chromium can't decode AAC, so the real
playback check (`scripts/browser-demo.sh player`) runs Google Chrome.

### Search, liked songs and recently played

- **Search** uses Postgres `pg_trgm` with GIN indexes on track and album titles and artist
  names. It matches substrings in any case and tolerates about one typo per word ("secnd wind").
  Exact titles rank first, then titles starting with the query, then the closest matches.
  Songs and albums also match on the artist's name, ranked below title matches. Only playable
  music is returned.
- **Likes** are idempotent (`PUT` twice or `DELETE` twice is fine). `GET /api/me/likes/ids`
  returns every liked id so clients can draw hearts anywhere. Likes are removed with the track.
- **History**: the client sends `POST /api/me/history` after 30 s of actual listening (half
  the length for songs under a minute; seeking doesn't count). `playedAt` may be up to 30 days
  in the past so offline plays can be sent later, and two reports for the same track within
  30 s count once. `GET /api/me/recent` lists the last 20 different tracks.

`deploy/demo-discover.sh` runs searches, likes and unlikes two songs, and records a play as
the admin.

### Playlists

Each listener has private playlists (others get 404). `GET/POST /api/me/playlists`,
`GET/PATCH/DELETE /api/me/playlists/:id`, `POST /api/me/playlists/:id/tracks { trackIds }`
(appends, skipping unplayable tracks), `DELETE /api/me/playlists/:id/tracks/:itemId` and
`POST /api/me/playlists/:id/move { itemId, toIndex }`. Entries have their own `itemId`, so a
song can be in a playlist twice. Limits: 500 playlists per user, 5,000 songs per playlist.

In the web app: **+** next to Playlists in the sidebar creates one. "⋯ → Add to playlist" on
any song adds it to a playlist (or a new one). On the playlist page, drag songs by the handle
(mouse or keyboard), or use "⋯ → Move up / Move down / Remove from this playlist".
`scripts/browser-demo.sh playlist` checks create, add, drag-reorder and delete in a real browser.

## Android app

`android/` is a Kotlin + Jetpack Compose app: application id `in.snowsig.music`, minSdk 26,
targetSdk 36. The Kotlin package is `snowsig.music`, because `in` is a Kotlin keyword. It talks
to `https://music.snowsig.in` (`BASE_URL` in `app/build.gradle.kts`).

**On your PC:** clone the repo, open the `android/` folder in Android Studio, let Gradle sync,
and press Run. Android Studio installs the SDK pieces it needs.

**On the Dev server (no Android Studio needed):** `scripts/android.sh` copies `android/` to the
server and runs Gradle in a container with the Android SDK (`android/ci/Dockerfile`). Reports
and APKs are copied back to `android/app/build/`.

```bash
scripts/android.sh testDebugUnitTest assembleDebug
# APK: android/app/build/outputs/apk/debug/app-debug.apk
```

The server has no KVM, so emulator tests (`connectedAndroidTest`) must run from Android Studio
on your PC.

Login: the refresh token is stored in DataStore, encrypted with an AES-GCM key held in the
Android Keystore. The access token lives only in memory. An OkHttp authenticator refreshes on
401, one refresh at a time; login and refresh use their own OkHttp dispatcher so waiting requests
can't block them. If the server can't be reached at startup, the app stays signed in with the
cached profile.

### What the Android app does

- **Screens:** Login, Home (recently played, new albums), Search, Your Library (Liked Songs,
  Downloads, playlists, recently played), album, artist and playlist pages, and a full Now
  Playing screen.
- **Playback** (`playback/PlaybackService.kt`, a Media3 `MediaSessionService` with ExoPlayer):
  - Playback continues in the background with notification, lock-screen, Bluetooth and headset
    controls, and keeps going when the app is swiped away.
  - It pauses for calls and other apps (audio focus) and when headphones are unplugged.
  - Each queue item is `music://track/<id>`. A `ResolvingDataSource` swaps in a fresh signed
    URL when ExoPlayer loads it, and refreshes it once on a 401/403.
- **Likes and playlists:** hearts everywhere; "⋯ → Add to playlist / Download / Go to album /
  Go to artist"; playlist Move up/down, Remove, Rename and Delete. Changes show at once and are
  undone if the server refuses.
- **Offline** (`offline/`):
  - The download button on an album, playlist or Liked Songs (or "⋯ → Download") saves songs
    to the phone at 160 kbps, about 1.2 MB a minute.
  - Downloaded songs always play from the phone. When offline, a banner appears, other songs
    are greyed out, and only downloaded songs are queued.
  - Plays are stored in Room and sent by WorkManager once there's a connection, with the
    time they really happened.
  - Media3 caches by URL, so cache keys drop the stream token
    (`TokenStrippingCacheKeyFactory`); otherwise downloads would be lost when their URL expired.

**Check on a phone** (the server can't run an emulator):

1. Log in, play an album, lock the phone, and skip from the lock screen. Swipe the app away;
   the music keeps playing.
2. Download an album. Watch the download notification, and see the green markers when done.
3. Turn on airplane mode, open Library → Downloads and play. Other songs are greyed out.
4. Listen for 30 s, turn the network back on, and the play shows up under Recently played on
   the web.

## Release APK

1. Create a release key once and keep it safe. Without it you can't update the installed app:

   ```bash
   keytool -genkeypair -keystore music-release.jks -alias music -keyalg RSA -keysize 3072 -validity 10000
   ```

   (or in Android Studio: Build → Generate Signed App Bundle / APK → Create new).
2. Create `android/keystore.properties`. It is gitignored; never commit it or the `.jks` file:

   ```properties
   music.keystore.path=C:/Users/tamil/keys/music-release.jks
   music.keystore.password=...
   music.key.alias=music
   music.key.password=...
   ```

3. Build: Android Studio → Build → Build APK(s) with the `release` variant, or
   `gradlew assembleRelease` in `android/`. The APK is at
   `android/app/build/outputs/apk/release/app-release.apk` (about 3 MB; R8 shrinks it).
4. Install it on your phone. Copy the file over and allow "install unknown apps", or use
   `adb install app-release.apk`.

Raise `versionCode` (and `versionName`) in `android/app/build.gradle.kts` for each new release,
so phones accept it as an update.

## Backups

`deploy/backup.sh` runs on the Dev server. It writes `/srv/music-backups/<UTC time>/` with
`db.dump` (pg_dump), `media/` (all music files) and `manifest.txt` (row counts). Unchanged files
are hard links to the previous backup, so a daily backup only uses space for new music. The
last 7 are kept.

```bash
ssh Dev /opt/music-app/deploy/backup.sh          # back up now
ssh Dev /opt/music-app/deploy/restore-test.sh    # restore the newest into a scratch DB and compare
```

To back up every night at 03:30, add this line with `ssh Dev crontab -e`:

```
30 3 * * * /opt/music-app/deploy/backup.sh >> /var/log/music-backup.log 2>&1
```

These backups sit on the same disk as the music. Copy `/srv/music-backups` to another machine
now and then, for example with `rsync -a Dev:/srv/music-backups/ /backup/music/`.

**Restoring for real** (this replaces the live data):

```bash
ssh Dev
B=/srv/music-backups/<time>
microk8s kubectl -n music scale deploy/api deploy/worker --replicas=0
microk8s kubectl -n music exec -i postgres-0 -- pg_restore -U music -d music --clean --if-exists --no-owner < $B/db.dump
rsync -a --delete $B/media/ /srv/music/ && chown -R 1000:1000 /srv/music
microk8s kubectl -n music scale deploy/api deploy/worker --replicas=1
```

## Tests

| Part | Command | Count |
| --- | --- | --- |
| Server unit | `scripts/node.sh server npm test` | 22 |
| Server e2e (Postgres, Redis, ffmpeg) | `scripts/node.sh server npm run test:e2e` | 95 |
| Web (Vitest, Testing Library, MSW) | `scripts/node.sh web npm test` | 80 |
| Android unit (JUnit, MockK, Turbine, Robolectric) | `scripts/android.sh testDebugUnitTest` | 48 |
| Production checks | `deploy/smoke.sh`, `deploy/demo-*.sh`, `scripts/browser-demo.sh <auth\|catalog\|player\|playlist>` | |
