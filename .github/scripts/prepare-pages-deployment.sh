#!/usr/bin/env bash
# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
set -euo pipefail

repository="${1:-}"
branch="${2:-}"
commit_sha="${3:-}"
bundle="${4:-dist}"
project='operations-superduper-solutions'
environment='preview'
[[ "$branch" != main ]] || environment='production'
endpoint='unresolved'

sanitize() {
  jq -Rrs '
    reduce ([env.GH_TOKEN, env.GITHUB_TOKEN, env.GH_APP_PRIVATE_KEY, env.CLOUDFLARE_API_TOKEN][] |
      select(type == "string" and length > 0)) as $secret (.; split($secret) | join("[REDACTED]")) |
    gsub("(?<scheme>[A-Za-z][A-Za-z0-9+.-]*://)[^/@[:space:]]+@"; "\(.scheme)[REDACTED]@") |
    gsub("[[:cntrl:]]+"; " ") | .[:1800]
  '
}
fail() {
  printf '::error::%s\n' "$(printf '%s (repository=%s branch=%s commit_sha=%s bundle=%s account=%s project=%s endpoint=%s)' \
    "$1" "$repository" "$branch" "$commit_sha" "$bundle" "${CLOUDFLARE_ACCOUNT_ID:-unset}" "$project" "$endpoint" | sanitize)" >&2
  exit 1
}
summary() {
  printf '%s\n' "$1"
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    printf '%s\n' "$1" >> "$GITHUB_STEP_SUMMARY"
  fi
}
output() {
  [[ -n "${GITHUB_OUTPUT:-}" ]] || fail 'GITHUB_OUTPUT is required to pass the deployment decision to the workflow.'
  printf 'deploy=%s\nskipped=%s\nbundle_hash=%s\ndeployment_id=%s\ndeployment_url=%s\nalias_url=%s\n' \
    "$deploy" "$skipped" "$bundle_hash" "$deployment_id" "$deployment_url" "$alias_url" >> "$GITHUB_OUTPUT"
}

[[ $# -ge 3 && $# -le 4 && "$repository" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] ||
  fail 'Usage: prepare-pages-deployment.sh <owner/repository> <branch> <commit-sha> [bundle-directory].'
[[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] || fail 'Expected a full lowercase commit SHA.'
case "$branch" in
  main|develop) ;;
  release/*|hotfix/*)
    bash "$(dirname "${BASH_SOURCE[0]}")/validate-semver.sh" "${branch#*/}" >/dev/null 2>&1 ||
      fail 'Release and hotfix branches must contain an unprefixed MAJOR.MINOR.PATCH version.' ;;
  *) fail 'Pages deployment supports main, develop, release/<version>, and hotfix/<version> branches.' ;;
esac
for credential in GH_TOKEN CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID; do
  [[ -n "${!credential:-}" ]] || fail "Required deployment credential is missing: $credential."
done
[[ -n "${GITHUB_OUTPUT:-}" ]] || fail 'GITHUB_OUTPUT is required to pass the deployment decision to the workflow.'
[[ -d "$bundle" ]] || fail 'Bundle directory does not exist.'
ancestor="$bundle"
while [[ "$ancestor" != / && "$ancestor" != . ]]; do
  [[ ! -L "$ancestor" ]] || fail "Bundle directory has a symlink ancestor: $ancestor."
  ancestor="$(dirname -- "$ancestor")"
done
shopt -s nullglob dotglob
files=("$bundle"/*)
[[ ${#files[@]} == 1 && "${files[0]}" == "$bundle/index.html" && -f "${files[0]}" && ! -L "${files[0]}" && -s "${files[0]}" ]] ||
  fail 'Expected a single nonempty regular index.html in the bundle; additional files, directories, and symlinks are not supported.'
bundle_hash="$(sha256sum -- "$bundle/index.html")" || fail 'Could not hash the application bundle.'
bundle_hash="${bundle_hash%% *}"
alias="$(printf '%s' "$branch" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g')"
[[ ${#alias} -le 63 ]] || fail 'Branch alias exceeds the DNS label limit of 63 characters.'
alias_url="https://$alias.$project.pages.dev"
[[ "$environment" != production ]] || alias_url="https://$project.pages.dev"
deploy=true
skipped=false
deployment_id=''
deployment_url=''

temporary="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/prepare-pages-deployment.XXXXXX")"
trap 'rm -rf -- "$temporary"' EXIT
cloudflare() {
  local status=0 reason
  curl --fail-with-body --silent --show-error --connect-timeout 10 --max-time 60 --request GET \
    --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    "https://api.cloudflare.com/client/v4$endpoint" > "$temporary/response" 2> "$temporary/stderr" || status=$?
  if (( status != 0 )) || ! jq -e 'type == "object" and .success == true' "$temporary/response" >/dev/null 2>&1; then
    jq -r '.errors[]? | select(type == "object") | "Cloudflare error \(.code // "unknown"): \(.message // "No message provided")"' \
      "$temporary/response" >> "$temporary/stderr" 2>/dev/null || true
    reason="$(sanitize < "$temporary/stderr")"
    fail "Could not inspect the Pages destination (exit $status): ${reason:-invalid or unsuccessful Cloudflare response.}"
  fi
}

endpoint="/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/$project"
cloudflare
jq -e --arg project "$project" '.result | type == "object" and .name == $project and
  .production_branch == "main" and .subdomain == ($project + ".pages.dev")' "$temporary/response" >/dev/null 2>&1 ||
  fail 'Cloudflare returned an unexpected project, production branch, or Pages subdomain.'
if [[ "$environment" == production ]]; then
  jq -e '.result | has("canonical_deployment") and
    (.canonical_deployment == null or (.canonical_deployment | type == "object"))' "$temporary/response" >/dev/null 2>&1 ||
    fail 'Cloudflare returned invalid canonical deployment data.'
  jq -c '.result.canonical_deployment // empty' "$temporary/response" > "$temporary/candidates"
else
  : > "$temporary/candidates"
  page=1
  while :; do
    # Pages deployment listing accepts at most 25 entries per page.
    endpoint="/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/$project/deployments?env=preview&page=$page&per_page=25"
    cloudflare
    jq -e --argjson page "$page" '
      def integer: type == "number" and . == floor;
      (.result | type == "array") and
      (.result_info | .page == $page and (.per_page | integer and . > 0 and . <= 25) and
        (.count | integer and . >= 0 and . <= 25) and
        (.total_pages | integer and . >= 0 and . <= 1000)) and
      (.result | length) == .result_info.count and
      (.result_info.count <= .result_info.per_page) and
      (.result_info.total_pages >= $page or ($page == 1 and .result_info.total_pages == 0 and .result_info.count == 0)) and
      all(.result[]; type == "object" and has("aliases") and
        (.aliases == null or (.aliases | type == "array" and all(.[]; type == "string"))))
    ' "$temporary/response" >/dev/null 2>&1 || fail 'Cloudflare returned invalid or incomplete preview deployment pagination or aliases.'
    jq -c --arg alias "$alias_url" '.result[] | select((.aliases // []) | index($alias))' \
      "$temporary/response" >> "$temporary/candidates"
    total_pages="$(jq -r '.result_info.total_pages' "$temporary/response")"
    (( page < total_pages )) || break
    (( page += 1 ))
  done
fi

count="$(jq -s 'length' "$temporary/candidates")"
(( count <= 1 )) || fail 'More than one deployment claims the destination alias; refusing an ambiguous reuse decision.'
if (( count == 1 )); then
  jq -e --arg branch "$branch" --arg environment "$environment" --arg project "$project" '
    (.id | type == "string" and test("\\A[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\\z")) and
    .environment == $environment and .deployment_trigger.metadata.branch == $branch and
    .latest_stage.name == "deploy" and .latest_stage.status == "success" and
    (.url | type == "string" and startswith("https://") and
      endswith("." + $project + ".pages.dev") and test("\\Ahttps://[a-z0-9-]+\\.[a-z0-9-]+\\.pages\\.dev\\z")) and
    (.deployment_trigger.metadata.commit_message | . == null or type == "string")
  ' "$temporary/candidates" >/dev/null 2>&1 || fail 'The active destination deployment has invalid identity, URL, branch, environment, or completion status.'
  if jq -e --arg marker "bundle-sha256:$bundle_hash" '.deployment_trigger.metadata.commit_message == $marker' \
    "$temporary/candidates" >/dev/null; then
    deploy=false
    deployment_id="$(jq -r '.id' "$temporary/candidates")"
    deployment_url="$(jq -r '.url' "$temporary/candidates")"
  fi
fi

# Read the branch after inspecting Cloudflare, immediately before the caller can deploy.
endpoint="repos/$repository:refs/heads/$branch"
jq -n --arg owner "${repository%%/*}" --arg name "${repository#*/}" --arg ref "refs/heads/$branch" \
  '{query: "query($owner: String!, $name: String!, $ref: String!) { repository(owner: $owner, name: $name) { ref(qualifiedName: $ref) { target { oid } } } }",
    variables: {owner: $owner, name: $name, ref: $ref}}' > "$temporary/query"
status=0
gh api graphql --method POST --input "$temporary/query" > "$temporary/response" 2> "$temporary/stderr" || status=$?
if (( status != 0 )) || ! jq -e 'type == "object" and ((.errors // []) | type == "array" and length == 0) and
  (.data.repository | type == "object" and has("ref"))' "$temporary/response" >/dev/null 2>&1; then
  jq -r '.errors[]?.message // empty' "$temporary/response" >> "$temporary/stderr" 2>/dev/null || true
  reason="$(sanitize < "$temporary/stderr")"
  fail "Could not read the destination branch (exit $status): ${reason:-invalid or unavailable GitHub repository data.}"
fi
if jq -e '.data.repository.ref == null' "$temporary/response" >/dev/null; then
  [[ "$environment" != production ]] || fail 'The production branch no longer exists.'
  deploy=false
  skipped=true
  summary "Pages preview skipped for $branch at $commit_sha: the branch was deleted."
else
  actual_sha="$(jq -er '.data.repository.ref.target.oid | select(type == "string" and test("\\A[0-9a-f]{40}\\z"))' \
    "$temporary/response")" || fail 'GitHub returned an invalid destination branch SHA.'
  if [[ "$actual_sha" != "$commit_sha" ]] && ! bash "$(dirname "${BASH_SOURCE[0]}")/validate-badge-only-advance.sh" \
    "$repository" "$commit_sha" "$actual_sha" > "$temporary/guard" 2>&1; then
    reason="$(sanitize < "$temporary/guard")"
    [[ "$environment" != production ]] || fail "Production was superseded by $actual_sha; could not prove a badge-only advance: $reason"
    deploy=false
    skipped=true
    printf '::warning::Could not verify a safe Pages preview advance to %s: %s\n' "$actual_sha" "$reason" >&2
    summary "Pages preview skipped for $branch at $commit_sha: branch advanced to $actual_sha; a dependency-badge-only change could not be verified."
  fi
fi
if [[ "$skipped" == true ]]; then
  deployment_id=''
  deployment_url=''
elif [[ "$deploy" == false ]]; then
  summary "Pages bundle unchanged for $branch ($bundle_hash); reusing $deployment_url via $alias_url."
else
  summary "Pages deployment required for $branch at $commit_sha: bundle $bundle_hash; destination $alias_url."
fi
output
