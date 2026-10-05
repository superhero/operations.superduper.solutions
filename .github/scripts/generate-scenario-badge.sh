#!/usr/bin/env bash
# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
set -euo pipefail

output="${1:-}"
inputs=("${@:2}")
mode=""
if (( ${#inputs[@]} > 0 )) && [[ "${inputs[-1]}" == --check ]]; then
  unset 'inputs[-1]'
  mode=--check
fi
fail() {
  echo "::error::$* Inputs='${inputs[*]}', output='$output'. Run npm run badges:scenarios to regenerate the committed badges." >&2
  exit 1
}
if [[ -z "$output" ]] || (( ${#inputs[@]} == 0 )); then
  fail 'Usage: generate-scenario-badge.sh <output-directory> <cucumber-json>... [--check].'
fi
for input in "${inputs[@]}"; do
  if ! jq -se '
    def text: type == "string" and length > 0;
    def step:
      type == "object" and (.result.status |
        . == "passed" or . == "failed" or . == "undefined" or . == "ambiguous" or . == "skipped" or . == "pending");
    length == 1 and (.[0] | type == "array" and length > 0 and
      all(.[]; type == "object" and (.name | text) and (.elements | type == "array" and length > 0 and
        all(.[]; type == "object" and (.type == "scenario" or .type == "background") and
          (.name | text) and (.steps | type == "array" and length > 0 and all(.[]; step)) and
          (if .type == "scenario" then (.id | text) else true end)))) and
      any(.[].elements[]; .type == "scenario"))
  ' -- "$input" >/dev/null 2>&1; then
    fail "Invalid Cucumber report '$input': expected one nonempty feature array containing scenarios with IDs, names, steps, and recognized result statuses."
  fi
done

generated="$(mktemp -d "${TMPDIR:-/tmp}/operations-scenario-badge.XXXXXX")"
trap 'rm -rf "$generated"' EXIT
jq -s '
  [.[][] | .elements[] | select(.type == "scenario") | [.steps[].result.status]] as $scenarios |
  ($scenarios | length) as $total |
  ($scenarios | map(select(all(.[]; . == "passed"))) | length) as $passed |
  {schemaVersion: 1, label: "Scenarios",
    message: (if $passed == $total then "\($total) passed" else "\($passed)/\($total) passed" end),
    color: (if any($scenarios[][]; . == "failed" or . == "undefined" or . == "ambiguous") then "red"
      elif $passed == $total then "brightgreen" else "orange" end)}
' -- "${inputs[@]}" > "$generated/test-scenarios.json"
message="$(jq -r '.message' "$generated/test-scenarios.json")"
color="$(jq -r 'if .color == "brightgreen" then "#4c1" elif .color == "red" then "#e05d44" else "#fe7d37" end' "$generated/test-scenarios.json")"
label_width=75
value_width=$((${#message} * 7 + 12))
width=$((label_width + value_width))
cat > "$generated/test-scenarios.svg" <<SVG
<svg xmlns="http://www.w3.org/2000/svg" width="$width" height="20" role="img" aria-label="Scenarios: $message">
  <!-- Copyright (C) 2026 Erik Landvall; SPDX-License-Identifier: AGPL-3.0-only. See LICENSE and LICENSE-ADDITIONAL-TERMS. -->
  <title>Scenarios: $message</title>
  <clipPath id="round"><rect width="$width" height="20" rx="3"/></clipPath>
  <g clip-path="url(#round)">
    <rect width="$label_width" height="20" fill="#555"/>
    <rect x="$label_width" width="$value_width" height="20" fill="$color"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="DejaVu Sans Mono,monospace" font-size="11">
    <text x="$((label_width / 2))" y="14">Scenarios</text>
    <text x="$((label_width + value_width / 2))" y="14">$message</text>
  </g>
</svg>
SVG

if [[ "$mode" == --check ]]; then
  for name in test-scenarios.json test-scenarios.svg; do
    if [[ ! -f "$output/$name" ]] || ! cmp -s "$generated/$name" "$output/$name"; then
      fail "Scenario badge is missing or stale: '$output/$name'."
    fi
  done
else
  mkdir -p "$output"
  for name in test-scenarios.json test-scenarios.svg; do
    cp -- "$generated/$name" "$output/$name"
  done
fi
