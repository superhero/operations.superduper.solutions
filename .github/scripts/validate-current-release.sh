#!/usr/bin/env bash
# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
set -euo pipefail

repository="${1:-}"
merge_sha="${2:-}"

fail() {
  printf '::error::%s (repository=%s merge_sha=%s)\n' \
    "$1" "${repository:-unset}" "${merge_sha:-unset}" >&2
  exit 1
}

[[ -n "$repository" ]] || fail 'Repository is required.'
[[ -n "$merge_sha" ]] || fail 'Release merge SHA is required.'
current_sha="$(gh api "repos/$repository/git/ref/heads/main" --jq '.object.sha')" || fail 'Could not read current main SHA before production publishing.'
if [[ "$current_sha" != "$merge_sha" ]]; then
  bash "$(dirname "${BASH_SOURCE[0]}")/validate-badge-only-advance.sh" "$repository" "$merge_sha" "$current_sha" ||
    fail "Release has been superseded; expected main=$merge_sha, actual main=$current_sha; refusing to overwrite production. Rollback requires a separate operation."
fi
echo "Release $merge_sha matches current main apart from dependency badge updates (main=$current_sha)."
