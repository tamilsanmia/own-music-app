#!/usr/bin/env bash
# Small helper for one-off admin tasks against production.
#   deploy/admin-api.sh catalog                   list artists, albums and their track counts
#   deploy/admin-api.sh call METHOD PATH [JSON]   call the API as the admin (prints the response)
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
BASE="${BASE_URL:-https://music.snowsig.in}"
set -a; . ./.env; set +a

TOKEN="$(curl -fsS -H 'Content-Type: application/json' -X POST "$BASE/api/auth/login" \
  -d "$(python3 -c 'import json,os; print(json.dumps({"email":os.environ["ADMIN_EMAIL"],"password":os.environ["ADMIN_PASSWORD"],"client":"mobile"}))')" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["accessToken"])')"

call() {
  local method="$1" path="$2" body="${3:-}"
  curl -sS -w '\nHTTP %{http_code}\n' -X "$method" -H "Authorization: Bearer $TOKEN" \
    ${body:+-H 'Content-Type: application/json' -d "$body"} "$BASE$path"
}

case "${1:-}" in
  catalog)
    {
      echo '{"artists":'; curl -fsS -H "Authorization: Bearer $TOKEN" "$BASE/api/admin/artists?limit=100"
      echo ',"albums":'; curl -fsS -H "Authorization: Bearer $TOKEN" "$BASE/api/admin/albums?limit=100"
      echo '}'
    } | python3 -c '
import sys, json
d = json.load(sys.stdin)
print("ARTISTS")
for a in d["artists"]["items"]:
    print(f"  {a['"'"'name'"'"']!r:32} albums={a['"'"'albumCount'"'"']:<3} tracks={a['"'"'trackCount'"'"']:<4} {a['"'"'id'"'"']}")
print("ALBUMS")
for a in d["albums"]["items"]:
    print(f"  {a['"'"'title'"'"']!r:32} by {a['"'"'artist'"'"']['"'"'name'"'"']!r:26} tracks={a['"'"'trackCount'"'"']:<4} {a['"'"'id'"'"']}")
'
    ;;
  call) shift; call "$@" ;;
  *) echo "usage: $0 catalog | call METHOD PATH [JSON]" >&2; exit 1 ;;
esac
