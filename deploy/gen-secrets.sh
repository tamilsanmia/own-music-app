#!/usr/bin/env bash
# Create deploy/.env with random secrets if it doesn't exist. Never overwrites an existing file.
# Usage: deploy/gen-secrets.sh <admin-email>
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

ADMIN_EMAIL="${1:?usage: deploy/gen-secrets.sh <admin-email>}"
if [ -e .env ]; then
  echo "deploy/.env already exists; leaving it unchanged." >&2
  exit 0
fi

umask 077
cat > .env <<EOF
POSTGRES_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 32)
STREAM_SECRET=$(openssl rand -hex 32)
ADMIN_EMAIL=${ADMIN_EMAIL}
ADMIN_PASSWORD=$(openssl rand -hex 12)
EOF
echo "Wrote deploy/.env (mode 600). The admin password is in that file."
