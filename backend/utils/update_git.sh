#!/bin/bash

# Git operations used by backend/update. Device installs are cloned with
# --single-branch, so fetch main explicitly instead of relying on git pull or
# changing the configured fetch refspec.

apollo_git_current_branch() {
    git -C "$1" symbolic-ref --quiet --short HEAD
}

apollo_git_current_commit() {
    git -C "$1" rev-parse --verify HEAD
}

apollo_git_fetch_main() {
    local repo="$1"

    git -C "$repo" rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 1
    git -C "$repo" fetch --no-tags origin \
        "+refs/heads/main:refs/remotes/origin/main" || return 1
    git -C "$repo" rev-parse --verify refs/remotes/origin/main^{commit} \
        >/dev/null 2>&1
}

apollo_git_checkout_main() {
    local repo="$1"

    git -C "$repo" reset --hard || return 1
    # --force: devices carry untracked copies of the release binaries
    # (futurebit-miner-v2/-v3, apollo-helper, ckpool). If a release ever starts
    # tracking one of those paths, an unforced switch aborts and the device is
    # stuck on its installed branch with every retry failing the same way.
    # Device state (settings database, .env, *.conf) is untracked and absent
    # from the release tree, so it is left alone.
    git -C "$repo" checkout -f -B main refs/remotes/origin/main || return 1
    apollo_git_matches_main "$repo"
}

apollo_git_matches_main() {
    local repo="$1"
    local branch
    local head
    local remote

    branch=$(apollo_git_current_branch "$repo" 2>/dev/null) || return 1
    [ "$branch" = "main" ] || return 1

    head=$(apollo_git_current_commit "$repo") || return 1
    remote=$(git -C "$repo" rev-parse --verify refs/remotes/origin/main^{commit}) \
        || return 1

    [ "$head" = "$remote" ]
}

apollo_git_restore() {
    local repo="$1"
    local branch="$2"
    local commit="$3"

    git -C "$repo" reset --hard || return 1

    if [ -n "$branch" ]; then
        git -C "$repo" checkout -f -B "$branch" "$commit"
    else
        git -C "$repo" checkout -f --detach "$commit"
    fi
}
