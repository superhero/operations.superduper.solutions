#!/usr/bin/env bash
# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
set -euo pipefail

repository="${1:-}"
base_branch="${2:-}"
wait_seconds="${DOCUMENTATION_MERGE_WAIT_SECONDS:-0}"
fail() {
  printf '::error::%s (repository=%s base_branch=%s)\n' "$1" "$repository" "$base_branch" >&2
  exit 1
}
if ! [[ $# == 2 && "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ &&
  ( "$base_branch" == main || "$base_branch" == develop || "$base_branch" == release/* ) ]]; then
  fail 'Usage: validate-documentation-merge.sh <owner/repository> <main|develop|release/version>.'
fi
[[ "$wait_seconds" =~ ^(0|[1-9][0-9]{0,2})$ && "$wait_seconds" -le 120 ]] ||
  fail 'DOCUMENTATION_MERGE_WAIT_SECONDS must be an integer from 0 to 120.'
if [[ "$base_branch" == release/* ]]; then
  bash "$(dirname "${BASH_SOURCE[0]}")/validate-semver.sh" "${base_branch#*/}" >/dev/null ||
    fail "Invalid target release version '${base_branch#*/}'."
fi
[[ "$base_branch" != develop ]] || exit 0

# Both main and release documentation hold the main merge lock: a release
# cannot start publication between this check and the documentation merge.
elapsed=0
while true; do
  runs="$(gh api --paginate "repos/$repository/actions/workflows/ci-main.yml/runs?status=in_progress&per_page=100")" ||
    fail 'Could not inspect active production releases; no documentation merge attempted.'
  active="$(jq -ers '
    def count: type == "number" and . >= 0 and . == floor;
    select(length > 0 and all(.[];
      type == "object" and (.total_count | count) and (.workflow_runs | type == "array"))) |
    .[0].total_count as $total |
    select(all(.[]; .total_count == $total)) |
    [.[].workflow_runs[]] |
    select(length == $total and ([.[].id] | unique | length) == $total and
      all(.[]; type == "object" and (.id | count and . > 0) and
        .status == "in_progress" and
        (.head_branch | type == "string" and length > 0 and (test("[[:cntrl:]]") | not)))) |
    [.[] | select(.head_branch == "develop" or
      (.head_branch | startswith("release/") or startswith("hotfix/"))) |
      "\(.head_branch) (run \(.id))"] | join(", ")
  ' <<< "$runs")" || fail 'Invalid or incomplete active workflow data; no documentation merge attempted.'
  [[ -n "$active" ]] || break
  if ((elapsed >= wait_seconds)); then
    fail "Production release work is active: $active. Rerun documentation CI after the active release finishes."
  fi
  # Generated changelog PRs can start while their creating ci-main run is still
  # finishing. Wait only when explicitly requested, and validate every response.
  delay=2
  ((wait_seconds - elapsed >= delay)) || delay=$((wait_seconds - elapsed))
  sleep "$delay"
  elapsed=$((elapsed + delay))
done
echo 'No active production release prevents the documentation merge.'
