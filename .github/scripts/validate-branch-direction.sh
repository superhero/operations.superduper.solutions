#!/usr/bin/env bash
set -euo pipefail

head_branch="${1:?Usage: validate-branch-direction.sh <head-branch> <base-branch> <expected-base-pattern> <allowed-head-pattern>...}"
base_branch="${2:?Usage: validate-branch-direction.sh <head-branch> <base-branch> <expected-base-pattern> <allowed-head-pattern>...}"
expected_base_pattern="${3:?Usage: validate-branch-direction.sh <head-branch> <base-branch> <expected-base-pattern> <allowed-head-pattern>...}"
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
