#!/usr/bin/env bash
# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
set -euo pipefail

repository="${1:-${GITHUB_REPOSITORY:-}}"
source_pr="${2:-}"
source_sha="${3:-}"

[[ -n "$repository" ]] || { echo "::error::Repository is required." >&2; exit 1; }
[[ "$source_pr" =~ ^[0-9]+$ ]] || { echo "::error::Source PR number is required." >&2; exit 1; }
[[ "$source_sha" =~ ^[0-9a-f]{40}$ ]] || { echo "::error::Full source SHA is required." >&2; exit 1; }

source_marker="<!-- release-source:$source_pr:$source_sha -->"
legacy_body="Automatically created from develop by PR #$source_pr at $source_sha."
pulls="$(
  gh api --paginate "repos/$repository/pulls?state=all&base=main&per_page=100" |
    jq -s '[.[][]]'
)"

# The PR body preserves the source identity even after the branch is deleted.
release="$(
  jq -c --arg marker "$source_marker" --arg legacy "$legacy_body" \
    --arg repository "$repository" --arg sha "$source_sha" '
    [.[] | select(
      .head.repo.full_name == $repository and
      .head.sha == $sha and
      (.head.ref | startswith("release/")) and
      ((.body // "") | contains($marker) or contains($legacy))
    )] | if length > 1 then error("Multiple releases match this source") else .[0] // empty end
  ' <<<"$pulls"
)"

if [[ -n "$release" ]]; then
  if [[ "$(jq -r '.state' <<<"$release")" == "closed" && \
        "$(jq -r '.merged_at // empty' <<<"$release")" == "" ]]; then
    echo "::error::The existing release PR was closed without merging; reopen it to retry." >&2
    exit 1
  fi
  release_branch="$(jq -r '.head.ref' <<<"$release")"
  release_pr="$(jq -r '.number' <<<"$release")"
  version="${release_branch#release/}"
  echo "Reusing $release_branch from PR #$release_pr."
else
  source="$(gh api "repos/$repository/pulls/$source_pr")"
  jq -e --arg sha "$source_sha" --arg repository "$repository" '
    .state == "open" and .draft == false and
    .head.ref == "develop" and .base.ref == "main" and
    .head.sha == $sha and .head.repo.full_name == $repository
  ' <<<"$source" >/dev/null || {
    echo "::error::Release trigger is closed, draft, or no longer matches develop at $source_sha." >&2
    exit 1
  }

  comparison="$(gh api "repos/$repository/compare/main...$source_sha")"
  jq -e '.ahead_by > 0 and .behind_by == 0' <<<"$comparison" >/dev/null || {
    echo "::error::The source must contain current main and include unreleased changes." >&2
    exit 1
  }

  active="$(jq -r '[.[] | select(.state == "open" and (.head.ref | startswith("release/")))][0].head.ref // empty' <<<"$pulls")"
  [[ -z "$active" ]] || {
    echo "::error::Another release is active: $active." >&2
    exit 1
  }

  tags="$(gh api --paginate "repos/$repository/tags?per_page=100" | jq -s '[.[][] | .name]')"
  latest="$(
    jq -r --argjson tags "$tags" '
      ($tags + [.[] | select(.merged_at != null) | .head.ref | sub("^(release|hotfix)/"; "")])[] |
      select(test("^[0-9]+\\.[0-9]+\\.[0-9]+$"))
    ' <<<"$pulls" | sort -Vu | tail -1
  )"
  latest="${latest:-0.0.0}"
  IFS=. read -r major minor patch <<<"$latest"
  version="$major.$minor.$((10#$patch + 1))"
  release_branch="release/$version"

  branches="$(gh api "repos/$repository/git/matching-refs/heads/release/")"
  conflicting="$(
    jq -r --arg branch "refs/heads/$release_branch" --argjson tags "$tags" '
      [.[] | select(.ref != $branch) |
        select((.ref | sub("^refs/heads/release/"; "")) as $version | $tags | index($version) == null)
      ][0].ref // empty
    ' <<<"$branches"
  )"
  [[ -z "$conflicting" ]] || {
    echo "::error::Another untagged release branch is active: $conflicting." >&2
    exit 1
  }
  existing_sha="$(jq -r --arg branch "refs/heads/$release_branch" '[.[] | select(.ref == $branch)][0].object.sha // empty' <<<"$branches")"
  [[ -z "$existing_sha" || "$existing_sha" == "$source_sha" ]] || {
    echo "::error::$release_branch already exists at a different commit." >&2
    exit 1
  }
  if [[ -z "$existing_sha" ]]; then
    gh api --method POST "repos/$repository/git/refs" \
      -f "ref=refs/heads/$release_branch" -f "sha=$source_sha" >/dev/null
  fi

  release_pr="$(
    gh api --method POST "repos/$repository/pulls" \
      -f base=main -f "head=$release_branch" -f "title=Release $version" \
      -f "body=$legacy_body

$source_marker" --jq '.number'
  )"
fi

# Gather all pages before counting, so comments on later pages are recognized.
comment_marker="<!-- release-trigger -->"
existing_comment="$(
  gh api --paginate "repos/$repository/issues/$source_pr/comments?per_page=100" |
    jq -s --arg marker "$comment_marker" '[.[][] | select((.body // "") | contains($marker))] | length'
)"
if [[ "$existing_comment" == "0" ]]; then
  # Markdown backticks must stay literal; printf substitutes only its arguments.
  # shellcheck disable=SC2016
  printf -v comment_body '%s\nRelease trigger accepted.\n\nCreated PR #%s from `%s` into `main`, using `develop` at `%s`.\n\nThis trigger PR will remain open while release validation continues in PR #%s. Once that release PR merges this exact commit into `main`, GitHub will mark this trigger PR as merged as well.\n' \
    "$comment_marker" "$release_pr" "$release_branch" "${source_sha:0:7}" "$release_pr"
  gh api --method POST "repos/$repository/issues/$source_pr/comments" -f "body=$comment_body" >/dev/null
fi

{
  echo "version=$version"
  echo "release_pr=$release_pr"
} >> "$GITHUB_OUTPUT"
