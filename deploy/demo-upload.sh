#!/usr/bin/env bash
# Task 6 demo against production: upload an audio file in chunks, watch it go
# UPLOADING -> PENDING -> PROCESSING -> READY, and list the HLS output on the server.
# Usage: deploy/demo-upload.sh [audio-file]   (default: a generated 3-minute test tone as MP3)
# Leaves a "Demo Artist / Demo Upload" album with the track in place; the script prints how to
# delete it.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
BASE="${BASE_URL:-https://music.snowsig.in}"
CHUNK=$((4 * 1024 * 1024))
FILE="${1:-}"
set -a; . ./.env; set +a

json() { python3 -c "import sys,json; d=json.load(sys.stdin); print(eval('d'+sys.argv[1]))" "$1"; }
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

if [ -z "$FILE" ]; then
  FILE="$WORK/Demo Tone.mp3"
  echo "==> Generating a 3-minute test file"
  docker run --rm music-dev-node:24 ffmpeg -loglevel error -f lavfi \
    -i "sine=frequency=220:duration=180" -f lavfi -i "sine=frequency=330:duration=180" \
    -filter_complex amerge=inputs=2 -c:a libmp3lame -b:a 320k -f mp3 - > "$FILE"
fi
SIZE=$(stat -c %s "$FILE"); NAME="$(basename "$FILE")"
echo "file: $NAME ($SIZE bytes)"

TOKEN="$(curl -fsS -H 'Content-Type: application/json' -X POST "$BASE/api/auth/login" \
  -d "$(python3 -c 'import json,os; print(json.dumps({"email":os.environ["ADMIN_EMAIL"],"password":os.environ["ADMIN_PASSWORD"],"client":"mobile"}))')" \
  | json "['accessToken']")"
auth=(-H "Authorization: Bearer $TOKEN")
post_json() { curl -fsS "${auth[@]}" -H 'Content-Type: application/json' -X POST "$BASE$1" -d "$2"; }

echo "==> Create artist, album and track"
ARTIST="$(post_json /api/admin/artists '{"name":"Demo Artist"}' | json "['id']")"
ALBUM="$(post_json /api/admin/albums "{\"title\":\"Demo Upload\",\"artistId\":\"$ARTIST\"}" | json "['id']")"
TRACK="$(post_json /api/admin/tracks "$(python3 -c 'import json,sys; print(json.dumps({"albumId":sys.argv[1],"filename":sys.argv[2],"sizeBytes":int(sys.argv[3])}))' "$ALBUM" "$NAME" "$SIZE")" | json "['track']['id']")"
echo "track=$TRACK"

echo "==> Upload in $((CHUNK / 1024 / 1024)) MiB chunks"
offset=0
while [ "$offset" -lt "$SIZE" ]; do
  dd if="$FILE" of="$WORK/chunk" iflag=skip_bytes,count_bytes skip="$offset" count="$CHUNK" status=none
  offset="$(curl -fsS "${auth[@]}" -X PUT -H 'Content-Type: application/octet-stream' \
    --data-binary @"$WORK/chunk" "$BASE/api/admin/tracks/$TRACK/upload?offset=$offset" | json "['receivedBytes']")"
  echo "  $offset / $SIZE"
done
post_json "/api/admin/tracks/$TRACK/upload/complete" '{}' | json "['status'], d['sourceInfo'], d['durationMs']"

echo "==> Waiting for the worker"
last=""
for _ in $(seq 1 120); do
  status="$(curl -fsS "${auth[@]}" "$BASE/api/admin/tracks/$TRACK" | json "['status']")"
  [ "$status" != "$last" ] && echo "  $status" && last="$status"
  case "$status" in READY) break ;; FAILED) curl -fsS "${auth[@]}" "$BASE/api/admin/tracks/$TRACK"; exit 1 ;; esac
  sleep 2
done
[ "$status" = READY ] || { echo "FAIL: still $status" >&2; exit 1; }

echo "==> HLS output on the server"
ssh "${DEPLOY_HOST:-Dev}" "ls /srv/music/hls/$TRACK; cat /srv/music/hls/$TRACK/master.m3u8; ls /srv/music/hls/$TRACK/160k | head -4; du -sh /srv/music/hls/$TRACK /srv/music/originals/$TRACK.*"

echo "==> Listener-visible album"
curl -fsS "${auth[@]}" "$BASE/api/albums/$ALBUM" | json "['tracks']"
echo
echo "Kept. To remove: DELETE /api/admin/tracks/$TRACK, /api/admin/albums/$ALBUM, /api/admin/artists/$ARTIST"
