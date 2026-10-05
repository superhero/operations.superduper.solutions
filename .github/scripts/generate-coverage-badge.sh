#!/usr/bin/env bash
# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
set -euo pipefail

summary="${1:-}"
output="${2:-}"
mode="${3:-}"
fail() {
  echo "::error::$* Input='$summary', output='$output'." >&2
  exit 1
}
if ! [[ ( $# == 2 || ( $# == 3 && "$mode" == --check ) ) && -n "$summary" && -n "$output" ]]; then
  fail 'Usage: generate-coverage-badge.sh <coverage-summary-json> <output-directory> [--check].'
fi
if ! jq -se 'length == 1 and (.[0].total.statements.pct | type == "number" and . >= 0 and . <= 100)' \
  "$summary" >/dev/null 2>&1; then
  fail 'Expected one coverage summary with a numeric total.statements.pct between 0 and 100.'
fi

generated="$(mktemp -d "${TMPDIR:-/tmp}/operations-coverage-badge.XXXXXX")"
trap 'rm -rf "$generated"' EXIT
jq '{schemaVersion: 1, label: "Test Coverage", message: "\(.total.statements.pct)%",
  color: (if .total.statements.pct == 100 then "brightgreen" else "orange" end)}' \
  "$summary" > "$generated/test-coverage.json"
message="$(jq -r '.message' "$generated/test-coverage.json")"
color="$(jq -r 'if .color == "brightgreen" then "#4c1" else "#fe7d37" end' "$generated/test-coverage.json")"
label_width=103
value_width=$((${#message} * 7 + 12))
width=$((label_width + value_width))
cat > "$generated/test-coverage.svg" <<SVG
<svg xmlns="http://www.w3.org/2000/svg" width="$width" height="20" role="img" aria-label="Test Coverage: $message">
  <!-- Copyright (C) 2026 Erik Landvall; SPDX-License-Identifier: AGPL-3.0-only. See LICENSE and LICENSE-ADDITIONAL-TERMS. -->
  <title>Test Coverage: $message</title>
  <clipPath id="round"><rect width="$width" height="20" rx="3"/></clipPath>
  <g clip-path="url(#round)">
    <rect width="$label_width" height="20" fill="#555"/>
    <rect x="$label_width" width="$value_width" height="20" fill="$color"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="DejaVu Sans Mono,monospace" font-size="11">
    <text x="$((label_width / 2))" y="14">Test Coverage</text>
    <text x="$((label_width + value_width / 2))" y="14">$message</text>
  </g>
</svg>
SVG

if [[ "$mode" == --check ]]; then
  for name in test-coverage.json test-coverage.svg; do
    if [[ ! -f "$output/$name" ]] || ! cmp -s "$generated/$name" "$output/$name"; then
      fail "Coverage badge is missing or stale: '$output/$name'. Run npm run badges:coverage to regenerate the committed badges."
    fi
  done
else
  mkdir -p "$output"
  for name in test-coverage.json test-coverage.svg; do
    cp -- "$generated/$name" "$output/$name"
  done
fi
