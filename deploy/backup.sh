#!/usr/bin/env bash
# Back up the music app on the Dev server: a PostgreSQL dump plus a copy of /srv/music.
# Runs ON the server (deploy.sh keeps a copy at /opt/music-app/deploy/backup.sh):
#   ssh Dev /opt/music-app/deploy/backup.sh
#
# Each run creates /srv/music-backups/<UTC time>/ with:
#   db.dump       pg_dump custom format (restore with pg_restore)
#   media/        originals/, hls/, covers/ (unchanged files are hard links to the previous
#                 backup, so daily backups only use space for what changed)
#   manifest.txt  row counts and sizes at backup time (used by restore-test.sh)
# The newest $KEEP backups are kept (default 7).
#
# These backups are on the same disk as the data: they protect against mistakes (deleted
# albums, bad migrations), not against losing the server. Copy them elsewhere too.
#
# Cron, every night at 03:30 server time:
#   30 3 * * * /opt/music-app/deploy/backup.sh >> /var/log/music-backup.log 2>&1
set -euo pipefail

ROOT="${BACKUP_ROOT:-/srv/music-backups}"
KEEP="${KEEP:-7}"
MEDIA=/srv/music
K="microk8s kubectl -n music"

ts="$(date -u +%Y%m%dT%H%M%SZ)"
tmp="$ROOT/.incomplete-$ts"
mkdir -p "$tmp"
chmod 700 "$ROOT"
trap 'rm -rf "$tmp"' ERR
prev="$(find "$ROOT" -mindepth 1 -maxdepth 1 -type d -name '2*' | sort | tail -1)"

echo "[$ts] database"
$K exec postgres-0 -- pg_dump -U music -d music -Fc > "$tmp/db.dump"
# Sanity check: a custom-format dump starts with "PGDMP".
[ "$(head -c 5 "$tmp/db.dump")" = PGDMP ] || { echo "pg_dump output is not a dump" >&2; exit 1; }

echo "[$ts] media${prev:+ (unchanged files linked to $(basename "$prev"))}"
rsync -a --delete --exclude /tmp/ ${prev:+--link-dest="$prev/media"} "$MEDIA/" "$tmp/media/"

count() { $K exec postgres-0 -- psql -U music -d music -tAc "SELECT count(*) FROM \"$1\""; }
{
  echo "created $ts"
  for t in User Artist Album Track Playlist PlaylistTrack LikedTrack PlayHistory; do echo "rows.$t $(count "$t")"; done
  echo "ready_tracks $($K exec postgres-0 -- psql -U music -d music -tAc "SELECT count(*) FROM \"Track\" WHERE status = 'READY'")"
  echo "db_bytes $(stat -c %s "$tmp/db.dump")"
  echo "media_bytes $(du -sb "$tmp/media" | cut -f1)"
} > "$tmp/manifest.txt"

mv "$tmp" "$ROOT/$ts"
trap - ERR

# Keep the newest $KEEP backups.
find "$ROOT" -mindepth 1 -maxdepth 1 -type d -name '2*' | sort | head -n "-$KEEP" | xargs -r rm -rf
find "$ROOT" -mindepth 1 -maxdepth 1 -type d -name '.incomplete-*' -mmin +120 -exec rm -rf {} +

echo "[$ts] done: $ROOT/$ts ($(du -sh "$ROOT/$ts" | cut -f1) new on disk, $(du -sh "$ROOT" | cut -f1) total)"
cat "$ROOT/$ts/manifest.txt"
