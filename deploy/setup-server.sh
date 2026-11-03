#!/usr/bin/env bash
# One-time, idempotent preparation of the Dev server. Runs ON the server (deploy.sh calls it).
# The cluster is shared with other apps: this script only checks addons and creates the music
# data directories. It never disables addons or edits other namespaces or the shared issuer.
set -euo pipefail

K="microk8s kubectl"

microk8s status --wait-ready --timeout 60 >/dev/null

for addon in dns ingress cert-manager registry; do
  if ! microk8s status --addon "$addon" | grep -q enabled; then
    echo "microk8s addon '$addon' is not enabled. Enable it manually (shared cluster):" >&2
    echo "  microk8s enable $addon" >&2
    exit 1
  fi
done

if ! $K get clusterissuer letsencrypt-prod >/dev/null 2>&1; then
  echo "ClusterIssuer letsencrypt-prod not found; create it before deploying." >&2
  exit 1
fi

# Media is written by the api/worker pods (uid 1000). The postgres:16-alpine image runs as
# uid 70, which must be able to enter /srv/music-db to reach PGDATA.
mkdir -p /srv/music/originals /srv/music/hls /srv/music/covers /srv/music/tmp /srv/music-db
chown -R 1000:1000 /srv/music
chmod 750 /srv/music
chown 70:70 /srv/music-db
chmod 700 /srv/music-db

echo "Server ready: addons enabled, /srv/music and /srv/music-db present."
