#!/usr/bin/env bash
# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
set -euo pipefail

tested_head_sha="${1:-}"
merge_sha="${2:-}"
fail() {
  printf '::error::%s (tested_head_sha=%s merge_sha=%s)\n' \
    "$1" "$tested_head_sha" "$merge_sha" >&2
  exit 1
}
[[ $# == 2 && "$tested_head_sha" =~ ^[0-9a-f]{40}$ && "$merge_sha" =~ ^[0-9a-f]{40}$ ]] ||
  fail 'Usage: validate-release-tree.sh <tested-head-sha> <confirmed-merge-sha>; full commit SHAs are required.'
if ! git cat-file -e "$tested_head_sha^{commit}" || ! git cat-file -e "$merge_sha^{commit}"; then
  fail 'Both release commits must be available in the checkout; fetch complete history and retry.'
fi

paths="$(mktemp)" || fail 'Could not create temporary output for the released tree comparison.'
trap 'rm -f "$paths"' EXIT
# Compare the two exact revisions, including modes, deletions, and rename
# sources. Their ancestry may differ after a squash or ordinary merge.
git diff --name-only --no-renames -z "$tested_head_sha" "$merge_sha" -- > "$paths" ||
  fail 'Could not compare the tested and confirmed release trees.'
while IFS= read -r -d '' path; do
  if [[ ! "$path" =~ ^\.github/badges/version-dependency-[a-z0-9][a-z0-9._-]*\.svg$ ]]; then
    printf -v offending_path '%q' "$path"
    fail "Confirmed release differs from the tested artifacts at $offending_path; only dependency version SVGs may differ."
  fi
done < "$paths"
