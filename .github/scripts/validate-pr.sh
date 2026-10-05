#!/usr/bin/env bash
# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
set -euo pipefail

repository="${1:-}"
head_branch="${2:-}"
base_branch="${3:-}"
head_sha="${4:-}"

fail() {
  echo "::error::Gitflow validation for $repository ($head_branch -> $base_branch, head $head_sha): $*" >&2
  exit 1
}

[[ $# == 4 && -n "$repository" && -n "$head_branch" && -n "$base_branch" && "$head_sha" =~ ^[0-9a-f]{40}$ ]] ||
  fail 'Usage: validate-pr.sh <repository> <head-branch> <base-branch> <full-head-sha>; four arguments and a full 40-character head SHA are required.'

case "$base_branch:$head_branch" in
  main:release/*|main:hotfix/*|develop:feature/*|develop:bugfix/*|develop:release/*|develop:hotfix/*|develop:main|release/*:hotfix/*|support/*:hotfix/*) ;;
  *) fail "Branch '$head_branch' may not merge into '$base_branch'." ;;
esac

case "$head_branch" in
  release/*|hotfix/*) ;;
  *) exit 0 ;;
esac
kind="${head_branch%%/*}"
version="${head_branch#*/}"
bash "$(dirname "${BASH_SOURCE[0]}")/validate-semver.sh" "$version" >/dev/null ||
  fail "Invalid $kind version '$version'."

# Capture API results before inspecting them: failed requests must never mean
# an available tag or an empty set of active branches.
tags="$(gh api --paginate "repos/$repository/tags?per_page=100" | jq -sc '[.[][] | .name]')" ||
  fail 'Could not list repository tags.'
closed_main_prs=""
load_closed_main_prs() {
  [[ -z "$closed_main_prs" ]] || return 0
  closed_main_prs="$(gh api --paginate "repos/$repository/pulls?state=closed&base=main&per_page=100" |
    jq -cse 'if length > 0 and all(.[]; type == "array") then [.[][]]
      else error("Expected pages of closed main pull requests") end')" ||
    fail "Could not inspect closed main PRs reserving $1."
}
validate_hotfix_patch_line() {
  local require_base="${1:-false}" semver_tags tag comparison major minor patch expected
  # The newest target-reachable tag determines this line, independent of tags
  # from other support lines. A released hotfix backport must have a known base.
  semver_tags="$(jq -r '.[] | select(test("^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$"))' <<< "$tags" | sort -Vr)"
  while IFS= read -r tag; do
    [[ -n "$tag" ]] || continue
    comparison="$(gh api "repos/$repository/compare/$tag...$base_branch")" ||
      fail "Could not compare $tag...$base_branch to determine the hotfix patch line."
    if jq -e '.behind_by == 0' <<< "$comparison" >/dev/null; then
      IFS=. read -r major minor patch <<< "$tag"
      expected="$major.$minor.$((patch + 1))"
      [[ "$version" == "$expected" ]] ||
        fail "Hotfix '$version' must be the next patch after '$tag': expected '$expected'."
      return 0
    fi
  done <<< "$semver_tags"
  [[ "$require_base" != true ]] || fail "No released tag is reachable from '$base_branch' to establish the hotfix patch line."
}
released_revision=""
if jq -e --arg version "$version" 'index($version) != null' <<< "$tags" >/dev/null; then
  released_revision="$version"
else
  # GitHub can delete a merged branch before the tagging workflow completes.
  # The merged PR keeps that version reserved even if tagging failed.
  load_closed_main_prs "version '$version'"
  released_revision="$(jq -r --arg repository "$repository" --arg version "$version" '
      [.[] | select(.merged_at != null and .head.repo.full_name == $repository and
        (.head.ref == "release/" + $version or .head.ref == "hotfix/" + $version))] |
      if length == 0 then empty
      elif length == 1 and ((.[0].merge_commit_sha // "") | test("^[0-9a-f]{40}$"))
      then .[0].merge_commit_sha
      else error("Merged version must have one unambiguous merge commit") end' <<< "$closed_main_prs")" ||
    fail "Could not inspect closed main PRs reserving version '$version'."
fi
if [[ -n "$released_revision" ]]; then
  case "$base_branch:$kind" in
    develop:*|release/*:hotfix|support/*:hotfix) ;;
    *) fail "Version '$version' already exists as a tag or merged release." ;;
  esac
  if [[ "$base_branch" == release/* ]]; then
    target_version="${base_branch#*/}"
    bash "$(dirname "${BASH_SOURCE[0]}")/validate-semver.sh" "$target_version" >/dev/null ||
      fail "Invalid target release version '$target_version'."
    if jq -e --arg version "$target_version" 'index($version) != null' <<< "$tags" >/dev/null; then
      fail "Target release '$base_branch' already exists as a tag or merged release."
    fi
    load_closed_main_prs "target release '$base_branch'"
    target_released="$(jq -r --arg repository "$repository" --arg version "$target_version" '
      any(.[]; .merged_at != null and .head.repo.full_name == $repository and
        (.head.ref == "release/" + $version or .head.ref == "hotfix/" + $version))' <<< "$closed_main_prs")" ||
      fail "Could not inspect closed main PRs reserving target release '$base_branch'."
    if [[ "$target_released" == true ]]; then
      fail "Target release '$base_branch' already exists as a tag or merged release."
    fi
  fi
  comparison="$(gh api "repos/$repository/compare/$head_sha...$released_revision")" ||
    fail "Could not compare $head_sha...$released_revision to validate release synchronization."
  if ! jq -e '.behind_by == 0' <<< "$comparison" >/dev/null; then
    bash "$(dirname "${BASH_SOURCE[0]}")/validate-released-content.sh" "$repository" \
      "$released_revision" "$head_sha" ||
      fail "Branch '$head_branch' contains changes outside its released version '$version' other than dependency badges."
  fi
  if [[ "$kind" == hotfix && "$base_branch" == support/* ]]; then
    validate_hotfix_patch_line true
  fi
  exit 0
fi

branches="$(gh api --paginate "repos/$repository/git/matching-refs/heads/" |
  jq -sc '[.[][] | .ref | sub("^refs/heads/"; "")]')" || fail 'Could not list repository branches.'
conflict="$(jq -r --arg kind "$kind" --arg current "$head_branch" --arg version "$version" \
  --argjson tags "$tags" '
    .[] | select(. != $current) |
    select((startswith($kind + "/") and ((ltrimstr($kind + "/") as $v | $tags | index($v)) == null)) or
      (. == "release/" + $version or . == "hotfix/" + $version))' <<< "$branches")"
[[ -z "$conflict" ]] || fail "Conflicting active release or hotfix branch: $conflict"

if [[ "$base_branch" == main ]]; then
  comparison="$(gh api "repos/$repository/compare/main...$head_sha")" ||
    fail "Could not compare main...$head_sha to validate release ancestry."
  if ! jq -e '.behind_by == 0' <<< "$comparison" >/dev/null; then
    bash "$(dirname "${BASH_SOURCE[0]}")/validate-badge-only-advance.sh" "$repository" \
      "$(jq -r '.merge_base_commit.sha // empty' <<< "$comparison")" \
      "$(jq -r '.base_commit.sha // empty' <<< "$comparison")" ||
      fail "Branch '$head_branch' must include current main except for dependency badge updates before release CI can validate its artifacts."
  fi
fi

if [[ "$kind" == hotfix ]]; then
  validate_hotfix_patch_line
fi
