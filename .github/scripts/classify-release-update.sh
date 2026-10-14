#!/usr/bin/env bash
# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
set -euo pipefail

action="${1:-}"
head_branch="${2:-}"
before_sha="${3:-}"
head_sha="${4:-}"
fail() {
  printf '::error::%s (action=%s branch=%s before_sha=%s head_sha=%s)\n' \
    "$1" "$action" "$head_branch" "$before_sha" "$head_sha" >&2
  exit 1
}
route() {
  printf 'run_release=%s\n' "$1" >> "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"
  printf '%s\n' "$2"
  exit 0
}
if ! [[ $# == 4 && "$head_sha" =~ ^[0-9a-f]{40}$ ]]; then
  fail 'Usage: classify-release-update.sh <action> <head-branch> <before-sha> <head-sha>; full commit SHAs are required.'
fi
case "$action" in
  opened|synchronize|reopened|edited|ready_for_review) ;;
  *) fail 'Unsupported pull request action.' ;;
esac
git check-ref-format "refs/heads/$head_branch" >/dev/null || fail 'A valid source branch is required.'

# Explicit lifecycle events always validate the actual event head. The only
# fast path is an incremental synchronize event on an existing release PR.
if [[ "$action" != synchronize || "$head_branch" != release/* ]]; then
  route true 'Run the full pipeline for this pull request event.'
fi
[[ "$before_sha" =~ ^[0-9a-f]{40}$ ]] || fail 'A full previous head SHA is required for release synchronization.'

# Read pinned objects without checking out or executing anything from the source.
export GIT_NO_REPLACE_OBJECTS=1
for revision in "$before_sha" "$head_sha"; do
  object_type="$(git cat-file -t "$revision")" || fail "Could not read revision $revision."
  [[ "$object_type" == commit ]] || fail "Revision $revision is not a commit."
  git cat-file -e "$revision^{tree}" || fail "Could not read the tree of revision $revision."
done
if git merge-base --is-ancestor "$before_sha" "$head_sha"; then
  :
else
  status=$?
  [[ "$status" == 1 ]] || fail 'Could not verify the release update ancestry.'
  route true 'Run the full pipeline because the previous head is not an ancestor.'
fi

changes="$(mktemp)" || fail 'Could not create the release change inventory.'
trap 'rm -f "$changes"' EXIT
# Inspect the complete raw diff. Renames become a deletion and an addition so
# neither side can hide code or a special file behind a Markdown name.
git diff --raw -z --no-abbrev --no-renames --no-ext-diff --no-textconv \
  "$before_sha" "$head_sha" -- > "$changes" || fail 'Could not inspect the complete release update.'
count=0
documentation_only=true
while IFS= read -r -d '' entry; do
  IFS= read -r -d '' path || fail 'The release change inventory is incomplete.'
  [[ "$entry" =~ ^:([0-9]{6})\ ([0-9]{6})\ ([0-9a-f]{40})\ ([0-9a-f]{40})\ ([ADMT])$ ]] ||
    fail 'The release change inventory contains an unexpected record.'
  old_mode="${BASH_REMATCH[1]}"
  new_mode="${BASH_REMATCH[2]}"
  old_object="${BASH_REMATCH[3]}"
  new_object="${BASH_REMATCH[4]}"
  [[ "$path" == *.[mM][dD] ]] || documentation_only=false
  for side in "$old_mode:$old_object" "$new_mode:$new_object"; do
    mode="${side%%:*}"
    object="${side#*:}"
    [[ "$mode" == 000000 || "$mode" == 100644 ]] || documentation_only=false
    # Gitlinks name a different repository's commit, which need not exist here.
    if [[ "$mode" != 000000 && "$mode" != 160000 ]]; then
      object_type="$(git cat-file -t "$object")" || fail "Could not read changed object $object."
      [[ "$object_type" == blob ]] || fail "Changed object $object is not a blob."
    fi
  done
  count=$((count + 1))
done < "$changes"
if [[ "$documentation_only" == true ]] && ((count > 0)); then
  route false "Skip release publication for $count Markdown-only forward changes."
fi
route true 'Run the full pipeline for code, special-file, or empty changes.'
