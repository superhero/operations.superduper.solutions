#!/usr/bin/env bash
# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
set -euo pipefail

operation=merge
# shellcheck source=.github/scripts/release-pr.sh
source "$(dirname "${BASH_SOURCE[0]}")/release-pr.sh"
read_merge_pr() {
  read_pr
  if ! is_merged && ! jq -e '.draft == false' <<< "$pr" >/dev/null; then
    fail 'A draft release PR may not merge.'
  fi
}
read_merge_pr
if is_merged; then
  confirm_release
  exit 0
fi

remaining=$((deadline - SECONDS))
(( remaining >= 0 )) || remaining=0
if pending_output="$(bash "$scripts/auto-merge.sh" "$repository" "$pr_number" "$head_sha" main "$base_sha" "$head_branch" "$remaining" 2>&1)"; then
  [[ -z "$pending_output" ]] || printf '%s\n' "$pending_output"
  pending_output=""
else
  read_merge_pr
  is_merged || fail 'Automatic merging failed and the exact release PR has not merged.'
  pending_output=""
  confirm_release
  exit 0
fi

# Recheck the exact merge metadata before authorizing publication.
read_merge_pr
is_merged || fail 'Release PR is no longer confirmed merged after automatic merging; publication requires a confirmed result.'
confirm_release
