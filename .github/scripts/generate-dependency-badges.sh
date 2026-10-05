#!/usr/bin/env bash
# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
set -euo pipefail

manifest="${1:-}"
output="${2:-}"
mode="${3:-}"
outdated="${4:-}"
fail() {
  echo "::error::$* Manifest='$manifest', output='$output'." >&2
  exit 1
}
if ! [[ ( $# == 2 || ( $# == 3 && "$mode" == --check ) ||
  ( $# == 4 && "$mode" == --outdated && -n "$outdated" ) ) && -n "$manifest" && -n "$output" ]]; then
  fail 'Usage: generate-dependency-badges.sh <package-json> <output-directory> [--check | --outdated <outdated-json>].'
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

if [[ "$mode" == --outdated ]] && ! jq -se 'length == 1 and (.[0] |
  type == "object" and (has("error") | not) and all(.[];
    type == "object" and
    (.current == null or (.current | type == "string" and length > 0 and (explode | all(. >= 32 and . != 127)))) and
    all(.wanted, .latest; type == "string" and length > 0 and (explode | all(. >= 32 and . != 127)))))' \
  "$outdated" >/dev/null 2>&1; then
  fail "Expected one npm outdated JSON object with nonempty wanted/latest version strings and an optional current version: '$outdated'."
fi

# Never read or overwrite badges through links supplied by a checked-out branch.
ancestor="$output"
while [[ "$ancestor" != / && "$ancestor" == */ ]]; do ancestor="${ancestor%/}"; done
while [[ "$ancestor" != / && "$ancestor" != . ]]; do
  [[ ! -L "$ancestor" ]] || fail "Badge output has a symlink ancestor: '$ancestor'."
  ancestor="$(dirname -- "$ancestor")"
done
shopt -s nullglob
for badge in "$output"/version-dependency-*.svg; do
  [[ ! -L "$badge" && -f "$badge" ]] || fail "Expected a regular dependency badge, not a symlink or directory: '$badge'."
done

render_svg() {
  local colour="$1"
  cat <<SVG
<svg xmlns="http://www.w3.org/2000/svg" width="$width" height="20" role="img" aria-label="$label: $version">
  <!-- Copyright (C) 2026 Erik Landvall; SPDX-License-Identifier: AGPL-3.0-only. See LICENSE and LICENSE-ADDITIONAL-TERMS. -->
  <title>$label: $version</title>
  <clipPath id="round"><rect width="$width" height="20" rx="3"/></clipPath>
  <g clip-path="url(#round)">
    <rect width="$label_width" height="20" fill="#555"/>
    <rect x="$label_width" width="$version_width" height="20" fill="$colour"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="DejaVu Sans Mono,monospace" font-size="11">
    <text x="$((label_width / 2))" y="14">$label</text>
    <text x="$((label_width + version_width / 2))" y="14">$version</text>
  </g>
</svg>
SVG
}

generated="$(mktemp -d "${TMPDIR:-/tmp}/operations-dependency-badges.XXXXXX")"
trap 'rm -rf "$generated"' EXIT
while IFS=$'\t' read -r slug label version label_length version_length colour; do
  label_width=$((label_length * 7 + 12))
  version_width=$((version_length * 7 + 12))
  width=$((label_width + version_width))
  badge="version-dependency-$slug.svg"
  if [[ "$mode" != --outdated ]]; then
    # Preserve an observed update only for an otherwise canonical badge of this version.
    render_svg '#fe7d37' > "$generated/orange-candidate"
    if cmp -s "$generated/orange-candidate" "$output/$badge"; then
      colour='#fe7d37'
    fi
  fi
  render_svg "$colour" > "$generated/$badge"
done < <(jq -r --arg mode "$mode" --slurpfile outdated "${outdated:-/dev/null}" '
  .devDependencies | to_entries | sort_by(.key)[] |
  [(.key | ltrimstr("@") | gsub("/"; "--")), (.key | @html), (.value | @html),
    (.key | length), (.value | length),
    (if $mode == "--outdated" and $outdated[0][.key] != null and $outdated[0][.key].latest != .value
      then "#fe7d37" else "#007ec6" end)] | map(tostring) | join("\t")' "$manifest")

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
