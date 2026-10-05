#!/usr/bin/env bash
# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
# Shared identity and retry checks, sourced by the two release PR entrypoints.

repository="${1:-}"
pr_number="${2:-}"
head_branch="${3:-}"
head_sha="${4:-}"
base_sha="${5:-}"
timeout_seconds="${6:-180}"
pending_output=""
scripts="$(dirname "${BASH_SOURCE[0]}")"

fail() {
  [[ -z "$pending_output" ]] || printf '%s\n' "$pending_output" >&2
  printf '::error::%s (operation=%s repository=%s release_pr=%s head_branch=%s head_sha=%s tested_base_sha=%s merge_sha=%s timeout_seconds=%s)\n' \
    "$1" "${operation:-release-pr}" "$repository" "$pr_number" "$head_branch" "$head_sha" "$base_sha" "${merge_sha:-unresolved}" "$timeout_seconds" >&2
  exit 1
}

if ! [[ $# -ge 5 && $# -le 6 &&
  "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ && "$pr_number" =~ ^[1-9][0-9]*$ &&
  "$head_branch" =~ ^(release|hotfix)/ && "$head_sha" =~ ^[0-9a-f]{40}$ &&
  "$base_sha" =~ ^[0-9a-f]{40}$ && "$timeout_seconds" =~ ^(0|[1-9][0-9]*)$ ]]; then
  fail 'Expected <owner/repository> <PR-number> <release-or-hotfix-branch> <head-sha> <tested-base-sha> [timeout-seconds]; exact identities and full SHAs are required.'
fi
bash "$scripts/validate-semver.sh" "${head_branch#*/}" >/dev/null || fail 'The release branch must name an unprefixed SemVer version.'
deadline=$((SECONDS + timeout_seconds))

read_pr() {
  pr="$(gh api "repos/$repository/pulls/$pr_number")" || fail 'Could not read the release PR.'
  jq -e --argjson number "$pr_number" --arg repository "$repository" \
    --arg branch "$head_branch" --arg sha "$head_sha" '
    .number == $number and .head.repo.full_name == $repository and
    .head.ref == $branch and .head.sha == $sha and
    .base.repo.full_name == $repository and .base.ref == "main"
  ' <<< "$pr" >/dev/null || {
    actual="$(jq -c '{number, head: {repository: .head.repo.full_name, branch: .head.ref, sha: .head.sha},
      base: {repository: .base.repo.full_name, branch: .base.ref}}' <<< "$pr")" ||
      fail 'Could not parse release PR identity.'
    fail "Release PR identity changed or does not match the expected same-repository head and main target; actual=$actual."
  }
  state="$(jq -er '
    if .state == "closed" and .merged == true and (.merged_at | type == "string" and length > 0) then "merged"
    elif .state == "open" and .merged == false and (.draft | type == "boolean") then "open"
    else error("Release PR must be open with a valid draft flag, or confirmed merged; state=\(.state) merged=\(.merged) draft=\(.draft)") end
  ' <<< "$pr")" || fail 'Release PR is closed without merging or has invalid merge state.'
}

is_merged() {
  [[ "$state" == merged ]]
}

confirm_release() {
  while jq -e '.merge_commit_sha == null' <<< "$pr" >/dev/null; do
    if (( SECONDS >= deadline )); then
      fail 'Timed out waiting for GitHub to report the actual merge SHA of the confirmed release.'
    fi
    remaining=$((deadline - SECONDS))
    (( remaining < 5 )) || remaining=5
    sleep "$remaining"
    read_pr
    is_merged || fail 'Release PR is no longer confirmed merged while waiting for its actual merge SHA.'
  done
  merge_sha="$(jq -er '.merge_commit_sha | select(type == "string" and test("^[0-9a-f]{40}$"))' <<< "$pr")" ||
    fail 'GitHub did not return a valid actual merge SHA for the confirmed release.'
  bash "$scripts/validate-current-release.sh" "$repository" "$merge_sha" ||
    fail 'The confirmed release is no longer current on main.'
  {
    echo "merge_sha=$merge_sha"
    echo "head_branch=$head_branch"
    echo "head_sha=$head_sha"
    echo "pr_number=$pr_number"
  } >> "$GITHUB_OUTPUT"
  echo "Confirmed release PR #$pr_number ($head_branch at $head_sha) merged at $merge_sha."
}
