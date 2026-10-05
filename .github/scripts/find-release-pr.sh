#!/usr/bin/env bash
# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
set -euo pipefail

repository="${1:-}"
merge_sha="${2:-}"
timeout_seconds="${3:-60}"

fail() {
  printf '::error::%s (repository=%s merge_sha=%s release_pr=%s timeout_seconds=%s)\n' \
    "$1" "${repository:-unset}" "${merge_sha:-unset}" "${pr_number:-unresolved}" "$timeout_seconds" >&2
  exit 1
}

[[ -n "$repository" ]] || fail 'Repository is required.'
[[ "$merge_sha" =~ ^[0-9a-f]{40}$ ]] || fail 'Merge SHA must contain 40 lowercase hexadecimal characters.'

[[ "$timeout_seconds" =~ ^[0-9]+$ ]] || fail 'Recognition timeout must be a nonnegative number of seconds.'

pulls="$(
  gh api --paginate --method GET "repos/$repository/commits/$merge_sha/pulls?per_page=100" |
    jq -es 'if length > 0 and all(.[]; type == "array") then [.[][]] else error("Expected PR pages") end'
)" || fail 'Could not list pull requests associated with the pushed merge commit.'

release_candidates() {
  jq -c --arg repository "$repository" --arg sha "$merge_sha" '
    [.[] | select(
      .base.ref == "main" and .base.repo.full_name == $repository and .head.repo.full_name == $repository and
      (.head.ref | type == "string" and (startswith("release/") or startswith("hotfix/"))) and
      ((.state == "closed" and .merged != false and (.merged_at | type == "string" and length > 0) and .merge_commit_sha == $sha)
        or (.head.sha == $sha and
          (.state == "open" or (.state == "closed" and .merged != false and
            (.merged_at | type == "string" and length > 0)))))
    )]
  '
}
matches="$(release_candidates <<< "$pulls")" || fail 'Could not inspect associated PR release identities.'
if [[ "$(jq 'length' <<< "$matches")" == 0 ]]; then
  # Once the commit reaches the default branch, the association API may omit
  # open PRs while GitHub is still recognizing their indirect merge.
  pulls="$(gh api --paginate "repos/$repository/pulls?state=all&base=main&per_page=100" |
    jq -es 'if length > 0 and all(.[]; type == "array") then [.[][]] else error("Expected PR pages") end')" ||
    fail 'Could not discover the release PR while GitHub recognizes its fast-forward merge.'
  matches="$(release_candidates <<< "$pulls")" || fail 'Could not inspect release PR identities.'
fi
count="$(jq 'length' <<< "$matches")"
[[ "$count" == 1 ]] || {
  identities="$(jq -r 'map("#\(.number) \(.head.ref)") | join(", ")' <<< "$matches")"
  fail "Expected exactly one merged same-repository release/hotfix PR into main; found $count (matches: ${identities:-none})."
}

pr_number="$(jq -r '.[0].number' <<< "$matches")"
if ! [[ "$pr_number" =~ ^[1-9][0-9]*$ ]] || ! jq -e '.[0].number | type == "number"' <<< "$matches" >/dev/null; then
  fail "Release PR number '$pr_number' must be a positive integer."
fi
if ! jq -e --arg sha "$merge_sha" '
  .[0] | .state == "closed" and .merged != false and (.merged_at | type == "string" and length > 0) and .merge_commit_sha == $sha
' <<< "$matches" >/dev/null; then
  # Fast-forward publication preserves the tested head SHA. Wait for GitHub's
  # merged flag; merely finding that commit in an open PR never authorizes release.
  expected_branch="$(jq -r '.[0].head.ref' <<< "$matches")"
  deadline=$((SECONDS + timeout_seconds))
  echo "Waiting for GitHub to recognize PR #$pr_number ($expected_branch) at $merge_sha as merged."
  while :; do
    pr="$(gh api "repos/$repository/pulls/$pr_number")" ||
      fail "Could not read PR #$pr_number while waiting for its fast-forward merge."
    jq -e --arg repository "$repository" --arg sha "$merge_sha" --arg branch "$expected_branch" '
      .base.ref == "main" and .base.repo.full_name == $repository and
      .head.repo.full_name == $repository and .head.ref == $branch and .head.sha == $sha
    ' <<< "$pr" >/dev/null ||
      fail "PR #$pr_number no longer identifies $repository:$expected_branch@$merge_sha -> main."
    if jq -e '.state == "closed" and .merged == true and (.merged_at | type == "string" and length > 0)' <<< "$pr" >/dev/null; then
      matches="$(jq -c '[.]' <<< "$pr")"
      break
    fi
    state="$(jq -r '"state=\(.state) merged=\(.merged) merge_commit_sha=\(.merge_commit_sha)"' <<< "$pr")"
    jq -e '.state == "open" and .merged == false' <<< "$pr" >/dev/null ||
      fail "PR #$pr_number is not a merged release; $state."
    if (( SECONDS >= deadline )); then
      fail "Timed out after $timeout_seconds seconds waiting for GitHub to recognize the fast-forward merge; $state."
    fi
    remaining=$((deadline - SECONDS))
    (( remaining < 5 )) || remaining=5
    sleep "$remaining"
  done
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
