#!/usr/bin/env bash
# Run a command inside a Node 24 container, with the repo mounted at /repo.
# Node is not installed on the host, so all npm/test commands go through this.
#
# Usage: scripts/node.sh <subdir> <command...>
#   scripts/node.sh server npm install
#   scripts/node.sh server npm test
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SUBDIR="${1:?usage: scripts/node.sh <subdir> <command...>}"
shift

IMAGE=music-dev-node:24
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  docker build -q -t "$IMAGE" -f "$REPO_ROOT/scripts/dev-node.Dockerfile" "$REPO_ROOT/scripts" >/dev/null
fi

TTY_FLAGS=()
if [ -t 0 ] && [ -t 1 ]; then TTY_FLAGS=(-it); fi

exec docker run --rm "${TTY_FLAGS[@]}" \
  --network host \
  -u "$(id -u):$(id -g)" \
  -e HOME=/tmp \
  -e npm_config_cache=/repo/.data/npm-cache \
  ${NODE_ENV_FILE:+--env-file "$NODE_ENV_FILE"} \
  -v "$REPO_ROOT":/repo \
  -w "/repo/$SUBDIR" \
  "$IMAGE" "$@"
