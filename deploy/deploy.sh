#!/usr/bin/env bash
# Build and deploy to microk8s on the Dev server.
#
# Runs from your workstation (WSL). It copies the repo to the server over SSH, builds the
# images there, pushes them to the cluster registry (localhost:32000), updates the Secret from
# deploy/.env, applies the Kustomize manifests with the image tag set to the git SHA, and waits
# for the rollout.
#
# Usage: deploy/deploy.sh            (SSH host alias "Dev" from ~/.ssh/config)
#        DEPLOY_HOST=other deploy/deploy.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="${DEPLOY_HOST:-Dev}"
REMOTE_DIR="${REMOTE_DIR:-/opt/music-app}"
REGISTRY=localhost:32000
IMAGES=(server)   # subdirectories with a Dockerfile; web is added in Task 4

cd "$REPO_ROOT"
[ -f deploy/.env ] || { echo "deploy/.env missing. Run: deploy/gen-secrets.sh <admin-email>" >&2; exit 1; }

TAG="$(git rev-parse --short HEAD)"
if [ -n "$(git status --porcelain -- server web deploy)" ]; then
  TAG="${TAG}-dirty-$(date +%s)"
fi
echo "==> Deploying tag $TAG to $HOST"

echo "==> Syncing sources to $HOST:$REMOTE_DIR"
ssh "$HOST" "mkdir -p '$REMOTE_DIR' && chmod 700 '$REMOTE_DIR'"
rsync -az --delete \
  --exclude node_modules --exclude dist --exclude .git --exclude .data \
  --exclude android --exclude coverage \
  ./ "$HOST:$REMOTE_DIR/"

ssh "$HOST" bash -s -- "$REMOTE_DIR" "$TAG" "$REGISTRY" "${IMAGES[@]}" <<'REMOTE'
set -euo pipefail
DIR="$1"; TAG="$2"; REGISTRY="$3"; shift 3
K="microk8s kubectl"
cd "$DIR"

bash deploy/setup-server.sh

for img in "$@"; do
  name="music-$img"
  echo "==> Building $REGISTRY/$name:$TAG"
  docker build -q -t "$REGISTRY/$name:$TAG" "$img"
  docker push -q "$REGISTRY/$name:$TAG"
done

$K apply -f deploy/k8s/namespace.yaml >/dev/null
echo "==> Updating Secret music-secrets"
$K -n music create secret generic music-secrets --from-env-file=deploy/.env \
  --dry-run=client -o yaml | $K apply -f - >/dev/null

# Temporary overlay that pins every image to this build's tag.
OVERLAY="$(mktemp -d)"
trap 'rm -rf "$OVERLAY"' EXIT
cp -r deploy/k8s "$OVERLAY/base"
{
  echo "apiVersion: kustomize.config.k8s.io/v1beta1"
  echo "kind: Kustomization"
  echo "resources: [base]"
  echo "images:"
  for img in "$@"; do
    echo "  - name: music-$img"
    echo "    newName: $REGISTRY/music-$img"
    echo "    newTag: \"$TAG\""
  done
} > "$OVERLAY/kustomization.yaml"

echo "==> Applying manifests"
$K apply -k "$OVERLAY"

echo "==> Waiting for rollout"
$K -n music rollout status statefulset/postgres --timeout=180s
for d in $($K -n music get deploy -o name); do
  $K -n music rollout status "$d" --timeout=300s
done
REMOTE

echo "==> Done. Run deploy/smoke.sh to check https://music.snowsig.in"

