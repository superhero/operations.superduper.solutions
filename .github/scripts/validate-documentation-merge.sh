#!/usr/bin/env bash
# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
set -euo pipefail

repository="${1:-}"
base_branch="${2:-}"
fail() {
  printf '::error::%s (repository=%s base_branch=%s)\n' "$1" "$repository" "$base_branch" >&2
  exit 1
}
if ! [[ $# == 2 && "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ &&
  ( "$base_branch" == main || "$base_branch" == develop ) ]]; then
  fail 'Usage: validate-documentation-merge.sh <owner/repository> <main|develop>.'
fi
[[ "$base_branch" == main ]] || exit 0

# Called while holding the main merge lock: a release waiting for that lock
# cannot start publication between this check and the documentation merge.
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
[[ -z "$active" ]] ||
  fail "Production release work is active: $active. Rerun documentation CI after the active release finishes."
echo 'No active production release prevents the documentation merge.'
