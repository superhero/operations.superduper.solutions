#!/usr/bin/env bash
set -euo pipefail

repository="${1:-${GITHUB_REPOSITORY:-}}"
source_pr="${2:-}"
source_sha="${3:-}"

[[ -n "$repository" ]] || { echo "::error::Repository is required." >&2; exit 1; }
[[ -n "$source_pr" ]] || { echo "::error::Source pull request number is required." >&2; exit 1; }
[[ -n "$source_sha" ]] || { echo "::error::Source SHA is required." >&2; exit 1; }

owner="${repository%%/*}"

latest="$(
  {
    gh api --paginate "repos/$repository/tags?per_page=100" --jq '.[].name'
    gh api --paginate "repos/$repository/pulls?state=closed&base=main&per_page=100" \
      --jq '.[] | select(.merged_at != null) | .head.ref' \
      | sed -nE 's#^(release|hotfix)/([0-9]+\.[0-9]+\.[0-9]+)$#\2#p'
  } \
    | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' \
    | sort -Vu \
    | tail -1
)"

latest="${latest:-0.0.0}"
IFS=. read -r major minor patch <<< "$latest"
version="$major.$minor.$((patch + 1))"
release_branch="release/$version"

existing_sha="$(
  gh api --paginate "repos/$repository/branches?per_page=100" \
    | jq -r --arg branch "$release_branch" '.[] | select(.name == $branch) | .commit.sha' \
    | head -1
)"

if [[ -n "$existing_sha" && "$existing_sha" != "$source_sha" ]]; then
  echo "::error::$release_branch already exists at a different commit." >&2
  exit 1
fi

if [[ -z "$existing_sha" ]]; then
  gh api --method POST "repos/$repository/git/refs" \
    -f "ref=refs/heads/$release_branch" \
    -f "sha=$source_sha" \
    >/dev/null
fi

release_pr="$(
  gh api --method GET "repos/$repository/pulls" \
    -f state=open \
    -f base=main \
    -f "head=$owner:$release_branch" \
    --jq '.[0].number // empty'
)"

if [[ -z "$release_pr" ]]; then
  release_pr="$(
    gh api --method POST "repos/$repository/pulls" \
      -f base=main \
      -f "head=$release_branch" \
      -f "title=Release $version" \
      -f "body=Automatically created from develop by PR #$source_pr at $source_sha." \
      --jq '.number'
  )"
fi

gh api --method PATCH "repos/$repository/pulls/$source_pr" -f state=closed >/dev/null

echo "version=$version" >> "$GITHUB_OUTPUT"
echo "release_pr=$release_pr" >> "$GITHUB_OUTPUT"
