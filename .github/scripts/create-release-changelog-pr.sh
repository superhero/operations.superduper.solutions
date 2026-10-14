#!/usr/bin/env bash
# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
set -euo pipefail
node "$(dirname "${BASH_SOURCE[0]}")/create-release-changelog-pr.mjs" "$@"
