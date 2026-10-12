#!/usr/bin/env bash
# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
set -euo pipefail

base_sha="${1:-}"
head_sha="${2:-}"
fail() {
  printf '::error::%s (base_sha=%s head_sha=%s)\n' "$1" "$base_sha" "$head_sha" >&2
  exit 1
}
if ! [[ $# == 2 && "$base_sha" =~ ^[0-9a-f]{40}$ && "$head_sha" =~ ^[0-9a-f]{40}$ ]]; then
  fail 'Usage: validate-documentation-changes.sh <base-sha> <head-sha>; full commit SHAs are required.'
fi

# Inspect committed Git objects, never files or commands supplied by the PR.
export GIT_NO_REPLACE_OBJECTS=1
for revision in "$base_sha" "$head_sha"; do
  object_type="$(git cat-file -t "$revision")" || fail "Could not read revision $revision. Fetch both commits and their history first."
  [[ "$object_type" == commit ]] || fail "Revision $revision is not a commit."
done
merge_base="$(git merge-base --all "$base_sha" "$head_sha")" ||
  fail 'Could not resolve a common ancestor. Fetch complete history before validating documentation changes.'
[[ "$merge_base" =~ ^[0-9a-f]{40}$ ]] || fail 'Expected exactly one merge base; refusing ambiguous or incomplete history.'

changes="$(mktemp)" || fail 'Could not create the temporary change inventory.'
trap 'rm -f "$changes"' EXIT
# Disabling rename detection validates both old and new paths as independent
# deletions/additions. NUL delimiters preserve spaces, tabs and newlines in names.
# Write the complete diff before reading it so a Git failure cannot pass partially.
git diff --raw -z --no-abbrev --no-renames --no-ext-diff --no-textconv \
  "$merge_base" "$head_sha" -- > "$changes" || fail 'Could not inspect the complete documentation diff.'

count=0
while IFS= read -r -d '' entry; do
  IFS= read -r -d '' path || fail 'The documentation change inventory is incomplete.'
  [[ "$entry" =~ ^:([0-9]{6})\ ([0-9]{6})\ ([0-9a-f]{40})\ ([0-9a-f]{40})\ ([ADMT])$ ]] ||
    fail 'The documentation change inventory contains an unexpected record.'
  old_mode="${BASH_REMATCH[1]}"
  new_mode="${BASH_REMATCH[2]}"
  printf -v display_path '%q' "$path"
  [[ "$path" == *.[mM][dD] ]] || fail "Only Markdown (.md) documents may change: $display_path."
  for mode in "$old_mode" "$new_mode"; do
    [[ "$mode" == 000000 || "$mode" == 100644 ]] ||
      fail "Documentation must be regular, non-executable files on both sides of the diff: $display_path (mode $mode)."
  done
  count=$((count + 1))
done < "$changes"
((count > 0)) || fail 'The documentation diff is empty; at least one Markdown document must change.'
printf 'Validated %s Markdown document changes.\n' "$count"
