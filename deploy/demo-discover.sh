#!/usr/bin/env bash
# Task 10 demo against production, as the admin account: search (including a typo), like two
# songs, report a play, and read Liked Songs and Recently played. Undoes the likes at the end;
# the play stays in the admin's history.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
BASE="${BASE_URL:-https://music.snowsig.in}"
set -a; . ./.env; set +a

py() { python3 -c "import sys,json; d=json.load(sys.stdin); $1"; }
TOKEN="$(curl -fsS -H 'Content-Type: application/json' -X POST "$BASE/api/auth/login" \
  -d "$(python3 -c 'import json,os; print(json.dumps({"email":os.environ["ADMIN_EMAIL"],"password":os.environ["ADMIN_PASSWORD"],"client":"mobile"}))')" \
  | py 'print(d["accessToken"])')"
auth=(-H "Authorization: Bearer $TOKEN")
get() { curl -fsS "${auth[@]}" "$BASE$1"; }
search() {
  echo "==> search \"$1\""
  get "/api/search?q=$(python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "$1")" | py '
for k in ("tracks","albums","artists"):
    print(f"  {k:8} " + ", ".join(i.get("title") or i.get("name") for i in d[k]))'
}

search "wind"
search "secnd wind"     # one typo per word is tolerated
search "browser demo"
search "zzzz"

FIRST="$(get "/api/search?q=morning" | py 'print(d["tracks"][0]["id"])')"
SECOND="$(get "/api/search?q=second" | py 'print(d["tracks"][0]["id"])')"

echo "==> like two songs (twice, to show it's idempotent)"
for id in "$FIRST" "$SECOND" "$FIRST"; do
  printf '  PUT %s -> %s\n' "$id" "$(curl -s -o /dev/null -w '%{http_code}' "${auth[@]}" -X PUT "$BASE/api/me/likes/$id")"
done
get /api/me/likes | py 'print("  liked:", d["total"], "-", ", ".join(t["title"] for t in d["items"]))'

echo "==> report a play"
curl -fsS "${auth[@]}" -H 'Content-Type: application/json' -X POST "$BASE/api/me/history" -d "{\"trackId\":\"$SECOND\"}"
get /api/me/recent | py 'print("  recent:", ", ".join(t["title"] for t in d["items"][:5]))'

echo "==> undo the likes"
for id in "$FIRST" "$SECOND"; do curl -fsS "${auth[@]}" -X DELETE "$BASE/api/me/likes/$id"; done
get /api/me/likes/ids | py 'print("  liked ids left:", len(d))'
