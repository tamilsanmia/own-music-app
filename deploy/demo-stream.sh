#!/usr/bin/env bash
# Task 7 demo against production: get a signed stream URL for the newest playable track,
# decode it with ffmpeg over HTTPS (exactly as a player would fetch it), and show that
# tampered tokens, other paths and requests without a token are refused.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
BASE="${BASE_URL:-https://music.snowsig.in}"
set -a; . ./.env; set +a

json() { python3 -c "import sys,json; d=json.load(sys.stdin); print(eval('d'+sys.argv[1]))" "$1"; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

TOKEN="$(curl -fsS -H 'Content-Type: application/json' -X POST "$BASE/api/auth/login" \
  -d "$(python3 -c 'import json,os; print(json.dumps({"email":os.environ["ADMIN_EMAIL"],"password":os.environ["ADMIN_PASSWORD"],"client":"mobile"}))')" \
  | json "['accessToken']")"
auth=(-H "Authorization: Bearer $TOKEN")

ALBUM="$(curl -fsS "${auth[@]}" "$BASE/api/home" | json "['newAlbums'][0]['id']")"
TRACK="$(curl -fsS "${auth[@]}" "$BASE/api/albums/$ALBUM" | json "['tracks'][0]['id']")"
echo "==> Track $TRACK"

RESP="$(curl -fsS "${auth[@]}" "$BASE/api/tracks/$TRACK/stream-url")"
URL="$BASE$(echo "$RESP" | json "['url']")"
echo "expires: $(echo "$RESP" | json "['expiresAt']")"
SIGNED="$(echo "$URL" | cut -d/ -f5)"

echo "==> Master playlist (no Authorization header)"
curl -fsS -D - "$URL" | grep -i -E '^(HTTP|content-type|cache-control)|m3u8'

echo "==> Decode the whole stream with ffmpeg, as a player would"
docker run --rm music-dev-node:24 sh -c "
  ffprobe -v error -show_entries format=duration:stream=codec_name,sample_rate,channels -of default=nw=1 '$URL' &&
  ffmpeg -v error -i '$URL' -map 0:a:1 -f null - && echo 'decoded 160k rendition without errors'"

echo "==> Refused requests"
TAMPERED="${SIGNED%??}AA"; [ "$TAMPERED" = "$SIGNED" ] && TAMPERED="${SIGNED%??}BB"
printf 'tampered token:          %s\n' "$(code "$BASE/stream/$TAMPERED/$TRACK/master.m3u8")"
printf 'no token:                %s\n' "$(code "$BASE/stream/$TRACK/master.m3u8")"
printf 'path outside HLS folder: %s\n' "$(code "$BASE/stream/$SIGNED/$TRACK/..%2F..%2Foriginals%2F$TRACK.mp3")"
printf 'stream-url, logged out:  %s\n' "$(code "$BASE/api/tracks/$TRACK/stream-url")"
