#!/usr/bin/env bash
# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
set -euo pipefail

repository="${1:-${GITHUB_REPOSITORY:-}}"
pull_request="${2:-}"
head_sha="${3:-}"
base_branch="${4:-${GITHUB_BASE_REF:-}}"
base_sha="${5:-}"

fail() {
  echo "::error::Merge refused for $repository PR #$pull_request (expected head $head_sha, base $base_branch at $base_sha): $*" >&2
  exit 1
}

[[ -n "$repository" ]] || fail 'Repository is required.'
[[ "$pull_request" =~ ^[1-9][0-9]*$ ]] || fail 'A pull request number is required.'
[[ "$head_sha" =~ ^[0-9a-f]{40}$ ]] || fail 'A full pull request head SHA is required.'
[[ -n "$base_branch" ]] || fail 'The validated pull request base branch is required.'
[[ "$base_sha" =~ ^[0-9a-f]{40}$ ]] || fail 'The full validated base SHA is required.'

read_pr() {
  pr="$(gh api "repos/$repository/pulls/$pull_request")" || fail 'Could not read current pull request state.'
  reason="$(jq -er --arg sha "$head_sha" --arg repository "$repository" --arg base "$base_branch" '
    if .state != "open" then "State is \(.state); expected open."
    elif .draft != false then "Draft status is \(.draft); expected false."
    elif .head.repo.full_name != $repository then "Head repository is \(.head.repo.full_name); expected \($repository)."
    elif .head.sha != $sha then "Head changed: expected \($sha), found \(.head.sha); rerun CI."
    elif .base.ref != $base then "Base branch changed: expected \($base), found \(.base.ref); rerun CI."
    elif (.head.ref | type) != "string" or .head.ref == "" then "Source branch is missing or is not a non-empty string."
    elif (.head.ref | test("[[:cntrl:]]")) then "Invalid source branch in current pull request metadata."
    elif (.base.sha | type) != "string" or (.base.sha | test("^[0-9a-f]{40}$") | not) then "Base commit is missing or invalid."
    else "" end' <<< "$pr")" || fail 'Could not parse current pull request state.'
  [[ -z "$reason" ]] || fail "$reason"
}
read_pr
head_branch="$(jq -r '.head.ref' <<< "$pr")"
git check-ref-format "refs/heads/$head_branch" || fail "Invalid source branch '$head_branch' in current pull request metadata."

merge_method=merge
case "$base_branch:$head_branch" in
  develop:feature/*|develop:bugfix/*|main:hotfix/*) merge_method=squash ;;
esac

current_base="$(jq -r '.base.sha // empty' <<< "$pr")"
if [[ "$current_base" != "$base_sha" ]]; then
  bash "$(dirname "${BASH_SOURCE[0]}")/validate-badge-only-advance.sh" "$repository" "$base_sha" "$current_base" ||
    fail "Pull request base changed beyond dependency badges; update the branch and rerun CI. Expected $base_sha, found $current_base."
fi

comparison="$(gh api "repos/$repository/compare/$current_base...$head_sha")" ||
  fail "Could not compare $current_base...$head_sha before merging."
jq -e --arg base "$current_base" --arg head "$head_sha" '
  def count: type == "number" and . >= 0 and . == floor;
  .base_commit.sha == $base and
  (.merge_base_commit.sha | type == "string" and test("^[0-9a-f]{40}$")) and
  (.ahead_by | count) and (.behind_by | count) and (.total_commits | count) and
  .total_commits == .ahead_by and
  (if .behind_by == 0 then
    .merge_base_commit.sha == $base and
    (if .ahead_by == 0 then .status == "identical" and $base == $head else .status == "ahead" end)
  else
    .merge_base_commit.sha != $base and
    (if .ahead_by == 0 then .status == "behind" else .status == "diverged" end)
  end)
' <<< "$comparison" >/dev/null || fail "Invalid comparison metadata for $current_base...$head_sha; cannot choose a safe merge method."
ahead_by="$(jq -r '.ahead_by' <<< "$comparison")"
behind_by="$(jq -r '.behind_by' <<< "$comparison")"

if [[ "$base_branch" == main && "$behind_by" != 0 ]]; then
  bash "$(dirname "${BASH_SOURCE[0]}")/validate-badge-only-advance.sh" "$repository" \
    "$(jq -r '.merge_base_commit.sha' <<< "$comparison")" "$current_base" ||
    fail "Main changed beyond dependency badges since this release was built ($current_base...$head_sha reports behind_by=$behind_by); update the branch and rerun CI."
fi

if [[ "$behind_by" == 0 && "$ahead_by" != 0 && ( "$merge_method" == merge || "$ahead_by" == 1 ) ]]; then
  # Recheck just before writing. A non-force ref update also rejects any
  # intervening base change that is not already contained in the tested head.
  read_pr
  jq -e --arg source "$head_branch" --arg base "$current_base" '
    .head.ref == $source and .base.sha == $base
  ' <<< "$pr" >/dev/null || fail "Source branch or base commit changed before fast-forward ($head_branch -> $base_branch at $current_base); rerun CI."
  updated="$(gh api --method PATCH "repos/$repository/git/refs/heads/$base_branch" \
    -f "sha=$head_sha" -F force=false)" ||
    fail "GitHub could not fast-forward '$base_branch' from $current_base to tested '$head_branch' at $head_sha."
  jq -e --arg ref "refs/heads/$base_branch" --arg sha "$head_sha" '
    .ref == $ref and .object.type == "commit" and .object.sha == $sha
  ' <<< "$updated" >/dev/null || fail "Fast-forward response did not confirm '$base_branch' at $head_sha; inspect the branch before retrying."

  for attempt in {1..13}; do
    merged="$(gh api "repos/$repository/pulls/$pull_request")" ||
      fail "Fast-forward applied to '$base_branch' at $head_sha, but GitHub's PR merge status could not be read."
    if jq -e --arg repository "$repository" --arg source "$head_branch" \
      --arg base "$base_branch" --arg sha "$head_sha" '
      .state == "closed" and .merged == true and
      (.merged_at | type == "string" and length > 0) and
      .head.repo.full_name == $repository and .head.ref == $source and
      .head.sha == $sha and .base.ref == $base and .base.repo.full_name == $repository
    ' <<< "$merged" >/dev/null; then
      echo "Fast-forwarded '$base_branch' to tested '$head_branch' at $head_sha; GitHub confirmed PR #$pull_request merged."
      exit 0
    fi
    [[ "$attempt" == 13 ]] || sleep 5
  done
  fail "Fast-forward applied to '$base_branch' at $head_sha, but GitHub has not confirmed this PR as merged; inspect its status before retrying."
fi

gh pr merge "$pull_request" \
  --repo "$repository" \
  --auto \
  "--$merge_method" \
  --match-head-commit "$head_sha" || fail "GitHub could not merge the validated pull request from '$head_branch' using '$merge_method'."
