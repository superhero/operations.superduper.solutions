#!/usr/bin/env bash
# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
set -euo pipefail

branch="${1:-}"
badges="${2:-}"
context="repository='${GITHUB_REPOSITORY:-local}', branch='$branch', manifest='package.json', badges='$badges', command='npm outdated --json'"
[[ $# == 1 || ( $# == 2 && -n "$badges" ) ]] || {
  echo "::error::Usage: update-dependency-status.sh <branch> [badge-directory] ($context)." >&2
  exit 1
}
if [[ -z "$branch" ]] || ! git check-ref-format "refs/heads/$branch"; then
  echo "::error::Invalid dependency status branch ($context); expected a valid Git branch name." >&2
  exit 1
fi
[[ -f package.json ]] || {
  echo "::error::Package manifest does not exist ($context)." >&2
  exit 1
}

temporary="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/dependency-status.XXXXXX")"
trap 'rm -rf -- "$temporary"' EXIT

status=0
npm outdated --json > "$temporary/outdated.json" 2> "$temporary/npm.stderr" || status=$?
if [[ "$status" == 0 && ! -s "$temporary/outdated.json" ]]; then
  echo '{}' > "$temporary/outdated.json"
fi
validation=""
if ! jq -se '
  def version: type == "string" and length > 0;
  length == 1 and (.[0] | type == "object" and (has("error") | not) and
    all(to_entries[]; (.key | length > 0) and (.value | type == "object" and
      (.wanted | version) and (.latest | version) and (.current == null or (.current | version)))))
' "$temporary/outdated.json" >/dev/null 2>&1; then
  validation="; expected one JSON object with nonempty wanted/latest versions and optional current versions"
fi
if (( status > 1 )) || [[ -n "$validation" ]]; then
  (( status > 0 )) || status=1
  echo "::error::npm outdated --json failed (exit $status; $context)$validation; dependency report was not generated." >&2
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

if [[ -n "$badges" ]]; then
  scripts="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
  bash "$scripts/generate-dependency-badges.sh" package.json "$badges" --outdated "$temporary/outdated.json" || {
    echo "::error::Could not update dependency badge colours ($context)." >&2
    exit 1
  }
fi

jq -r --arg branch "$branch" '
  def text:
    tostring | @html | gsub("[[:cntrl:]]"; " ") |
    gsub("(?<char>[\\\\`*_\\[\\]|])"; "\\\(.char)");
  "## Dependency status: \($branch | text)\n",
  if length == 0 then "All dependencies are up to date."
  else
    "\(length) outdated dependencies.\n",
    "| Package | Current | Wanted | Latest |",
    "| --- | --- | --- | --- |",
    (to_entries | sort_by(.key)[] |
      "| \(.key | text) | \(.value.current // "missing" | text) | \(.value.wanted | text) | \(.value.latest | text) |")
  end
' "$temporary/outdated.json" > "$temporary/report.md"
cat "$temporary/report.md"
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  cat "$temporary/report.md" >> "$GITHUB_STEP_SUMMARY"
fi
