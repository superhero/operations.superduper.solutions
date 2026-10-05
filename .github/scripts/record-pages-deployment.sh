#!/usr/bin/env bash
# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
set -euo pipefail

repository="${1:-}"
branch="${2:-}"
commit_sha="${3:-}"
bundle_hash="${4:-}"
pages_id="${5:-}"
outcome="${6:-}"
project=operations-superduper-solutions
context="repository=$repository branch=$branch commit=$commit_sha bundle=$bundle_hash deployment=${pages_id:-unavailable} action=$outcome project=$project account=${CLOUDFLARE_ACCOUNT_ID:-unavailable}"

sanitize() {
  jq -Rrs 'reduce ([env.GH_TOKEN, env.GH_APP_PRIVATE_KEY, env.CLOUDFLARE_API_TOKEN][] | select(. != null and . != "")) as $secret
    (. ; split($secret) | join("[REDACTED]")) | gsub("[\\r\\n]+"; " ") | .[0:1000]'
}
fail() {
  printf '::error::%s (%s).\n' "$1" "$context" | sanitize >&2
  exit 1
}

version='(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)'
[[ $# == 6 && "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ &&
  "$branch" =~ ^(main|develop|(release|hotfix)/$version)$ && "$commit_sha" =~ ^[0-9a-f]{40}$ &&
  "$bundle_hash" =~ ^[0-9a-f]{64}$ && "$outcome" =~ ^(success|failure)$ ]] ||
  fail 'Expected <repository> <main|develop|release/version|hotfix/version> <commit-sha> <bundle-hash> <deployment-id> <success|failure>'
[[ -z "$pages_id" || "$pages_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] ||
  fail 'Invalid Cloudflare Pages deployment ID'
[[ -n "${GH_TOKEN:-}" ]] || fail 'GH_TOKEN is required to record the deployment through the GitHub App'
[[ "${GITHUB_RUN_ID:-}" =~ ^[1-9][0-9]*$ ]] || fail 'GITHUB_RUN_ID must identify the workflow run'

temporary="$(mktemp -d)"
trap 'rm -rf "$temporary"' EXIT
production=false
environment="$branch"
alias_url="https://${branch//[^a-z0-9]/-}.$project.pages.dev"
if [[ "$branch" == main ]]; then
  production=true
  environment=production
  alias_url="https://$project.pages.dev"
fi
deployment_url=""
[[ -z "$pages_id" ]] || deployment_url="https://${pages_id:0:8}.$project.pages.dev"
run_url="https://github.com/$repository/actions/runs/$GITHUB_RUN_ID"
state=failure
reason='Cloudflare deployment action failed; inspect the deployment step for its error'

if [[ "$outcome" == success ]]; then
  if [[ -z "$pages_id" ]]; then
    reason='Cloudflare deployment action returned no deployment ID'
  elif [[ -z "${CLOUDFLARE_API_TOKEN:-}" || ! "${CLOUDFLARE_ACCOUNT_ID:-}" =~ ^[0-9a-f]{32}$ ]]; then
    reason='Cloudflare verification requires CLOUDFLARE_API_TOKEN and a valid CLOUDFLARE_ACCOUNT_ID'
  else
    deadline=$((SECONDS + 60))
    reason='Timed out waiting for Cloudflare to confirm a successful deploy stage'
    for ((attempt=1; attempt<=13; attempt++)); do
      remaining=$((deadline - SECONDS))
      (( remaining > 0 )) || break
      (( remaining <= 15 )) || remaining=15
      if ! response="$(curl --fail-with-body --silent --show-error --connect-timeout 10 --max-time "$remaining" \
        --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
        "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/$project/deployments/$pages_id" \
        2>"$temporary/error")"; then
        details="$( { jq -r '.errors[]? | "Cloudflare error \(.code // "unknown"): \(.message // "No reason provided")"' <<< "$response" 2>/dev/null || true; cat "$temporary/error"; } | sanitize)"
        reason="Could not verify the Cloudflare deployment: $details"
        break
      fi
      if ! jq -e '.success == true' <<< "$response" >/dev/null 2>&1; then
        details="$(jq -r '.errors[]? | "Cloudflare error \(.code // "unknown"): \(.message // "No reason provided")"' <<< "$response" 2>/dev/null | sanitize || true)"
        reason="Cloudflare returned an unsuccessful or invalid deployment response${details:+: $details}"
        break
      fi
      if ! jq -e --arg id "$pages_id" --arg project "$project" --arg branch "$branch" \
        --arg environment "$([[ "$production" == true ]] && echo production || echo preview)" \
        --arg marker "bundle-sha256:$bundle_hash" --arg url "$deployment_url" '
        .result.id == $id and .result.project_name == $project and
        .result.environment == $environment and .result.deployment_trigger.metadata.branch == $branch and
        .result.deployment_trigger.metadata.commit_message == $marker and .result.url == $url and
        (.result.deployment_trigger.metadata.commit_hash | type == "string" and test("^[0-9a-f]{40}$"))
      ' <<< "$response" >/dev/null 2>&1; then
        reason='Cloudflare returned mismatched deployment identity, bundle, environment, or URL'
        break
      fi
      if ! stage="$(jq -er '.result.latest_stage | select(type == "object") |
        select((.name | type == "string") and (.status | type == "string")) |
        "\(.name):\(.status)"' <<< "$response" 2>/dev/null)"; then
        reason='Cloudflare returned an invalid deployment stage'
        break
      fi
      if [[ "$stage" == deploy:success ]]; then
        state=success
        reason='Cloudflare Pages confirmed the deployed bundle'
        break
      fi
      if ! [[ "$stage" =~ ^(queued|initialize|clone_repo|build|deploy):(idle|active|success)$ ]]; then
        reason="Cloudflare deployment did not succeed: stage=$stage"
        break
      fi
      (( attempt < 13 )) || break
      remaining=$((deadline - SECONDS))
      (( remaining > 0 )) || break
      (( remaining <= 5 )) || remaining=5
      sleep "$remaining"
    done
  fi
fi

# Pages retains these URLs; superseded records are inactive, not destroyed.
jq -n --arg ref "$commit_sha" --arg environment "$environment" --argjson production "$production" \
  --arg branch "$branch" --arg bundle "$bundle_hash" --arg pages_id "$pages_id" '
  {ref: $ref, environment: $environment, auto_merge: false, required_contexts: [],
   production_environment: $production, transient_environment: false,
   description: ("Cloudflare Pages: " + $branch),
   payload: {bundle_sha256: $bundle, cloudflare_deployment_id: $pages_id}}
' > "$temporary/request.json"
if ! response="$(gh api --method POST "repos/$repository/deployments" --input "$temporary/request.json" 2>"$temporary/error")"; then
  fail "Could not create GitHub deployment: $(sanitize < "$temporary/error"); Cloudflare result: $reason"
fi
github_id="$(jq -er '.id | select(type == "number" and . > 0 and floor == .)' <<< "$response" 2>/dev/null)" ||
  fail "GitHub did not return a deployment ID; Cloudflare result: $reason"
# GitHub only inactivates earlier successful previews in this same environment.
jq -n --arg state "$state" --arg environment_url "$alias_url" --arg log_url "$run_url" \
  --arg description "$(printf '%s' "$reason" | sanitize)" '
  {state: $state, environment_url: $environment_url, log_url: $log_url,
   auto_inactive: true, description: $description[0:140]}
' > "$temporary/request.json"
if ! response="$(gh api --method POST "repos/$repository/deployments/$github_id/statuses" --input "$temporary/request.json" 2>"$temporary/error")"; then
  fail "Could not record GitHub deployment $github_id status=$state: $(sanitize < "$temporary/error"); Cloudflare result: $reason"
fi
jq -e --arg state "$state" '.state == $state' <<< "$response" >/dev/null 2>&1 ||
  fail "GitHub did not confirm deployment $github_id status=$state; Cloudflare result: $reason"

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  {
    printf '### Cloudflare Pages: %s\n\n' "$branch"
    printf "Deployment **%s** for \`%s\`.\n\n" "$state" "$commit_sha"
    printf '[Branch URL](%s)' "$alias_url"
    [[ -z "$deployment_url" ]] || printf ' · [This deployment](%s)' "$deployment_url"
    printf ' · [Workflow run](%s)\n\n' "$run_url"
    printf '%s\n' "$(printf '%s' "$reason" | sanitize)"
  } >> "$GITHUB_STEP_SUMMARY"
fi
[[ "$state" == success ]] || fail "$reason"
printf 'Confirmed Cloudflare Pages deployment: %s (%s).\n' "$alias_url" "$context"
