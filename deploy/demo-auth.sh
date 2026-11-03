#!/usr/bin/env bash
# Task 3 demo against production: admin login -> create listener -> listener login ->
# listener gets 403 on the admin API. Reads the admin credentials from deploy/.env and never
# prints them. Leaves a deactivated demo listener behind so it can't be used.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
BASE="${1:-https://music.snowsig.in}"
set -a; . ./.env; set +a

need() { command -v "$1" >/dev/null || { echo "missing $1" >&2; exit 1; }; }
need curl; need python3
json() { python3 -c "import sys,json; print(json.load(sys.stdin)$1)"; }
post() { curl -fsS -H 'Content-Type: application/json' "$@"; }

echo "==> Admin login"
ADMIN_TOKEN="$(post -X POST "$BASE/api/auth/login" \
  -d "$(python3 -c 'import json,os; print(json.dumps({"email":os.environ["ADMIN_EMAIL"],"password":os.environ["ADMIN_PASSWORD"],"client":"mobile"}))')" \
  | json "['accessToken']")"
curl -fsS -H "Authorization: Bearer $ADMIN_TOKEN" "$BASE/api/me"; echo

LISTENER_EMAIL="demo-$(date +%s)@music.snowsig.in"
LISTENER_PASS="$(openssl rand -hex 8)"
echo "==> Create listener $LISTENER_EMAIL"
LISTENER_ID="$(post -X POST -H "Authorization: Bearer $ADMIN_TOKEN" "$BASE/api/admin/users" \
  -d "{\"email\":\"$LISTENER_EMAIL\",\"password\":\"$LISTENER_PASS\",\"displayName\":\"Demo Listener\"}" \
  | json "['id']")"
echo "id=$LISTENER_ID"

echo "==> Listener login"
LISTENER_TOKEN="$(post -X POST "$BASE/api/auth/login" \
  -d "{\"email\":\"$LISTENER_EMAIL\",\"password\":\"$LISTENER_PASS\",\"client\":\"mobile\"}" | json "['accessToken']")"
curl -fsS -H "Authorization: Bearer $LISTENER_TOKEN" "$BASE/api/me"; echo

echo "==> Listener calls GET /api/admin/users"
code="$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $LISTENER_TOKEN" "$BASE/api/admin/users")"
echo "HTTP $code"
[ "$code" = 403 ] || { echo "FAIL: expected 403" >&2; exit 1; }

echo "==> Deactivate demo listener"
post -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" "$BASE/api/admin/users/$LISTENER_ID" \
  -d '{"isActive":false}' | json "['isActive']"
code="$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $LISTENER_TOKEN" "$BASE/api/me")"
echo "listener /api/me after deactivation: HTTP $code"
[ "$code" = 401 ] || { echo "FAIL: expected 401" >&2; exit 1; }
echo "OK"
