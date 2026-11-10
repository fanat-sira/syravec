#!/bin/sh
# Run on the deployment host, inside its pre-provisioned SyraVec directory.
set -eu
: "${SYRAVEC_IMAGE:?set SYRAVEC_IMAGE}"
: "${SYRAVEC_TAG:?set SYRAVEC_TAG}"
case "$SYRAVEC_TAG" in *[!a-zA-Z0-9_.-]*|'') echo 'invalid release tag' >&2; exit 1;; esac
[ -f .env ] || { echo 'create .env on the host first (see README)' >&2; exit 1; }
[ -f 'originals/assets.zip' ] || { echo 'provide the private SVG archive in originals/ first' >&2; exit 1; }
compose() { docker compose -f compose.yaml -f compose.release.yaml "$@"; }
compose config -q
compose pull
previous=$(cat .deployed-tag 2>/dev/null || true)
# Asset failure prevents replacing the running web/API with an incomplete release.
compose run --rm --no-deps assets
if compose up -d --no-build --wait --wait-timeout 120; then
  printf '%s\n' "$SYRAVEC_TAG" > .deployed-tag
else
  echo 'release health check failed' >&2
  if [ -n "$previous" ]; then
    export SYRAVEC_TAG="$previous"
    echo "restoring release $previous" >&2
    compose up -d --no-build --wait --wait-timeout 120
  fi
  exit 1
fi
