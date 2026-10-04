#!/usr/bin/env bash
# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
set -euo pipefail

branch="${1:-}"
context="repository='${GITHUB_REPOSITORY:-local}', branch='$branch', manifest='package.json', command='npm outdated --json'"
[[ $# == 1 ]] || {
  echo "::error::Usage: update-dependency-status.sh <main|develop> ($context)." >&2
  exit 1
}
case "$branch" in
  main) prefix="" ;;
  develop) prefix="develop/" ;;
  *)
    echo "::error::Unsupported dependency status branch ($context); expected main or develop." >&2
    exit 1
    ;;
esac
[[ -f package.json ]] || {
  echo "::error::Package manifest does not exist ($context)." >&2
  exit 1
}

scripts="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
temporary="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/dependency-status.XXXXXX")"
trap 'rm -rf -- "$temporary"' EXIT

status=0
npm outdated --json > "$temporary/outdated.json" 2> "$temporary/npm.stderr" || status=$?
if [[ "$status" == 0 && ! -s "$temporary/outdated.json" ]]; then
  echo '{}' > "$temporary/outdated.json"
fi
if (( status > 1 )) || ! jq -se 'length == 1 and (.[0] | type == "object" and (has("error") | not))' \
  "$temporary/outdated.json" >/dev/null 2>&1; then
  (( status > 0 )) || status=1
  echo "::error::npm outdated --json failed (exit $status; $context); dependency badges were not published." >&2
  diagnostic="$(jq -er '
    .error? | select(type == "object" and any(.code, .summary; type == "string" and length > 0)) |
    "npm error \(.code | if type == "string" then . else "unknown" end): \(.summary | if type == "string" then . else "No summary provided" end)"
  ' "$temporary/outdated.json" 2>/dev/null)" || diagnostic=""
  [[ -n "$diagnostic" ]] || diagnostic="$(< "$temporary/npm.stderr")"
  printf '%s' "$diagnostic" | jq -Rrs '
    reduce ([env.NPM_TOKEN, env.NODE_AUTH_TOKEN, env.GH_TOKEN, env.GITHUB_TOKEN,
      env.GH_APP_PRIVATE_KEY, env.CLOUDFLARE_API_TOKEN, env.CLOUDFLARE_PAGES_API_TOKEN,
      env.CLOUDFLARE_R2_API_TOKEN][] |
      select(type == "string" and length > 0)) as $secret (.; split($secret) | join("[REDACTED]")) |
    gsub("(?<scheme>[A-Za-z][A-Za-z0-9+.-]*://)[^/@[:space:]]+@"; "\(.scheme)[REDACTED]@") |
    gsub("[[:cntrl:]]+"; " ") |
    if length == 0 then "npm provided no error summary or stderr." else .[:1000] end
  ' >&2
  exit "$status"
fi

bash "$scripts/generate-dependency-status.sh" package.json "$temporary/outdated.json" "$temporary/status"
bash "$scripts/publish-status.sh" "$temporary/status/version-dependencies.json" \
  "${prefix}version-dependencies.json" application/json
