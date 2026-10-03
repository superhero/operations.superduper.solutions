#!/usr/bin/env bash
set -euo pipefail

usage='Usage: validate-branch-direction.sh <head-branch> <base-branch> <expected-base-pattern> <allowed-head-pattern>...'

[[ -n "${1:-}" ]] || { printf '%s\n<head-branch> is missing\n' "$usage" >&2; exit 1; }
[[ -n "${2:-}" ]] || { printf '%s\n<base-branch> is missing\n' "$usage" >&2; exit 1; }
[[ -n "${3:-}" ]] || { printf '%s\n<expected-base-pattern> is missing\n' "$usage" >&2; exit 1; }

head_branch="$1"
base_branch="$2"
expected_base_pattern="$3"

[[ "$base_branch" == $expected_base_pattern ]] || {
  echo "::error::Target branch '$base_branch' does not match '$expected_base_pattern'."
  exit 1
}

shift 3

for pattern in "$@"; do
  if [[ "$head_branch" == $pattern ]]; then
    echo "Branch direction is valid: $head_branch → $base_branch"
    exit 0
  fi
done

echo "::error::Branch '$head_branch' may not merge into '$base_branch'."
exit 1
