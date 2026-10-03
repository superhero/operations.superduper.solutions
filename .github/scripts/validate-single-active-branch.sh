#!/usr/bin/env bash
set -euo pipefail

usage='Usage: validate-single-active-branch.sh <repository> <kind> <current-branch>'

[[ -n "${1:-}" ]] || { printf '%s\n<repository> is missing\n' "$usage" >&2; exit 1; }
[[ -n "${2:-}" ]] || { printf '%s\n<kind> is missing\n' "$usage" >&2; exit 1; }
[[ -n "${3:-}" ]] || { printf '%s\n<current-branch> is missing\n' "$usage" >&2; exit 1; }

repository="$1"
kind="$2"
current_branch="$3"

case "$kind" in
  release|hotfix) ;;
  *)
    echo "::error::Unsupported branch kind '$kind'." >&2
    exit 1
    ;;
esac

mapfile -t branches < <(
  gh api --paginate "repos/$repository/git/matching-refs/heads/$kind/" \
    --jq '.[].ref | sub("^refs/heads/"; "")'
)

for branch in "${branches[@]:-}"; do
  [[ -z "$branch" || "$branch" == "$current_branch" ]] && continue

  branch_version="${branch#"$kind/"}"
  if gh api "repos/$repository/git/ref/tags/$branch_version" >/dev/null 2>&1; then
    continue
  fi

  echo "::error::Only one active $kind/* branch is permitted; '$branch' is already active." >&2
  exit 1
done

echo "No other active $kind/* branch exists."
