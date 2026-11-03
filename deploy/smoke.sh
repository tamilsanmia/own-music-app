#!/usr/bin/env bash
# Check the public deployment: health endpoint over HTTPS with a trusted Let's Encrypt cert.
set -euo pipefail
HOST="${1:-music.snowsig.in}"

echo "==> GET https://$HOST/api/health"
body="$(curl -fsS --max-time 10 "https://$HOST/api/health")"
echo "$body"
echo "$body" | grep -q '"db":"up"' || { echo "FAIL: database not up" >&2; exit 1; }

echo "==> Web app shell, including client-side routes"
for path in / /admin/users; do
  headers="$(curl -fsS -D - -o /dev/null --max-time 10 "https://$HOST$path")"
  echo "$headers" | grep -qi '^content-type: text/html' || { echo "FAIL: $path is not HTML" >&2; exit 1; }
  echo "$headers" | grep -qi '^content-security-policy:' || { echo "FAIL: $path has no CSP" >&2; exit 1; }
  echo "$path ok"
done

echo "==> Unknown /api paths reach the API, not the web app"
type="$(curl -s -o /dev/null -w '%{content_type}' --max-time 10 "https://$HOST/api/does-not-exist")"
case "$type" in application/json*) echo "$type" ;; *) echo "FAIL: got $type" >&2; exit 1 ;; esac

echo "==> HTTP redirects to HTTPS"
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://$HOST/api/health")"
[ "$code" = 301 ] || [ "$code" = 308 ] || { echo "FAIL: expected redirect, got $code" >&2; exit 1; }
echo "$code"

echo "==> Certificate"
cert="$(echo | openssl s_client -connect "$HOST:443" -servername "$HOST" 2>/dev/null \
  | openssl x509 -noout -issuer -subject -enddate)"
echo "$cert"
echo "$cert" | grep -q "Let's Encrypt" || { echo "FAIL: certificate is not from Let's Encrypt" >&2; exit 1; }
echo "$cert" | grep -q "STAGING" && { echo "FAIL: staging certificate" >&2; exit 1; }

echo "OK"
