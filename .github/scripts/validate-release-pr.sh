#!/usr/bin/env bash
# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
set -euo pipefail

operation=validate
# shellcheck source=.github/scripts/release-pr.sh
source "$(dirname "${BASH_SOURCE[0]}")/release-pr.sh"
[[ $# == 5 ]] || fail 'Validation requires repository, PR number, expected branch, head SHA, and tested base SHA.'
read_pr
if is_merged; then
  confirm_release
  exit 0
fi

if pending_output="$(bash "$scripts/validate-pr.sh" "$repository" "$head_branch" main "$head_sha" 2>&1)"; then
  [[ -z "$pending_output" ]] || printf '%s\n' "$pending_output"
  exit 0
fi
read_pr
is_merged || fail 'Gitflow validation failed and the exact release PR has not merged.'
pending_output=""
confirm_release
