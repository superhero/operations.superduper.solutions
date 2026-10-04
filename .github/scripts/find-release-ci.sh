#!/usr/bin/env bash
# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
set -euo pipefail

repository="${1:?Repository is required}"
pr_number="${2:?Release PR number is required}"
head_sha="${3:?Full release SHA is required}"
timeout_seconds="${4:-600}"
[[ "$timeout_seconds" =~ ^[0-9]+$ ]] || { echo "::error::Invalid CI timeout." >&2; exit 1; }

pr="$(gh api "repos/$repository/pulls/$pr_number")"
jq -e --arg repository "$repository" --arg sha "$head_sha" '
  .merged == true and .base.ref == "main" and
  .head.repo.full_name == $repository and .head.sha == $sha and
  (.head.ref | startswith("release/") or startswith("hotfix/"))
' <<<"$pr" >/dev/null || {
  echo "::error::PR #$pr_number is not a merged release at $head_sha." >&2
  exit 1
}
branch="$(jq -r '.head.ref' <<<"$pr")"
deadline=$((SECONDS + timeout_seconds))
run_id=""

while :; do
  if [[ -z "$run_id" ]]; then
    runs="$(
      gh api --paginate --method GET "repos/$repository/actions/workflows/ci-main.yml/runs" \
        -f event=pull_request -f "head_sha=$head_sha" -f "branch=$branch" -f per_page=100 |
        jq -s '[.[].workflow_runs[]]'
    )"
    # GitHub may omit pull_requests after merge; the verified branch and SHA
    # remain authoritative. If associations are present, require this PR.
    run_id="$(
      jq -r --arg sha "$head_sha" --arg branch "$branch" \
        --arg repository "$repository" --argjson pr "$pr_number" '
        [.[] | select(
          .head_sha == $sha and .head_branch == $branch and
          .head_repository.full_name == $repository and .event == "pull_request" and
          ((.pull_requests | length) == 0 or any(.pull_requests[]; .number == $pr))
        )] | max_by(.id) | .id // empty
      ' <<<"$runs"
    )"
  fi

  if [[ -n "$run_id" ]]; then
    run="$(gh api "repos/$repository/actions/runs/$run_id")"
    if [[ "$(jq -r '.status' <<<"$run")" == "completed" ]]; then
      conclusion="$(jq -r '.conclusion' <<<"$run")"
      [[ "$conclusion" == "success" ]] || {
        echo "::error::Release CI run $run_id finished with $conclusion; deployment refused." >&2
        exit 1
      }
      artifacts="$(
        gh api --paginate "repos/$repository/actions/runs/$run_id/artifacts?per_page=100" |
          jq -s '[.[].artifacts[] | select(.expired == false) | .name]'
      )"
      missing="$(jq -r '["bundle", "coverage", "coverage-status"] - . | join(", ")' <<<"$artifacts")"
      [[ -z "$missing" ]] || {
        echo "::error::Release CI run $run_id is missing required artifacts: $missing." >&2
        exit 1
      }
      echo "run_id=$run_id" >> "$GITHUB_OUTPUT"
      echo "Validated release CI run $run_id for PR #$pr_number at $head_sha."
      exit 0
    fi
  fi

  if (( SECONDS >= deadline )); then
    echo "::error::Timed out waiting for release CI for PR #$pr_number at $head_sha (run ${run_id:-not found})." >&2
    exit 1
  fi
  echo "Waiting for release CI for PR #$pr_number (run ${run_id:-not found})..."
  remaining=$((deadline - SECONDS))
  (( remaining < 5 )) || remaining=5
  sleep "$remaining"
done
