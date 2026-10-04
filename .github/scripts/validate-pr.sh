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
released_revision=""
if jq -e --arg version "$version" 'index($version) != null' <<< "$tags" >/dev/null; then
  released_revision="$version"
else
  # GitHub can delete a merged branch before the tagging workflow completes.
  # The merged PR keeps that version reserved even if tagging failed.
  released_revision="$(gh api --paginate "repos/$repository/pulls?state=closed&base=main&per_page=100" |
    jq -sr --arg repository "$repository" --arg version "$version" '
      [.[][] | select(.merged_at != null and .head.repo.full_name == $repository and
        (.head.ref == "release/" + $version or .head.ref == "hotfix/" + $version))] |
      if length == 0 then empty
      elif length == 1 and ((.[0].merge_commit_sha // "") | test("^[0-9a-f]{40}$"))
      then .[0].merge_commit_sha
      else error("Merged version must have one unambiguous merge commit") end')" ||
    fail "Could not inspect closed main PRs reserving version '$version'."
fi
if [[ -n "$released_revision" ]]; then
  [[ "$base_branch" == develop ]] || fail "Version '$version' already exists as a tag or merged release."
  comparison="$(gh api "repos/$repository/compare/$head_sha...$released_revision")" ||
    fail "Could not compare $head_sha...$released_revision to validate release synchronization."
  jq -e '.behind_by == 0' <<< "$comparison" >/dev/null ||
    fail "Branch '$head_branch' contains changes outside its released version '$version'."
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
  jq -e '.behind_by == 0' <<< "$comparison" >/dev/null ||
    fail "Branch '$head_branch' must include current main before release CI can validate its artifacts."
fi

if [[ "$kind" == hotfix ]]; then
  # The newest tag reachable from this target determines its patch line. Tags
  # from other support lines must not force an unrelated version increment.
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
      break
    fi
  done <<< "$semver_tags"
fi
