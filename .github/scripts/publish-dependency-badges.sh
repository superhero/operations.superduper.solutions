#!/usr/bin/env bash
# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
set -euo pipefail

repository="${1:-}"
branch="${2:-}"
expected_sha="${3:-}"
project="${4:-}"
fail() {
  printf '::error::%s (repository=%s branch=%s expected_sha=%s)\n' \
    "$1" "$repository" "$branch" "$expected_sha" >&2
  exit 1
}
summary() {
  printf '%s\n' "$1"
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    printf '%s\n' "$1" | jq -Rr '@html | gsub("(?<char>[\\\\`*_\\[\\]|])"; "\\\(.char)")' >> "$GITHUB_STEP_SUMMARY"
  fi
}

[[ $# == 4 && "$repository" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] ||
  fail 'Usage: publish-dependency-badges.sh <owner/repository> <branch> <expected-sha> <project-directory>.'
[[ "$expected_sha" =~ ^[0-9a-f]{40}$ ]] || fail 'Expected SHA must contain 40 lowercase hexadecimal characters.'
if [[ -z "$branch" ]] || ! git check-ref-format "refs/heads/$branch" >/dev/null 2>&1; then
  fail 'Expected a valid branch name.'
fi
[[ -d "$project" ]] || fail 'Project directory does not exist.'

# Check every ancestor before Git or payload reads can follow a checkout-supplied link.
ancestor="$project/.github/badges"
while [[ "$ancestor" != / && "$ancestor" != . ]]; do
  [[ ! -L "$ancestor" ]] || fail "Badge directory has a symlink ancestor: '$ancestor'."
  ancestor="$(dirname -- "$ancestor")"
done
project="$(cd -- "$project" && pwd -P)"
root="$(git -C "$project" rev-parse --show-toplevel 2>/dev/null)" || fail 'Project is not a Git checkout.'
[[ "$project" == "$root" ]] || fail 'Project directory must be the Git checkout root.'
local_sha="$(git -C "$project" rev-parse HEAD 2>/dev/null)" || fail 'Could not read the checked-out commit.'
[[ "$local_sha" == "$expected_sha" ]] || fail "Checked-out commit differs from expected SHA: actual_sha=$local_sha."
shopt -s nullglob
for badge in "$project"/.github/badges/version-dependency-*.svg; do
  [[ ! -L "$badge" && -f "$badge" ]] || fail "Expected a regular dependency badge, not a symlink or directory: '$badge'."
done

temporary="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/publish-dependency-badges.XXXXXX")"
trap 'rm -rf -- "$temporary"' EXIT
pattern=':(glob).github/badges/version-dependency-*.svg'
git -C "$project" diff --no-ext-diff --no-textconv --no-renames --name-only -z HEAD -- "$pattern" > "$temporary/paths" ||
  fail 'Could not inspect changed dependency badges.'
git -C "$project" ls-files --others --exclude-standard -z -- "$pattern" >> "$temporary/paths" ||
  fail 'Could not inspect new dependency badges.'
: > "$temporary/additions"
: > "$temporary/deletions"
while IFS= read -r -d '' path; do
  [[ "$path" =~ ^\.github/badges/version-dependency-[a-z0-9][a-z0-9._-]*\.svg$ ]] ||
    fail "Unsafe dependency badge path: '$path'."
  [[ ! -L "$project/$path" ]] || fail "Dependency badge is a symlink: '$path'."
  before="$(git -C "$project" rev-parse --verify "$expected_sha:$path" 2>/dev/null)" || before=""
  if [[ -f "$project/$path" ]]; then
    after="$(git -C "$project" hash-object --no-filters -- "$path")" || fail "Could not inspect badge: '$path'."
    [[ "$before" != "$after" ]] || continue
    base64 -w0 -- "$project/$path" > "$temporary/contents" || fail "Could not read badge: '$path'."
    jq -nc --arg path "$path" --rawfile contents "$temporary/contents" \
      '{path: $path, contents: $contents}' >> "$temporary/additions"
  elif [[ ! -e "$project/$path" && -n "$before" ]]; then
    jq -nc --arg path "$path" '{path: $path}' >> "$temporary/deletions"
  else
    fail "Dependency badge is not a regular file: '$path'."
  fi
done < <(sort -zu "$temporary/paths")

if [[ ! -s "$temporary/additions" && ! -s "$temporary/deletions" ]]; then
  summary "Dependency badges unchanged for $repository:$branch; no commit needed."
  exit 0
fi

github() {
  local operation="$1" request="$2" status=0 diagnostic
  gh api graphql --method POST --input "$request" > "$temporary/response" 2> "$temporary/stderr" || status=$?
  if ! jq -e 'type == "object" and ((.errors // []) | type == "array" and length == 0)' \
    "$temporary/response" >/dev/null 2>&1 || (( status != 0 )); then
    # Keep GitHub's diagnostic, never the request or raw response body.
    jq -r '.errors[]?.message // empty' "$temporary/response" >> "$temporary/stderr" 2>/dev/null || true
    diagnostic="$(jq -Rrs '
      reduce ([env.GH_TOKEN, env.GITHUB_TOKEN, env.GH_APP_PRIVATE_KEY, env.NPM_TOKEN, env.NODE_AUTH_TOKEN][] |
        select(type == "string" and length > 0)) as $secret (.; split($secret) | join("[REDACTED]")) |
      gsub("(?<scheme>[A-Za-z][A-Za-z0-9+.-]*://)[^/@[:space:]]+@"; "\(.scheme)[REDACTED]@") |
      gsub("[[:cntrl:]]+"; " ") |
      if length == 0 then "GitHub returned no usable diagnostic or invalid JSON." else .[:1000] end
    ' "$temporary/stderr")"
    fail "$operation failed (exit $status): $diagnostic"
  fi
}

jq -n --arg owner "${repository%%/*}" --arg name "${repository#*/}" --arg ref "refs/heads/$branch" \
  '{query: "query($owner: String!, $name: String!, $ref: String!) { repository(owner: $owner, name: $name) { ref(qualifiedName: $ref) { target { oid } } } }",
    variables: {owner: $owner, name: $name, ref: $ref}}' > "$temporary/query.json"
github 'Reading remote branch head' "$temporary/query.json"
jq -e '.data.repository | type == "object" and has("ref")' "$temporary/response" >/dev/null ||
  fail 'GitHub returned no repository branch data.'
if jq -e '.data.repository.ref == null' "$temporary/response" >/dev/null; then
  summary "Dependency badge publication skipped for $repository:$branch: branch was deleted."
  exit 0
fi
actual_sha="$(jq -er '.data.repository.ref.target.oid | select(type == "string" and test("\\A[0-9a-f]{40}\\z"))' \
  "$temporary/response")" || fail 'GitHub returned an invalid branch head SHA.'
if [[ "$actual_sha" != "$expected_sha" ]]; then
  summary "Dependency badge publication skipped for $repository:$branch: branch advanced from $expected_sha to $actual_sha."
  exit 0
fi

jq -n --arg repository "$repository" --arg branch "$branch" --arg sha "$expected_sha" \
  --slurpfile additions "$temporary/additions" --slurpfile deletions "$temporary/deletions" \
  '{query: "mutation($input: CreateCommitOnBranchInput!) { createCommitOnBranch(input: $input) { commit { oid url } } }",
    variables: {input: {branch: {repositoryNameWithOwner: $repository, branchName: $branch},
      expectedHeadOid: $sha, message: {headline: "chore: refresh dependency badges"},
      fileChanges: {additions: $additions, deletions: $deletions}}}}' > "$temporary/commit.json"
github 'Publishing dependency badge commit (branch must still match expected SHA)' "$temporary/commit.json"
commit="$(jq -er '.data.createCommitOnBranch.commit.oid | select(type == "string" and test("\\A[0-9a-f]{40}\\z"))' \
  "$temporary/response")" || fail 'GitHub returned no dependency badge commit SHA.'
summary "Published dependency badges for $repository:$branch: ${GITHUB_SERVER_URL:-https://github.com}/$repository/commit/$commit"
