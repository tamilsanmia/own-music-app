#!/usr/bin/env bash
# Run a Playwright browser demo against production, on the Dev server (it has the disk space
# for the ~2 GB browser image; this PC doesn't). Screenshots are copied to .data/browser-demo/.
#
# Usage: scripts/browser-demo.sh [--cleanup] [auth|catalog]
#   auth     login, users, roles (scripts/browser-demo-auth.mjs) - default
#   catalog  artist, album, cover and track uploads (scripts/browser-demo-catalog.mjs)
#   playlist create, add, drag-reorder and delete a playlist
#   player   real playback in Google Chrome, which has the AAC decoder Playwright's Chromium lacks
#   --cleanup  remove the Playwright image from the server afterwards
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="${DEPLOY_HOST:-Dev}"
PW_VERSION=1.64.1
IMAGE="mcr.microsoft.com/playwright:v${PW_VERSION}-noble"
CLEANUP=""; [ "${1:-}" = --cleanup ] && { CLEANUP=--cleanup; shift; }
DEMO="${1:-auth}"
CHANNEL=none; [ "$DEMO" = player ] && CHANNEL=chrome
SCRIPT="$REPO_ROOT/scripts/browser-demo-$DEMO.mjs"
[ -f "$SCRIPT" ] || { echo "No demo named $DEMO" >&2; exit 1; }

ASSETS="$(mktemp -d)"; trap 'rm -rf "$ASSETS"' EXIT
if [ "$DEMO" = catalog ]; then
  echo "==> Generating demo assets"
  # Three short two-tone MP3s with distinct lengths, a cover and an artist photo.
  docker run --rm -v "$ASSETS":/a -w /a music-dev-node:24 sh -c '
    for spec in "01 Morning Light:262:20" "02 Second Wind:330:30" "03 Long Way Home:196:40"; do
      name=${spec%%:*}; rest=${spec#*:}; f=${rest%%:*}; d=${rest#*:}
      ffmpeg -loglevel error -f lavfi -i "sine=frequency=$f:duration=$d" -f lavfi -i "sine=frequency=$((f*3/2)):duration=$d" \
        -filter_complex amerge=inputs=2 -c:a libmp3lame -b:a 192k "$name.mp3"
    done
    ffmpeg -loglevel error -f lavfi -i "gradients=s=1200x1200:c0=0x1ed760:c1=0x121212:duration=1" -frames:v 1 cover.png
    ffmpeg -loglevel error -f lavfi -i "mandelbrot=s=800x800" -frames:v 1 artist.png
    chmod a+r *'
fi

scp -q "$SCRIPT" "$HOST:/tmp/music-browser-demo.mjs"
ssh "$HOST" 'rm -rf /tmp/music-browser-demo-assets && mkdir -p /tmp/music-browser-demo-assets'
if [ -n "$(ls -A "$ASSETS")" ]; then scp -q "$ASSETS"/* "$HOST:/tmp/music-browser-demo-assets/"; fi

# ssh joins arguments into one string, so an empty one would vanish: pass "keep" instead.
status=0
ssh "$HOST" bash -s -- "$IMAGE" "$PW_VERSION" "${CLEANUP:-keep}" "$CHANNEL" <<'REMOTE' || status=$?
set -uo pipefail
IMAGE="$1"; PW_VERSION="$2"; CLEANUP="$3"; CHANNEL="$4"
OUT=/tmp/music-browser-demo; rm -rf "$OUT"; mkdir -p "$OUT"; chmod 777 "$OUT"
docker run --rm --ipc=host --env-file /opt/music-app/deploy/.env -e BROWSER_CHANNEL="${CHANNEL#none}" \
  -v /tmp/music-browser-demo.mjs:/demo/demo.mjs:ro -v /tmp/music-browser-demo-assets:/assets:ro -v "$OUT":/out "$IMAGE" \
  bash -c "cd /demo && npm i -s --no-fund --no-audit playwright@$PW_VERSION >/dev/null 2>&1 &&
    if [ '$CHANNEL' != none ]; then npx playwright install --with-deps $CHANNEL >/dev/null 2>&1; fi && node demo.mjs"
status=$?
rm -rf /tmp/music-browser-demo.mjs /tmp/music-browser-demo-assets
[ "$CLEANUP" = --cleanup ] && docker rmi -f "$IMAGE" >/dev/null
exit $status
REMOTE
mkdir -p "$REPO_ROOT/.data/browser-demo"
scp -q "$HOST:/tmp/music-browser-demo/*.png" "$REPO_ROOT/.data/browser-demo/" 2>/dev/null || true
ssh "$HOST" rm -rf /tmp/music-browser-demo
echo "Screenshots: .data/browser-demo/"
exit $status
