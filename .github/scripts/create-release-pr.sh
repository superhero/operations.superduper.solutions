#!/usr/bin/env bash
# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
set -euo pipefail

repository="${1:-${GITHUB_REPOSITORY:-}}"
source_pr="${2:-}"
source_sha="${3:-}"
changelog_helper="$(dirname "${BASH_SOURCE[0]}")/prepare-release-changelog.mjs"

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
  main_sha="$(jq -er '.base_commit.sha | select(test("^[0-9a-f]{40}$"))' <<< "$comparison")" ||
    fail 'Could not identify the current main commit.'
  jq -e '.behind_by | select(type == "number" and . >= 0 and . == floor)' <<< "$comparison" >/dev/null ||
    fail "Could not determine whether develop contains main at $main_sha."
  assert_fresh_source() {
    local current_source current_main
    current_source="$(gh api "repos/$repository/pulls/$source_pr")" || fail 'Could not recheck source PR before publication.'
    jq -e --arg sha "$source_sha" --arg repository "$repository" '
      .state == "open" and .draft == false and .head.ref == "develop" and .base.ref == "main" and
      .head.sha == $sha and .head.repo.full_name == $repository
    ' <<< "$current_source" >/dev/null || fail 'Source PR changed during release preparation; retry its current head.'
    current_main="$(gh api "repos/$repository/git/ref/heads/main" --jq '.object.sha')" || fail 'Could not recheck main before publication.'
    [[ "$current_main" == "$main_sha" ]] || fail "Main changed during release preparation from $main_sha to $current_main; retry."
  }
  preview="$(node "$changelog_helper" prepare "$source_sha" "$main_sha")" ||
    fail "Could not prepare develop with main at $main_sha."
  jq -e '.substantive_changes == true' <<< "$preview" >/dev/null ||
    fail 'The source must include unreleased changes outside dependency badges; badge updates do not create releases.'
  tags="$(gh api --paginate "repos/$repository/tags?per_page=100" | jq -s '[.[][] | .name]')" || fail 'Could not list version tags.'
  active="$(jq -c --arg repository "$repository" '
    [.[] | select(.state == "open" and .head.repo.full_name == $repository and (.head.ref | startswith("release/")))] |
    if length > 1 then error("Multiple open releases") else .[0] // empty end
  ' <<< "$pulls")" || fail 'Cannot select one active release.'
  if [[ -n "$active" ]]; then
    release_branch="$(jq -r '.head.ref' <<< "$active")"
    release_pr="$(jq -r '.number' <<< "$active")"
    version="${release_branch#release/}"
    existing_sha="$(jq -er '.head.sha | select(test("^[0-9a-f]{40}$"))' <<< "$active")" || fail 'Active release has no valid head SHA.'
    jq -e --arg version "$version" 'index($version) == null' <<< "$tags" >/dev/null || fail "Version $version is already tagged."
    jq -e --arg branch "$release_branch" 'all(.[]; .head.ref != $branch or .merged_at == null)' <<< "$pulls" >/dev/null ||
      fail "Version $version has already been merged."
    preparation="$(node "$changelog_helper" prepare "$source_sha" "$main_sha" "$version" "$existing_sha")" ||
      fail "Could not integrate develop into $release_branch at $existing_sha."
    prepared_sha="$(jq -er '.sha' <<< "$preparation")"
    current_release="$(gh api "repos/$repository/pulls/$release_pr")" || fail 'Could not recheck active release before publication.'
    jq -e --arg branch "$release_branch" --arg sha "$existing_sha" --arg repository "$repository" '
      .state == "open" and .merged_at == null and .base.ref == "main" and
      .head.ref == $branch and .head.sha == $sha and .head.repo.full_name == $repository
    ' <<< "$current_release" >/dev/null || fail 'Active release changed during preparation; retry its current head.'
    assert_fresh_source
    node "$changelog_helper" publish "$repository" "$release_branch" "$existing_sha" "$prepared_sha" ||
      fail "Could not update $release_branch; its expected head was $existing_sha."
    updated_body="$(jq -r '.body // ""' <<< "$current_release")

$source_marker"
    gh api --method PATCH "repos/$repository/pulls/$release_pr" -f "body=$updated_body" >/dev/null ||
      fail "Could not record the integrated source on release PR #$release_pr."
    echo "Updated $release_branch from develop $source_sha."
  else
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
  preparation="$(node "$changelog_helper" prepare "$source_sha" "$main_sha" "$version")" ||
    fail "Could not prepare changelog for $release_branch."
  expected_tree="$(jq -er '.tree' <<< "$preparation")"
  prepared_sha="$(jq -er '.sha' <<< "$preparation")"

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
  validate_prepared_release() {
    jq -e --arg source "$source_sha" --arg main "${2:-$main_sha}" --arg tree "${3:-$expected_tree}" '
      (.sha | test("^[0-9a-f]{40}$")) and
      [.parents[].sha] == [$source, $main] and .commit.tree.sha == $tree
    ' <<< "$1" >/dev/null
  }
  if [[ -n "$existing_sha" && "$existing_sha" != "$source_sha" ]]; then
    prepared="$(gh api "repos/$repository/commits/$existing_sha")" ||
      fail "Could not inspect existing $release_branch at $existing_sha."
    prepared_main="$(jq -er --arg source "$source_sha" --arg existing "$existing_sha" '
      select(.sha == $existing and (.parents | type == "array" and length == 2) and
        .parents[0].sha == $source) | .parents[1].sha | select(test("^[0-9a-f]{40}$"))
    ' <<< "$prepared")" ||
      fail "$release_branch already exists at a different commit; expected prepared develop $source_sha, actual_sha=$existing_sha."
    prepared_tree="$expected_tree"
    if [[ "$prepared_main" != "$main_sha" ]]; then
      # An interrupted attempt may have integrated main before its next badge
      # refresh. Preserve that exact preparation if only badges have advanced.
      bash "$(dirname "${BASH_SOURCE[0]}")/validate-badge-only-advance.sh" \
        "$repository" "$prepared_main" "$main_sha" ||
        fail "$release_branch was prepared against main $prepared_main; current main $main_sha must differ only in dependency badges to retry."
      prepared_preview="$(node "$changelog_helper" prepare "$source_sha" "$prepared_main" "$version")" ||
        fail "Could not verify prepared $release_branch against develop $source_sha and its original main $prepared_main."
      prepared_tree="$(jq -er '.tree' <<< "$prepared_preview")" ||
        fail "Could not identify the expected tree for prepared $release_branch at $existing_sha."
    fi
    validate_prepared_release "$prepared" "$prepared_main" "$prepared_tree" ||
      fail "$release_branch already exists at a different commit; expected develop $source_sha integrated with main $prepared_main and tree $prepared_tree, actual_sha=$existing_sha."
  fi
  assert_fresh_source
  if [[ -z "$existing_sha" ]]; then
    gh api --method POST "repos/$repository/git/refs" \
      -f "ref=refs/heads/$release_branch" -f "sha=$source_sha" >/dev/null || fail "Could not create $release_branch at $source_sha."
  fi
  if [[ -z "$existing_sha" || "$existing_sha" == "$source_sha" ]]; then
    node "$changelog_helper" publish "$repository" "$release_branch" "$source_sha" "$prepared_sha" ||
      fail "Could not prepare $release_branch; its expected head was develop $source_sha."
  else
    node "$changelog_helper" publish "$repository" "$release_branch" "$existing_sha" "$existing_sha" ||
      fail "Prepared $release_branch changed before its pull request could be opened; expected $existing_sha."
  fi

  release_pr="$(
    gh api --method POST "repos/$repository/pulls" \
      -f base=main -f "head=$release_branch" -f "title=Release $version" \
      -f "body=$legacy_body

$source_marker" --jq '.number'
  )" || fail "Could not open release PR $release_branch -> main for version $version."
  fi
fi

{
  echo "version=$version"
  echo "release_pr=$release_pr"
} >> "$GITHUB_OUTPUT"

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  echo "Release $version: ${GITHUB_SERVER_URL:-https://github.com}/$repository/pull/$release_pr" >> "$GITHUB_STEP_SUMMARY"
fi
