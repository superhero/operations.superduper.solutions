#!/usr/bin/env bash
# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
set -euo pipefail

manifest="${1:-}"
output="${2:-}"
mode="${3:-}"
fail() {
  echo "::error::$* Manifest='$manifest', output='$output'." >&2
  exit 1
}
if ! [[ ( $# == 2 || ( $# == 3 && "$mode" == --check ) ) && -n "$manifest" && -n "$output" ]]; then
  fail 'Usage: generate-dependency-badges.sh <package-json> <output-directory> [--check].'
fi

# Names become filenames, so reject unsafe names and scoped/unscoped slug collisions.
if ! jq -se 'length == 1 and (.[0] | type == "object" and
  (.devDependencies | type == "object" and
    all(to_entries[];
      (.key | test("\\A(@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*\\z")) and
      (.value | type == "string" and length > 0 and (explode | all(. >= 32 and . != 127)))) and
    ([keys[] | ltrimstr("@") | gsub("/"; "--")] | length == (unique | length))))' \
  "$manifest" >/dev/null 2>&1; then
  fail 'Expected one package manifest with a devDependencies object, safe package names, unique badge filenames, and nonempty string versions without control characters.'
fi

generated="$(mktemp -d "${TMPDIR:-/tmp}/operations-dependency-badges.XXXXXX")"
trap 'rm -rf "$generated"' EXIT
while IFS=$'\t' read -r slug label version label_length version_length; do
  label_width=$((label_length * 7 + 12))
  version_width=$((version_length * 7 + 12))
  width=$((label_width + version_width))
  cat > "$generated/version-dependency-$slug.svg" <<SVG
<svg xmlns="http://www.w3.org/2000/svg" width="$width" height="20" role="img" aria-label="$label: $version">
  <!-- Copyright (C) 2026 Erik Landvall; SPDX-License-Identifier: AGPL-3.0-only. See LICENSE and LICENSE-ADDITIONAL-TERMS. -->
  <title>$label: $version</title>
  <clipPath id="round"><rect width="$width" height="20" rx="3"/></clipPath>
  <g clip-path="url(#round)">
    <rect width="$label_width" height="20" fill="#555"/>
    <rect x="$label_width" width="$version_width" height="20" fill="#007ec6"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="DejaVu Sans Mono,monospace" font-size="11">
    <text x="$((label_width / 2))" y="14">$label</text>
    <text x="$((label_width + version_width / 2))" y="14">$version</text>
  </g>
</svg>
SVG
done < <(jq -r '.devDependencies | to_entries | sort_by(.key)[] |
  [(.key | ltrimstr("@") | gsub("/"; "--")), (.key | @html), (.value | @html),
    (.key | length), (.value | length)] | map(tostring) | join("\t")' "$manifest")

shopt -s nullglob
if [[ "$mode" == --check ]]; then
  for file in "$generated"/*.svg; do
    badge="$output/${file##*/}"
    if [[ ! -f "$badge" ]] || ! cmp -s "$file" "$badge"; then
      fail "Dependency badge is missing or stale: '$badge'. Run npm run badges:dependencies to regenerate the committed badges."
    fi
  done
  for file in "$output"/version-dependency-*.svg; do
    [[ -f "$generated/${file##*/}" ]] ||
      fail "Dependency badge is obsolete: '$file'. Run npm run badges:dependencies to regenerate the committed badges."
  done
else
  mkdir -p "$output"
  for file in "$output"/version-dependency-*.svg; do
    [[ -f "$generated/${file##*/}" ]] || rm -- "$file"
  done
  for file in "$generated"/*.svg; do
    cp -- "$file" "$output/${file##*/}"
  done
fi
