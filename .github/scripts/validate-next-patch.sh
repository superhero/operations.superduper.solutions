#!/usr/bin/env bash
set -euo pipefail

usage='Usage: validate-next-patch.sh <repository> <base-branch> <version>'

[[ -n "${1:-}" ]] || { printf '%s\n<repository> is missing\n' "$usage" >&2; exit 1; }
[[ -n "${2:-}" ]] || { printf '%s\n<base-branch> is missing\n' "$usage" >&2; exit 1; }
[[ -n "${3:-}" ]] || { printf '%s\n<version> is missing\n' "$usage" >&2; exit 1; }

repository="$1"
base_branch="$2"
version="$3"

mapfile -t semver_tags < <(
  gh api --paginate "repos/$repository/tags?per_page=100" --jq '.[].name' |
    grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' |
    sort -Vr
)

latest_tag=""
for tag in "${semver_tags[@]:-}"; do
  [[ -z "$tag" ]] && continue

  behind_by="$(gh api "repos/$repository/compare/$tag...$base_branch" --jq '.behind_by')"

  if [[ "$behind_by" == "0" ]]; then
    latest_tag="$tag"
    break
  fi
done

if [[ -z "$latest_tag" ]]; then
  echo "No existing SemVer tag applies to '$base_branch'; next-patch validation is not required."
  exit 0
fi

IFS=. read -r major minor patch <<< "$latest_tag"
expected="$major.$minor.$((patch + 1))"

[[ "$version" == "$expected" ]] || {
  echo "::error::Version '$version' must be the next patch after '$latest_tag': expected '$expected'." >&2
  exit 1
}

echo "Next patch is valid: $latest_tag → $version"
