#!/usr/bin/env bash
# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
set -euo pipefail

manifest="${1:-}"
outdated="${2:-}"
output="${3:-}"
[[ $# == 3 ]] || {
  echo "::error::Usage: generate-dependency-status.sh <package-json> <outdated-json> <output-directory> (manifest='$manifest', input='$outdated', output='$output')." >&2
  exit 1
}

if ! jq -se 'length == 1 and (.[0] | type == "object" and (has("error") | not) and
  all(.[]; type == "object" and (.latest | type == "string" and length > 0)))' \
  "$outdated" >/dev/null 2>&1; then
  echo "::error::npm outdated did not return valid dependency data. Input='$outdated', manifest='$manifest', output='$output'." >&2
  jq -r '.error? | select(type == "object") |
    "npm error \(.code | if type == "string" then . else "unknown" end): \(.summary | if type == "string" then . else "No summary provided" end)" |
    gsub("[\\r\\n]+"; " ")' "$outdated" >&2 2>/dev/null || true
  exit 1
fi
if ! jq -se 'length == 1 and (.[0].devDependencies | type == "object" and all(.[]; type == "string"))' \
  "$manifest" >/dev/null 2>&1; then
  echo "::error::Package manifest '$manifest' must contain a devDependencies object with string versions. Input='$outdated', output='$output'." >&2
  exit 1
fi

mkdir -p "$output"
count="$(jq 'length' "$outdated")"
message='up to date'
color=brightgreen
if (( count > 0 )); then
  message="$count outdated"
  color=orange
fi
jq -n --arg message "$message" --arg color "$color" \
  '{schemaVersion: 1, label: "Dependencies", message: $message, color: $color}' \
  > "$output/version-dependencies.json"

while IFS=$'\t' read -r package current; do
  latest="$(jq -r --arg package "$package" --arg current "$current" '.[$package].latest // $current' "$outdated")"
  color=blue
  [[ "$current" == "$latest" ]] || color=orange
  slug="${package#@}"
  slug="${slug//\//--}"
  jq -n --arg label "$package" --arg message "$current" --arg color "$color" \
    '{schemaVersion: 1, label: $label, message: $message, color: $color}' \
    > "$output/version-dependency-$slug.json"
done < <(jq -r '.devDependencies | to_entries[] | [.key, .value] | @tsv' "$manifest")
