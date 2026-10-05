#!/usr/bin/env bash
# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
set -euo pipefail

repository="${1:-}"
released="${2:-}"
head_sha="${3:-}"
fail() {
  printf '::error::%s (repository=%s released=%s head_sha=%s)\n' \
    "$1" "$repository" "$released" "$head_sha" >&2
  exit 1
}
if ! [[ $# == 3 && "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ &&
  "$released" =~ ^([0-9a-f]{40}|(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*))$ &&
  "$head_sha" =~ ^[0-9a-f]{40}$ ]]; then
  fail 'Usage: validate-released-content.sh <owner/repository> <released-sha-or-version> <head-sha>; candidate must be a full commit SHA.'
fi
[[ "$released" != "$head_sha" ]] || exit 0

comparison="$(gh api "repos/$repository/compare/$released...$head_sha")" ||
  fail 'Could not compare released content with the synchronization head.'
# Once the released commit is an ancestor, this diff describes the actual
# content to synchronize, including a harmless merge reconciling squash history.
# Compare responses cap changed files at 300; refuse that boundary.
if ! jq -e --arg released "$released" '
  def sha: type == "string" and test("\\A[0-9a-f]{40}\\z");
  def badge: type == "string" and test("\\A\\.github/badges/version-dependency-[a-z0-9][a-z0-9._-]*\\.svg\\z");
  (.status == "ahead" or .status == "identical") and .behind_by == 0 and
  (.base_commit.sha | sha) and .merge_base_commit.sha == .base_commit.sha and
  (if ($released | sha) then .base_commit.sha == $released else true end) and
  (.files | type == "array" and length < 300 and
    all(.[]; (.filename | badge) and
      (if has("previous_filename") then (.previous_filename | badge) else true end)))
' <<< "$comparison" >/dev/null; then
  fail 'Synchronization must contain the released commit and differ only in dependency version SVGs; refusing other content, unrelated history, or an incomplete file comparison.'
fi
