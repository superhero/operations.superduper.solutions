#!/usr/bin/env bash
set -euo pipefail

repository="${1:-${GITHUB_REPOSITORY:-}}"
pull_request="${2:-}"
head_sha="${3:-}"

[[ -n "$repository" ]] || {
  echo "::error::Repository is required." >&2
  exit 1
}

[[ -n "$pull_request" ]] || {
  echo "::error::Pull request number is required." >&2
  exit 1
}

[[ -n "$head_sha" ]] || {
  echo "::error::Pull request head SHA is required." >&2
  exit 1
}

gh pr merge "$pull_request" \
  --repo "$repository" \
  --auto \
  --merge \
  --match-head-commit "$head_sha"
