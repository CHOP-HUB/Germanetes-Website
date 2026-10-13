#!/usr/bin/env bash
set -euo pipefail

APP_DIR=${APP_DIR:-/opt/germanetes}
UPDATE_BRANCH=${UPDATE_BRANCH:-main}

if [[ ! -d "$APP_DIR/.git" ]]; then
    echo "Git checkout not found at $APP_DIR" >&2
    exit 1
fi

git_cmd() {
    command git -c "safe.directory=$APP_DIR" -C "$APP_DIR" "$@"
}

if [[ -n "$(git_cmd status --porcelain --untracked-files=all)" ]]; then
    echo "Refusing deployment: the checkout contains local changes." >&2
    exit 1
fi

git_cmd fetch --quiet origin "$UPDATE_BRANCH"
local_commit=$(git_cmd rev-parse HEAD)
remote_commit=$(git_cmd rev-parse FETCH_HEAD)

if [[ "$local_commit" == "$remote_commit" ]]; then
    exit 0
fi

if ! git_cmd merge-base --is-ancestor "$local_commit" "$remote_commit"; then
    echo "Refusing deployment: local and remote branches have diverged." >&2
    exit 1
fi

install_dependencies=false
if ! git_cmd diff --quiet "$local_commit" "$remote_commit" -- server/package.json server/package-lock.json; then
    install_dependencies=true
fi

git_cmd merge --ff-only "$remote_commit"

if [[ "$install_dependencies" == true ]]; then
    /bin/bash "$APP_DIR/server/deploy/install-dependencies.sh"
fi

systemctl restart germanetes.service
