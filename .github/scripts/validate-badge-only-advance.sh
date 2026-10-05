#!/usr/bin/env bash
# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
set -euo pipefail

repository="${1:-}"
base_sha="${2:-}"
head_sha="${3:-}"
fail() {
  printf '::error::%s (repository=%s base_sha=%s head_sha=%s commit=%s)\n' \
    "$1" "$repository" "$base_sha" "$head_sha" "${commit:-unresolved}" >&2
  exit 1
}
if ! [[ $# == 3 && "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ &&
  "$base_sha" =~ ^[0-9a-f]{40}$ && "$head_sha" =~ ^[0-9a-f]{40}$ ]]; then
  fail 'Usage: validate-badge-only-advance.sh <owner/repository> <base-sha> <head-sha>; full commit SHAs are required.'
fi
[[ "$base_sha" != "$head_sha" ]] || exit 0

comparison="$(gh api --paginate "repos/$repository/compare/$base_sha...$head_sha?per_page=100")" ||
  fail 'Could not compare revisions before allowing dependency badge updates.'
commits="$(jq -cse --arg base "$base_sha" --arg head "$head_sha" '
  .[0] as $first |
  select(length > 0 and all(.[]; .commits | type == "array") and
    $first.status == "ahead" and $first.behind_by == 0 and
    $first.base_commit.sha == $base and $first.merge_base_commit.sha == $base and
    ($first.ahead_by | type == "number" and . > 0 and . == floor) and
    $first.total_commits == $first.ahead_by) |
  [.[].commits[]] |
  select(length == $first.ahead_by and .[-1].sha == $head and
    all(.[]; (.sha | type == "string" and test("\\A[0-9a-f]{40}\\z")) and
      (.parents | type == "array" and length == 1 and
        (.[0].sha | type == "string" and test("\\A[0-9a-f]{40}\\z")))))
' <<< "$comparison" 2>/dev/null)" ||
  fail 'Expected a complete, linear descendant comparison; refusing an unrelated revision, merge commit, or incomplete history.'

previous="$base_sha"
while IFS=$'\t' read -r commit parent; do
  [[ "$parent" == "$previous" ]] || fail "Commit parent is $parent; expected $previous in a linear badge update."
  changes="$(gh api --paginate "repos/$repository/commits/$commit?per_page=100")" ||
    fail 'Could not inspect all changed files in the dependency badge update.'
  # GitHub caps a commit diff at 3,000 files. Refuse that boundary rather than
  # treating a potentially incomplete response as proof that code is unchanged.
  if ! jq -se --arg commit "$commit" '
    def badge: type == "string" and test("\\A\\.github/badges/version-dependency-[a-z0-9][a-z0-9._-]*\\.svg\\z");
    length > 0 and all(.[]; .sha == $commit and (.files | type == "array")) and
    ([.[].files[]] | length > 0 and length < 3000 and
      all(.[]; (.filename | badge) and
        (if has("previous_filename") then (.previous_filename | badge) else true end)))
  ' <<< "$changes" >/dev/null 2>&1; then
    fail 'Commit changes files outside dependency version SVGs, or its file diff is empty, invalid, or incomplete.'
  fi
  previous="$commit"
done < <(jq -r '.[] | [.sha, .parents[0].sha] | @tsv' <<< "$commits")
