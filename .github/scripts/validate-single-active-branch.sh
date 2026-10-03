#!/usr/bin/env bash
set -euo pipefail

repository="${1:?Usage: validate-single-active-branch.sh <repository> <kind> <current-branch>}"
kind="${2:?Usage: validate-single-active-branch.sh <repository> <kind> <current-branch>}"
current_branch="${3:?Usage: validate-single-active-branch.sh <repository> <kind> <current-branch>}"

case "$kind" in
  release|hotfix) ;;
  *)
    echo "::error::Unsupported branch kind '$kind'."
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

  echo "::error::Only one active $kind/* branch is permitted; '$branch' is already active."
  exit 1
done

echo "No other active $kind/* branch exists."
