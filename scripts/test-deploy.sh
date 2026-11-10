#!/bin/sh
# Exercise deployment guards and rollback without Docker, SSH or production files.
set -eu
repo=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
test_root=$(mktemp -d)
trap 'rm -rf "$test_root"' EXIT HUP INT TERM
mkdir -p "$test_root/bin" "$test_root/site/originals"
cat > "$test_root/bin/docker" <<'MOCK'
#!/bin/sh
printf '%s|%s\n' "$SYRAVEC_TAG" "$*" >> "$DEPLOY_TEST_LOG"
case "$*" in
  *' up '*)
    [ "${FAIL_NEW_RELEASE:-0}" != 1 ] || [ "$SYRAVEC_TAG" = old ] || exit 1
    ;;
esac
MOCK
chmod +x "$test_root/bin/docker"
export PATH="$test_root/bin:$PATH" DEPLOY_TEST_LOG="$test_root/calls" SYRAVEC_IMAGE=ghcr.io/example/syravec SYRAVEC_TAG=new
cd "$test_root/site"
# Missing environment/archive must fail before contacting Docker.
if sh "$repo/scripts/deploy.sh" > "$test_root/output" 2>&1; then exit 1; fi
test ! -f "$DEPLOY_TEST_LOG"
: > .env
if sh "$repo/scripts/deploy.sh" > "$test_root/output" 2>&1; then exit 1; fi
test ! -f "$DEPLOY_TEST_LOG"
: > 'originals/assets.zip'
# A host with only the old large archive must keep its current release running.
if sh "$repo/scripts/deploy.sh" > "$test_root/output" 2>&1; then exit 1; fi
test ! -f "$DEPLOY_TEST_LOG"
grep -qF 'small original SVG archive' "$test_root/output"
: > 'originals/assets-small.zip'
printf 'old\n' > .deployed-tag
# New release fails; previous tag is restored and recorded tag is preserved.
if FAIL_NEW_RELEASE=1 sh "$repo/scripts/deploy.sh" > "$test_root/output" 2>&1; then exit 1; fi
test "$(cat .deployed-tag)" = old
grep -F 'old|compose -f compose.yaml -f compose.release.yaml up -d --no-build --wait --wait-timeout 120' "$DEPLOY_TEST_LOG"
# Success records the exact new release only after the health wait.
sh "$repo/scripts/deploy.sh"
test "$(cat .deployed-tag)" = new
printf 'deployment guards, rollback and successful release: passed\n'
