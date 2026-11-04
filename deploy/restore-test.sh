#!/usr/bin/env bash
# Prove a backup can be restored, without touching the live app. Runs ON the Dev server:
#   ssh Dev /opt/music-app/deploy/restore-test.sh [backup-dir]
# Restores db.dump into a throwaway PostgreSQL container, compares row counts with the backup's
# manifest, and checks that every playable track's files are in the backup's media/.
set -euo pipefail

ROOT="${BACKUP_ROOT:-/srv/music-backups}"
DIR="${1:-$(find "$ROOT" -mindepth 1 -maxdepth 1 -type d -name '2*' | sort | tail -1)}"
[ -f "$DIR/db.dump" ] || { echo "No backup found in ${DIR:-$ROOT}" >&2; exit 1; }
NAME="music-restore-test-$$"
echo "==> Restoring $DIR into a temporary database"

docker run -d --rm --name "$NAME" -e POSTGRES_PASSWORD=restore-test -e POSTGRES_DB=music postgres:16-alpine >/dev/null
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 60); do docker exec "$NAME" pg_isready -U postgres -d music -q 2>/dev/null && break; sleep 1; done
# Wait for the init restart to finish too.
sleep 3
docker exec "$NAME" sh -c 'until pg_isready -U postgres -d music -q; do sleep 1; done'
docker exec -i "$NAME" pg_restore -U postgres -d music --no-owner --no-privileges --exit-on-error < "$DIR/db.dump"

psql() { docker exec "$NAME" psql -U postgres -d music -tAc "$1"; }
fail=0
echo "==> Row counts (backup manifest vs restored)"
while read -r key expected; do
  case "$key" in
    rows.*)
      table="${key#rows.}"
      got="$(psql "SELECT count(*) FROM \"$table\"")"
      printf '  %-14s %6s %6s %s\n' "$table" "$expected" "$got" "$([ "$got" = "$expected" ] && echo ok || echo MISMATCH)"
      [ "$got" = "$expected" ] || fail=1
      ;;
  esac
done < "$DIR/manifest.txt"

echo "==> Files for every playable track"
missing=0
total=0
while IFS='|' read -r id ext; do
  total=$((total + 1))
  [ -f "$DIR/media/originals/$id.$ext" ] || { echo "  missing original $id.$ext"; missing=$((missing + 1)); }
  [ -f "$DIR/media/hls/$id/master.m3u8" ] || { echo "  missing stream $id"; missing=$((missing + 1)); }
done < <(psql "SELECT id, \"originalExt\" FROM \"Track\" WHERE status = 'READY'")
echo "  $total playable tracks, $missing missing files"
[ "$missing" -eq 0 ] || fail=1

covers=0
while read -r cid; do
  [ -z "$cid" ] && continue
  [ -f "$DIR/media/covers/$cid-600.webp" ] || covers=$((covers + 1))
done < <(psql "SELECT \"coverId\" FROM \"Album\" WHERE \"coverId\" IS NOT NULL UNION ALL SELECT \"imageId\" FROM \"Artist\" WHERE \"imageId\" IS NOT NULL")
echo "  missing cover images: $covers"
[ "$covers" -eq 0 ] || fail=1

[ "$fail" -eq 0 ] && echo "OK: $DIR restores cleanly" || { echo "FAILED" >&2; exit 1; }
