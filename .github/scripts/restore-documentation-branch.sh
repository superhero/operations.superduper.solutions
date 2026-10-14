#!/usr/bin/env bash
# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
set -euo pipefail

repository="${1:-}"
pull_request="${2:-}"
head_branch="${3:-}"
head_sha="${4:-}"
base_branch="${5:-}"
error_log=""
write_status='not attempted'
trap '[[ -z "$error_log" ]] || rm -f "$error_log"' EXIT

fail() {
  [[ -z "$error_log" || ! -s "$error_log" ]] || cat "$error_log" >&2
  printf '::error::Documentation source recovery for %s PR #%s (source=%s head=%s original_base=%s write=%s): %s\n' \
    "$repository" "$pull_request" "$head_branch" "$head_sha" "$base_branch" "$write_status" "$1" >&2
  exit 1
}

if ! [[ $# == 5 && "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ &&
  "$pull_request" =~ ^[1-9][0-9]*$ && "$head_branch" == docs/?* &&
  "$head_sha" =~ ^[0-9a-f]{40}$ ]]; then
  fail 'Usage: restore-documentation-branch.sh <owner/repository> <merged-pr-number> <docs/branch> <full-original-head-sha> <original-base>.'
fi
git check-ref-format "refs/heads/$head_branch" || fail 'Invalid documentation source branch.'
case "$base_branch" in
  main|develop) ;;
  release/*)
    bash "$(dirname "${BASH_SOURCE[0]}")/validate-semver.sh" "${base_branch#release/}" >/dev/null ||
      fail 'Original release target must have a valid version.'
    ;;
  *) fail 'Original base must be main, develop, or release/<valid-semver>.' ;;
esac

error_log="$(mktemp)" || fail 'Could not create the API diagnostic file.'
encoded_branch="$(jq -rn --arg branch "$head_branch" '$branch | @uri')" || fail 'Could not encode the source branch.'
reference="refs/heads/$head_branch"
ref_endpoint="repos/$repository/git/ref/heads/$encoded_branch"

read_pr() {
  local pr
  pr="$(gh api "repos/$repository/pulls/$pull_request" 2>"$error_log")" ||
    fail 'Could not read the exact merged pull request; no source recovery attempted.'
  pr_identity="$(jq -ecs --arg number "$pull_request" --arg repository "$repository" \
    --arg branch "$head_branch" --arg sha "$head_sha" --arg base "$base_branch" '
    def sha: type == "string" and test("\\A[0-9a-f]{40}\\z");
    select(length == 1) | .[0] |
    select(type == "object" and (.number | type == "number" and tostring == $number) and
      .head.repo.full_name == $repository and .base.repo.full_name == $repository and
      .head.ref == $branch and .head.sha == $sha and .base.ref == $base and
      (.base.sha | sha) and .state == "closed" and .merged == true and .draft == false and
      (.merge_commit_sha | sha) and
      (.merged_at | type == "string" and (. as $timestamp |
        (try (fromdateiso8601 | todateiso8601) catch null) == $timestamp))) |
    {number, head: {ref: .head.ref, sha: .head.sha, repository: .head.repo.full_name},
      base: {ref: .base.ref, sha: .base.sha, repository: .base.repo.full_name},
      merged_at, merge_commit_sha}
  ' <<< "$pr")" ||
    fail 'Invalid merged PR identity or metadata: require the exact PR number, same repositories, original source SHA, and original base.'
}

# Read the HTTP status emitted by gh itself. A failed request, a JSON status
# field, or text containing "404" does not prove that a source ref is absent.
request_with_status() {
  local response status_line
  api_exit=0
  response="$(gh api --include "$@" 2>"$error_log")" || api_exit=$?
  response="${response//$'\r'/}"
  status_line="${response%%$'\n'*}"
  api_status=""
  api_body=""
  if [[ "$status_line" =~ ^HTTP/[0-9]+(\.[0-9]+)?\ ([0-9]{3})(\ .*)?$ && "$response" == *$'\n\n'* ]]; then
    api_status="${BASH_REMATCH[2]}"
    api_body="${response#*$'\n\n'}"
  fi
}

validate_ref() {
  jq -ers --arg ref "$reference" '
    select(length == 1) | .[0] |
    select(type == "object" and .ref == $ref and .object.type == "commit" and
      (.object.sha | type == "string" and test("\\A[0-9a-f]{40}\\z"))) |
    .object.sha
  ' <<< "$1"
}

read_ref() {
  request_with_status "$ref_endpoint"
  ref_exists=false
  ref_sha=""
  if [[ "$api_status" == 200 && "$api_exit" == 0 ]]; then
    ref_sha="$(validate_ref "$api_body")" || fail 'Invalid source ref response; recovery refused.'
    ref_exists=true
  elif [[ "$api_status" == 404 && "$api_exit" != 0 ]] &&
    jq -es 'length == 1 and (.[0] | type == "object" and .message == "Not Found" and
      (.status == null or .status == "404" or .status == 404))' <<< "$api_body" >/dev/null; then
    : # The exact source ref is missing; only a create may follow.
  else
    fail 'Could not inspect source ref: require a successful read or a complete HTTP 404 Not Found response.'
  fi
}

require_exact_ref() {
  [[ "$ref_exists" == true ]] || fail 'Source ref is still missing; recovery is unconfirmed. Retry with the same pinned PR identity.'
  [[ "$ref_sha" == "$head_sha" ]] ||
    fail "Source branch exists at $ref_sha instead of $head_sha; refusing to overwrite or rewind it."
}

read_pr
original_pr_identity="$pr_identity"
read_ref
if [[ "$ref_exists" == true ]]; then
  require_exact_ref
  printf 'Documentation source %s already exists at %s; no write needed.\n' "$head_branch" "$head_sha"
  exit 0
fi

# Recheck the merged PR immediately before creating the missing ref. Always
# recover its original head, including after a squash merge, never its merge SHA.
read_pr
[[ "$pr_identity" == "$original_pr_identity" ]] || fail 'Merged PR metadata changed before recovery; no source recovery attempted.'
write_status='attempted; unconfirmed'
request_with_status --method POST "repos/$repository/git/refs" -f "ref=$reference" -f "sha=$head_sha"
if [[ "$api_exit" == 0 && "$api_status" == 201 ]]; then
  created_sha="$(validate_ref "$api_body")" || fail 'Create response did not confirm the expected source ref; inspect the source before retrying.'
  [[ "$created_sha" == "$head_sha" ]] || fail 'Create response returned a different source SHA; recovery is unconfirmed.'
else
  # A competing restore or a lost response may have completed the create. A
  # successful exact read is the only acceptable recovery from a failed create.
  read_ref
  require_exact_ref
  printf 'Documentation source %s confirmed at %s after a concurrent or interrupted create.\n' "$head_branch" "$head_sha"
  exit 0
fi
read_ref
require_exact_ref
printf 'Restored documentation source %s at its original head %s from merged PR #%s.\n' "$head_branch" "$head_sha" "$pull_request"
