#!/usr/bin/env bash
# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
set -euo pipefail

repository="${1:-${GITHUB_REPOSITORY:-}}"
source_pr="${2:-}"
source_sha="${3:-}"

fail() {
  printf '::error::%s (repository=%s source_pr=%s source_sha=%s)\n' \
    "$1" "${repository:-unset}" "${source_pr:-unset}" "${source_sha:-unset}" >&2
  exit 1
}

[[ -n "$repository" ]] || fail 'Repository is required.'
[[ "$source_pr" =~ ^[0-9]+$ ]] || fail 'Source PR number must be numeric.'
[[ "$source_sha" =~ ^[0-9a-f]{40}$ ]] || fail 'Source SHA must contain 40 lowercase hexadecimal characters.'

source_marker="<!-- release-source:$source_pr:$source_sha -->"
legacy_body="Automatically created from develop by PR #$source_pr at $source_sha."
pulls="$(
  gh api --paginate "repos/$repository/pulls?state=all&base=main&per_page=100" |
    jq -s '[.[][]]'
)" || fail 'Could not list pull requests targeting main.'

# The PR body preserves the source identity even after the branch is deleted.
release="$(
  jq -c --arg marker "$source_marker" --arg legacy "$legacy_body" \
    --arg repository "$repository" '
    [.[] | select(
      .head.repo.full_name == $repository and
      (.head.ref | startswith("release/")) and
      ((.body // "") | contains($marker) or contains($legacy))
    )] | if length > 1 then error("Multiple releases match this source") else .[0] // empty end
  ' <<<"$pulls"
)" || fail 'Could not identify one release PR matching the source identity.'

if [[ -n "$release" ]]; then
  release_branch="$(jq -r '.head.ref' <<<"$release")"
  release_pr="$(jq -r '.number' <<<"$release")"
  if [[ "$(jq -r '.state' <<<"$release")" == "closed" && \
        "$(jq -r '.merged_at // empty' <<<"$release")" == "" ]]; then
    fail "Release PR #$release_pr ($release_branch) was closed without merging; reopen it to retry."
  fi
  version="${release_branch#release/}"
  echo "Reusing $release_branch from PR #$release_pr."
else
  source="$(gh api "repos/$repository/pulls/$source_pr")" || fail 'Could not read source PR.'
  jq -e --arg sha "$source_sha" --arg repository "$repository" '
    .state == "open" and .draft == false and
    .head.ref == "develop" and .base.ref == "main" and
    .head.sha == $sha and .head.repo.full_name == $repository
  ' <<<"$source" >/dev/null || {
    actual="$(jq -r '"state=\(.state) draft=\(.draft) head=\(.head.repo.full_name):\(.head.ref)@\(.head.sha) base=\(.base.ref)"' <<<"$source")"
    fail "Release trigger no longer matches expected open, non-draft $repository:develop@$source_sha -> main; actual $actual."
  }

  comparison="$(gh api "repos/$repository/compare/main...$source_sha")" || fail "Could not compare main...$source_sha."
  jq -e '.ahead_by > 0 and .behind_by == 0' <<<"$comparison" >/dev/null || {
    actual="$(jq -r '"ahead_by=\(.ahead_by) behind_by=\(.behind_by)"' <<<"$comparison")"
    fail "The source must contain current main and include unreleased changes; expected ahead_by>0 behind_by=0, actual $actual."
  }

  active="$(jq -r '[.[] | select(.state == "open" and (.head.ref | startswith("release/")))][0] | if . then "\(.head.ref) (PR #\(.number))" else empty end' <<<"$pulls")"
  [[ -z "$active" ]] || fail "Another release is active: $active."

  tags="$(gh api --paginate "repos/$repository/tags?per_page=100" | jq -s '[.[][] | .name]')" || fail 'Could not list version tags.'
  latest="$(
    jq -r --argjson tags "$tags" '
      ($tags + [.[] | select(.merged_at != null) | .head.ref | sub("^(release|hotfix)/"; "")])[] |
      select(test("^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$"))
    ' <<<"$pulls" | sort -Vu | tail -1
  )" || fail 'Could not determine the latest version from tags and merged main PRs.'
  latest="${latest:-0.0.0}"
  IFS=. read -r major minor patch <<<"$latest"
  version="$major.$minor.$((10#$patch + 1))"
  release_branch="release/$version"

  branches="$(gh api --paginate "repos/$repository/git/matching-refs/heads/" | jq -s '[.[][]]')" || fail "Could not list branches before creating $release_branch."
  if jq -e --arg ref "refs/heads/hotfix/$version" 'any(.[]; .ref == $ref)' <<<"$branches" >/dev/null; then
    fail "Version $version is reserved by an active hotfix (hotfix/$version); complete it before creating $release_branch."
  fi
  conflicting="$(
    jq -r --arg branch "refs/heads/$release_branch" --argjson tags "$tags" '
      [.[] | select((.ref | startswith("refs/heads/release/")) and .ref != $branch) |
        select((.ref | sub("^refs/heads/release/"; "")) as $version | $tags | index($version) == null)
      ][0].ref // empty
    ' <<<"$branches"
  )"
  [[ -z "$conflicting" ]] || fail "Another untagged release branch is active: $conflicting; cannot create $release_branch."
  existing_sha="$(jq -r --arg branch "refs/heads/$release_branch" '[.[] | select(.ref == $branch)][0].object.sha // empty' <<<"$branches")"
  [[ -z "$existing_sha" || "$existing_sha" == "$source_sha" ]] || {
    fail "$release_branch already exists at a different commit; expected_sha=$source_sha actual_sha=$existing_sha."
  }
  if [[ -z "$existing_sha" ]]; then
    gh api --method POST "repos/$repository/git/refs" \
      -f "ref=refs/heads/$release_branch" -f "sha=$source_sha" >/dev/null || fail "Could not create $release_branch at $source_sha."
  fi

  release_pr="$(
    gh api --method POST "repos/$repository/pulls" \
      -f base=main -f "head=$release_branch" -f "title=Release $version" \
      -f "body=$legacy_body

$source_marker" --jq '.number'
  )" || fail "Could not open release PR $release_branch -> main for version $version."
fi

{
  echo "version=$version"
  echo "release_pr=$release_pr"
} >> "$GITHUB_OUTPUT"

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  echo "Release $version: ${GITHUB_SERVER_URL:-https://github.com}/$repository/pull/$release_pr" >> "$GITHUB_STEP_SUMMARY"
fi
