#!/usr/bin/env bash
# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
set -euo pipefail

repository="${1:-}"
head_branch="${2:-}"
head_sha="${3:-}"
merge_sha="${4:-}"
fail() {
  printf '::error::%s (repository=%s head_branch=%s head_sha=%s merge_sha=%s target=%s)\n' \
    "$1" "$repository" "$head_branch" "$head_sha" "$merge_sha" "${target:-develop}" >&2
  exit 1
}
summary() {
  printf '%s\n' "$1"
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    printf '%s\n' "$1" >> "$GITHUB_STEP_SUMMARY"
  fi
}
if ! [[ $# == 4 && "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ &&
  "$head_branch" =~ ^(release|hotfix)/[0-9]+\.[0-9]+\.[0-9]+$ &&
  "$head_sha" =~ ^[0-9a-f]{40}$ && "$merge_sha" =~ ^[0-9a-f]{40}$ ]]; then
  fail 'Usage: synchronize-release.sh <owner/repository> <release-or-hotfix-branch> <head-sha> <merge-sha>; full commit SHAs are required.'
fi

open_pr() {
  local source="$1" pulls pr_url
  pulls="$(gh api --paginate --method GET "repos/$repository/pulls" \
    -f state=open -f "base=$target" -f "head=${repository%%/*}:$source" -f per_page=100)" ||
    fail "Could not find an open synchronization PR ($source -> $target)."
  pr_url="$(jq -ers --arg repository "$repository" --arg head "$source" --arg base "$target" '
    select(length > 0 and all(.[]; type == "array")) |
    [.[][] | select(.state == "open" and .head.repo.full_name == $repository and
      .head.ref == $head and .base.ref == $base)] |
    if length > 1 then error("Multiple synchronization PRs match")
    elif length == 0 then ""
    else .[0].html_url | select(type == "string" and length > 0) end
  ' <<< "$pulls")" || fail "Could not identify one synchronization PR ($source -> $target)."
  if [[ -z "$pr_url" ]]; then
    pr_url="$(gh api --method POST "repos/$repository/pulls" \
      -f "base=$target" -f "head=$source" -f "title=Synchronize $source into $target" \
      -f body='Synchronize released code. CI validates and merges this PR.' --jq '.html_url')" ||
      fail "Could not create synchronization PR ($source -> $target)."
    [[ -n "$pr_url" && "$pr_url" != null ]] || fail "GitHub returned no synchronization PR URL ($source -> $target)."
  fi
  summary "Synchronization ($source -> $target): $pr_url"
}

target=develop
behind_by="$(gh api "repos/$repository/compare/main...develop" --jq '.behind_by')" ||
  fail 'Could not compare main...develop before synchronization.'
[[ "$behind_by" =~ ^[0-9]+$ ]] || fail "Invalid main...develop comparison: behind_by=$behind_by."
# Synchronize ancestry even when a squash or badge update leaves the same code.
# CI chooses a fast-forward when possible and otherwise preserves both histories.
if [[ "$behind_by" != 0 ]]; then
  open_pr main
else
  summary 'Develop already contains main history; no synchronization PR needed.'
fi
[[ "$head_branch" == hotfix/* ]] || exit 0

releases="$(gh api --paginate "repos/$repository/pulls?state=open&base=main&per_page=100" |
  jq -ces --arg repository "$repository" '
    select(length > 0 and all(.[]; type == "array")) |
    [.[][] | select(.state == "open" and .base.ref == "main" and
      .head.repo.full_name == $repository and (.head.ref | startswith("release/")))]
  ')" || fail 'Could not discover open same-repository release PRs targeting main.'
count="$(jq 'length' <<< "$releases")"
if [[ "$count" == 0 ]]; then
  summary "No active release PR; $head_branch needs no release synchronization."
  exit 0
fi
[[ "$count" == 1 ]] || fail "Expected at most one active release PR targeting main; found $count."
target="$(jq -r '.[0].head.ref' <<< "$releases")"
target_sha="$(jq -r '.[0].head.sha' <<< "$releases")"
bash "$(dirname "${BASH_SOURCE[0]}")/validate-semver.sh" "${target#release/}" >/dev/null ||
  fail 'The active release branch must name an unprefixed SemVer version.'
[[ "$target_sha" =~ ^[0-9a-f]{40}$ ]] || fail "Invalid active release head SHA: $target_sha."

tags="$(gh api "repos/$repository/git/matching-refs/tags/${target#release/}")" ||
  fail "Could not check whether $target has already been tagged."
tagged="$(jq -er --arg ref "refs/tags/${target#release/}" '
  select(type == "array") | any(.[]; .ref == $ref) | tostring
' <<< "$tags")" || fail "Invalid tag listing for $target."
if [[ "$tagged" == true ]]; then
  summary "Skipping $target: its version is already tagged."
  exit 0
fi
behind_by="$(gh api "repos/$repository/compare/$merge_sha...$target_sha" --jq '.behind_by')" ||
  fail "Could not compare released merge $merge_sha with active release head $target_sha."
[[ "$behind_by" =~ ^[0-9]+$ ]] || fail "Invalid release comparison: behind_by=$behind_by, target_sha=$target_sha."
if [[ "$behind_by" == 0 ]]; then
  summary "$target already contains released merge $merge_sha; no synchronization needed."
  exit 0
fi

# Include the released main commit as ancestry even when the original hotfix
# was squash-merged. Reconcile histories without resetting any existing commit.
read_head() {
  local refs
  refs="$(gh api "repos/$repository/git/matching-refs/heads/$head_branch")" ||
    fail "Could not read $head_branch before synchronizing its released code."
  current_sha="$(jq -er --arg ref "refs/heads/$head_branch" '
    select(type == "array") | [.[] | select(.ref == $ref)] |
    if length == 0 then "" elif length == 1 then
      .[0].object.sha | select(type == "string" and test("\\A[0-9a-f]{40}\\z"))
    else error("Duplicate branch refs") end
  ' <<< "$refs")" || fail "Could not identify the current $head_branch revision."
}
read_head
if [[ -z "$current_sha" ]]; then
  gh api --method POST "repos/$repository/git/refs" \
    -f "ref=refs/heads/$head_branch" -f "sha=$merge_sha" >/dev/null ||
    fail "Could not restore $head_branch at released merge $merge_sha."
elif [[ "$current_sha" != "$merge_sha" ]]; then
  behind_by="$(gh api "repos/$repository/compare/$merge_sha...$current_sha" --jq '.behind_by')" ||
    fail "Could not check released ancestry of $head_branch at $current_sha."
  [[ "$behind_by" =~ ^[0-9]+$ ]] || fail "Invalid hotfix ancestry comparison: behind_by=$behind_by, current_sha=$current_sha."
  if [[ "$behind_by" != 0 ]]; then
    bash "$(dirname "${BASH_SOURCE[0]}")/validate-badge-only-advance.sh" "$repository" "$head_sha" "$current_sha" ||
      fail "$head_branch changed unexpectedly to $current_sha after tested head $head_sha; refusing to synchronize unpublished code."
    expected_sha="$current_sha"
    read_head
    [[ "$current_sha" == "$expected_sha" ]] ||
      fail "$head_branch advanced from $expected_sha to $current_sha before reconciliation; retry with its current history."
    gh api --method POST "repos/$repository/merges" \
      -f "base=$head_branch" -f "head=$merge_sha" \
      -f "commit_message=Synchronize released $head_branch history" >/dev/null ||
      fail "Could not reconcile $head_branch at $current_sha with released merge $merge_sha; resolve any merge conflict before retrying."
  fi
fi
read_head
[[ -n "$current_sha" ]] || fail "$head_branch disappeared before synchronization."
bash "$(dirname "${BASH_SOURCE[0]}")/validate-released-content.sh" "$repository" "$merge_sha" "$current_sha" ||
  fail "$head_branch at $current_sha must contain released merge $merge_sha without unpublished code before synchronization."
open_pr "$head_branch"
