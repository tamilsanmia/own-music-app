#!/usr/bin/env bash
# Build and test the Android app on the Dev server, in a container with the Android SDK.
# (This PC has no Android SDK and too little disk for one; in Android Studio, just open android/.)
#
# Usage: scripts/android.sh <gradle tasks...>
#   scripts/android.sh testDebugUnitTest assembleDebug
# Test reports and APKs are copied back to android/app/build/ (gitignored).
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="${DEPLOY_HOST:-Dev}"
REMOTE=/opt/music-app-android
IMAGE=music-android-build:36

[ $# -gt 0 ] || { echo "usage: $0 <gradle tasks...>" >&2; exit 1; }

ssh "$HOST" "mkdir -p $REMOTE"
rsync -az --delete --exclude .gradle --exclude build --exclude local.properties --exclude keystore.properties --exclude '*.jks' \
  "$REPO_ROOT/android/" "$HOST:$REMOTE/"

status=0
ssh "$HOST" bash -s -- "$REMOTE" "$IMAGE" "$@" <<'REMOTE' || status=$?
set -euo pipefail
DIR="$1"; IMAGE="$2"; shift 2
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "==> Building $IMAGE (first run only)"
  docker build -q -t "$IMAGE" "$DIR/ci" >/dev/null
fi
docker volume create music-android-gradle >/dev/null
docker volume create music-android-m2 >/dev/null
docker volume create music-android-home >/dev/null
# ~/.m2 holds Robolectric's android-all jar; keeping it avoids re-downloading (and Maven Central 429s).
# ~/.android holds debug.keystore; without it every build gets a new debug key and Android
# refuses to install the APK over the previous one.
docker run --rm \
  -v "$DIR":/project -w /project \
  -v music-android-gradle:/root/.gradle \
  -v music-android-m2:/root/.m2 \
  -v music-android-home:/root/.android \
  -e GRADLE_OPTS="-Dorg.gradle.daemon=false" \
  "$IMAGE" ./gradlew --no-daemon --console=plain "$@"
REMOTE

mkdir -p "$REPO_ROOT/android/app/build"
rsync -az "$HOST:$REMOTE/app/build/reports" "$HOST:$REMOTE/app/build/test-results" "$HOST:$REMOTE/app/build/outputs" \
  "$REPO_ROOT/android/app/build/" 2>/dev/null || true
exit $status
