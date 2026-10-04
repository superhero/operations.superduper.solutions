#!/usr/bin/env bash
# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
set -euo pipefail

repository="${1:?Repository is required}"
merge_sha="${2:?Release merge SHA is required}"
current_sha="$(gh api "repos/$repository/git/ref/heads/main" --jq '.object.sha')"
[[ "$current_sha" == "$merge_sha" ]] || {
  echo "::error::Release $merge_sha has been superseded by main at $current_sha; refusing to overwrite production. Rollback requires a separate operation." >&2
  exit 1
}
echo "Release $merge_sha matches current main."
