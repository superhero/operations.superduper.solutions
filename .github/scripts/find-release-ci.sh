#!/usr/bin/env bash
# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
set -euo pipefail

repository="${1:-}"
pr_number="${2:-}"
head_sha="${3:-}"
timeout_seconds="${4:-600}"

fail() {
  printf '::error::%s (repository=%s release_pr=%s head_sha=%s branch=%s run_id=%s timeout_seconds=%s)\n' \
    "$1" "${repository:-unset}" "${pr_number:-unset}" "${head_sha:-unset}" \
    "${branch:-unresolved}" "${run_id:-not-found}" "$timeout_seconds" >&2
  exit 1
}

[[ -n "$repository" ]] || fail 'Repository is required.'
[[ -n "$pr_number" ]] || fail 'Release PR number is required.'
[[ -n "$head_sha" ]] || fail 'Full release SHA is required.'
[[ "$timeout_seconds" =~ ^[0-9]+$ ]] || fail 'CI timeout must be a nonnegative number of seconds.'

pr="$(gh api "repos/$repository/pulls/$pr_number")" || fail 'Could not read release PR before selecting CI artifacts.'
jq -e --arg repository "$repository" --arg sha "$head_sha" '
  .merged == true and .base.ref == "main" and
  .head.repo.full_name == $repository and .head.sha == $sha and
  (.head.ref | startswith("release/") or startswith("hotfix/"))
' <<<"$pr" >/dev/null || {
  actual="$(jq -r '"merged=\(.merged) head=\(.head.repo.full_name):\(.head.ref)@\(.head.sha) base=\(.base.ref)"' <<<"$pr")"
  fail "PR #$pr_number is not a merged release at $head_sha; expected merged release/* or hotfix/* -> main in $repository; actual $actual."
}
branch="$(jq -r '.head.ref' <<<"$pr")"
deadline=$((SECONDS + timeout_seconds))
run_id=""
status="not-found"

while :; do
  if [[ -z "$run_id" ]]; then
    runs="$(
      gh api --paginate --method GET "repos/$repository/actions/workflows/ci-main.yml/runs" \
        -f event=pull_request -f "head_sha=$head_sha" -f "branch=$branch" -f per_page=100 |
        jq -s '[.[].workflow_runs[]]'
    )" || fail "Could not list ci-main.yml pull-request runs for $branch at $head_sha."
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
    run="$(gh api "repos/$repository/actions/runs/$run_id")" || fail "Could not read release CI run $run_id."
    status="$(jq -r '.status' <<<"$run")"
    if [[ "$status" == "completed" ]]; then
      conclusion="$(jq -r '.conclusion' <<<"$run")"
      [[ "$conclusion" == "success" ]] || fail "Release CI run $run_id finished with $conclusion; expected success, deployment refused."
      artifacts="$(
        gh api --paginate "repos/$repository/actions/runs/$run_id/artifacts?per_page=100" |
          jq -s '[.[].artifacts[] | select(.expired == false) | .name]'
      )" || fail "Could not list artifacts for release CI run $run_id."
      missing="$(jq -r '["bundle", "coverage", "test-report"] - . | join(", ")' <<<"$artifacts")"
      [[ -z "$missing" ]] || {
        available="$(jq -r 'join(", ")' <<<"$artifacts")"
        fail "Release CI run $run_id is missing required artifacts: $missing; available unexpired artifacts: ${available:-none}."
      }
      echo "run_id=$run_id" >> "$GITHUB_OUTPUT"
      echo "Validated release CI run $run_id for PR #$pr_number at $head_sha."
      exit 0
    fi
  fi

  if (( SECONDS >= deadline )); then
    fail "Timed out after $timeout_seconds seconds waiting for release CI; expected completed/success, last_status=$status."
  fi
  echo "Waiting for release CI for PR #$pr_number (run ${run_id:-not found})..."
  remaining=$((deadline - SECONDS))
  (( remaining < 5 )) || remaining=5
  sleep "$remaining"
done
