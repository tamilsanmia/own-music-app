#!/usr/bin/env bash
# Task 5 demo against production: create an artist and an album, upload a cover, fetch the cover
# without logging in, then delete everything and check the files are gone.
# Usage: deploy/demo-catalog.sh [--keep] [image-file]
#   --keep      leave the demo artist/album in place so you can open the cover URL in a browser
#   image-file  your own JPEG/PNG; by default a test pattern is generated with ffmpeg
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
BASE="${BASE_URL:-https://music.snowsig.in}"
KEEP=0; [ "${1:-}" = --keep ] && { KEEP=1; shift; }
IMAGE="${1:-}"
set -a; . ./.env; set +a

json() { python3 -c "import sys,json; d=json.load(sys.stdin); print(eval('d'+sys.argv[1]))" "$1"; }
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

if [ -z "$IMAGE" ]; then
  IMAGE="$WORK/cover.png"
  docker run --rm music-dev-node:24 ffmpeg -loglevel error -f lavfi -i testsrc2=s=1400x1000 \
    -frames:v 1 -f image2pipe -vcodec png - > "$IMAGE"
fi

TOKEN="$(curl -fsS -H 'Content-Type: application/json' -X POST "$BASE/api/auth/login" \
  -d "$(python3 -c 'import json,os; print(json.dumps({"email":os.environ["ADMIN_EMAIL"],"password":os.environ["ADMIN_PASSWORD"],"client":"mobile"}))')" \
  | json "['accessToken']")"
auth=(-H "Authorization: Bearer $TOKEN")

echo "==> Create artist and album"
ARTIST="$(curl -fsS "${auth[@]}" -H 'Content-Type: application/json' -X POST "$BASE/api/admin/artists" \
  -d '{"name":"Demo Artist","bio":"Created by deploy/demo-catalog.sh"}' | json "['id']")"
ALBUM="$(curl -fsS "${auth[@]}" -H 'Content-Type: application/json' -X POST "$BASE/api/admin/albums" \
  -d "{\"title\":\"Demo Album\",\"artistId\":\"$ARTIST\",\"releaseYear\":2026}" | json "['id']")"
echo "artist=$ARTIST album=$ALBUM"

echo "==> Upload cover"
COVER="$(curl -fsS "${auth[@]}" -X PUT -F "image=@$IMAGE" "$BASE/api/admin/albums/$ALBUM/cover" | json "['cover']['large']")"
echo "$BASE$COVER"

echo "==> Fetch cover without logging in"
curl -fsS -D - -o "$WORK/large.webp" "$BASE$COVER" | grep -i -E '^(HTTP|content-type|cache-control)'
file "$WORK/large.webp"

echo "==> Listener view hides the album until it has playable tracks"
code="$(curl -s -o /dev/null -w '%{http_code}' "${auth[@]}" "$BASE/api/albums/$ALBUM")"
echo "GET /api/albums/$ALBUM -> $code"; [ "$code" = 404 ] || { echo "FAIL" >&2; exit 1; }

if [ "$KEEP" = 1 ]; then
  echo "Kept. Open $BASE$COVER in a browser. Delete later with:"
  echo "  DELETE /api/admin/albums/$ALBUM, then DELETE /api/admin/artists/$ARTIST"
  exit 0
fi

echo "==> Delete album and artist; cover files must disappear"
curl -fsS "${auth[@]}" -X DELETE "$BASE/api/admin/albums/$ALBUM"
curl -fsS "${auth[@]}" -X DELETE "$BASE/api/admin/artists/$ARTIST"
code="$(curl -s -o /dev/null -w '%{http_code}' "$BASE$COVER")"
echo "cover after delete -> $code"; [ "$code" = 404 ] || { echo "FAIL" >&2; exit 1; }
echo "OK"
