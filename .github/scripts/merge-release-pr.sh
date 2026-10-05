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

if pending_output="$(bash "$scripts/auto-merge.sh" "$repository" "$pr_number" "$head_sha" main "$base_sha" 2>&1)"; then
  [[ -z "$pending_output" ]] || printf '%s\n' "$pending_output"
  pending_output=""
else
  read_merge_pr
  is_merged || fail 'Automatic merging failed and the exact release PR has not merged.'
  pending_output=""
  confirm_release
  exit 0
fi

# Enabling --auto only queues a merge; publication waits for a confirmed result.
while :; do
  read_merge_pr
  if is_merged; then
    confirm_release
    exit 0
  fi
  if (( SECONDS >= deadline )); then
    fail 'Timed out waiting for the validated release PR to merge; queued auto-merge does not authorize publication.'
  fi
  remaining=$((deadline - SECONDS))
  (( remaining < 5 )) || remaining=5
  sleep "$remaining"
done
