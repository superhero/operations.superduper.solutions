#!/usr/bin/env bash
set -euo pipefail

usage='Usage: validate-branch-direction.sh <head-branch> <base-branch> <expected-base-pattern> <allowed-head-pattern>...'

head_branch="${1:?${usage}
[head-branch] is missing}"
base_branch="${2:?${usage}
[base-branch] is missing}"
expected_base_pattern="${3:?${usage}
[expected-base-pattern] is missing}"
shift 3

[[ "$base_branch" == $expected_base_pattern ]] || {
  echo "::error::Target branch '$base_branch' does not match '$expected_base_pattern'."
  exit 1
}

for pattern in "$@"; do
  if [[ "$head_branch" == $pattern ]]; then
    echo "Branch direction is valid: $head_branch -> $base_branch"
    exit 0
  fi
done

echo "::error::Branch '$head_branch' may not merge into '$base_branch'."
exit 1
