#!/usr/bin/env bash
# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
set -euo pipefail

target_sha="${1:-}"
source_sha="${2:-}"
fail() {
  printf '::error::%s (target_sha=%s source_sha=%s)\n' "$1" "$target_sha" "$source_sha" >&2
  exit 1
}
[[ $# == 2 && "$target_sha" =~ ^[0-9a-f]{40}$ && "$source_sha" =~ ^[0-9a-f]{40}$ ]] ||
  fail 'Usage: preview-merge.sh <target-sha> <source-sha>; full commit SHAs are required.'
if ! git cat-file -e "$target_sha^{commit}" || ! git cat-file -e "$source_sha^{commit}"; then
  fail 'Both commits must be available in the checkout; fetch complete history and retry.'
fi

if ! result="$(git merge-tree --write-tree "$target_sha" "$source_sha")"; then
  printf '%s\n' "$result" >&2
  fail 'Could not integrate the commits; resolve any reported merge conflicts before retrying.'
fi
[[ "$result" =~ ^[0-9a-f]{40}$ ]] || fail 'Git returned an invalid merged tree.'
paths="$(mktemp)"
trap 'rm -f "$paths"' EXIT
git diff --name-only --no-renames -z "$target_sha" "$result" > "$paths" ||
  fail 'Could not compare the integrated tree with its target.'
substantive=false
while IFS= read -r -d '' path; do
  if [[ ! "$path" =~ ^\.github/badges/version-dependency-[a-z0-9][a-z0-9._-]*\.svg$ ]]; then
    substantive=true
    break
  fi
done < "$paths"
jq -n --arg tree "$result" --argjson changed "$substantive" \
  '{tree: $tree, substantive_changes: $changed}'
