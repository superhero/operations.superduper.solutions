#!/usr/bin/env bash
# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
set -euo pipefail

repository="${1:-}"
merge_sha="${2:-}"

fail() {
  printf '::error::%s (repository=%s merge_sha=%s)\n' \
    "$1" "${repository:-unset}" "${merge_sha:-unset}" >&2
  exit 1
}

[[ -n "$repository" ]] || fail 'Repository is required.'
[[ "$merge_sha" =~ ^[0-9a-f]{40}$ ]] || fail 'Merge SHA must contain 40 lowercase hexadecimal characters.'

pulls="$(
  gh api --paginate --method GET "repos/$repository/commits/$merge_sha/pulls?per_page=100" |
    jq -s '[.[][]]'
)" || fail 'Could not list pull requests associated with the pushed merge commit.'

matches="$(jq -c --arg repository "$repository" --arg sha "$merge_sha" '
  [.[] | select(
    .state == "closed" and (.merged_at | type == "string" and length > 0) and
    .merge_commit_sha == $sha and .base.ref == "main" and
    .base.repo.full_name == $repository and .head.repo.full_name == $repository and
    (.head.ref | type == "string" and (startswith("release/") or startswith("hotfix/")))
  )]
' <<<"$pulls")" || fail 'Could not inspect associated PR release identities.'

count="$(jq 'length' <<<"$matches")"
[[ "$count" == 1 ]] || {
  identities="$(jq -r 'map("#\(.number) \(.head.ref)") | join(", ")' <<<"$matches")"
  fail "Expected exactly one merged same-repository release/hotfix PR into main; found $count (matches: ${identities:-none})."
}

pr_number="$(jq -r '.[0].number' <<<"$matches")"
if ! [[ "$pr_number" =~ ^[1-9][0-9]*$ ]] || ! jq -e '.[0].number | type == "number"' <<<"$matches" >/dev/null; then
  fail "Release PR number '$pr_number' must be a positive integer."
fi
head_branch="$(jq -r '.[0].head.ref' <<<"$matches")"
head_sha="$(jq -r '.[0].head.sha' <<<"$matches")"
[[ "$head_sha" =~ ^[0-9a-f]{40}$ ]] || fail "PR #$pr_number ($head_branch) has invalid head SHA '$head_sha'; expected 40 lowercase hexadecimal characters."
version="${head_branch#*/}"
bash "$(dirname "${BASH_SOURCE[0]}")/validate-semver.sh" "$version" >/dev/null ||
  fail "PR #$pr_number has invalid release version '$version' in branch '$head_branch'."

{
  echo "pr_number=$pr_number"
  echo "head_branch=$head_branch"
  echo "head_sha=$head_sha"
} >> "$GITHUB_OUTPUT"
echo "Selected PR #$pr_number ($head_branch) for merge $merge_sha."
