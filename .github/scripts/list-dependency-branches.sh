#!/usr/bin/env bash
# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
set -euo pipefail

repository="${1:-}"
endpoint="repos/$repository/branches?per_page=100"
fail() {
  printf '::error::%s (repository=%s endpoint=%s)\n' "$1" "${repository:-unset}" "$endpoint" >&2
  exit 1
}

if ! [[ $# == 1 && "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
  fail 'Usage: list-dependency-branches.sh <owner/repository>.'
fi

diagnostic="$(mktemp "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/dependency-branches.XXXXXX")"
trap 'rm -f -- "$diagnostic"' EXIT
if ! response="$(gh api --paginate "$endpoint" 2> "$diagnostic")"; then
  reason="$(jq -Rrs '
    reduce ([env.GH_TOKEN, env.GITHUB_TOKEN, env.GH_APP_PRIVATE_KEY, env.CLOUDFLARE_API_TOKEN][] |
      select(type == "string" and length > 0)) as $secret (.; split($secret) | join("[REDACTED]")) |
    gsub("(?<scheme>[A-Za-z][A-Za-z0-9+.-]*://)[^/@[:space:]]+@"; "\(.scheme)[REDACTED]@") |
    gsub("[[:cntrl:]]+"; " ") |
    if length == 0 then "GitHub CLI returned no diagnostic." else .[:1000] end
  ' "$diagnostic")"
  fail "Could not list repository branches: $reason"
fi

branches="$(jq -cse '
  if length > 0 and all(.[]; type == "array") then
    [.[][] | {branch: .name, sha: .commit.sha}] |
    select(all(.[];
      (.branch | type == "string" and length > 0 and (test("[[:cntrl:]]") | not)) and
      (.sha | type == "string" and test("\\A[0-9a-f]{40}\\z"))))
  else empty end
' <<< "$response" 2>/dev/null)" || fail 'GitHub returned invalid branch data; expected arrays of branch names and full commit SHAs.'

count="$(jq 'length' <<< "$branches")"
(( count > 0 )) || fail 'No branches were returned; dependency checks cannot run.'
(( count <= 256 )) || fail "Found $count branches; GitHub Actions supports at most 256 jobs in a matrix. No branches were omitted."
while IFS= read -r branch; do
  git check-ref-format "refs/heads/$branch" >/dev/null 2>&1 || fail "GitHub returned an invalid branch name: $branch"
done < <(jq -r '.[].branch' <<< "$branches")

printf '%s\n' "$branches"
