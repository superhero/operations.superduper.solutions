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

pr="$(gh api "repos/$repository/pulls/$pull_request")" || fail 'Could not read current pull request state.'
reason="$(jq -er --arg sha "$head_sha" --arg repository "$repository" --arg base "$base_branch" '
  if .state != "open" then "State is \(.state); expected open."
  elif .draft != false then "Draft status is \(.draft); expected false."
  elif .head.repo.full_name != $repository then "Head repository is \(.head.repo.full_name); expected \($repository)."
  elif .head.sha != $sha then "Head changed: expected \($sha), found \(.head.sha); rerun CI."
  elif .base.ref != $base then "Base branch changed: expected \($base), found \(.base.ref); rerun CI."
  else "" end' <<< "$pr")" || fail 'Could not parse current pull request state.'
[[ -z "$reason" ]] || fail "$reason"
current_base="$(jq -r '.base.sha // empty' <<< "$pr")"
if [[ "$current_base" != "$base_sha" ]]; then
  bash "$(dirname "${BASH_SOURCE[0]}")/validate-badge-only-advance.sh" "$repository" "$base_sha" "$current_base" ||
    fail "Pull request base changed beyond dependency badges; update the branch and rerun CI. Expected $base_sha, found $current_base."
fi

if [[ "$base_branch" == main ]]; then
  comparison="$(gh api "repos/$repository/compare/main...$head_sha")" ||
    fail "Could not compare main...$head_sha before merging."
  if ! jq -e '.behind_by == 0' <<< "$comparison" >/dev/null; then
    bash "$(dirname "${BASH_SOURCE[0]}")/validate-badge-only-advance.sh" "$repository" \
      "$(jq -r '.merge_base_commit.sha // empty' <<< "$comparison")" \
      "$(jq -r '.base_commit.sha // empty' <<< "$comparison")" ||
      fail "Main changed beyond dependency badges since this release was built (main...$head_sha reports behind_by=$(jq -r '.behind_by' <<< "$comparison")); update the branch and rerun CI."
  fi
fi

gh pr merge "$pull_request" \
  --repo "$repository" \
  --auto \
  --merge \
  --match-head-commit "$head_sha" || fail 'GitHub could not merge the validated pull request.'
