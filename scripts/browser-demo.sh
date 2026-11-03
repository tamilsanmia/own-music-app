#!/usr/bin/env bash
# Run scripts/browser-demo.mjs in the Playwright container on the Dev server (it has the disk
# space for the ~2 GB browser image; this PC doesn't). Screenshots are copied to
# .data/browser-demo/. Pass --cleanup to remove the Playwright image from the server afterwards.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="${DEPLOY_HOST:-Dev}"
PW_VERSION=1.64.1
IMAGE="mcr.microsoft.com/playwright:v${PW_VERSION}-noble"

scp -q "$REPO_ROOT/scripts/browser-demo.mjs" "$HOST:/tmp/music-browser-demo.mjs"
ssh "$HOST" bash -s -- "$IMAGE" "$PW_VERSION" "${1:-}" <<'REMOTE'
set -euo pipefail
IMAGE="$1"; PW_VERSION="$2"; CLEANUP="$3"
OUT=/tmp/music-browser-demo; rm -rf "$OUT"; mkdir -p "$OUT"; chmod 777 "$OUT"
docker run --rm --ipc=host --env-file /opt/music-app/deploy/.env \
  -v /tmp/music-browser-demo.mjs:/demo/demo.mjs:ro -v "$OUT":/out "$IMAGE" \
  bash -c "cd /demo && npm i -s --no-fund --no-audit playwright@$PW_VERSION >/dev/null 2>&1 && node demo.mjs"
status=$?
rm -f /tmp/music-browser-demo.mjs
[ "$CLEANUP" = --cleanup ] && docker rmi -f "$IMAGE" >/dev/null
exit $status
REMOTE
mkdir -p "$REPO_ROOT/.data/browser-demo"
scp -q "$HOST:/tmp/music-browser-demo/*.png" "$REPO_ROOT/.data/browser-demo/"
ssh "$HOST" rm -rf /tmp/music-browser-demo
echo "Screenshots: .data/browser-demo/"
