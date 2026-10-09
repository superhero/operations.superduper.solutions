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
head_branch="${6:-${GITHUB_HEAD_REF:-}}"
timeout_seconds="${7:-180}"
error_log=""
write_status='not attempted'
trap '[[ -z "$error_log" ]] || rm -f "$error_log"' EXIT

fail() {
  [[ -z "$error_log" || ! -s "$error_log" ]] || cat "$error_log" >&2
  echo "::error::Merge incomplete for $repository PR #$pull_request (expected source $head_branch at $head_sha, base $base_branch at $base_sha, timeout_seconds=$timeout_seconds, write=$write_status): $*" >&2
  exit 1
}

[[ $# -ge 5 && $# -le 7 ]] || fail 'Expected repository, PR number, head SHA, base branch, tested base SHA, optional source branch and timeout.'
[[ -n "$repository" ]] || fail 'Repository is required.'
[[ "$pull_request" =~ ^[1-9][0-9]*$ ]] || fail 'A pull request number is required.'
[[ "$head_sha" =~ ^[0-9a-f]{40}$ ]] || fail 'A full pull request head SHA is required.'
[[ -n "$base_branch" ]] || fail 'The validated pull request base branch is required.'
git check-ref-format "refs/heads/$base_branch" || fail "Invalid validated base branch '$base_branch'."
[[ "$base_sha" =~ ^[0-9a-f]{40}$ ]] || fail 'The full validated base SHA is required.'
[[ -n "$head_branch" ]] || fail 'The expected source branch is required as argument six or GITHUB_HEAD_REF.'
git check-ref-format "refs/heads/$head_branch" || fail "Invalid expected source branch '$head_branch'."
if ! [[ "$timeout_seconds" =~ ^(0|[1-9][0-9]{0,2})$ ]] || (( timeout_seconds > 240 )); then
  fail 'Merge confirmation timeout must be a whole number from 0 to 240 seconds.'
fi
deadline=$((SECONDS + timeout_seconds))

read_pr() {
  pr="$(gh api "repos/$repository/pulls/$pull_request")" || fail 'Could not read current pull request state.'
  reason="$(jq -er --argjson number "$pull_request" --arg sha "$head_sha" \
    --arg source "$head_branch" --arg repository "$repository" --arg base "$base_branch" '
    if .number != $number then "PR number is \(.number); expected \($number)."
    elif .draft != false then "Draft status is \(.draft); expected false."
    elif .head.repo.full_name != $repository then "Head repository is \(.head.repo.full_name); expected \($repository)."
    elif .base.repo.full_name != $repository then "Base repository is \(.base.repo.full_name); expected \($repository)."
    elif .head.sha != $sha then "Head changed: expected \($sha), found \(.head.sha); rerun CI."
    elif .base.ref != $base then "Base branch changed: expected \($base), found \(.base.ref); rerun CI."
    elif (.head.ref | type) != "string" or .head.ref == "" then "Source branch is missing or is not a non-empty string."
    elif (.head.ref | test("[[:cntrl:]]")) then "Invalid source branch in current pull request metadata."
    elif .head.ref != $source then "Source branch changed: expected \($source), found \(.head.ref); rerun CI."
    elif (.base.sha | type) != "string" or (.base.sha | test("^[0-9a-f]{40}$") | not) then "Base commit is missing or invalid."
    elif .state == "closed" and .merged == true then
      if (.merged_at | type) != "string" or .merged_at == "" then "Merged PR has no valid merged_at metadata."
      elif .merge_commit_sha != null and
        ((.merge_commit_sha | type) != "string" or (.merge_commit_sha | test("^[0-9a-f]{40}$") | not))
      then "Merged PR has an invalid merge_commit_sha: \(.merge_commit_sha)."
      else "" end
    elif .state != "open" or .merged != false then "State is \(.state) with merged=\(.merged); expected open or confirmed merged."
    else "" end' <<< "$pr")" || fail 'Could not parse current pull request state.'
  [[ -z "$reason" ]] || fail "$reason"
}

# PR metadata can lag behind the actual target branch. Read and validate the
# canonical ref independently; API failures must never fall back to .base.sha.
read_live_base() {
  local reference encoded_branch
  encoded_branch="$(jq -rn --arg branch "$base_branch" '$branch | @uri')" ||
    fail "Could not encode live target branch '$base_branch'."
  reference="$(gh api "repos/$repository/git/ref/heads/$encoded_branch")" ||
    fail "Could not read live target ref 'refs/heads/$base_branch'; no merge attempted."
  live_base="$(jq -ers --arg ref "refs/heads/$base_branch" '
    select(length == 1) | .[0] |
    select(type == "object" and .ref == $ref and .object.type == "commit" and
      (.object.sha | type == "string" and test("\\A[0-9a-f]{40}\\z"))) |
    .object.sha
  ' <<< "$reference")" || fail "Invalid live target ref response for 'refs/heads/$base_branch'; no merge attempted."
}

is_merged() {
  jq -e '.merged == true' <<< "$pr" >/dev/null
}

wait_for_merge() {
  while :; do
    if is_merged && jq -e '.merge_commit_sha != null' <<< "$pr" >/dev/null; then
      merge_sha="$(jq -r '.merge_commit_sha' <<< "$pr")"
      if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
        echo "merge_sha=$merge_sha" >> "$GITHUB_OUTPUT"
      fi
      echo "GitHub confirmed $repository PR #$pull_request merged: $head_branch at $head_sha -> $base_branch (merge_sha=$merge_sha)."
      exit 0
    fi
    if (( SECONDS >= deadline )); then
      fail 'Timed out waiting for GitHub to confirm this exact PR merged with complete merge metadata; inspect the PR and branch before retrying.'
    fi
    remaining=$((deadline - SECONDS))
    (( remaining < 5 )) || remaining=5
    sleep "$remaining"
    read_pr
  done
}

recover_write_failure() {
  read_pr
  is_merged || fail "$1"
  wait_for_merge
}

read_pr
if is_merged; then
  wait_for_merge
fi

merge_method=merge
case "$base_branch:$head_branch" in
  develop:feature/*|develop:bugfix/*|main:hotfix/*) merge_method=squash ;;
esac

read_live_base
current_base="$live_base"
if [[ "$current_base" != "$base_sha" ]]; then
  bash "$(dirname "${BASH_SOURCE[0]}")/validate-badge-only-advance.sh" "$repository" "$base_sha" "$current_base" ||
    fail "Pull request base changed beyond dependency badges (live target ref); update the branch and rerun CI. Expected $base_sha, found $current_base."
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

# Recheck PR identity and the live target immediately before either write.
# This is not an atomic base lock: native squash/merge still needs strict
# required checks enforced for the merging App at GitHub's merge boundary.
# Keep the post-merge tree verification as a separate deployment guard.
read_pr
if is_merged; then
  wait_for_merge
fi
read_live_base
[[ "$live_base" == "$current_base" ]] ||
  fail "Source branch or base commit changed before merging ($head_branch -> $base_branch at $current_base); actual live base=$live_base; update the branch and rerun CI."
error_log="$(mktemp)" || fail 'Could not prepare temporary merge diagnostics.'

if [[ "$behind_by" == 0 && "$ahead_by" != 0 && ( "$merge_method" == merge || "$ahead_by" == 1 ) ]]; then
  write_status='fast-forward attempted'
  updated="$(gh api --method PATCH "repos/$repository/git/refs/heads/$base_branch" \
    -f "sha=$head_sha" -F force=false 2>"$error_log")" ||
    recover_write_failure "GitHub could not fast-forward '$base_branch' from $current_base to tested '$head_branch' at $head_sha."
  write_status='fast-forward applied'
  jq -e --arg ref "refs/heads/$base_branch" --arg sha "$head_sha" '
    .ref == $ref and .object.type == "commit" and .object.sha == $sha
  ' <<< "$updated" >/dev/null || fail "Fast-forward response did not confirm '$base_branch' at $head_sha; inspect the branch before retrying."
else
  write_status="$merge_method attempted"
  gh pr merge "$pull_request" \
    --repo "$repository" \
    "--$merge_method" \
    --match-head-commit "$head_sha" 2>"$error_log" ||
    recover_write_failure "GitHub could not merge the validated pull request from '$head_branch' using '$merge_method'."
  write_status="$merge_method completed"
fi
cat "$error_log" >&2
: > "$error_log"
read_pr
wait_for_merge
