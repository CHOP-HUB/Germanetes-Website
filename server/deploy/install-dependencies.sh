#!/usr/bin/env bash
set -euo pipefail

APP_DIR=${APP_DIR:-/opt/germanetes}
DEPENDENCY_DIR=${DEPENDENCY_DIR:-/var/lib/germanetes/nodejs}
RELEASES_DIR="$DEPENDENCY_DIR/releases"
BUILD_DIR=$(mktemp -d "$RELEASES_DIR/build.XXXXXX")

cleanup() {
    if [[ -n "${BUILD_DIR:-}" && -d "$BUILD_DIR" ]]; then
        rm -rf "$BUILD_DIR"
    fi
}
trap cleanup EXIT

install -o germanetes -g germanetes -m 0644 "$APP_DIR/server/package.json" "$BUILD_DIR/package.json"
install -o germanetes -g germanetes -m 0644 "$APP_DIR/server/package-lock.json" "$BUILD_DIR/package-lock.json"
chown germanetes:germanetes "$BUILD_DIR"

runuser -u germanetes -- env npm_config_cache=/var/lib/germanetes/.npm npm ci --omit=dev --prefix "$BUILD_DIR"

release_name="release-$(date -u +%Y%m%dT%H%M%SZ)-$$"
RELEASE_DIR="$RELEASES_DIR/$release_name"
mv "$BUILD_DIR" "$RELEASE_DIR"
BUILD_DIR=''

next_link="$DEPENDENCY_DIR/current.next"
rm -f "$next_link"
ln -s "$RELEASE_DIR" "$next_link"
mv -Tf "$next_link" "$DEPENDENCY_DIR/current"

find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -name 'release-*' -printf '%T@ %p\n' \
    | sort -nr \
    | awk 'NR > 2 { $1=""; sub(/^ /, ""); print }' \
    | while IFS= read -r old_release; do
        [[ -n "$old_release" ]] && rm -rf -- "$old_release"
    done

printf 'Installed dependencies in %s\n' "$RELEASE_DIR"
